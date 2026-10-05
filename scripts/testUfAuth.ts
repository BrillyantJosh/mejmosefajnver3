/**
 * Unconditional Financing — who may do what, decided by SIGNATURES.
 *
 * 1. DELETE /requests/:id and PATCH /requests/:id/admin used to read "who is
 *    asking" from the JSON body (requesterPubkey / adminPubkey). A public key is
 *    public: anyone who knew the owner's key could delete any request that had no
 *    contributions. Both now take the identity from a signed kind 27235 event
 *    (the pattern /api/functions/update-app-settings uses), bound to the method,
 *    the action and the request, short-lived and single-use.
 * 2. The 4-Splits membership check (used by POST /requests/upsert, GET
 *    /eligibility and the relay indexer) only counts a KIND 88888 plan signed by
 *    the Lana8Wonder service key: a plan someone signs ABOUT THEMSELVES, dated
 *    last year, no longer makes them a long-time member. And "no relay answered"
 *    is a 503, not a false "not eligible".
 *
 * The REAL router is mounted in this process on a THROWAWAY database
 * (MEJMO_DB_PATH, in the OS temp dir) with a fake relay on 127.0.0.1 — no server
 * on :3210, nothing near data/mejmosefajn.db, nothing that reaches a real relay.
 *   npx tsx scripts/testUfAuth.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

// The database must be chosen BEFORE anything opens it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-auth-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');
const realData = path.resolve(new URL('../data', import.meta.url).pathname);
if (path.resolve(process.env.MEJMO_DB_PATH).startsWith(realData)) throw new Error('refusing to run against the real data directory');

const { default: express } = await import('express');
const { getDb } = await import('../server/db/connection.js');
const { default: ufRoutes } = await import('../server/routes/unconditionalFinancing.js');
const { default: dbRoutes } = await import('../server/routes/db.js');
const { closeRelayPool } = await import('../server/lib/relayPool.js');
const { UF_PAST_SKEW_SECONDS } = await import('../server/lib/ufMaturing.js');
const { forgetLastGoodCalendar } = await import('../server/lib/ufEligibility.js');
const { CALENDAR_DAY_SKEW_SECONDS } = await import('../server/lib/ufSplitCount.js');

const DAY = 86400;
const MATURING_DAYS = 15;
const now = Math.floor(Date.now() / 1000);

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 260) : ''); }
}

interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const service = newKey();   // stands in for the Lana8Wonder service key

// ── a fake relay (kind 88888 by #p and authors) ────────────────
const relay = { store: [] as Event[], refuse88888: false };
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>((r) => wss.on('listening', () => r()));
const RELAY_URL = `ws://127.0.0.1:${(wss.address() as any).port}`;
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m[0] !== 'REQ') return;
    const [, sub, f] = m;
    if (relay.refuse88888 && f.kinds?.includes(88888)) { ws.send(JSON.stringify(['CLOSED', sub, 'blocked: test'])); return; }
    for (const e of relay.store) {
      if (f.kinds && !f.kinds.includes(e.kind)) continue;
      if (f.authors && !f.authors.includes(e.pubkey)) continue;
      if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))) continue;
      ws.send(JSON.stringify(['EVENT', sub, e]));
    }
    ws.send(JSON.stringify(['EOSE', sub]));
  });
});

/**
 * The signed calendar production publishes (KIND 38888 split_history), moved so that
 * "now" is this test's now: Split 9 has been running for 27 days, Splits 5-8 are over
 * (95, 125, 155 and 185 days ago), 1-4 earlier. A member who enrolled 200 days ago has
 * four Splits behind them; one who enrolled 120 days ago has one; a newcomer of 10
 * days has none. (Until 5. 10. 2026 the count came from a server table that held two
 * rows, and everyone enrolled before it passed through a "long-time member" exception.)
 */
const calendarEvent = (now: number, day: number) => ({
  tags: [
    ['split', '9'], ['split_started_at', String(now - 27 * day)],
    ...[[1, 305], [2, 275], [3, 245], [4, 215], [5, 185], [6, 155], [7, 125], [8, 95], [9, 27]]
      .map(([n, d]) => ['split_history', String(n), String(now - d * day)]),
  ],
  content: '{}',
});

// ── the app: the real router, its own database ─────────────────
const db = getDb();
// What the seed put there (a fresh database starts with a placeholder row of system parameters).
const seededParametersDate = (db.prepare('SELECT created_at FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any)?.created_at;
db.prepare('DELETE FROM kind_38888').run();   // the seed points at the real relays — replace it before anything can read it
db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
            VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
  .run(now, JSON.stringify([RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk] }), JSON.stringify(calendarEvent(now, DAY)));
const setSetting = (key: string, value: string) =>
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
setSetting('unconditional_financing_maturing_days', String(MATURING_DAYS));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
app.use('/api/db', dbRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}/api/unconditional-financing`;
const DB_BASE = `http://127.0.0.1:${(http.address() as any).port}/api/db`;

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

// ── people ────────────────────────────────────────────
const owner = newKey(), owner2 = newKey(), stranger = newKey(), admin = newKey(), moduleAdmin = newKey();
db.prepare('INSERT INTO admin_users (nostr_hex_id) VALUES (?)').run(admin.pk);
setSetting('unconditional_financing_admins', JSON.stringify([moduleAdmin.pk]));

const seed = db.prepare(`
  INSERT INTO uf_requests (id, event_id, pubkey, title, wallet, published_at, funding_opens_at, is_hidden, nostr_created_at)
  VALUES (?, ?, ?, 'Seeded', 'LW', ?, ?, ?, ?)`);
let seedN = 0;
/** A request that is OPEN for funding (its review ended 15 days ago) or still MATURING (5 days to go). */
const addRequest = (id: string, who: Key, hidden = 0, state: 'open' | 'maturing' = 'open') =>
  seed.run(id, `ev${++seedN}`, who.pk, now - (state === 'open' ? 30 : 10) * DAY, state === 'open' ? now - 15 * DAY : now + 5 * DAY, hidden, now - 30 * DAY);
const exists = (id: string) => !!db.prepare('SELECT 1 FROM uf_requests WHERE id = ?').get(id);
const hiddenOf = (id: string) => (db.prepare('SELECT is_hidden FROM uf_requests WHERE id = ?').get(id) as any)?.is_hidden;

/** What a client sends: a kind 27235 event bound to the method, the action and the request. */
function signedAction(who: Key, method: 'DELETE' | 'PATCH', action: string, id: string, extra: Record<string, unknown> = {}, o: { createdAt?: number; content?: string; nonce?: boolean } = {}) {
  const url = `${BASE}/requests/${encodeURIComponent(id)}${method === 'PATCH' ? '/admin' : ''}`;
  // A real client adds a random nonce: two otherwise identical events signed in the same
  // second have the SAME id (the signature is not part of the hash), and the second would
  // be refused as a replay.
  const nonce = o.nonce === false ? [] : [['nonce', Buffer.from(generateSecretKey()).toString('hex').slice(0, 32)]];
  return finalizeEvent({
    kind: 27235,
    created_at: o.createdAt ?? now,
    tags: [['u', url], ['method', method], ...nonce],
    content: o.content ?? JSON.stringify({ action, id, ...extra }),
  }, who.sk);
}
const del = (id: string, body: unknown) => call('DELETE', `/requests/${encodeURIComponent(id)}`, body);
const patch = (id: string, body: unknown) => call('PATCH', `/requests/${encodeURIComponent(id)}/admin`, body);

// ════════════════════════════════════════════════════════
console.log('— deleting a request: the old contract (a public key in the body) is dead —');
{
  addRequest('uf:d1', owner);
  let r = await del('uf:d1', { requesterPubkey: owner.pk });
  check('the owner’s PUBLIC KEY in the body no longer deletes anything → 401', r.status === 401 && exists('uf:d1'), r);
  r = await del('uf:d1', {});
  check('an empty body → 401', r.status === 401 && exists('uf:d1'), r);
  r = await call('DELETE', '/requests/uf%3Ad1');
  check('no body at all → 401', r.status === 401 && exists('uf:d1'), r);
}

console.log('— deleting a request: the signature decides —');
{
  addRequest('uf:d2', owner, 0, 'maturing');
  let r = await del('uf:d2', { event: signedAction(stranger, 'DELETE', 'uf-request-delete', 'uf:d2') });
  check('someone else’s signature → 403, the request stays', r.status === 403 && exists('uf:d2'), r);

  const good = signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d2');
  r = await del('uf:d2', { event: good });
  check('the owner’s signature → 200, the request is gone', r.status === 200 && !exists('uf:d2'), r);

  addRequest('uf:d2', owner, 0, 'maturing');   // back again, to prove a captured event does not work twice
  r = await del('uf:d2', { event: good });
  check('the same event again (a replay) → 401, the request stays', r.status === 401 && exists('uf:d2'), r);

  r = await del('uf:d2', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d2', {}, { createdAt: now - 1000 }) });
  check('an event older than five minutes → 401', r.status === 401 && exists('uf:d2'), r);

  r = await del('uf:d2', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:something-else') });
  check('an event signed for ANOTHER request cannot be used on this one → 401', r.status === 401 && exists('uf:d2'), r);

  r = await del('uf:d2', { event: signedAction(owner, 'DELETE', 'uf-request-set-hidden', 'uf:d2', { is_hidden: true }) });
  check('an event signed for ANOTHER action cannot be used to delete → 401', r.status === 401 && exists('uf:d2'), r);

  const forged = signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d2');
  forged.content = JSON.stringify({ action: 'uf-request-delete', id: 'uf:d2', extra: 1 });   // altered after signing
  r = await del('uf:d2', { event: forged });
  check('an event altered after signing → 401', r.status === 401 && exists('uf:d2'), r);

  const wrongMethod = finalizeEvent({ kind: 27235, created_at: now, tags: [['u', BASE], ['method', 'POST']], content: JSON.stringify({ action: 'uf-request-delete', id: 'uf:d2' }) }, owner.sk);
  r = await del('uf:d2', { event: wrongMethod });
  check('an event signed for a different HTTP method → 401', r.status === 401 && exists('uf:d2'), r);

  const notAuthKind = finalizeEvent({ kind: 1, created_at: now, tags: [['method', 'DELETE']], content: JSON.stringify({ action: 'uf-request-delete', id: 'uf:d2' }) }, owner.sk);
  r = await del('uf:d2', { event: notAuthKind });
  check('a signed event of another kind → 401', r.status === 401 && exists('uf:d2'), r);

  r = await del('uf:d2', { event: signedAction(admin, 'DELETE', 'uf-request-delete', 'uf:d2') });
  check('an administrator’s signature (admin_users) may delete → 200', r.status === 200 && !exists('uf:d2'), r);
}

console.log('— deleting: the rules that were always there still hold —');
{
  addRequest('uf:d3', owner, 0, 'maturing');
  db.prepare(`INSERT INTO uf_contributions (id, request_id, supporter_pubkey, amount_fiat) VALUES ('c1', 'uf:d3', ?, 10)`).run(stranger.pk);
  let r = await del('uf:d3', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d3') });
  check('a request with contributions cannot be deleted, even by its owner → 409', r.status === 409 && exists('uf:d3'), r);
  r = await del('uf:d3', { event: signedAction(admin, 'DELETE', 'uf-request-delete', 'uf:d3') });
  check('…nor by an administrator → 409', r.status === 409 && exists('uf:d3'), r);

  r = await del('uf:missing', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:missing') });
  check('a request that does not exist → 404', r.status === 404, r);

  // An OPEN request is not deleted: a contribution can be on its way (paid, published, not yet
  // recorded), and a deleted row is re-listed by the indexer with a restarted window that would
  // refuse it. It is hidden by an administrator instead.
  addRequest('uf:d3b', owner);
  r = await del('uf:d3b', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d3b') });
  check('a request that is already OPEN for funding cannot be deleted by its owner → 409', r.status === 409 && exists('uf:d3b'), r);
  r = await del('uf:d3b', { event: signedAction(admin, 'DELETE', 'uf-request-delete', 'uf:d3b') });
  check('…nor by an administrator → 409', r.status === 409 && exists('uf:d3b'), r);
  r = await patch('uf:d3b', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:d3b', { is_hidden: true }) });
  check('…but an administrator can hide it → 200', r.status === 200 && hiddenOf('uf:d3b') === 1, r);

  addRequest('uf:d4', owner, 1, 'maturing');
  r = await del('uf:d4', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d4') });
  check('a request an administrator HID cannot be deleted by its owner (re-indexing would bring it back, visible) → 403', r.status === 403 && exists('uf:d4'), r);
  r = await del('uf:d4', { event: signedAction(moduleAdmin, 'DELETE', 'uf-request-delete', 'uf:d4') });
  check('…an administrator may (named in the module’s own admin list) → 200', r.status === 200 && !exists('uf:d4'), r);
}

console.log('— hiding a request: the old contract is dead too —');
{
  addRequest('uf:h1', owner);
  let r = await patch('uf:h1', { adminPubkey: admin.pk, is_hidden: true });
  check('an administrator’s PUBLIC KEY in the body no longer hides anything → 401', r.status === 401 && hiddenOf('uf:h1') === 0, r);
  r = await patch('uf:h1', { adminPubkey: moduleAdmin.pk, is_hidden: true });
  check('…the module admin list’s public key neither → 401', r.status === 401 && hiddenOf('uf:h1') === 0, r);
}

console.log('— hiding a request: the signature decides —');
{
  let r = await patch('uf:h1', { event: signedAction(stranger, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: true }) });
  check('a signature that is not an administrator’s → 403', r.status === 403 && hiddenOf('uf:h1') === 0, r);
  r = await patch('uf:h1', { event: signedAction(owner, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false }) });
  check('the request’s own owner is not an administrator → 403', r.status === 403 && hiddenOf('uf:h1') === 0, r);

  const hide = signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: true });
  r = await patch('uf:h1', { event: hide });
  check('an administrator’s signature hides it → 200', r.status === 200 && hiddenOf('uf:h1') === 1, r);

  r = await patch('uf:h1', { event: signedAction(moduleAdmin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false }) });
  check('the module admin list may unhide → 200', r.status === 200 && hiddenOf('uf:h1') === 0, r);

  r = await patch('uf:h1', { event: hide });
  check('replaying the hide AFTER the unhide does nothing → 401', r.status === 401 && hiddenOf('uf:h1') === 0, r);

  // Two identical signed events in the same second are the SAME event (same id): the second is a replay.
  // With a nonce tag they are different events, and both are accepted.
  const twinA = signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false }, { nonce: false });
  const twinB = signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false }, { nonce: false });
  check('(why clients add a nonce) two identical events in one second share an id', twinA.id === twinB.id);
  const n1 = signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false });
  const n2 = signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false });
  check('…and with a nonce tag they do not', n1.id !== n2.id);
  const first = await patch('uf:h1', { event: n1 });
  const second = await patch('uf:h1', { event: n2 });
  check('two quick identical requests with nonces (a double-click) are both accepted', first.status === 200 && second.status === 200, { first, second });

  // The replay memory, with an injected clock.
  {
    const { verifySignedAction, consumeSignedAction, isRefused, UF_SIGNED_ACTION_MAX_REMEMBERED } = await import('../server/lib/ufSignedAction.js');
    const T = 2_000_000_000;
    const sign = (who: Key, createdAt: number) => finalizeEvent({
      kind: 27235, created_at: createdAt,
      tags: [['method', 'PATCH'], ['nonce', Buffer.from(generateSecretKey()).toString('hex').slice(0, 32)]],
      content: JSON.stringify({ action: 'uf-request-set-hidden', id: 'uf:clock', is_hidden: true }),
    }, who.sk);
    const expectAt = (n: number) => ({ method: 'PATCH', action: 'uf-request-set-hidden', target: 'uf:clock', now: n });

    // dated five minutes AHEAD: valid until five minutes after ITS date, i.e. until T + 600
    const ahead = sign(admin, T + 300);
    const accepted = verifySignedAction(ahead, expectAt(T));
    check('an event dated five minutes ahead is accepted', !isRefused(accepted), accepted);
    if (!isRefused(accepted)) consumeSignedAction(accepted, T);
    const replayLate = verifySignedAction(ahead, expectAt(T + 600));
    check('…and its replay at the very end of its life is still refused as USED (not merely expired)', isRefused(replayLate) && /already been used/.test(replayLate.error), replayLate);
    const replayAfter = verifySignedAction(ahead, expectAt(T + 602));
    check('…after that it is expired anyway', isRefused(replayAfter) && /expired/.test(replayAfter.error), replayAfter);

    // an event that fails authorisation is never spent: it leaves nothing in the memory
    const unspent = sign(stranger, T);
    const first1 = verifySignedAction(unspent, expectAt(T));
    const again1 = verifySignedAction(unspent, expectAt(T));
    check('verifying alone spends nothing (the route spends only after authorising)', !isRefused(first1) && !isRefused(again1));

    // the memory has a ceiling and forgets what is over (synthetic accepted events: no signatures needed to fill it)
    const synthetic = (i: number, createdAt: number) => ({ ok: true as const, pubkey: 'x', eventId: `synthetic-${i}`, createdAt, payload: {} });
    let refusedAt = -1;
    for (let i = 0; i < UF_SIGNED_ACTION_MAX_REMEMBERED + 5; i++) {
      const spentNow = consumeSignedAction(synthetic(i, T + 2000), T + 2000);
      if (spentNow) { refusedAt = i; check('a full memory refuses with 429, not silently', spentNow.status === 429, spentNow); break; }
    }
    check('…at the ceiling, not before', refusedAt === UF_SIGNED_ACTION_MAX_REMEMBERED, refusedAt);
    check('…and once those events are over, there is room again', consumeSignedAction(synthetic(-1, T + 4000), T + 4000) === null);
  }

  r = await patch('uf:h1', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: true }), is_hidden: false });
  check('the flag is read from the SIGNED content — a different one in the body is ignored', r.status === 200 && hiddenOf('uf:h1') === 1, r);
  r = await patch('uf:h1', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: false }) });
  check('(and back again, to carry on from a visible request)', r.status === 200 && hiddenOf('uf:h1') === 0, r);

  r = await patch('uf:h1', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', {}) });
  check('signed content without is_hidden → 400', r.status === 400, r);
  r = await patch('uf:h1', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:h1', { is_hidden: 'yes' }) });
  check('is_hidden that is not a boolean → 400', r.status === 400 && hiddenOf('uf:h1') === 0, r);
  r = await patch('uf:h1', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:other', { is_hidden: true }) });
  check('an event signed for another request → 401', r.status === 401 && hiddenOf('uf:h1') === 0, r);
  r = await patch('uf:missing', { event: signedAction(admin, 'PATCH', 'uf-request-set-hidden', 'uf:missing', { is_hidden: true }) });
  check('a request that does not exist → 404', r.status === 404, r);
}

// ════════════════════════════════════════════════════════
console.log('— the system parameters cannot be rewritten by whoever asks —');
{
  // kind_38888 holds the relay list, the keys trusted as registrar / Lana8Wonder signers, the
  // exchange rates and the Split calendar. The generic db route used to let anyone write it.
  const send = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${DB_BASE}/${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };
  const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM kind_38888').get() as any).n as number;
  const before = rows();

  let r = await send('POST', 'kind_38888', { event_id: 'forged', pubkey: 'f'.repeat(64), created_at: 4102444800, relays: '["ws://evil"]', electrum_servers: '[]', exchange_rates: '{}', trusted_signers: '{"Lana8Wonder":["' + 'f'.repeat(64) + '"]}', raw_event: '{}' });
  check('POST /api/db/kind_38888 (a row dated 2100 with its own signer) → 403', r.status === 403, r);
  r = await send('PATCH', 'kind_38888?event_id=eq.test', { trusted_signers: '{}' });
  check('PATCH /api/db/kind_38888 → 403', r.status === 403, r);
  r = await send('DELETE', 'kind_38888?event_id=neq.nothing');
  check('DELETE /api/db/kind_38888 → 403', r.status === 403, r);
  check('the table is exactly as it was', rows() === before && !db.prepare("SELECT 1 FROM kind_38888 WHERE event_id = 'forged'").get(), { before, after: rows() });
  r = await send('GET', 'kind_38888?select=event_id&limit=1');
  check('…and it can still be READ (the app reads the parameters on every start)', r.status === 200 && Array.isArray(r.data) && r.data.length === 1, r);
  check('the placeholder a fresh database starts with is dated 0, so the real event always replaces it',
    seededParametersDate === 0, seededParametersDate);
}

// ════════════════════════════════════════════════════════
console.log('— membership: who signed the plan matters —');
{
  const plan = (signer: Key, member: string, createdAt: number) => finalizeEvent({
    kind: 88888, created_at: createdAt,
    tags: [['d', `plan:${member.slice(0, 8)}`], ['p', member]],
    content: JSON.stringify({ subject_hex: member }),
  }, signer.sk);

  const member = newKey(), selfVouched = newKey(), noPlan = newKey();
  relay.store.push(plan(service, member.pk, now - 200 * DAY));            // a real plan, enrolled before the recorded history
  relay.store.push(plan(selfVouched, selfVouched.pk, now - 400 * DAY));   // signs a plan about THEMSELVES, long ago

  let r = await call('GET', `/eligibility/${member.pk}`);
  check('a plan signed by the service key counts: eligible', r.status === 200 && r.data.eligible === true && r.data.exists === true, r);
  r = await call('GET', `/eligibility/${selfVouched.pk}`);
  check('a plan the person signed about themselves does NOT count: no plan, not eligible', r.status === 200 && r.data.eligible === false && r.data.exists === false, r);
  r = await call('GET', `/eligibility/${noPlan.pk}`);
  check('no plan at all: not eligible', r.status === 200 && r.data.eligible === false && r.data.exists === false, r);

  // The count is real: from the signed calendar, no exception for "long-time members"
  // (it used to come from a table that held two rows, and everyone older than it got in).
  const oldException = newKey();
  relay.store.push(plan(service, oldException.pk, now - 120 * DAY));       // real, older than that table — but only ONE Split is over since
  r = await call('GET', `/eligibility/${member.pk}`);
  check('enrolled 200 days ago: four finished Splits, counted from the signed calendar',
    r.data.completedSplitsSinceEnrollment === 4 && r.data.requiredSplits === 4 && r.data.currentSplit === 9, r.data);
  check('…and there is no "grandfathered" any more', !('grandfathered' in r.data), r.data);
  r = await call('GET', `/eligibility/${oldException.pk}`);
  check('enrolled 120 days ago: ONE finished Split, not eligible (the old exception let them in)',
    r.status === 200 && r.data.eligible === false && r.data.exists === true && r.data.completedSplitsSinceEnrollment === 1, r);

  const requestBy = (who: Key, id: string, publishedAt = now) => finalizeEvent({
    kind: 31240, created_at: now,
    tags: [['d', id], ['service', 'unconditional-financing'], ['title', 't'], ['summary', 's'], ['request_type', 'personal_hardship'],
      ['fiat_goal', '100'], ['currency', 'EUR'], ['wallet', 'LW'], ['published_at', String(publishedAt)], ['status', 'active']],
    content: 'story',
  }, who.sk);

  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-ok') });
  check('POST /requests/upsert: a member is accepted', r.status === 200 && exists('uf:m-ok'), r);
  r = await call('POST', '/requests/upsert', { event: requestBy(selfVouched, 'uf:m-self') });
  check('POST /requests/upsert: a self-vouched key is refused → 403', r.status === 403 && !exists('uf:m-self'), r);
  r = await call('POST', '/requests/upsert', { event: requestBy(noPlan, 'uf:m-none') });
  check('POST /requests/upsert: a stranger is refused → 403', r.status === 403 && !exists('uf:m-none'), r);
  r = await call('POST', '/requests/upsert', { event: requestBy(oldException, 'uf:m-old') });
  check('POST /requests/upsert: one finished Split is refused → 403', r.status === 403 && !exists('uf:m-old'), r);

  console.log('— membership: the count is exact at the edges (the route, the real calendar) —');
  {
    // Split 5 is dated 185 days ago in the seeded calendar; a Split begins two hours before its
    // row says. Four Splits (5-8) are over for anyone who enrolled before Split 5 BEGAN.
    const began5 = now - 185 * DAY - CALENDAR_DAY_SKEW_SECONDS;
    const justBefore = newKey(), atTheStart = newKey(), halfwayIn = newKey(), threeSplits = newKey();
    relay.store.push(plan(service, justBefore.pk, began5 - 1));       // one second before Split 5 began
    relay.store.push(plan(service, atTheStart.pk, began5));           // the second it began
    relay.store.push(plan(service, halfwayIn.pk, began5 + 3600));     // an hour into it
    relay.store.push(plan(service, threeSplits.pk, now - 160 * DAY)); // Splits 6, 7 and 8 are over since: three

    const expectations: [string, Key, number][] = [
      ['enrolled one second before Split 5 began', justBefore, 4],
      ['enrolled the very second Split 5 began', atTheStart, 3],
      ['enrolled an hour into Split 5', halfwayIn, 3],
      ['enrolled 160 days ago (Splits 6-8)', threeSplits, 3],
    ];
    for (const [who, key, expected] of expectations) {
      const g = await call('GET', `/eligibility/${key.pk}`);
      check(`GET /eligibility, ${who}: ${expected} Splits, ${expected >= 4 ? 'eligible' : 'not eligible'}`,
        g.status === 200 && g.data.completedSplitsSinceEnrollment === expected && g.data.eligible === (expected >= 4), g);
      const id = `uf:m-edge-${key.pk.slice(0, 6)}`;
      const u = await call('POST', '/requests/upsert', { event: requestBy(key, id) });
      check(`POST /requests/upsert, ${who}: ${expected >= 4 ? 'accepted' : 'refused → 403, nothing listed'}`,
        expected >= 4 ? u.status === 200 && exists(id) : u.status === 403 && !exists(id), u);
    }
  }

  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-backdated', now - 30 * DAY) });
  check('POST /requests/upsert: a backdated published_at is held at one hour back (unchanged rule)',
    r.status === 200 && Math.abs(r.data.fundingOpensAt - (Math.floor(Date.now() / 1000) - UF_PAST_SKEW_SECONDS + MATURING_DAYS * DAY)) <= 5, r);

  console.log('— a signed event is public: posting it again must change nothing —');
  {
    // The owner's event is on the relays for everybody to read, and POST /requests/upsert accepts
    // it from anyone. Posting the very event the row already reflects used to RESTART the review
    // period (and revert the content) of a request that is maturing — a way for anybody to keep
    // anybody's request from ever opening.
    const requestAt = (who: Key, id: string, createdAt: number, title: string) => finalizeEvent({
      kind: 31240, created_at: createdAt,
      tags: [['d', id], ['service', 'unconditional-financing'], ['title', title], ['summary', 's'], ['request_type', 'personal_hardship'],
        ['fiat_goal', '100'], ['currency', 'EUR'], ['wallet', 'LW'], ['published_at', String(createdAt)], ['status', 'active']],
      content: 'story',
    }, who.sk);
    const titleOf = (id: string) => (db.prepare('SELECT title FROM uf_requests WHERE id = ?').get(id) as any)?.title;
    const T = Math.floor(Date.now() / 1000);

    const e1 = requestAt(member, 'uf:m-replay', T, 'first version');
    let rr = await call('POST', '/requests/upsert', { event: e1 });
    check('the owner publishes: accepted', rr.status === 200 && exists('uf:m-replay'), rr);

    db.prepare('UPDATE uf_requests SET funding_opens_at = ? WHERE id = ?').run(T + 3 * DAY, 'uf:m-replay');   // a window that is plainly not "now + 15 days"
    rr = await call('POST', '/requests/upsert', { event: e1 });
    check('the SAME event posted again (by anyone) → 200 and nothing changes: the window is not restarted',
      rr.status === 200 && rr.data.unchanged === true && rr.data.fundingOpensAt === T + 3 * DAY, rr);

    const older = requestAt(member, 'uf:m-replay', T - 100, 'an older version');
    rr = await call('POST', '/requests/upsert', { event: older });
    check('an OLDER version of the same request → 409, and the content is not reverted', rr.status === 409 && titleOf('uf:m-replay') === 'first version', { rr, title: titleOf('uf:m-replay') });

    const newer = requestAt(member, 'uf:m-replay', T + 1, 'refined by the owner');
    rr = await call('POST', '/requests/upsert', { event: newer });
    check('a genuine NEWER edit by the owner still applies…', rr.status === 200 && titleOf('uf:m-replay') === 'refined by the owner', { rr, title: titleOf('uf:m-replay') });
    check('…and, while maturing, restarts the review period as before (later, never sooner)', rr.data.fundingOpensAt > T + 3 * DAY && Math.abs(rr.data.fundingOpensAt - (Math.floor(Date.now() / 1000) + MATURING_DAYS * DAY)) <= 5, rr);
  }

  console.log('— …and "nobody answered" is not "not a member" —');
  relay.refuse88888 = true;
  await new Promise((res) => setTimeout(res, 50));
  r = await call('GET', `/eligibility/${member.pk}`);
  check('GET /eligibility with no relay answering → 503, not a false "not eligible"', r.status === 503, r);
  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-blind') });
  check('POST /requests/upsert with no relay answering → 503, nothing listed', r.status === 503 && !exists('uf:m-blind'), r);
  relay.refuse88888 = false;

  console.log('— …and a Split calendar nobody can read is "unknown" too —');
  const stored = (db.prepare('SELECT raw_event FROM kind_38888').get() as any).raw_event;
  const gapped = calendarEvent(now, DAY);
  gapped.tags = gapped.tags.filter((t) => !(t[0] === 'split_history' && t[1] === '3'));   // Split 3 missing: a calendar mid-edit
  const breakCalendar = async () => { db.prepare('UPDATE kind_38888 SET raw_event = ?').run(JSON.stringify(gapped)); await new Promise((res) => setTimeout(res, 50)); };
  const mendCalendar = () => db.prepare('UPDATE kind_38888 SET raw_event = ?').run(stored);

  forgetLastGoodCalendar(db);   // a process that has not yet read a sound calendar
  await breakCalendar();
  r = await call('GET', `/eligibility/${member.pk}`);
  check('a calendar with a hole, and no sound one seen yet → 503 that says so, not a false "not eligible"', r.status === 503 && /calendar/i.test(r.data.error || ''), r);
  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-gap') });
  check('POST /requests/upsert with a gapped calendar, none seen before → 503, nothing listed', r.status === 503 && !exists('uf:m-gap'), r);
  r = await call('GET', `/eligibility/${noPlan.pk}`);
  check('a stranger still gets a plain "not eligible": no calendar is needed to say there is no plan', r.status === 200 && r.data.eligible === false && r.data.exists === false, r);
  mendCalendar();
  r = await call('GET', `/eligibility/${member.pk}`);
  check('the calendar whole again: eligible again', r.status === 200 && r.data.eligible === true, r);

  // A history shorter than the rule looks back over is not "fewer Splits": the four newest
  // dates ARE the decision, and without them nobody can be told yes or no.
  forgetLastGoodCalendar(db);
  const short = calendarEvent(now, DAY);
  short.tags = short.tags.filter((t) => !(t[0] === 'split_history' && Number(t[1]) <= 5));   // only Splits 6-9 listed
  db.prepare('UPDATE kind_38888 SET raw_event = ?').run(JSON.stringify(short));
  await new Promise((res) => setTimeout(res, 50));
  r = await call('GET', `/eligibility/${member.pk}`);
  check('a history that lists only three finished Splits → 503 (does not list Split 5), not "three, so no"', r.status === 503 && /does not list Split 5/.test(r.data.error || ''), r);
  mendCalendar();
  r = await call('GET', `/eligibility/${member.pk}`);
  check('…and the full history again: eligible', r.status === 200 && r.data.eligible === true, r);

  console.log('— …but one that was read soundly a moment ago keeps answering, and can only be too careful —');
  await breakCalendar();
  r = await call('GET', `/eligibility/${member.pk}`);
  check('the calendar breaks after a sound reading: the member is still eligible, by the same count', r.status === 200 && r.data.eligible === true && r.data.completedSplitsSinceEnrollment === 4, r);
  r = await call('GET', `/eligibility/${oldException.pk}`);
  check('…and somebody with one finished Split is still refused (a stale calendar admits nobody new)', r.status === 200 && r.data.eligible === false && r.data.completedSplitsSinceEnrollment === 1, r);
  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-stale-ok') });
  check('POST /requests/upsert for the member goes through on the last sound calendar', r.status === 200 && exists('uf:m-stale-ok'), r);
  r = await call('POST', '/requests/upsert', { event: requestBy(oldException, 'uf:m-stale-no') });
  check('…and one finished Split is still a 403, not a 503', r.status === 403 && !exists('uf:m-stale-no'), r);
  mendCalendar();
}

closeRelayPool();
http.close();
wss.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir: the OS cleans it */ }
if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ ALL AUTH TESTS PASSED');
process.exit(0);
