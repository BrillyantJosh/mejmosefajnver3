// DM audio retention sweep — the pure directory walker behind
// POST /api/functions/cleanup-dm-audio and the daily heartbeat run.
// Run: npm run test:voice
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanupDmAudioDir } from '../routes/functions.js';

const DAY = 24 * 60 * 60 * 1000;

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-audio-'));
  const now = Date.now();
  const touch = (rel: string, ageDays: number, size = 10) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x'.repeat(size));
    const t = new Date(now - ageDays * DAY);
    fs.utimesSync(full, t, t);
    return full;
  };
  // <sender>-<process>/<ts>_<rand>.webm — the real layout, one level deep
  const oldA = touch('aaa-ppp/1_a.webm', 400, 100);
  const oldB = touch('aaa-ppp/2_b.webm', 366, 50);
  const fresh = touch('aaa-ppp/3_c.webm', 10, 7);
  const oldOnly = touch('bbb-qqq/4_d.webm', 500, 30);
  // an old folder that still holds a fresh file must survive
  const emptyDir = path.join(root, 'ccc-rrr');
  fs.mkdirSync(emptyDir);
  return { root, now, oldA, oldB, fresh, oldOnly, emptyDir };
}

test('dry run counts old files and their bytes without deleting anything', () => {
  const t = makeTree();
  const r = cleanupDmAudioDir(t.root, { retentionDays: 365, dry: true, now: t.now });
  assert.deepEqual(r, { candidates: 3, bytes: 180, deleted: 0, dry: true });
  for (const f of [t.oldA, t.oldB, t.fresh, t.oldOnly]) assert.ok(fs.existsSync(f), f);
  assert.ok(fs.existsSync(t.emptyDir));
  fs.rmSync(t.root, { recursive: true, force: true });
});

test('real run deletes only old files, keeps fresh ones, prunes emptied folders but never the root', () => {
  const t = makeTree();
  const r = cleanupDmAudioDir(t.root, { retentionDays: 365, now: t.now });
  assert.equal(r.deleted, 3);
  assert.equal(r.candidates, 3);
  assert.equal(r.bytes, 180);
  assert.equal(r.dry, false);
  assert.ok(!fs.existsSync(t.oldA));
  assert.ok(!fs.existsSync(t.oldB));
  assert.ok(!fs.existsSync(t.oldOnly));
  assert.ok(fs.existsSync(t.fresh), 'fresh file kept');
  assert.ok(fs.existsSync(path.dirname(t.fresh)), 'folder with a fresh file kept');
  assert.ok(!fs.existsSync(path.dirname(t.oldOnly)), 'emptied folder pruned');
  assert.ok(!fs.existsSync(t.emptyDir), 'already-empty folder pruned');
  assert.ok(fs.existsSync(t.root), 'root never removed');
  fs.rmSync(t.root, { recursive: true, force: true });
});

test('retention window is honoured and a missing directory is a no-op', () => {
  const t = makeTree();
  // 30-day window: the 10-day-old file is the only survivor
  const r = cleanupDmAudioDir(t.root, { retentionDays: 30, dry: true, now: t.now });
  assert.equal(r.candidates, 3);
  // 1000-day window: nothing is old enough
  const r2 = cleanupDmAudioDir(t.root, { retentionDays: 1000, dry: true, now: t.now });
  assert.equal(r2.candidates, 0);
  fs.rmSync(t.root, { recursive: true, force: true });
  assert.deepEqual(cleanupDmAudioDir(path.join(t.root, 'nope'), { dry: false }),
    { candidates: 0, bytes: 0, deleted: 0, dry: false });
});
