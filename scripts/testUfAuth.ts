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
const { closeRelayPool } = await import('../server/lib/relayPool.js');
const { UF_PAST_SKEW_SECONDS } = await import('../server/lib/ufMaturing.js');

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

// ── the app: the real router, its own database ─────────────────
const db = getDb();
db.prepare('DELETE FROM kind_38888').run();   // the seed points at the real relays — replace it before anything can read it
db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
            VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
  .run(now, JSON.stringify([RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk] }), JSON.stringify({ tags: [['split', '9']] }));
const setSetting = (key: string, value: string) =>
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
setSetting('unconditional_financing_maturing_days', String(MATURING_DAYS));
db.prepare('INSERT INTO split_history (split, started_at) VALUES (8, ?), (9, ?)').run(now - 95 * DAY, now - 27 * DAY);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}/api/unconditional-financing`;

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
const addRequest = (id: string, who: Key, hidden = 0) => seed.run(id, `ev${++seedN}`, who.pk, now - 30 * DAY, now - 15 * DAY, hidden, now - 30 * DAY);
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
  addRequest('uf:d2', owner);
  let r = await del('uf:d2', { event: signedAction(stranger, 'DELETE', 'uf-request-delete', 'uf:d2') });
  check('someone else’s signature → 403, the request stays', r.status === 403 && exists('uf:d2'), r);

  const good = signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d2');
  r = await del('uf:d2', { event: good });
  check('the owner’s signature → 200, the request is gone', r.status === 200 && !exists('uf:d2'), r);

  addRequest('uf:d2', owner);   // back again, to prove a captured event does not work twice
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
  addRequest('uf:d3', owner);
  db.prepare(`INSERT INTO uf_contributions (id, request_id, supporter_pubkey, amount_fiat) VALUES ('c1', 'uf:d3', ?, 10)`).run(stranger.pk);
  let r = await del('uf:d3', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:d3') });
  check('a request with contributions cannot be deleted, even by its owner → 409', r.status === 409 && exists('uf:d3'), r);
  r = await del('uf:d3', { event: signedAction(admin, 'DELETE', 'uf-request-delete', 'uf:d3') });
  check('…nor by an administrator → 409', r.status === 409 && exists('uf:d3'), r);

  r = await del('uf:missing', { event: signedAction(owner, 'DELETE', 'uf-request-delete', 'uf:missing') });
  check('a request that does not exist → 404', r.status === 404, r);

  addRequest('uf:d4', owner, 1);
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

  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-backdated', now - 30 * DAY) });
  check('POST /requests/upsert: a backdated published_at is held at one hour back (unchanged rule)',
    r.status === 200 && Math.abs(r.data.fundingOpensAt - (now - UF_PAST_SKEW_SECONDS + MATURING_DAYS * DAY)) <= 5, r);

  console.log('— …and "nobody answered" is not "not a member" —');
  relay.refuse88888 = true;
  await new Promise((res) => setTimeout(res, 50));
  r = await call('GET', `/eligibility/${member.pk}`);
  check('GET /eligibility with no relay answering → 503, not a false "not eligible"', r.status === 503, r);
  r = await call('POST', '/requests/upsert', { event: requestBy(member, 'uf:m-blind') });
  check('POST /requests/upsert with no relay answering → 503, nothing listed', r.status === 503 && !exists('uf:m-blind'), r);
  relay.refuse88888 = false;
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
