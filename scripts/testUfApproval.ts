/**
 * Unconditional Financing — a request is public only once an administrator approved it, and what
 * was approved (above all the amount) is what everyone reads and funds (Jasna and Brilly,
 * 16. 11. 2026; server/lib/ufApproval.ts).
 *
 * The REAL router and the REAL relay indexer, on a THROWAWAY database (MEJMO_DB_PATH in the OS
 * temp dir) with a fake relay on 127.0.0.1 — nothing near data/mejmosefajn.db, no real relay.
 *   npx tsx scripts/testUfApproval.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-approval-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');
if (path.resolve(process.env.MEJMO_DB_PATH).startsWith(path.resolve(new URL('../data', import.meta.url).pathname))) throw new Error('refusing to run against the real data directory');

const { default: express } = await import('express');
const { getDb } = await import('../server/db/connection.js');
const { initializeSchema } = await import('../server/db/schema.js');
const { default: ufRoutes } = await import('../server/routes/unconditionalFinancing.js');
const { indexUnconditionalFinancingFromRelays, resetUfIndexerCaches } = await import('../server/lib/nostr.js');
const { closeRelayPool } = await import('../server/lib/relayPool.js');
const { approvalHolds, editAllowedAfterApproval, frozenContentOfRow, fundingRefusal } = await import('../server/lib/ufApproval.js');

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 300) : ''); }
};
interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const service = newKey(), registrar = newKey(), admin = newKey(), stranger = newKey(), owner = newKey(), supporter = newKey(), sideDoor = newKey();
const randomHex = () => Buffer.from(generateSecretKey()).toString('hex').slice(0, 32);

console.log('— the deploy itself: requests that already exist are approved, amounts pinned —');
{
  // The table as production has it before this change, without the approval columns.
  const old = new Database(':memory:');
  old.exec(`CREATE TABLE uf_requests (
    id TEXT PRIMARY KEY, event_id TEXT UNIQUE, pubkey TEXT NOT NULL, title TEXT NOT NULL,
    short_desc TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', request_type TEXT NOT NULL DEFAULT 'personal_hardship',
    fiat_goal REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', wallet TEXT NOT NULL DEFAULT '',
    cover_image TEXT, gallery_images TEXT NOT NULL DEFAULT '[]', crowdfunding_refs TEXT NOT NULL DEFAULT '[]',
    published_at INTEGER NOT NULL DEFAULT 0, funding_opens_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
    is_hidden INTEGER NOT NULL DEFAULT 0, is_repaid INTEGER NOT NULL DEFAULT 0, nostr_created_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  old.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal, currency, is_hidden) VALUES ('uf:old-a', 'ev-a', 'p', 'A', 1300, 'EUR', 0)`).run();
  old.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal, currency, is_hidden) VALUES ('uf:old-b', 'ev-b', 'p', 'B', 90000, 'GBP', 1)`).run();
  const log = console.log; console.log = () => {};
  try { initializeSchema(old); } finally { console.log = log; }
  const a = old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:old-a'").get() as any;
  const b = old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:old-b'").get() as any;
  check('an existing request is approved, with the amount and currency it stood at pinned',
    approvalHolds(a) && a.approved_fiat_goal === 1300 && a.approved_currency === 'EUR' && a.approved_event_id === 'ev-a' && a.approved_by === 'grandfathered', a);
  check('…a hidden one too, and it stays hidden (archived)', approvalHolds(b) && b.is_hidden === 1 && b.approved_fiat_goal === 90000 && b.approved_currency === 'GBP', b);
  old.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal) VALUES ('uf:after', 'ev-c', 'p', 'C', 50)`).run();
  console.log = () => {};
  try { initializeSchema(old); } finally { console.log = log; }
  const c = old.prepare("SELECT * FROM uf_requests WHERE id = 'uf:after'").get() as any;
  check('the next start grandfathers nothing: a request that arrives after the deploy waits', !approvalHolds(c) && c.approved_at === null, c);
  const fresh = new Database(':memory:');
  console.log = () => {};
  try { initializeSchema(fresh); } finally { console.log = log; }
  fresh.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, fiat_goal) VALUES ('uf:x', 'ev-x', 'p', 'X', 50)`).run();
  check('a database built from scratch has the columns and approves nothing by itself',
    !approvalHolds(fresh.prepare("SELECT * FROM uf_requests WHERE id = 'uf:x'").get()));
}

console.log('— the rule, on its own —');
{
  const row = { title: 'T', short_desc: 's', content: 'c', request_type: 'wellbeing_project', fiat_goal: 1300, currency: 'EUR', cover_image: 'https://x/c.jpg',
    gallery_images: '["https://x/g1.jpg"]', crowdfunding_refs: '["31234:p:project:1"]', status: 'active', is_hidden: 0,
    approved_at: now, approved_fiat_goal: 1300, approved_currency: 'EUR' };
  const same = frozenContentOfRow(row);
  check('approved → holds', approvalHolds(row) && fundingRefusal(row) === null);
  check('the same content may be written again (a wallet move)', editAllowedAfterApproval(row, same));
  for (const [what, change] of [
    ['the amount', { fiatGoal: 1301 }], ['the currency', { currency: 'GBP' }], ['the title', { title: 'T2' }], ['the summary', { shortDesc: 's2' }],
    ['the story', { content: 'c2' }], ['the type', { requestType: 'personal_hardship' }], ['the cover', { coverImage: null }],
    ['the gallery', { galleryImages: [] }], ['the crowdfunding references', { crowdfundingRefs: ['https://elsewhere'] }], ['the status', { status: 'draft' }],
  ] as const) check(`a change to ${what} is refused after approval`, !editAllowedAfterApproval(row, { ...same, ...change }));
  check('before approval anything may change', editAllowedAfterApproval({ ...row, approved_at: null }, { ...same, fiatGoal: 99999 }));
  check('the stored amount drifting from the pinned one reads as NOT approved (fail-closed)',
    !approvalHolds({ ...row, fiat_goal: 9999 }) && fundingRefusal({ ...row, fiat_goal: 9999 })?.code === 'NOT_APPROVED');
  check('…the currency too', !approvalHolds({ ...row, currency: 'GBP' }));
  check('archived → not fundable', fundingRefusal({ ...row, is_hidden: 1 })?.code === 'ARCHIVED');
  check('a draft → not fundable', fundingRefusal({ ...row, status: 'draft' })?.code === 'DRAFT');
}

// ── a fake relay ──
const relay = { store: [] as Event[] };
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>((r) => wss.on('listening', () => r()));
const RELAY_URL = `ws://127.0.0.1:${(wss.address() as any).port}`;
wss.on('connection', (ws) => ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m[0] !== 'REQ') return;
  const [, sub, f] = m;
  for (const e of relay.store) {
    if (f.kinds && !f.kinds.includes(e.kind)) continue;
    if (f.authors && !f.authors.includes(e.pubkey)) continue;
    if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) continue;
    if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))) continue;
    ws.send(JSON.stringify(['EVENT', sub, e]));
  }
  ws.send(JSON.stringify(['EOSE', sub]));
}));

// The signed calendar production publishes, moved to this test's now (see testUfIndexer.ts).
const calendar = {
  tags: [['split', '9'], ['split_started_at', String(now - 27 * DAY)],
    ...[[1, 305], [2, 275], [3, 245], [4, 215], [5, 185], [6, 155], [7, 125], [8, 95], [9, 27]].map(([n, d]) => ['split_history', String(n), String(now - d * DAY)])],
  content: '{}',
};
const db = getDb();
db.prepare('DELETE FROM kind_38888').run();
db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
            VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
  .run(now, JSON.stringify([RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk], LanaRegistrar: [registrar.pk] }), JSON.stringify(calendar));
const setting = (k: string, v: string) => db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, v);
setting('unconditional_financing_maturing_days', '0');        // production's setting on 16. 11. 2026
setting('unconditional_financing_last_indexed_at', String(now - 600));
db.prepare('INSERT INTO admin_users (nostr_hex_id) VALUES (?)').run(admin.pk);
for (const member of [owner, sideDoor]) {
  relay.store.push(finalizeEvent({ kind: 88888, created_at: now - 200 * DAY, tags: [['d', `plan:${member.pk.slice(0, 8)}`], ['p', member.pk]], content: '{}' }, service.sk));
}
const W = (addr: string, type: string) => ['w', addr, type, 'LANA', '9', '0', ''];
relay.store.push(finalizeEvent({ kind: 30889, created_at: now - DAY, tags: [['d', owner.pk], ['p', owner.pk], ['status', 'active'], W('LOwnMain', 'Main Wallet'), W('LOwnOther', 'Wallet')], content: '' }, registrar.sk));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}/api/unconditional-financing`;
const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
};
const signed = (who: Key, method: string, action: string, id: string, fields: Record<string, unknown> = {}) => finalizeEvent({
  kind: 27235, created_at: Math.floor(Date.now() / 1000),
  tags: [['u', `${BASE}/x`], ['method', method], ['nonce', randomHex()]],
  content: JSON.stringify({ action, id, ...fields }),
}, who.sk);
const review = (who: Key) => call('POST', '/requests/review', { event: signed(who, 'POST', 'uf-requests-review', 'review') });
const approve = (who: Key, id: string, seen: { eventId: string; fiatGoal: number; currency: string }) =>
  call('POST', `/requests/${encodeURIComponent(id)}/approve`, { event: signed(who, 'POST', 'uf-request-approve', id, { event_id: seen.eventId, fiat_goal: seen.fiatGoal, currency: seen.currency }) });
const setArchived = (who: Key, id: string, on: boolean) =>
  call('PATCH', `/requests/${encodeURIComponent(id)}/admin`, { event: signed(who, 'PATCH', 'uf-request-set-hidden', id, { is_hidden: on }) });

let tick = 0;
const ID = 'uf:approval-test';
const requestEvent = (who: Key, o: { goal?: string; currency?: string; title?: string; wallet?: string; id?: string; at?: number } = {}) => finalizeEvent({
  kind: 31240, created_at: o.at ?? now - 1000 + ++tick,
  tags: [['d', o.id ?? ID], ['service', 'unconditional-financing'], ['title', o.title ?? 'Preobrazba kavarne'], ['summary', 'Nov dekor'],
    ['request_type', 'personal_hardship'], ['fiat_goal', o.goal ?? '1000'], ['currency', o.currency ?? 'EUR'], ['wallet', o.wallet ?? 'LOwnMain'],
    ['published_at', String(now - 2000)], ['funding_opens_at', String(now - 2000)], ['status', 'active'], ['client', 'mejmosefajn']],
  content: 'Zgodba',
}, who.sk);
let txN = 0;
const contribution = (who: Key, id = ID, at = now - 60) => finalizeEvent({
  kind: 60210, created_at: at,
  tags: [['service', 'unconditional-financing'], ['request', id], ['amount_lanoshis', '100000000'], ['amount_fiat', '10'], ['currency', 'EUR'],
    ['rate', '0.1'], ['from_wallet', 'LSup'], ['repayment_wallet', 'LSupMain'], ['to_wallet', 'LOwnMain'], ['tx', `tx-${++txN}`], ['timestamp_paid', String(at)]],
  content: '',
}, who.sk);
const repayment = (who: Key, id = ID) => finalizeEvent({
  kind: 60211, created_at: now - 30,
  tags: [['service', 'unconditional-financing'], ['request', id], ['amount_lanoshis_total', '50000000'], ['amount_fiat_total', '5'], ['currency', 'EUR'],
    ['rate', '0.1'], ['tx', `tx-r-${++txN}`], ['out', supporter.pk, 'LSupMain', '50000000', '5']],
  content: '',
}, who.sk);
const rowOf = (id = ID) => db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(id) as any;
const listed = async () => ((await call('GET', '/requests?tab=all')).data.requests || []).map((r: any) => r.id) as string[];
const detail = async (id = ID) => (await call('GET', `/requests/${encodeURIComponent(id)}`)).data.request;
const contributionsOf = (id = ID) => (db.prepare('SELECT COUNT(*) AS n FROM uf_contributions WHERE request_id = ?').get(id) as any).n as number;
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

console.log('— a new request waits for an administrator —');
{
  const first = requestEvent(owner);
  const r = await quiet(() => call('POST', '/requests/upsert', { event: first }));
  check('the route lists it for its author (200) and says it waits for approval', r.status === 200 && r.data.awaitingApproval === true, r);
  check('…it is NOT in the public list', !(await listed()).includes(ID));
  check('…nor counted in the public summary', (await call('GET', '/summary')).data.totalRequests === 0);
  const d = await detail();
  check('…its own page says pending and not fundable', d?.phase === 'pending' && d?.approval === 'pending' && d?.fundable === false, d);
  const mine = (await call('GET', `/my-financings/${owner.pk}`)).data.financings || [];
  check('…its author sees it under "My", as pending', mine.length === 1 && mine[0].request.phase === 'pending', mine);
  const c = await call('POST', '/contributions/record', { event: contribution(supporter) });
  check('…a contribution to it is refused (409 NOT_APPROVED), nothing counted', c.status === 409 && c.data.code === 'NOT_APPROVED' && contributionsOf() === 0, c);

  const edited = requestEvent(owner, { goal: '1200' });
  const e = await quiet(() => call('POST', '/requests/upsert', { event: edited }));
  check('before approval the author may still change it — the amount too', e.status === 200 && rowOf().fiat_goal === 1200, { e, row: rowOf() });
}

console.log('— only an administrator sees what waits, and approves it —');
{
  check('the review list without a signature → 401', (await call('POST', '/requests/review', {})).status === 401);
  check('…signed by someone who is not an administrator → 403', (await review(stranger)).status === 403);
  const rv = await review(admin);
  check('…signed by an administrator → the pending request is there', rv.status === 200 && rv.data.pending.some((p: any) => p.id === ID && p.fiatGoal === 1200), rv);

  const row = rowOf();
  check('approval signed by a stranger → 403, nothing changes', (await approve(stranger, ID, { eventId: row.event_id, fiatGoal: 1200, currency: 'EUR' })).status === 403 && !approvalHolds(rowOf()));
  const stale = await approve(admin, ID, { eventId: row.event_id, fiatGoal: 1000, currency: 'EUR' });
  check('approval of an amount the request no longer has → 409 CHANGED, nothing approved', stale.status === 409 && stale.data.code === 'CHANGED' && !approvalHolds(rowOf()), stale);
  const staleVersion = await approve(admin, ID, { eventId: 'f'.repeat(64), fiatGoal: 1200, currency: 'EUR' });
  check('approval of another version → 409 CHANGED', staleVersion.status === 409 && staleVersion.data.code === 'CHANGED', staleVersion);

  const ev = signed(admin, 'POST', 'uf-request-approve', ID, { event_id: row.event_id, fiat_goal: 1200, currency: 'EUR' });
  const ok = await call('POST', `/requests/${encodeURIComponent(ID)}/approve`, { event: ev });
  const after = rowOf();
  check('the administrator approves exactly what was seen → 200; version, amount and currency pinned',
    ok.status === 200 && approvalHolds(after) && after.approved_event_id === row.event_id && after.approved_fiat_goal === 1200 && after.approved_currency === 'EUR' && after.approved_by === admin.pk,
    { ok, after });
  check('…the maturing window is left as it was', after.funding_opens_at === row.funding_opens_at, { before: row.funding_opens_at, after: after.funding_opens_at });
  check('…the same signed approval cannot be sent again', (await call('POST', `/requests/${encodeURIComponent(ID)}/approve`, { event: ev })).status === 401);
  check('…approving it again → 409 ALREADY_APPROVED', (await approve(admin, ID, { eventId: row.event_id, fiatGoal: 1200, currency: 'EUR' })).data.code === 'ALREADY_APPROVED');
  check('now it is in the public list', (await listed()).includes(ID));
  const d = await detail();
  check('…approved, open for funding, fundable, at the pinned 1200 EUR', d?.approval === 'approved' && d?.phase === 'repaying' && d?.fundable === true && d?.fiatGoal === 1200 && d?.currency === 'EUR', d);
}

console.log('— after approval nothing an approval covers may change — above all the amount —');
{
  for (const [what, ev] of [
    ['a new amount', requestEvent(owner, { goal: '5000' })],
    ['another currency', requestEvent(owner, { goal: '1200', currency: 'GBP' })],
    ['a new title', requestEvent(owner, { goal: '1200', title: 'Drug naslov' })],
  ] as const) {
    const r = await quiet(() => call('POST', '/requests/upsert', { event: ev }));
    check(`the route refuses ${what} (409 APPROVED_LOCKED), the row is unchanged`,
      r.status === 409 && r.data.code === 'APPROVED_LOCKED' && rowOf().fiat_goal === 1200 && rowOf().currency === 'EUR' && rowOf().title === 'Preobrazba kavarne', { r, row: rowOf() });
  }
  // A cap lowered after approval must not block the one change still allowed.
  setting('unconditional_financing_max_amounts', JSON.stringify({ personal_hardship: 500, lifestyle_transition: 0, wellbeing_project: 0 }));
  const foreign = await quiet(() => call('POST', '/requests/upsert', { event: requestEvent(owner, { goal: '1200', wallet: 'LSomeoneElse' }) }));
  check('the receiving wallet may not move to an address that is not the owner’s (403)', foreign.status === 403 && rowOf().wallet === 'LOwnMain', foreign);
  const move = await quiet(() => call('POST', '/requests/upsert', { event: requestEvent(owner, { goal: '1200', wallet: 'LOwnOther' }) }));
  check('…to another of the owner’s own registered wallets it may (200), and the approval still holds',
    move.status === 200 && rowOf().wallet === 'LOwnOther' && approvalHolds(rowOf()) && (await detail())?.fiatGoal === 1200, { move, row: rowOf() });
  setting('unconditional_financing_max_amounts', JSON.stringify({ personal_hardship: 0, lifestyle_transition: 0, wellbeing_project: 0 }));

  // Straight to the relays, around the route: the re-index must not take it either.
  resetUfIndexerCaches();
  relay.store.push(requestEvent(owner, { goal: '999999', wallet: 'LOwnOther', at: now - 5 }));
  await quiet(() => indexUnconditionalFinancingFromRelays(db));
  check('a newer version with another amount, published straight to the relays, is not written by the re-index',
    rowOf().fiat_goal === 1200 && approvalHolds(rowOf()), rowOf());
  check('…the API still reads 1200 EUR, approved and fundable', (await detail())?.fiatGoal === 1200 && (await detail())?.fundable === true);

  const c = await call('POST', '/contributions/record', { event: contribution(supporter) });
  check('a contribution to the approved request is counted (200)', c.status === 200 && contributionsOf() === 1, c);
}

console.log('— defensive: should the stored amount ever drift from the pinned one —');
{
  db.prepare('UPDATE uf_requests SET fiat_goal = 7777 WHERE id = ?').run(ID);
  const d = await detail();
  check('the request reads as NOT approved: out of the public list, pending, not fundable',
    !(await listed()).includes(ID) && d?.approval === 'pending' && d?.fundable === false, d);
  const c = await call('POST', '/contributions/record', { event: contribution(supporter) });
  check('…a new contribution is refused (409 NOT_APPROVED)', c.status === 409 && c.data.code === 'NOT_APPROVED', c);
  check('…and an administrator sees it under pending again', (await review(admin)).data.pending.some((p: any) => p.id === ID));
  db.prepare('UPDATE uf_requests SET fiat_goal = 1200 WHERE id = ?').run(ID);
  check('(restored for the rest of the test)', approvalHolds(rowOf()));
}

console.log('— archive and restore —');
{
  check('a stranger cannot archive (403)', (await setArchived(stranger, ID, true)).status === 403 && rowOf().is_hidden === 0);
  check('an administrator archives (200)', (await setArchived(admin, ID, true)).status === 200 && rowOf().is_hidden === 1);
  check('…it leaves the public list and the summary', !(await listed()).includes(ID) && (await call('GET', '/summary')).data.totalRequests === 0);
  const d = await detail();
  check('…its page says archived and not fundable', d?.isArchived === true && d?.fundable === false, d);
  const c = await call('POST', '/contributions/record', { event: contribution(supporter) });
  check('…a new contribution is refused (409 ARCHIVED)', c.status === 409 && c.data.code === 'ARCHIVED', c);
  const sent = contribution(supporter, ID, now - 20);
  relay.store.push(sent);
  resetUfIndexerCaches();
  await quiet(() => indexUnconditionalFinancingFromRelays(db));
  check('…nor counted by the re-index', !db.prepare('SELECT 1 FROM uf_contributions WHERE id = ?').get(sent.id));
  const rp = await call('POST', '/repayments/record', { event: repayment(owner) });
  check('…repaying stays possible: its financiers are still owed (200)', rp.status === 200, rp);
  check('…an administrator sees it under archived', (await review(admin)).data.archived.some((p: any) => p.id === ID));
  const ap = await approve(admin, ID, { eventId: rowOf().event_id, fiatGoal: 1200, currency: 'EUR' });
  check('…an archived request cannot be approved (409)', ap.status === 409, ap);
  check('the administrator restores it (200): public again, fundable', (await setArchived(admin, ID, false)).status === 200 && (await listed()).includes(ID) && (await detail())?.fundable === true);
  await quiet(() => indexUnconditionalFinancingFromRelays(db));
  check('…and the contribution published while it was archived is counted by the next scan (the money did reach the owner)',
    !!db.prepare('SELECT 1 FROM uf_contributions WHERE id = ?').get(sent.id));
}

console.log('— a request that never went through the route —');
{
  const SIDE = 'uf:side-door';
  relay.store.push(requestEvent(sideDoor, { id: SIDE, goal: '3000' }), contribution(supporter, SIDE, now - 10));
  resetUfIndexerCaches();
  await quiet(() => indexUnconditionalFinancingFromRelays(db));
  check('listed by the re-index for its author, but waiting: not public', !!rowOf(SIDE) && !approvalHolds(rowOf(SIDE)) && !(await listed()).includes(SIDE), rowOf(SIDE));
  check('…its contribution is not counted', contributionsOf(SIDE) === 0);
  const pending = (await review(admin)).data.pending.map((p: any) => p.id);
  check('…and it waits in the administrator’s review list', pending.includes(SIDE), pending);
}

closeRelayPool();
http.close();
wss.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
