/**
 * The relay indexer must not be a way AROUND the REST route.
 *
 * The app publishes a request to the relays FIRST and then calls the route; the
 * indexer re-reads the relays every 30 minutes as a safety net. Anything the
 * route refuses must therefore be refused by the indexer too, or publishing
 * straight to the relays is a back door. Found on 5. 10. 2026, with a repro
 * against the committed indexer:
 *   1. a request published with a backdated `published_at` opened for funding
 *      the moment the next scan saw it, although maturing is 15 days;
 *   2. the 4-Splits membership rule was never checked.
 *
 * The rule that fixes it is in server/lib/ufMaturing.ts, with the reasoning:
 * why "just clamp to created_at" is wrong (a rebuilt database would restart
 * every window and silently drop the real contributions), and what the indexer
 * can trust instead. THE REBUILD CASE IS TESTED EXPLICITLY below.
 *
 * Needs no server and touches nothing outside this process: a fake relay on
 * 127.0.0.1 and an in-memory SQLite database built from the real schema.
 *   npx tsx scripts/testUfIndexer.ts
 */
import Database from 'better-sqlite3';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';
import { initializeSchema } from '../server/db/schema.js';
import { indexUnconditionalFinancingFromRelays, resetUfIndexerCaches, UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN } from '../server/lib/nostr.js';
import { closeRelayPool } from '../server/lib/relayPool.js';
import {
  isWalletPinned,
  resolveKnownFundingOpensAt,
  resolveNewRequestTiming,
  UF_FUTURE_SKEW_SECONDS,
  UF_PAST_SKEW_SECONDS,
} from '../server/lib/ufMaturing.js';

const DAY = 86400;
const MATURING_DAYS = 15;
const M = MATURING_DAYS * DAY;
const now = Math.floor(Date.now() / 1000);

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 260) : ''); }
}
const near = (got: unknown, want: number, tolerance = 10) =>
  typeof got === 'number' && Math.abs(got - want) <= tolerance;
const days = (seconds: number) => (seconds / DAY).toFixed(2);

// ── keys ────────────────────────────────────────────────
interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const service = newKey();   // stands in for the Lana8Wonder service key (signs every KIND 88888 plan)

// ── a fake relay that answers like a real one ───────────────
const relay = {
  store: [] as Event[],
  /** answer kind 88888 queries with CLOSED, like a relay that refuses the subscription */
  refuse88888: false,
};
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>((r) => wss.on('listening', () => r()));
const RELAY_URL = `ws://127.0.0.1:${(wss.address() as any).port}`;
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m[0] !== 'REQ') return;
    const [, sub, f] = m;
    if (relay.refuse88888 && f.kinds?.includes(88888)) {
      ws.send(JSON.stringify(['CLOSED', sub, 'blocked: test']));
      return;
    }
    const hits = relay.store
      .filter((e) => !f.kinds || f.kinds.includes(e.kind))
      .filter((e) => !f.authors || f.authors.includes(e.pubkey))
      .filter((e) => !f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1])))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, Math.min(f.limit ?? 500, 500));
    for (const e of hits) ws.send(JSON.stringify(['EVENT', sub, e]));
    ws.send(JSON.stringify(['EOSE', sub]));
  });
});

// ── event builders ─────────────────────────────────────
function plan(signer: Key, member: string, createdAt: number): Event {
  return finalizeEvent({
    kind: 88888, created_at: createdAt,
    tags: [['d', `plan:${member.slice(0, 8)}`], ['p', member]],
    content: JSON.stringify({ subject_hex: member }),
  }, signer.sk);
}

interface RequestOpts {
  createdAt: number;
  publishedAt?: number | null;
  fundingOpensAt?: number | null;
  wallet?: string;
  title?: string;
}
function requestTags(d: string, o: RequestOpts): string[][] {
  const tags = [
    ['d', d], ['service', 'unconditional-financing'], ['title', o.title ?? `request ${d}`], ['summary', 's'],
    ['request_type', 'personal_hardship'], ['fiat_goal', '1000'], ['currency', 'EUR'],
    ['wallet', o.wallet ?? 'LWallet'], ['status', 'active'],
  ];
  if (o.publishedAt != null) tags.push(['published_at', String(o.publishedAt)]);
  if (o.fundingOpensAt != null) tags.push(['funding_opens_at', String(o.fundingOpensAt)]);
  return tags;
}
const request = (k: Key, d: string, o: RequestOpts): Event =>
  finalizeEvent({ kind: 31240, created_at: o.createdAt, tags: requestTags(d, o), content: 'story' }, k.sk);

let txCounter = 0;
function contribution(supporter: Key, requestId: string, at: number): Event {
  return finalizeEvent({
    kind: 60210, created_at: at,
    tags: [
      ['service', 'unconditional-financing'], ['request', requestId],
      ['amount_lanoshis', '100000000'], ['amount_fiat', '10'], ['currency', 'EUR'], ['rate', '0.1'],
      ['from_wallet', 'LFrom'], ['repayment_wallet', 'LRepay'], ['to_wallet', 'LTo'],
      ['tx', `tx-${++txCounter}`], ['timestamp_paid', String(at)],
    ],
    content: '',
  }, supporter.sk);
}

// ── a database like production's, in memory ─────────────────
const setSetting = (db: any, key: string, value: string) =>
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);

interface DbOpts { relayUrl?: string; lastScanAt?: number }
function freshDb(o: DbOpts = {}) {
  const db = new Database(':memory:');
  initializeSchema(db);
  db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
              VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
    .run(now, JSON.stringify([o.relayUrl ?? RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk] }), JSON.stringify({ tags: [['split', '9']] }));
  setSetting(db, 'unconditional_financing_maturing_days', String(MATURING_DAYS));
  if (o.lastScanAt) setSetting(db, 'unconditional_financing_last_indexed_at', String(o.lastScanAt));
  // production's split history: only the splits this server has seen (8 and 9)
  const addSplit = db.prepare('INSERT INTO split_history (split, started_at) VALUES (?, ?)');
  addSplit.run(8, now - 95 * DAY);
  addSplit.run(9, now - 27 * DAY);
  return db;
}

/** A long-time member: a plan signed by the service key, enrolled before the recorded history began. */
function member(): Key {
  const k = newKey();
  relay.store.push(plan(service, k.pk, now - 200 * DAY));
  return k;
}

const rowOf = (db: any, id: string) => db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(id) as any;
const contributionsOf = (db: any, id: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM uf_contributions WHERE request_id = ?').get(id) as any).n as number;
const watermarkOf = (db: any) =>
  parseInt((db.prepare("SELECT value FROM app_settings WHERE key = 'unconditional_financing_last_indexed_at'").get() as any)?.value ?? '0', 10);
const scan = async (db: any) => { await indexUnconditionalFinancingFromRelays(db); };
const reset = () => { relay.store = []; relay.refuse88888 = false; resetUfIndexerCaches(); };
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  // the indexer logs a lot, by design; the test output should be the verdicts
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

// ════════════════════════════════════════════════════════
console.log('— the rule itself (pure) —');
{
  const base = { claimedFundingOpensAt: 0, createdAt: now, now, maturingSeconds: M };
  const live = (claimedPublishedAt: number, lastScanAt = now - 600, createdAt = now) =>
    resolveNewRequestTiming({ ...base, claimedPublishedAt, createdAt, lastScanAt });

  check('live: a date within the slack of the last scan is believed',
    live(now - 3000).publishedAt === now - 3000 && !live(now - 3000).publishedAtClamped);
  check('live: a date older than the last scan less the slack is NOT',
    live(now - 30 * DAY).publishedAt === now - 600 - UF_PAST_SKEW_SECONDS && live(now - 30 * DAY).publishedAtClamped);
  check('live: a date from the future is held at now + 5 minutes',
    live(now + 30 * DAY).publishedAt === now + UF_FUTURE_SKEW_SECONDS);
  check('live: the signer’s own funding_opens_at is ignored',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now, claimedFundingOpensAt: now - 10 * DAY, lastScanAt: now - 600 }).fundingOpensAt === now + M);
  check('live: an edit inside the window restarts it from the edit (the scan is old enough to believe the dates)',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now - 2 * DAY, createdAt: now - 1 * DAY, lastScanAt: now - 3 * DAY }).fundingOpensAt === now - DAY + M);
  check('live: an edit AFTER the window would have ended does not',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now - 20 * DAY, createdAt: now - 1 * DAY, lastScanAt: now - 25 * DAY }).fundingOpensAt === now - 20 * DAY + M);
  check('backfill (no scan yet): the dates are taken as written',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now - 30 * DAY, claimedFundingOpensAt: now - 15 * DAY, lastScanAt: 0 }).fundingOpensAt === now - 15 * DAY);
  check('backfill: an opening before the publication is not believed',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now - 20 * DAY, createdAt: now - 20 * DAY, claimedFundingOpensAt: now - 40 * DAY, lastScanAt: 0 }).fundingOpensAt === now - 20 * DAY + M);
  check('backfill: an absurdly distant opening is not believed',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now - 20 * DAY, createdAt: now - 20 * DAY, claimedFundingOpensAt: now + 900 * DAY, lastScanAt: 0 }).fundingOpensAt === now - 20 * DAY + M);
  check('backfill: still never from the future',
    resolveNewRequestTiming({ ...base, claimedPublishedAt: now + 30 * DAY, lastScanAt: 0 }).publishedAt === now + UF_FUTURE_SKEW_SECONDS);

  check('known: open stays open whatever the edit claims', resolveKnownFundingOpensAt({ existingOpensAt: now - DAY, eventCreatedAt: now - 2 * DAY, now, maturingSeconds: M }) === now - DAY);
  check('known: maturing, refined → restarts, later only',
    resolveKnownFundingOpensAt({ existingOpensAt: now + 13 * DAY, eventCreatedAt: now, now, maturingSeconds: M }) === now + M);
  check('known: maturing, a SHORTER setting never pulls it closer',
    resolveKnownFundingOpensAt({ existingOpensAt: now + 13 * DAY, eventCreatedAt: now, now, maturingSeconds: 1 * DAY }) === now + 13 * DAY);
  check('wallet is pinned exactly when open', isWalletPinned(now - 1, now) && isWalletPinned(now, now) && !isWalletPinned(now + 1, now));
}

// ════════════════════════════════════════════════════════
console.log('— the attack: backdating, published straight to the relays —');
{
  reset();
  const lastScan = now - 600;                       // a normal scan, ten minutes ago
  const honest = member(), tagOnly = member(), allDates = member(), future = member();
  const stranger = newKey(), selfVouched = newKey(), newcomer = newKey();
  relay.store.push(plan(selfVouched, selfVouched.pk, now - 400 * DAY));   // signs a plan about THEMSELVES, long ago
  relay.store.push(plan(service, newcomer.pk, now - 10 * DAY));            // a real plan, but enrolled 10 days ago

  relay.store.push(
    request(honest,   'uf:honest',        { createdAt: now, publishedAt: now, fundingOpensAt: now + M }),
    // published_at 30 days ago, and the funding_opens_at the signer says it has
    request(tagOnly,  'uf:tag-backdated', { createdAt: now, publishedAt: now - 30 * DAY, fundingOpensAt: now - 15 * DAY }),
    // created_at backdated too — a clamp to created_at would not have caught this one
    request(allDates, 'uf:all-backdated', { createdAt: now - 30 * DAY, publishedAt: now - 30 * DAY, fundingOpensAt: now - 15 * DAY }),
    request(future,   'uf:future',        { createdAt: now, publishedAt: now + 30 * DAY }),
    request(stranger,   'uf:stranger',   { createdAt: now, publishedAt: now - 30 * DAY }),
    request(selfVouched, 'uf:self',      { createdAt: now, publishedAt: now - 30 * DAY }),
    request(newcomer,   'uf:newcomer',   { createdAt: now, publishedAt: now - 30 * DAY }),
  );
  const db = freshDb({ lastScanAt: lastScan });
  await quiet(() => scan(db));

  const r = (id: string) => rowOf(db, id);
  check('an honest request matures for the full 15 days', near(r('uf:honest')?.funding_opens_at, now + M, 2), r('uf:honest'));
  check('a backdated published_at tag does NOT open it', r('uf:tag-backdated') && r('uf:tag-backdated').funding_opens_at > now + 14 * DAY, r('uf:tag-backdated'));
  check('…its publication date was held at the last scan less the slack, not 30 days ago',
    r('uf:tag-backdated')?.published_at === lastScan - UF_PAST_SKEW_SECONDS, { got: r('uf:tag-backdated')?.published_at, want: lastScan - UF_PAST_SKEW_SECONDS });
  check('created_at backdated as well: still maturing (≈15 days)', r('uf:all-backdated') && r('uf:all-backdated').funding_opens_at > now + 14 * DAY && r('uf:all-backdated').funding_opens_at <= now + M, r('uf:all-backdated'));
  check('a date from the future only delays (held at now + 5 min)', near(r('uf:future')?.funding_opens_at, now + UF_FUTURE_SKEW_SECONDS + M, 30), r('uf:future'));
  for (const id of ['uf:honest', 'uf:tag-backdated', 'uf:all-backdated', 'uf:future']) {
    check(`${id}: shows as maturing`, r(id) && r(id).funding_opens_at > now, r(id));
  }

  console.log('— …and membership, which the route checks and the indexer did not —');
  check('a stranger with no Lana8Wonder plan is NOT listed', !r('uf:stranger'));
  check('a plan signed by the person ABOUT THEMSELVES, dated long ago, does not make them a member', !r('uf:self'));
  check('a real member enrolled 10 days ago (too new) is NOT listed', !r('uf:newcomer'));

  console.log('— a second scan changes nothing —');
  const before = ['uf:honest', 'uf:tag-backdated', 'uf:all-backdated', 'uf:future'].map((id) => ({ ...r(id) }));
  await quiet(() => scan(db));
  const after = ['uf:honest', 'uf:tag-backdated', 'uf:all-backdated', 'uf:future'].map((id) => r(id));
  check('windows and publication dates are stable across scans',
    before.every((b, i) => b.published_at === after[i].published_at && b.funding_opens_at === after[i].funding_opens_at), { before, after });
  check('the scan watermark moved to this scan', near(watermarkOf(db), now, 15), watermarkOf(db));
  check('the ineligible are still not listed', !r('uf:stranger') && !r('uf:self') && !r('uf:newcomer'));
}

// ════════════════════════════════════════════════════════
console.log('— a membership check nobody could answer never lists a request —');
{
  reset();
  const m = member();
  relay.store.push(request(m, 'uf:waits', { createdAt: now, publishedAt: now }));
  const db = freshDb({ lastScanAt: now - 600 });

  relay.refuse88888 = true;
  await quiet(() => scan(db));
  check('relay refuses the membership query → not listed (fail closed)', !rowOf(db, 'uf:waits'));

  relay.refuse88888 = false;
  await new Promise((r) => setTimeout(r, 50));
  await quiet(() => scan(db));
  check('the next scan, once it can be asked, lists it', !!rowOf(db, 'uf:waits'), rowOf(db, 'uf:waits'));
}

// ════════════════════════════════════════════════════════
console.log('— REBUILD: the database is built again from the relays alone —');
{
  reset();
  // Real situations. Each client wrote funding_opens_at from the window the server
  // had announced at that moment; the maturing length was 0 when R1 was published.
  const m1 = member(), m2 = member(), m3 = member(), m4 = member(), m5 = member(), m6 = member(), plant = member();
  const supporters = [newKey(), newKey(), newKey()];

  const R1 = { P: now - 3 * DAY, C: now - 3 * DAY, F: now - 3 * DAY };            // published under 0 days, never edited
  const R2 = { P: now - 30 * DAY, C: now - 5 * DAY, F: now - 15 * DAY };          // edited AFTER it opened: created_at is the edit
  const R3 = { P: now - 10 * DAY, C: now - 4 * DAY, F: now - 4 * DAY + M };       // edited WHILE maturing: window restarted
  const R4 = { P: now - 20 * DAY, C: now - 20 * DAY, F: now - 20 * DAY + M };     // published under the 15 days we have now
  relay.store.push(
    request(m1, 'uf:r1', { createdAt: R1.C, publishedAt: R1.P, fundingOpensAt: R1.F }),
    request(m2, 'uf:r2', { createdAt: R2.C, publishedAt: R2.P, fundingOpensAt: R2.F }),
    request(m3, 'uf:r3', { createdAt: R3.C, publishedAt: R3.P, fundingOpensAt: R3.F }),
    request(m4, 'uf:r4', { createdAt: R4.C, publishedAt: R4.P, fundingOpensAt: R4.F }),
    request(m5, 'uf:r5', { createdAt: now - 20 * DAY, publishedAt: now - 20 * DAY }),                                   // no funding_opens_at tag at all
    request(m6, 'uf:r6', { createdAt: now - 20 * DAY, publishedAt: now - 20 * DAY, fundingOpensAt: now - 40 * DAY }),   // an opening BEFORE its own publication
  );
  // contributions
  relay.store.push(
    contribution(supporters[0], 'uf:r1', now - 3 * DAY + 3600), contribution(supporters[1], 'uf:r1', now - 2 * DAY), contribution(supporters[2], 'uf:r1', now - 1 * DAY),
    contribution(supporters[0], 'uf:r2', now - 14 * DAY), contribution(supporters[1], 'uf:r2', now - 10 * DAY), contribution(supporters[2], 'uf:r2', now - 6 * DAY),
    contribution(supporters[0], 'uf:r3', now - 1 * DAY),                                   // inside the restarted window → invalid by protocol
    contribution(supporters[0], 'uf:r4', now - 18 * DAY), contribution(supporters[1], 'uf:r4', now - 3 * DAY),   // first inside the window, second after it
    contribution(supporters[0], 'uf:r5', now - 3 * DAY),
    contribution(supporters[0], 'uf:r6', now - 10 * DAY),                                  // inside the window the claim cannot shorten
  );
  // somebody who is NOT a member plants an old request in the same relays
  const stranger = newKey();
  relay.store.push(request(stranger, 'uf:stranger-old', { createdAt: now - 40 * DAY, publishedAt: now - 40 * DAY, fundingOpensAt: now - 40 * DAY }));

  // what the naive repairs would have done to these very requests
  const clampToCreatedAt = (x: { P: number; C: number }) => Math.max(x.P, x.C - 3600) + M;
  const todaysLengthOnOldDates = (x: { P: number }) => x.P + M;
  check('(sanity) a clamp to created_at would restart R1 and R2 — their contributions would be dropped',
    clampToCreatedAt(R1) > now - 3 * DAY + 3600 && clampToCreatedAt(R2) > now - 6 * DAY, { r1: days(clampToCreatedAt(R1) - now), r2: days(clampToCreatedAt(R2) - now) });
  check('(sanity) today’s 15 days applied to R1, published when it was 0, would open it in the future',
    todaysLengthOnOldDates(R1) > now, days(todaysLengthOnOldDates(R1) - now));

  const db = freshDb();          // no scan watermark: this database has never scanned
  check('(precondition) the database has never completed a scan', watermarkOf(db) === 0);
  await quiet(() => scan(db));

  const r = (id: string) => rowOf(db, id);
  check('R1 (published under 0 days): window reproduced as it was', r('uf:r1')?.funding_opens_at === R1.F && r('uf:r1')?.published_at === R1.P, r('uf:r1'));
  check('R1: all 3 real contributions kept', contributionsOf(db, 'uf:r1') === 3, contributionsOf(db, 'uf:r1'));
  check('R2 (edited after it opened): the ORIGINAL date and window survive the edit', r('uf:r2')?.funding_opens_at === R2.F && r('uf:r2')?.published_at === R2.P, r('uf:r2'));
  check('R2: all 3 contributions kept', contributionsOf(db, 'uf:r2') === 3, contributionsOf(db, 'uf:r2'));
  check('R3 (edited while maturing): still maturing, window as restarted', r('uf:r3')?.funding_opens_at === R3.F && r('uf:r3').funding_opens_at > now, r('uf:r3'));
  check('R3: a contribution dated inside the window is still refused', contributionsOf(db, 'uf:r3') === 0, contributionsOf(db, 'uf:r3'));
  check('R4 (published under 15 days): window reproduced', r('uf:r4')?.funding_opens_at === R4.F, r('uf:r4'));
  check('R4: the one inside the window refused, the one after it kept', contributionsOf(db, 'uf:r4') === 1, contributionsOf(db, 'uf:r4'));
  check('R5 (no funding_opens_at tag): published + 15 days, its contribution after that kept',
    r('uf:r5')?.funding_opens_at === now - 20 * DAY + M && contributionsOf(db, 'uf:r5') === 1, { row: r('uf:r5'), n: contributionsOf(db, 'uf:r5') });
  check('R6 (opening before its own publication): the claim is not believed — published + 15 days; the contribution inside that window refused',
    r('uf:r6')?.funding_opens_at === now - 20 * DAY + M && contributionsOf(db, 'uf:r6') === 0, { row: r('uf:r6'), n: contributionsOf(db, 'uf:r6') });
  check('a NON-member’s old request is still not listed, even while rebuilding', !r('uf:stranger-old'));
  check('the rebuild recorded a scan: the database is no longer "from scratch"', watermarkOf(db) > 0, watermarkOf(db));

  console.log('— …and the same scan again changes nothing —');
  const snapshot = JSON.stringify(['uf:r1', 'uf:r2', 'uf:r3', 'uf:r4', 'uf:r5', 'uf:r6'].map((id) => [r(id).published_at, r(id).funding_opens_at, contributionsOf(db, id)]));
  await quiet(() => scan(db));
  const again = JSON.stringify(['uf:r1', 'uf:r2', 'uf:r3', 'uf:r4', 'uf:r5', 'uf:r6'].map((id) => [r(id).published_at, r(id).funding_opens_at, contributionsOf(db, id)]));
  check('windows, dates and contributions are identical', snapshot === again, { snapshot, again });

  console.log('— …and once it has scanned, a backdated request is clamped like any other —');
  relay.store.push(request(plant, 'uf:planted-after', { createdAt: now, publishedAt: now - 30 * DAY, fundingOpensAt: now - 30 * DAY }));
  await quiet(() => scan(db));
  check('planted after the rebuild: not open', r('uf:planted-after') && r('uf:planted-after').funding_opens_at > now + 14 * DAY, r('uf:planted-after'));
}

// ════════════════════════════════════════════════════════
console.log('— REBUILD that does not get through in one scan —');
{
  // The watermark only moves past a scan that SETTLED every request it did not know.
  // If it moved past a scan that left some waiting, the next scan would distrust their
  // dates, restart their windows and drop their real contributions — the very loss the
  // rebuild rule exists to prevent, reached by another road.
  const supporter = newKey();
  const published = now - 3 * DAY;     // published when the maturing length was 0: opens the moment it is published

  console.log('  · the membership check cannot be answered during the first scan');
  {
    reset();
    const m = member();
    relay.store.push(
      request(m, 'uf:flaky', { createdAt: published, publishedAt: published, fundingOpensAt: published }),
      contribution(supporter, 'uf:flaky', now - 1 * DAY),
    );
    const db = freshDb();
    relay.refuse88888 = true;
    await quiet(() => scan(db));
    check('first scan: nothing could be checked, nothing listed', !rowOf(db, 'uf:flaky'));
    check('…and the database is STILL "from scratch": the watermark did not move', watermarkOf(db) === 0, watermarkOf(db));

    relay.refuse88888 = false;
    await new Promise((r) => setTimeout(r, 50));
    await quiet(() => scan(db));
    check('second scan: listed with the window it really had', rowOf(db, 'uf:flaky')?.funding_opens_at === published, rowOf(db, 'uf:flaky'));
    check('…and its real contribution kept (a live-mode scan would have dropped it)', contributionsOf(db, 'uf:flaky') === 1, contributionsOf(db, 'uf:flaky'));
    check('now that everything was settled the watermark moved', watermarkOf(db) > 0, watermarkOf(db));
  }

  console.log('  · more requesters than one scan may look up');
  {
    reset();
    const total = UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN + 5;
    for (let i = 0; i < total; i++) {
      const m = member();
      relay.store.push(
        request(m, `uf:bulk-${i}`, { createdAt: published, publishedAt: published, fundingOpensAt: published }),
        contribution(supporter, `uf:bulk-${i}`, now - 1 * DAY),
      );
    }
    const db = freshDb();
    const listed = () => (db.prepare('SELECT COUNT(*) AS n FROM uf_requests').get() as any).n as number;
    const kept = () => (db.prepare('SELECT COUNT(*) AS n FROM uf_contributions').get() as any).n as number;
    await quiet(() => scan(db));
    check(`first scan: as many as it may look up are listed (${UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN} of ${total})`, listed() === UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN, listed());
    check('…and the watermark did NOT move, because five are still waiting', watermarkOf(db) === 0, watermarkOf(db));
    await quiet(() => scan(db));
    check(`second scan: the rest are listed too (${total} of ${total})`, listed() === total, listed());
    check('…all of them as they really were — every real contribution kept, none dropped by a premature live-mode scan', kept() === total, kept());
    check('…and then the watermark moved', watermarkOf(db) > 0, watermarkOf(db));
  }
}

// ════════════════════════════════════════════════════════
console.log('— RESTORE from a backup that is three weeks old —');
{
  reset();
  const backup = now - 21 * DAY;
  const fresh = member(), attacker = member(), zeroEra = member();
  const supporter = newKey();
  relay.store.push(
    // published 18 days ago, after the backup, under the 15 days: really open since 3 days
    request(fresh, 'uf:after-backup', { createdAt: now - 18 * DAY, publishedAt: now - 18 * DAY, fundingOpensAt: now - 18 * DAY + M }),
    contribution(supporter, 'uf:after-backup', now - 2 * DAY),
    // claims to be 60 days old — older than the backup, so it cannot have been on the relays at the backup
    request(attacker, 'uf:older-than-backup', { createdAt: now - 60 * DAY, publishedAt: now - 60 * DAY, fundingOpensAt: now - 45 * DAY }),
    // published after the backup while the setting was 0 days
    request(zeroEra, 'uf:zero-era', { createdAt: now - 5 * DAY, publishedAt: now - 5 * DAY, fundingOpensAt: now - 5 * DAY }),
    contribution(supporter, 'uf:zero-era', now - 4 * DAY),
  );
  const db = freshDb({ lastScanAt: backup });
  await quiet(() => scan(db));
  const r = (id: string) => rowOf(db, id);

  check('published after the backup: believed as written, its contribution kept',
    r('uf:after-backup')?.published_at === now - 18 * DAY && r('uf:after-backup')?.funding_opens_at === now - 3 * DAY && contributionsOf(db, 'uf:after-backup') === 1,
    { row: r('uf:after-backup'), n: contributionsOf(db, 'uf:after-backup') });
  check('older than the backup: its date is held at the backup (less the slack), not 60 days ago',
    r('uf:older-than-backup')?.published_at === backup - UF_PAST_SKEW_SECONDS, { got: r('uf:older-than-backup')?.published_at, want: backup - UF_PAST_SKEW_SECONDS });
  // KNOWN LIMIT, stated so that a change to it is a decision and not an accident:
  // the trust horizon after a restore is the backup — a backdated request can reach back to it, no further.
  check('(known limit) after a stale restore the horizon is the backup: the opening follows from that date',
    r('uf:older-than-backup')?.funding_opens_at === backup - UF_PAST_SKEW_SECONDS + M, r('uf:older-than-backup'));
  // KNOWN LIMIT: the maturing length of the time cannot be known to a database that did not see it.
  check('(known limit) published under a SHORTER setting that this database never saw: it gets today’s length, and the contribution inside it waits',
    r('uf:zero-era')?.funding_opens_at === now - 5 * DAY + M && contributionsOf(db, 'uf:zero-era') === 0,
    { row: r('uf:zero-era'), n: contributionsOf(db, 'uf:zero-era') });
}

// ════════════════════════════════════════════════════════
console.log('— a request the database already knows —');
{
  reset();
  const open = newKey(), maturing = newKey(), openB = newKey(), signed = newKey(), thief = newKey();
  const db = freshDb({ lastScanAt: now - 600 });
  const seed = db.prepare(`
    INSERT INTO uf_requests (id, event_id, pubkey, title, short_desc, content, request_type, fiat_goal, currency, wallet,
                             published_at, funding_opens_at, status, is_hidden, is_repaid, nostr_created_at)
    VALUES (?, ?, ?, 'Seeded', 's', 'c', 'personal_hardship', 1000, 'EUR', ?, ?, ?, 'active', 0, 0, ?)`);
  const OPEN_PUB = now - 30 * DAY, OPEN_OPENS = now - 15 * DAY;
  seed.run('uf:k-open', 'e1', open.pk, 'LOpen', OPEN_PUB, OPEN_OPENS, OPEN_PUB);
  seed.run('uf:k-maturing', 'e2', maturing.pk, 'LMaturing', now - 2 * DAY, now + 13 * DAY, now - 2 * DAY);
  seed.run('uf:k-open-b', 'e3', openB.pk, 'LOpenB', OPEN_PUB, OPEN_OPENS, OPEN_PUB);
  seed.run('uf:k-signed', 'e4', signed.pk, 'LSigned', OPEN_PUB, OPEN_OPENS, OPEN_PUB);

  relay.store.push(
    // refined after opening, claiming another wallet and an opening 99 days away
    request(open, 'uf:k-open', { createdAt: now, publishedAt: OPEN_PUB, fundingOpensAt: now + 99 * DAY, wallet: 'LAttacker', title: 'Edited after opening' }),
    // refined while maturing
    request(maturing, 'uf:k-maturing', { createdAt: now, publishedAt: now - 2 * DAY, wallet: 'LCorrected', title: 'Refined while maturing' }),
    // an edit BACKDATED to just before the request opened, to pass for "refined while maturing"
    request(openB, 'uf:k-open-b', { createdAt: OPEN_OPENS - 1, publishedAt: OPEN_PUB, wallet: 'LSwap', title: 'Backdated edit' }),
    // somebody else's event on an existing d-tag
    request(thief, 'uf:k-signed', { createdAt: now, publishedAt: now, title: 'Hijack' }),
  );
  // a tampered event: valid for an existing row, signature broken afterwards
  const tampered = request(signed, 'uf:k-signed', { createdAt: now + 1, publishedAt: OPEN_PUB, title: 'Honest title' });
  tampered.tags = tampered.tags.map((t) => (t[0] === 'title' ? ['title', 'Tampered title'] : t));
  relay.store.push(tampered);

  await quiet(() => scan(db));
  const r = (id: string) => rowOf(db, id);

  check('open: the edit is applied (title)', r('uf:k-open')?.title === 'Edited after opening', r('uf:k-open'));
  check('open: the receiving wallet is PINNED — the edit’s wallet is not used', r('uf:k-open')?.wallet === 'LOpen', r('uf:k-open')?.wallet);
  check('open: the window is untouched, whatever funding_opens_at the edit claims', r('uf:k-open')?.funding_opens_at === OPEN_OPENS && r('uf:k-open')?.published_at === OPEN_PUB, r('uf:k-open'));
  check('maturing: the wallet may still be corrected', r('uf:k-maturing')?.wallet === 'LCorrected', r('uf:k-maturing')?.wallet);
  check('maturing: refining restarts the review — later, never sooner', near(r('uf:k-maturing')?.funding_opens_at, now + M, 2), r('uf:k-maturing')?.funding_opens_at);
  check('a backdated edit cannot drag an OPEN request back into maturing', r('uf:k-open-b')?.funding_opens_at === OPEN_OPENS, r('uf:k-open-b'));
  check('…nor unpin its wallet', r('uf:k-open-b')?.wallet === 'LOpenB', r('uf:k-open-b')?.wallet);
  check('another author cannot take over an existing id', r('uf:k-signed')?.pubkey === signed.pk && r('uf:k-signed')?.title === 'Seeded', r('uf:k-signed'));
  check('an event whose signature does not hold is ignored', r('uf:k-signed')?.title !== 'Tampered title', r('uf:k-signed')?.title);
}

// ════════════════════════════════════════════════════════
console.log('— no relay answers —');
{
  reset();
  const k = newKey();
  const stale = now - 7 * DAY;
  const db = freshDb({ relayUrl: 'ws://127.0.0.1:1', lastScanAt: stale });
  db.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, wallet, published_at, funding_opens_at, nostr_created_at)
              VALUES ('uf:kept', 'e', ?, 'Kept', 'LW', ?, ?, ?)`).run(k.pk, now - 20 * DAY, now - 5 * DAY, now - 20 * DAY);
  await quiet(() => scan(db));
  check('nothing was heard, so nothing changed', rowOf(db, 'uf:kept')?.title === 'Kept');
  check('…and the scan watermark did NOT move past a scan that never happened', watermarkOf(db) === stale, { got: watermarkOf(db), want: stale });
}

closeRelayPool();
wss.close();
if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ ALL INDEXER TESTS PASSED');
process.exit(0);
