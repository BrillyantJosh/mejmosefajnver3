/**
 * A stored file must never run as the app.
 *   npx tsx scripts/testStorageServe.ts
 *
 * POST /api/storage/:bucket/upload takes any file from anyone, and GET serves it
 * back from the app's own origin — the origin whose localStorage holds the
 * signed-in person's keys. An uploaded .html or .svg opened there used to run
 * with that origin. So every served file now carries nosniff and a sandbox CSP,
 * and only pictures, sound and video display inline; everything else comes back
 * as a download of plain bytes. Only files are served, never a folder — not
 * even one named like a picture with an index.html inside.
 *
 * The router is mounted exactly where production mounts it, files are uploaded
 * the way the client uploads them (the `path` field first, then the file) into a
 * folder of their own, and the folder is removed at the end.
 */
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import storageRoutes from '../server/routes/storage.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

// Same folder storage.ts writes to (server/routes/../uploads).
const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/uploads');
const BUCKETS = ['room-files', 'dm-audio'];
const TEST_DIR = `storage-serve-test-${randomUUID()}`;

// 1×1 transparent PNG, so the "picture" really is one.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64',
);
const SCRIPT = '<script>localStorage.getItem("lana_user_session")</script>';

type Case = { name: string; body: Buffer; inline: boolean; type: string };
const CASES: Case[] = [
  { name: 't.html', body: Buffer.from(`<!doctype html><html><body>${SCRIPT}</body></html>`), inline: false, type: 'application/octet-stream' },
  { name: 't.svg', body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${SCRIPT}</svg>`), inline: false, type: 'application/octet-stream' },
  { name: 't.pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n'), inline: false, type: 'application/octet-stream' },
  { name: 't.png', body: PNG, inline: true, type: 'image/png' },
  // Camera files keep their own extension (CreatePost, OWN ChatView), often in capitals.
  { name: 'upper.PNG', body: PNG, inline: true, type: 'image/png' },
  { name: 't.webm', body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]), inline: true, type: 'video/webm' },
  { name: 't.aac', body: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc]), inline: true, type: 'audio/aac' },
];

// dm-audio .webm goes through its own stream branch, which forces audio/webm.
const expectedType = (bucket: string, c: Case) =>
  bucket === 'dm-audio' && c.name.endsWith('.webm') ? 'audio/webm' : c.type;

async function main() {
  const app = express();
  app.use('/api/storage', storageRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  const upload = async (bucket: string, c: Case) => {
    const form = new FormData();
    form.append('path', `${TEST_DIR}/${c.name}`);
    form.append('file', new Blob([c.body]), c.name);
    const r = await fetch(`${base}/api/storage/${bucket}/upload`, { method: 'POST', body: form });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  // Both headers, whatever else the response is.
  const hardened = (label: string, h: Headers) => {
    check(`${label}: nosniff`, h.get('x-content-type-options') === 'nosniff', h.get('x-content-type-options'));
    check(`${label}: sandboxed`, h.get('content-security-policy') === 'sandbox', h.get('content-security-policy'));
  };

  try {
    for (const bucket of BUCKETS) {
      console.log(`— ${bucket} —`);
      for (const c of CASES) {
        const up = await upload(bucket, c);
        const url = up.json?.data?.publicUrl;
        check(`${c.name}: upload still works`, up.status === 200 && url === `/api/storage/${bucket}/${TEST_DIR}/${c.name}`, up);
        if (!url) continue;

        const r = await fetch(`${base}${url}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        const label = `${bucket}/${c.name}`;
        check(`${label}: served`, r.status === 200, r.status);
        hardened(label, r.headers);

        const type = (r.headers.get('content-type') || '').split(';')[0];
        const disposition = r.headers.get('content-disposition');
        if (c.inline) {
          check(`${label}: shown inline as ${expectedType(bucket, c)}`, type === expectedType(bucket, c) && disposition === null, { type, disposition });
        } else {
          check(`${label}: a download of plain bytes`, type === 'application/octet-stream' && disposition === 'attachment', { type, disposition });
        }
        check(`${label}: the bytes come back unchanged`, bytes.equals(c.body), bytes.length);
      }
    }

    console.log('— the dm-audio stream branch, when a player seeks —');
    {
      const r = await fetch(`${base}/api/storage/dm-audio/${TEST_DIR}/t.webm`, { headers: { Range: 'bytes=0-3' } });
      check('a range request gets 206 with audio/webm', r.status === 206 && r.headers.get('content-type') === 'audio/webm', [r.status, r.headers.get('content-type')]);
      hardened('dm-audio range', r.headers);
      await r.arrayBuffer();
    }

    console.log('— a folder named like a picture —');
    {
      // The upload's `path` can make room-files/<TEST_DIR>/x.png/ with an index.html
      // inside. `x.png/` has the extension .png, and send() used to serve the folder's
      // index.html from it as text/html — which a room message can open as a picture.
      const page: Case = { name: 'x.png/index.html', body: Buffer.from(`<!doctype html><html><body>${SCRIPT}</body></html>`), inline: false, type: 'application/octet-stream' };
      const up = await upload('room-files', page);
      check('the upload makes the folder', up.status === 200 && fs.existsSync(path.join(UPLOADS_DIR, 'room-files', TEST_DIR, 'x.png', 'index.html')), up);

      for (const tail of ['x.png/', 'x.png%2F', 'x.png/?.png', 'x.png']) {
        const r = await fetch(`${base}/api/storage/room-files/${TEST_DIR}/${tail}`);
        const type = r.headers.get('content-type') || '';
        const body = await r.text();
        check(`${tail}: is a 404`, r.status === 404, r.status);
        check(`${tail}: never the page inside`, !type.startsWith('text/html') && !body.includes(SCRIPT), { type, body: body.slice(0, 80) });
        hardened(tail, r.headers);
      }

      const r = await fetch(`${base}/api/storage/room-files/${TEST_DIR}/x.png/index.html`);
      const type = (r.headers.get('content-type') || '').split(';')[0];
      check('the file itself is still a download of plain bytes', r.status === 200 && type === 'application/octet-stream' && r.headers.get('content-disposition') === 'attachment', [r.status, type]);
      await r.arrayBuffer();
    }

    console.log('— a missing file —');
    {
      const r = await fetch(`${base}/api/storage/room-files/${TEST_DIR}/nothing-here.html`);
      check('is a 404', r.status === 404, r.status);
      hardened('404', r.headers);
    }
  } finally {
    server.close();
    for (const bucket of BUCKETS) {
      fs.rmSync(path.join(UPLOADS_DIR, bucket, TEST_DIR), { recursive: true, force: true });
    }
  }

  console.log('— cleanup —');
  for (const bucket of BUCKETS) {
    const dir = path.join(UPLOADS_DIR, bucket, TEST_DIR);
    check(`${bucket}: the test files are gone`, !fs.existsSync(dir), dir);
  }

  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ a stored file is a picture, a sound, a video or a download — never a page of this app');
  process.exit(failures ? 1 : 0);
}
main().catch((err) => {
  console.error('❌ test crashed:', err);
  process.exit(1);
});
