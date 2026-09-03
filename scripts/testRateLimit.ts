/**
 * The rate limiter, and — just as important — where it does NOT apply.
 *   npx tsx scripts/testRateLimit.ts
 *
 * A limiter is the one piece of middleware that decides whether a request is
 * served at all, and this fleet has been taken down by one twice: once mounted
 * ahead of the static files so people got blank pages, once broad enough that
 * the JavaScript bundle came back 429 and the app could not load to stop
 * asking. So the placement is tested here too, not just the counting.
 */
import express from 'express';
import { createRateLimit } from '../server/lib/rateLimit.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = express();
  // Exactly the production shape: the limiter on one API router, nothing else.
  app.use('/api/voice', createRateLimit({ max: 3, windowMs: 400, message: 'slow down' }), (_r, res) => res.json({ ok: true }));
  app.get('/assets/app.js', (_r, res) => res.type('js').send('console.log(1)'));
  app.get('/api/db/thing', (_r, res) => res.json({ ok: true }));
  app.get('/', (_r, res) => res.type('html').send('<html></html>'));

  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = (server.address() as any).port;
  const get = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: r.status, retry: r.headers.get('retry-after'), body: await r.text() };
  };

  console.log('— it counts —');
  {
    const a = await get('/api/voice/x');
    const b = await get('/api/voice/x');
    const c = await get('/api/voice/x');
    check('the first three pass', [a, b, c].every((r) => r.status === 200), [a.status, b.status, c.status]);
    const d = await get('/api/voice/x');
    check('the fourth is refused', d.status === 429, d.status);
    check('and says how long to wait', !!d.retry, d.retry);
    check('with a message a person can act on', d.body.includes('slow down'), d.body);
  }

  console.log('— and it forgives —');
  {
    await sleep(450);
    const e = await get('/api/voice/x');
    check('a new window lets the caller back in', e.status === 200, e.status);
  }

  console.log('— it does NOT touch anything else —');
  {
    // The failure that matters: the bundle must never be refused, however hard
    // the API is being hammered.
    for (let i = 0; i < 20; i++) await get('/api/voice/x');
    const js = await get('/assets/app.js');
    const html = await get('/');
    const db = await get('/api/db/thing');
    check('the JavaScript bundle is untouched', js.status === 200, js.status);
    check('the page itself is untouched', html.status === 200, html.status);
    check('other API routes are untouched', db.status === 200, db.status);
  }

  server.close();
  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}
main();
