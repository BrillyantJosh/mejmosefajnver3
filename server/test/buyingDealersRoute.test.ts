/**
 * GET /api/buying-dealers, the route: what goes over the wire.
 *   npm run test:sell-moved
 *
 *   the shape    lana.discount's answer exactly — status, readAt, staleSince,
 *                directoryUrl, buyers[{slug, name, host, website, registerUrl,
 *                sellUrl, eventId, signedAt}] — and nothing else, even when
 *                the reader hands over more;
 *   no secrets   no admin or signer key, no bank account, no owner, no npub;
 *   no cache     Cache-Control: no-cache, on an answer and on a failure;
 *   no auth      public and read-only, mounted before the SPA fallback that
 *                answers every unknown /api/* with a 404.
 *
 * The router is mounted on a fresh express() at 127.0.0.1 with a stand-in
 * reader — server/index.ts is never imported (it opens the database and
 * starts the heartbeat), and no relay or website is reached.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { buyingDealersRouter, publicAnswer, type BuyingDealersSource } from '../routes/buyingDealers.js';
import { BEF_DIRECTORY_URL, createBuyingDealersReader, type BuyingDealersAnswer } from '../lib/buyingDealers.js';
import {
  dealerContent, dealerEvent, fakeRelays, fakeSites, makeKey, newIdentity, signEvent, NOW_MS, NOW_S,
} from '../lib/befDealers/dealerTestKit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..');

const servers: Server[] = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

async function serve(reader: BuyingDealersSource): Promise<string> {
  const app = express();
  app.use('/api/buying-dealers', buyingDealersRouter(reader));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buying-dealers`;
}

const ADMIN = 'a'.repeat(64);
const KROG = 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.';
const RAVENA = 'Ravena Plus d.o.o.';

/** An answer as the reader gives it — plus fields that must never go out. */
const readerAnswer = (): BuyingDealersAnswer => ({
  status: 'read',
  readAt: new Date(NOW_MS).toISOString(),
  staleSince: null,
  directoryUrl: BEF_DIRECTORY_URL,
  buyers: [
    {
      slug: 'krog-menjave', name: KROG, host: 'krogmenjave.com', website: 'https://krogmenjave.com/',
      registerUrl: 'https://krogmenjave.com/prijava', sellUrl: 'https://krogmenjave.com/ko-kreacija/prodaj',
      eventId: '1'.repeat(64), signedAt: new Date((NOW_S - 3600) * 1000).toISOString(),
      // What a future reader might carry by mistake:
      ...({ admins: [ADMIN], pubkey: ADMIN, iban: 'SI56191000000123438', owner: 'npub1someone' } as object),
    } as BuyingDealersAnswer['buyers'][number],
    {
      slug: 'ravena-plus', name: RAVENA, host: 'ravenaplus.com', website: 'https://ravenaplus.com/',
      registerUrl: 'https://ravenaplus.com/prijava', sellUrl: 'https://ravenaplus.com/ko-kreacija/prodaj',
      eventId: '2'.repeat(64), signedAt: new Date((NOW_S - 7200) * 1000).toISOString(),
    },
  ],
  ...({ relays: ['wss://relay.example'], reliable: [ADMIN] } as object),
});

const BUYER_KEYS = ['eventId', 'host', 'name', 'registerUrl', 'sellUrl', 'signedAt', 'slug', 'website'];
const ANSWER_KEYS = ['buyers', 'directoryUrl', 'readAt', 'staleSince', 'status'];

describe('GET /api/buying-dealers', () => {
  it('answers 200, no-cache, with exactly lana.discount’s fields — and no key, bank account or npub', async () => {
    const url = await serve({ get: async () => readerAnswer() });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ANSWER_KEYS);
    assert.equal(body.status, 'read');
    assert.equal(body.directoryUrl, 'https://befexplorer.com/companies');
    assert.deepEqual(body.buyers.map((b: any) => b.name), [KROG, RAVENA]);
    for (const b of body.buyers) {
      assert.deepEqual(Object.keys(b).sort(), BUYER_KEYS);
      for (const link of [b.website, b.registerUrl, b.sellUrl]) {
        const u = new URL(link);
        assert.equal(u.protocol, 'https:');
        assert.equal(u.hostname, b.host);
      }
      assert.equal(b.registerUrl, `https://${b.host}/prijava`);
      assert.equal(b.sellUrl, `https://${b.host}/ko-kreacija/prodaj`);
    }
    for (const secret of [ADMIN, 'npub', 'SI56191000000123438', 'iban', 'admins', 'pubkey', 'relay.example', 'reliable']) {
      assert.ok(!text.includes(secret), `${secret} must not go out`);
    }
  });

  it('no firm yet: "unknown", an empty list and the BEF Explorer directory', async () => {
    const url = await serve({ get: async () => ({ status: 'unknown', readAt: null, staleSince: null, directoryUrl: BEF_DIRECTORY_URL, buyers: [] }) });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.deepEqual(await res.json(), { status: 'unknown', readAt: null, staleSince: null, directoryUrl: 'https://befexplorer.com/companies', buyers: [] });
  });

  it('a reader that throws: 500 with a sentence, still no-cache, never a stack', async () => {
    const url = await serve({ get: async () => { throw new Error('SQLITE_CANTOPEN: /app/data/mejmosefajn.db'); } });
    const res = await fetch(url);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.deepEqual(await res.json(), { error: 'The companies could not be read right now.' });
  });

  it('end to end with the real reader: a signed KIND 38888 in, two firms out — on the verified host', async () => {
    const authority = makeKey();
    const krog = newIdentity();
    const ravena = newIdentity();
    const params = signEvent(authority, {
      kind: 38888, created_at: NOW_S - 86_400, content: '{}',
      tags: [['d', 'main'], ['relay', 'wss://relay.one.test'], ['reliable_person', krog.hex, 'K'], ['reliable_person', ravena.hex, 'R']],
    });
    const db = new Database(':memory:');
    db.exec('CREATE TABLE kind_38888 (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, relays TEXT NOT NULL, raw_event TEXT NOT NULL)');
    db.prepare('INSERT INTO kind_38888 VALUES (?, ?, ?, ?)').run('synced_1', params.created_at, '["wss://relay.lanacoin-eternity.com"]', JSON.stringify(params));
    const events = [
      dealerEvent(krog, 'krog-menjave', dealerContent({ host: 'krogmenjave.test', name: KROG })),
      dealerEvent(ravena, 'ravena-plus', dealerContent({ host: 'ravenaplus.test', name: RAVENA })),
    ];
    const asked: string[][] = [];
    const reader = createBuyingDealersReader({
      db: () => db,
      author: authority.pub,
      now: () => NOW_MS,
      reader: {
        fetchEvents: async (r, f) => { asked.push(r); return fakeRelays(events).source(r, f); },
        fetchWellKnown: fakeSites({
          'krogmenjave.test': { dealers: { 'krog-menjave': { admins: [krog.hex] } } },
          'ravenaplus.test': { dealers: { 'ravena-plus': { admins: [ravena.hex] } } },
        }).lookup,
      },
    });
    const res = await fetch(await serve(reader));
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.status, 'read');
    assert.deepEqual(body.buyers.map((b: any) => [b.name, b.registerUrl, b.sellUrl]), [
      [KROG, 'https://krogmenjave.test/prijava', 'https://krogmenjave.test/ko-kreacija/prodaj'],
      [RAVENA, 'https://ravenaplus.test/prijava', 'https://ravenaplus.test/ko-kreacija/prodaj'],
    ]);
    // The relays of the signed event, never the column's old alias.
    assert.ok(asked.length > 0 && asked.every((r) => JSON.stringify(r) === '["wss://relay.one.test"]'), JSON.stringify(asked));
    for (const secret of [krog.hex, ravena.hex, 'e'.repeat(64), 'SI56191000000123438', 'npub']) assert.ok(!text.includes(secret), secret);
  });

  it('publicAnswer keeps the answer’s values as they are', () => {
    const a = readerAnswer();
    const p = publicAnswer(a);
    assert.equal(p.buyers[0].name, KROG);
    assert.equal(p.readAt, a.readAt);
    assert.deepEqual(Object.keys(p.buyers[0]).sort(), BUYER_KEYS);
  });
});

describe('the mount', () => {
  const index = fs.readFileSync(path.join(SERVER, 'index.ts'), 'utf8');
  const route = fs.readFileSync(path.join(SERVER, 'routes/buyingDealers.ts'), 'utf8');

  it('is mounted once, before /health and the SPA fallback that 404s every unknown /api/*', () => {
    const mounts = index.match(/app\.use\('\/api\/buying-dealers', buyingDealersRoutes\);/g) ?? [];
    assert.equal(mounts.length, 1);
    const at = index.indexOf("app.use('/api/buying-dealers'");
    assert.ok(at > 0 && at < index.indexOf("app.get('/health'") && at < index.indexOf("app.get('/{*path}'"));
    assert.match(index, /import buyingDealersRoutes from '\.\/routes\/buyingDealers\.js';/);
  });

  it('asks nothing of the visitor: no session, no body, only GET', () => {
    assert.ok(!/router\.(post|put|patch|delete)\(/.test(route));
    assert.ok(!/req\.(body|query|params|headers)/.test(route));
    assert.ok(!/requireAuth|nip98|authorization/i.test(route.replace(/\/\*[\s\S]*?\*\//g, '')));
  });
});
