/**
 * Unconditional Financing — "Na vrh" / "Odstrani z vrha" (Jasna asked, Brilly approved,
 * 23. 11. 2026; src/lib/ufPinned.ts, POST /requests/:id/pin).
 *
 *   • only an administrator — the same people who approve requests — may pin or unpin, decided by
 *     the SIGNATURE (kind 27235, bound to method + action + request, single-use);
 *   • pinning writes pinned_at / pinned_by and nothing else (no amount, status, approval, window);
 *   • the public list carries pinnedAt; "Odprti" puts pinned first (latest pinned highest) and
 *     leaves every other request where it was;
 *   • the migration only adds two nullable columns; existing requests read as not pinned.
 *
 * The REAL router on a THROWAWAY database (MEJMO_DB_PATH in the OS temp dir) — nothing near
 * data/mejmosefajn.db, no relay.
 *   npx tsx scripts/testUfPinned.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-pinned-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');
if (path.resolve(process.env.MEJMO_DB_PATH).startsWith(path.resolve(new URL('../data', import.meta.url).pathname))) throw new Error('refusing to run against the real data directory');

const { default: express } = await import('express');
const { getDb } = await import('../server/db/connection.js');
const { initializeSchema } = await import('../server/db/schema.js');
const { default: ufRoutes } = await import('../server/routes/unconditionalFinancing.js');
const { default: dbRoutes } = await import('../server/routes/db.js');
const { UF_ACTION_SET_PINNED, UF_ACTION_SET_HIDDEN } = await import('../server/lib/ufSignedAction.js');
const { ufOpenOrder, ufIsPinned } = await import('../src/lib/ufPinned.js');

const now = Math.floor(Date.now() / 1000);
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 300) : ''); }
};
const quiet = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const log = console.log; console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};
interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const admin = newKey(), moduleAdmin = newKey(), stranger = newKey(), owner = newKey();
const randomHex = () => Buffer.from(generateSecretKey()).toString('hex').slice(0, 32);

console.log('— the migration: two nullable columns, nothing else —');
{
  // The table as production has it today: approval columns, no pinned columns.
  const old = new Database(':memory:');
  old.exec(`CREATE TABLE uf_requests (
    id TEXT PRIMARY KEY, event_id TEXT UNIQUE, pubkey TEXT NOT NULL, title TEXT NOT NULL,
    short_desc TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', request_type TEXT NOT NULL DEFAULT 'personal_hardship',
    fiat_goal REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', wallet TEXT NOT NULL DEFAULT '',
    cover_image TEXT, gallery_images TEXT NOT NULL DEFAULT '[]', crowdfunding_refs TEXT NOT NULL DEFAULT '[]',
    published_at INTEGER NOT NULL DEFAULT 0, funding_opens_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
    is_hidden INTEGER NOT NULL DEFAULT 0, is_repaid INTEGER NOT NULL DEFAULT 0, nostr_created_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    approved_at INTEGER, approved_by TEXT, approved_event_id TEXT, approved_fiat_goal REAL, approved_currency TEXT)`);
  old.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal, currency, approved_at, approved_by, approved_event_id, approved_fiat_goal, approved_currency)
               VALUES ('uf:old', 'ev-old', 'p', 'Old', 1300, 'EUR', 111, 'grandfathered', 'ev-old', 1300, 'EUR')`).run();
  const before = old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:old'").get() as any;
  await quiet(() => initializeSchema(old));
  const after = old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:old'").get() as any;
  check('the columns arrive', 'pinned_at' in after && 'pinned_by' in after, Object.keys(after));
  check('an existing request reads as not pinned', after.pinned_at === null && after.pinned_by === null, after);
  const { pinned_at: _a, pinned_by: _b, ...rest } = after;
  check('…and every other column is exactly as it was', JSON.stringify(rest) === JSON.stringify(before), { before, after });
  await quiet(() => initializeSchema(old));
  check('a second start changes nothing', JSON.stringify(old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:old'").get()) === JSON.stringify(after));
  const fresh = new Database(':memory:');
  await quiet(() => initializeSchema(fresh));
  check('a database built from scratch has them too',
    (fresh.prepare('PRAGMA table_info(uf_requests)').all() as any[]).filter((c) => c.name === 'pinned_at' || c.name === 'pinned_by').length === 2);
}

console.log('— the order, on its own —');
{
  const list = [
    { id: 'a', pinnedAt: null }, { id: 'b', pinnedAt: 100 }, { id: 'c', pinnedAt: null },
    { id: 'd', pinnedAt: 300 }, { id: 'e', pinnedAt: null }, { id: 'f', pinnedAt: 200 },
  ];
  const ids = (l: { id: string }[]) => l.map((r) => r.id).join('');
  check('pinned first, the most recently pinned highest; the rest keep their order', ids(ufOpenOrder(list)) === 'dfbace', ids(ufOpenOrder(list)));
  check('the input is not changed', ids(list) === 'abcdef');
  check('nothing pinned → the order is exactly the one given', ids(ufOpenOrder(list.map((r) => ({ ...r, pinnedAt: null })))) === 'abcdef');
  const unpinned = list.map((r) => (r.id === 'd' ? { ...r, pinnedAt: null } : r));
  check('unpinned → back to its own place among the rest', ids(ufOpenOrder(unpinned)) === 'fbacde', ids(ufOpenOrder(unpinned)));
  check('same second → the order it had', ids(ufOpenOrder([{ id: 'x', pinnedAt: 5 }, { id: 'y', pinnedAt: 5 }])) === 'xy');
  check('0, a negative or a missing time is not pinned', !ufIsPinned({ pinnedAt: 0 }) && !ufIsPinned({ pinnedAt: -1 }) && !ufIsPinned({}) && ufIsPinned({ pinnedAt: 1 }));
}

// ── the real router on the throwaway database ──
const db = getDb();
db.prepare('INSERT INTO admin_users (nostr_hex_id) VALUES (?)').run(admin.pk);
db.prepare(`INSERT INTO app_settings (key, value) VALUES ('unconditional_financing_admins', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
  .run(JSON.stringify([moduleAdmin.pk]));
const insert = (id: string, createdAt: number) => db.prepare(`
  INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal, currency, wallet, published_at, funding_opens_at, status, nostr_created_at,
                           approved_at, approved_by, approved_event_id, approved_fiat_goal, approved_currency)
  VALUES (?, ?, ?, ?, 1000, 'EUR', 'LWallet', ?, ?, 'active', ?, ?, 'x', ?, 1000, 'EUR')
`).run(id, `ev-${id}`, owner.pk, `Request ${id}`, createdAt, createdAt, createdAt, createdAt, `ev-${id}`);
const IDS = ['uf:one', 'uf:two', 'uf:three', 'uf:four'];
IDS.forEach((id, i) => insert(id, now - 1000 + i * 10)); // newest last → the list shows four, three, two, one

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
app.use('/api/db', dbRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}`;
const UF = `${BASE}/api/unconditional-financing`;

const sign = (who: Key, id: string, fields: Record<string, unknown>, opts: { method?: string; action?: string; boundId?: string; at?: number } = {}) =>
  finalizeEvent({
    kind: 27235,
    created_at: opts.at ?? Math.floor(Date.now() / 1000),
    tags: [['u', `${UF}/requests/${id}/pin`], ['method', opts.method ?? 'POST'], ['nonce', randomHex()]],
    content: JSON.stringify({ action: opts.action ?? UF_ACTION_SET_PINNED, id: opts.boundId ?? id, ...fields }),
  }, who.sk);
const post = async (id: string, body: unknown) => {
  const r = await quiet(() => fetch(`${UF}/requests/${encodeURIComponent(id)}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const pin = (who: Key, id: string, pinned: unknown) => post(id, { event: sign(who, id, { pinned }) });
const rowOf = (id: string) => db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(id) as any;
const listed = async () => {
  const d = await (await fetch(`${UF}/requests?tab=repaying&page=1&limit=100`)).json();
  return d.requests as { id: string; pinnedAt: number | null }[];
};
const openOrder = async () => ufOpenOrder(await listed()).map((r) => r.id);

console.log('— who may pin: the signature decides —');
{
  const T = 'uf:two';
  const before = rowOf(T);
  const noEvent = await post(T, {});
  check('no signed event → 401', noEvent.status === 401, noEvent);
  const bodyClaim = await post(T, { adminPubkey: admin.pk, pinned: true });
  check('an administrator’s public key in the body is not a signature → 401', bodyClaim.status === 401, bodyClaim);
  const strangerTry = await pin(stranger, T, true);
  check('a stranger’s signature → 403', strangerTry.status === 403, strangerTry);
  const ownerTry = await pin(owner, T, true);
  check('the request’s own author is not an administrator → 403', ownerTry.status === 403, ownerTry);
  const forged = sign(admin, T, { pinned: true });
  const tampered = { ...forged, pubkey: stranger.pk };
  check('an event whose signature does not match → 401', (await post(T, { event: tampered })).status === 401);
  check('signed for another method → 401', (await post(T, { event: sign(admin, T, { pinned: true }, { method: 'PATCH' }) })).status === 401);
  check('signed for another action (archive) → 401', (await post(T, { event: sign(admin, T, { pinned: true }, { action: UF_ACTION_SET_HIDDEN }) })).status === 401);
  check('signed for another request → 401', (await post(T, { event: sign(admin, T, { pinned: true }, { boundId: 'uf:one' }) })).status === 401);
  check('signed too long ago → 401', (await post(T, { event: sign(admin, T, { pinned: true }, { at: Math.floor(Date.now() / 1000) - 3600 }) })).status === 401);
  check('…none of that wrote anything', JSON.stringify(rowOf(T)) === JSON.stringify(before), rowOf(T));
  check('"pinned" that is not true/false → 400', (await pin(admin, T, 'yes')).status === 400);
  check('an unknown request → 404', (await pin(admin, 'uf:nope', true)).status === 404);
}

console.log('— an administrator pins and unpins —');
{
  check('nothing pinned: the order is the existing one (newest first)', (await openOrder()).join() === 'uf:four,uf:three,uf:two,uf:one', await openOrder());
  check('the public list carries pinnedAt (null when not pinned)', (await listed()).every((r) => 'pinnedAt' in r && r.pinnedAt === null));

  const before = rowOf('uf:two');
  const ev = sign(admin, 'uf:two', { pinned: true });
  const r = await post('uf:two', { event: ev });
  check('an administrator (admin_users) pins → 200', r.status === 200 && r.data.pinnedAt > 0, r);
  const after = rowOf('uf:two');
  check('pinned_at and pinned_by are written', after.pinned_at > 0 && after.pinned_by === admin.pk, after);
  const strip = (row: any) => { const { pinned_at: _a, pinned_by: _b, ...rest } = row; return JSON.stringify(rest); };
  check('…and NOTHING else in the row changed (amount, status, approval, window, updated_at)', strip(after) === strip(before), { before, after });
  check('the same signed event a second time → 401 (single-use)', (await post('uf:two', { event: ev })).status === 401);
  check('"Odprti": the pinned request is first, the others keep their order', (await openOrder()).join() === 'uf:two,uf:four,uf:three,uf:one', await openOrder());
  check('the public list shows it pinned', (await listed()).find((x) => x.id === 'uf:two')?.pinnedAt === after.pinned_at);

  // The module's own administrator list counts as well (the same check approval uses).
  await new Promise((res) => setTimeout(res, 1100)); // a later second, so the order is visible
  const m = await pin(moduleAdmin, 'uf:one', true);
  check('an administrator from the module’s own list pins → 200', m.status === 200, m);
  check('two pinned: the most recently pinned is highest', (await openOrder()).join() === 'uf:one,uf:two,uf:four,uf:three', await openOrder());

  const firstTime = rowOf('uf:two').pinned_at;
  await new Promise((res) => setTimeout(res, 1100));
  check('pinning one that is already on top → 200, keeps its first time', (await pin(moduleAdmin, 'uf:two', true)).status === 200
    && rowOf('uf:two').pinned_at === firstTime && rowOf('uf:two').pinned_by === admin.pk, rowOf('uf:two'));

  const beforeUnpin = rowOf('uf:one');
  check('unpin → 200', (await pin(admin, 'uf:one', false)).status === 200);
  check('…the columns are cleared, nothing else changes', rowOf('uf:one').pinned_at === null && rowOf('uf:one').pinned_by === null && strip(rowOf('uf:one')) === strip(beforeUnpin));
  check('…and it is back in its own place', (await openOrder()).join() === 'uf:two,uf:four,uf:three,uf:one', await openOrder());
  check('a stranger cannot unpin → 403, still pinned', (await pin(stranger, 'uf:two', false)).status === 403 && rowOf('uf:two').pinned_at === firstTime);
  check('unpin the last one → the original order', (await pin(admin, 'uf:two', false)).status === 200 && (await openOrder()).join() === 'uf:four,uf:three,uf:two,uf:one', await openOrder());
}

console.log('— no side door —');
{
  const r = await fetch(`${BASE}/api/db/uf_requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'uf:three', pinned_at: now }) });
  check('the generic /api/db route does not reach uf_requests', r.status >= 400 && rowOf('uf:three').pinned_at === null, r.status);
}

http.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
