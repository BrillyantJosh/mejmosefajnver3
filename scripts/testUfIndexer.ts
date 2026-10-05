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
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';
import { initializeSchema } from '../server/db/schema.js';
import {
  indexUnconditionalFinancingFromRelays,
  isGenuineSystemParameters,
  resetUfIndexerCaches,
  UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN,
} from '../server/lib/nostr.js';
import { closeRelayPool } from '../server/lib/relayPool.js';
import { CALENDAR_DAY_SKEW_SECONDS } from '../server/lib/ufSplitCount.js';
import { computeEligibility } from '../server/lib/ufEligibility.js';
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

// ── fake relays that answer like real ones ─────────────────
interface FakeRelay {
  store: Event[];
  url: string;
  /** answer kind 88888 queries with CLOSED, like a relay that refuses the subscription */
  refuse88888: boolean;
  /** answer EVERYTHING with CLOSED: the relay is down for this reader */
  down: boolean;
  /** ignore the `authors` and `#p` filters on kind 88888, like a relay that does not honour them */
  lax88888: boolean;
  /** answer the next N kind-88888 queries with a clean EOSE and no events (a transient empty answer) */
  emptyNext88888: number;
  /** how many kind-88888 queries arrived (answered or not) */
  count88888: number;
  close(): void;
}
async function makeRelay(): Promise<FakeRelay> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  const r: FakeRelay = {
    store: [], url: `ws://127.0.0.1:${(wss.address() as any).port}`,
    refuse88888: false, down: false, lax88888: false, emptyNext88888: 0, count88888: 0,
    close: () => wss.close(),
  };
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m[0] !== 'REQ') return;
      const [, sub, f] = m;
      const is88888 = !!f.kinds?.includes(88888);
      if (is88888) r.count88888++;
      if (r.down || (r.refuse88888 && is88888)) {
        ws.send(JSON.stringify(['CLOSED', sub, 'blocked: test']));
        return;
      }
      if (is88888 && r.emptyNext88888 > 0) {
        r.emptyNext88888--;
        ws.send(JSON.stringify(['EOSE', sub]));
        return;
      }
      const honour = !(is88888 && r.lax88888);
      const hits = r.store
        .filter((e) => !f.kinds || f.kinds.includes(e.kind))
        .filter((e) => !honour || !f.authors || f.authors.includes(e.pubkey))
        .filter((e) => !honour || !f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1])))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, Math.min(f.limit ?? 500, 500));
      for (const e of hits) ws.send(JSON.stringify(['EVENT', sub, e]));
      ws.send(JSON.stringify(['EOSE', sub]));
    });
  });
  return r;
}
const relay = await makeRelay();     // the relay every scenario uses
const relay2 = await makeRelay();    // a second one, for scenarios about a relay that is silent
const RELAY_URL = relay.url;

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

interface DbOpts { relayUrl?: string; relayUrls?: string[]; lastScanAt?: number; calendar?: unknown }
function freshDb(o: DbOpts = {}) {
  const db = new Database(':memory:');
  initializeSchema(db);
  db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
              VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
    .run(now, JSON.stringify(o.relayUrls ?? [o.relayUrl ?? RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk] }), JSON.stringify(o.calendar ?? calendarEvent(now, DAY)));
  setSetting(db, 'unconditional_financing_maturing_days', String(MATURING_DAYS));
  if (o.lastScanAt) setSetting(db, 'unconditional_financing_last_indexed_at', String(o.lastScanAt));
  return db;
}

/** A member with enough Splits: a plan signed by the service key, enrolled 200 days ago — four Splits are over since. */
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
const reset = () => {
  for (const r of [relay, relay2]) { r.store = []; r.refuse88888 = false; r.down = false; r.lax88888 = false; r.emptyNext88888 = 0; r.count88888 = 0; }
  resetUfIndexerCaches();
};
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
console.log('— the system parameters are only believed with a valid signature from the authority —');
{
  // A real KIND 38888 as production published it (copied from a sibling repo's fixtures; it verifies).
  const real = JSON.parse(readFileSync(new URL('./fixtures/kind38888.signed.json', import.meta.url), 'utf8'));
  // nostr-tools remembers a successful verification ON the event object (a symbol key), and an object
  // spread copies it — so a tampered copy of an event that was already verified would inherit "verified".
  // Every variant below is therefore built from plain JSON, the way an event arrives from a relay.
  const variant = (change: (e: any) => void) => { const e = JSON.parse(JSON.stringify(real)); change(e); return e; };
  check('the real signed event is accepted', isGenuineSystemParameters(variant(() => {})));
  check('…with one tag changed it is NOT: the signature no longer holds',
    !isGenuineSystemParameters(variant((e) => { e.tags = e.tags.map((t: string[]) => (t[0] === 'split' ? ['split', '1'] : t)); })));
  check('…with its content changed it is NOT', !isGenuineSystemParameters(variant((e) => { e.content = '{}'; })));
  const stranger = newKey();
  const forged = JSON.parse(JSON.stringify(finalizeEvent({ kind: 38888, created_at: real.created_at + 1, tags: real.tags, content: real.content }, stranger.sk)));
  check('the same content, perfectly signed by SOMEONE ELSE, is NOT the authority’s', !isGenuineSystemParameters(forged));
  check('another kind with the authority’s name on it is NOT', !isGenuineSystemParameters(variant((e) => { e.kind = 1; })));
  check('an event without a valid signature is NOT',
    !isGenuineSystemParameters(variant((e) => { delete e.sig; })) && !isGenuineSystemParameters(variant((e) => { e.sig = 'local_seed'; })));
  check('nothing at all is not', !isGenuineSystemParameters(null) && !isGenuineSystemParameters({}));
}

// ════════════════════════════════════════════════════════
console.log('— the attack: backdating, published straight to the relays —');
{
  reset();
  const lastScan = now - 600;                       // a normal scan, ten minutes ago
  const honest = member(), tagOnly = member(), allDates = member(), future = member();
  const stranger = newKey(), selfVouched = newKey(), newcomer = newKey(), oldException = newKey();
  relay.store.push(plan(selfVouched, selfVouched.pk, now - 400 * DAY));   // signs a plan about THEMSELVES, long ago
  relay.store.push(plan(service, newcomer.pk, now - 10 * DAY));            // a real plan, but enrolled 10 days ago
  relay.store.push(plan(service, oldException.pk, now - 120 * DAY));       // real, and older than the table the server used to count from — but only ONE Split is over since

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
    request(oldException, 'uf:old-exception', { createdAt: now, publishedAt: now - 30 * DAY }),
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
  check('a real member with ONE finished Split is NOT listed — the old "long-time member" exception is gone', !r('uf:old-exception'));

  console.log('— a second scan changes nothing —');
  const before = ['uf:honest', 'uf:tag-backdated', 'uf:all-backdated', 'uf:future'].map((id) => ({ ...r(id) }));
  await quiet(() => scan(db));
  const after = ['uf:honest', 'uf:tag-backdated', 'uf:all-backdated', 'uf:future'].map((id) => r(id));
  check('windows and publication dates are stable across scans',
    before.every((b, i) => b.published_at === after[i].published_at && b.funding_opens_at === after[i].funding_opens_at), { before, after });
  check('the scan watermark moved to this scan', near(watermarkOf(db), now, 15), watermarkOf(db));
  check('the ineligible are still not listed', !r('uf:stranger') && !r('uf:self') && !r('uf:newcomer') && !r('uf:old-exception'));
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
console.log('— a Split calendar that cannot be read is "unknown", never "not eligible" —');
{
  reset();
  const m = member();
  relay.store.push(request(m, 'uf:calendar-gap', { createdAt: now, publishedAt: now }));
  // Split 3 is missing from the published history: a calendar in the middle of an edit
  const gapped = calendarEvent(now, DAY);
  gapped.tags = gapped.tags.filter((t) => !(t[0] === 'split_history' && t[1] === '3'));
  const db = freshDb({ lastScanAt: now - 600, calendar: gapped });
  const mark = watermarkOf(db);

  await quiet(() => scan(db));
  check('a gapped calendar lists nothing', !rowOf(db, 'uf:calendar-gap'));
  check('…and the scan is not counted as done: the watermark did not move', watermarkOf(db) === mark, { before: mark, after: watermarkOf(db) });

  // the authority fixes the calendar: the very next scan lists it
  db.prepare('UPDATE kind_38888 SET raw_event = ?').run(JSON.stringify(calendarEvent(now, DAY)));
  await quiet(() => scan(db));
  check('once the calendar is whole again, the next scan lists it', !!rowOf(db, 'uf:calendar-gap'), rowOf(db, 'uf:calendar-gap'));
}

// ════════════════════════════════════════════════════════
console.log('— membership at the edges: three Splits is not four, and a Split joined halfway does not count —');
{
  reset();
  // Split 5 is dated 185 days ago in the seeded calendar; a Split begins two hours before its
  // row says. Splits 5-8 are the four that are over: they are all behind anyone who enrolled
  // before Split 5 BEGAN.
  const began5 = now - 185 * DAY - CALENDAR_DAY_SKEW_SECONDS;
  const people: [string, string, number, number][] = [
    ['one second before Split 5 began', 'before', began5 - 1, 4],
    ['the very second Split 5 began', 'start', began5, 3],
    ['an hour into Split 5', 'halfway', began5 + 3600, 3],
    ['160 days ago (Splits 6, 7, 8)', 'three', now - 160 * DAY, 3],
    ['190 days ago (Splits 5-8)', 'four', now - 190 * DAY, 4],
  ];
  const keys = new Map<string, Key>();
  for (const [, id, enrolled] of people) {
    const k = newKey();
    keys.set(id, k);
    relay.store.push(plan(service, k.pk, enrolled), request(k, `uf:edge-${id}`, { createdAt: now, publishedAt: now }));
  }
  const db = freshDb({ lastScanAt: now - 600 });
  await quiet(() => scan(db));
  for (const [who, id, , splits] of people) {
    check(`enrolled ${who}: ${splits} Splits → ${splits >= 4 ? 'listed' : 'NOT listed'}`, splits >= 4 ? !!rowOf(db, `uf:edge-${id}`) : !rowOf(db, `uf:edge-${id}`), rowOf(db, `uf:edge-${id}`));
  }
  // the very same people, asked directly: the count the indexer judged them by
  const asked = async (id: string): Promise<any> => computeEligibility(db, keys.get(id)!.pk, async (_relays, f) => ({
    events: relay.store.filter((e) => e.kind === 88888 && f.authors.includes(e.pubkey) && e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))),
    answered: ['x'], failed: [],
  }));
  for (const [who, id, , splits] of people) {
    const e = await asked(id);
    check(`…and counted directly: ${who} has ${splits}`, e.completedSplitsSinceEnrollment === splits && e.eligible === (splits >= 4), e);
  }
}

// ════════════════════════════════════════════════════════
console.log('— a calendar that breaks AFTER a sound scan: the last sound one answers, and admits nobody new —');
{
  reset();
  const a = member(), b = member();
  const oneSplit = newKey();
  relay.store.push(plan(service, oneSplit.pk, now - 120 * DAY));   // one finished Split since
  relay.store.push(request(a, 'uf:before-break', { createdAt: now, publishedAt: now }));
  const db = freshDb({ lastScanAt: now - 600 });
  await quiet(() => scan(db));
  check('a sound calendar: the first request is listed', !!rowOf(db, 'uf:before-break'));

  // the authority's calendar loses Split 3 (mid-edit) — and two more requests arrive
  const gapped = calendarEvent(now, DAY);
  gapped.tags = gapped.tags.filter((t) => !(t[0] === 'split_history' && t[1] === '3'));
  db.prepare('UPDATE kind_38888 SET raw_event = ?').run(JSON.stringify(gapped));
  relay.store.push(request(b, 'uf:during-break', { createdAt: now, publishedAt: now }));
  relay.store.push(request(oneSplit, 'uf:during-break-no', { createdAt: now, publishedAt: now }));
  await quiet(() => scan(db));
  check('the member whose request arrives while it is broken is listed (the calendar from before answers)', !!rowOf(db, 'uf:during-break'), rowOf(db, 'uf:during-break'));
  check('…while one finished Split is still refused: standing in admits nobody new', !rowOf(db, 'uf:during-break-no'));
  check('…and that scan settled: the watermark moved (nothing is waiting on the calendar)', near(watermarkOf(db), now, 15), watermarkOf(db));
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
  const open = newKey(), maturing = newKey(), openB = newKey(), signed = newKey(), thief = newKey(), byHand = newKey(), byHandLater = newKey();
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
  // Two windows an administrator corrected BY HAND (5. 10. 2026: a request had opened with the
  // maturing length at 0 days). The owner's signed event on the relays still says 0 days.
  const HAND_PUB = now - 8 * 3600;
  seed.run('uf:k-by-hand', 'e5', byHand.pk, 'LByHand', HAND_PUB, HAND_PUB + M, HAND_PUB);
  seed.run('uf:k-by-hand-later', 'e6', byHandLater.pk, 'LByHandLater', HAND_PUB, HAND_PUB + 20 * DAY, HAND_PUB);

  relay.store.push(
    // refined after opening, claiming another wallet and an opening 99 days away
    request(open, 'uf:k-open', { createdAt: now, publishedAt: OPEN_PUB, fundingOpensAt: now + 99 * DAY, wallet: 'LAttacker', title: 'Edited after opening' }),
    // refined while maturing
    request(maturing, 'uf:k-maturing', { createdAt: now, publishedAt: now - 2 * DAY, wallet: 'LCorrected', title: 'Refined while maturing' }),
    // an edit BACKDATED to just before the request opened, to pass for "refined while maturing"
    request(openB, 'uf:k-open-b', { createdAt: OPEN_OPENS - 1, publishedAt: OPEN_PUB, wallet: 'LSwap', title: 'Backdated edit' }),
    // the owner's event for a hand-corrected request: the form was told "0 days", so funding_opens_at == published_at
    request(byHand, 'uf:k-by-hand', { createdAt: HAND_PUB, publishedAt: HAND_PUB, fundingOpensAt: HAND_PUB }),
    request(byHandLater, 'uf:k-by-hand-later', { createdAt: HAND_PUB, publishedAt: HAND_PUB, fundingOpensAt: HAND_PUB }),
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

  console.log('— a window corrected by hand is never lowered —');
  check('the owner’s event still claims 0 days: the row keeps the corrected opening', r('uf:k-by-hand')?.funding_opens_at === HAND_PUB + M, r('uf:k-by-hand'));
  check('a window set even LATER than the maturing length stays where it was', r('uf:k-by-hand-later')?.funding_opens_at === HAND_PUB + 20 * DAY, r('uf:k-by-hand-later'));
  await quiet(() => scan(db));
  check('…scan after scan', r('uf:k-by-hand')?.funding_opens_at === HAND_PUB + M && r('uf:k-by-hand-later')?.funding_opens_at === HAND_PUB + 20 * DAY, [r('uf:k-by-hand'), r('uf:k-by-hand-later')]);
  check('…and they still show as maturing', r('uf:k-by-hand').funding_opens_at > now && r('uf:k-by-hand-later').funding_opens_at > now);
}

// ════════════════════════════════════════════════════════
console.log('— the first scan after the deploy, on a database shaped like production’s today —');
{
  // Three requests opened the moment they were published (the maturing length was 0), the
  // oldest two have many contributions; a fourth was published this morning and its window
  // was corrected by hand. Their owners' events carry funding_opens_at == published_at.
  // The new indexer must leave ALL of it exactly as it is.
  reset();
  const owners = [newKey(), newKey(), newKey(), newKey()];
  const supporters = [newKey(), newKey(), newKey()];
  const published = [now - 70 * DAY, now - 60 * DAY, now - 40 * DAY, now - 8 * 3600];
  const contributionCounts = [32, 8, 4, 0];
  const db = freshDb({ lastScanAt: now - 25 * 60 });          // the scan runs every 30 minutes
  const insertRow = db.prepare(`
    INSERT INTO uf_requests (id, event_id, pubkey, title, wallet, published_at, funding_opens_at, nostr_created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertContribution = db.prepare(`
    INSERT INTO uf_contributions (id, request_id, supporter_pubkey, recipient_pubkey, amount_fiat, amount_lanoshis, tx_id, nostr_created_at)
    VALUES (?, ?, ?, ?, 10, 100000000, ?, ?)`);
  const ids = ['uf:prod-a', 'uf:prod-b', 'uf:prod-c', 'uf:prod-d'];
  owners.forEach((o, i) => {
    const opens = i === 3 ? published[i] + M : published[i];                       // d: corrected by hand to published + 15 days
    insertRow.run(ids[i], `ev-${i}`, o.pk, `Title ${i}`, `LWallet${i}`, published[i], opens, published[i]);
    // the owner's newest event: published_at as it was, funding_opens_at == published_at (told "0 days"), same wallet
    relay.store.push(request(o, ids[i], { createdAt: published[i], publishedAt: published[i], fundingOpensAt: published[i], wallet: `LWallet${i}`, title: `Title ${i}` }));
    for (let n = 0; n < contributionCounts[i]; n++) {
      const c = contribution(supporters[n % supporters.length], ids[i], published[i] + 3600 + n * 600);
      relay.store.push(c);
      insertContribution.run(c.id, ids[i], c.pubkey, o.pk, `tx-${i}-${n}`, c.created_at);
    }
  });
  const snapshot = () => JSON.stringify({
    rows: db.prepare('SELECT id, pubkey, title, wallet, published_at, funding_opens_at, is_hidden, is_repaid, status FROM uf_requests ORDER BY id').all(),
    contributions: db.prepare('SELECT id, request_id, supporter_pubkey, amount_fiat FROM uf_contributions ORDER BY id').all(),
  });
  const before = snapshot();
  await quiet(() => scan(db));
  check('every request and every contribution is exactly as it was (windows, dates, wallets, flags)', snapshot() === before);
  check('…the 32 + 8 + 4 contributions are all still there',
    (db.prepare('SELECT COUNT(*) AS n FROM uf_contributions').get() as any).n === 44);
  check('…nothing new was listed', (db.prepare('SELECT COUNT(*) AS n FROM uf_requests').get() as any).n === 4);
  check('…the three that opened at publication are still open, the corrected one still matures',
    [0, 1, 2].every((i) => rowOf(db, ids[i]).funding_opens_at <= now) && rowOf(db, ids[3]).funding_opens_at > now);
  await quiet(() => scan(db));
  check('…and the second scan changes nothing either', snapshot() === before);
}

// ════════════════════════════════════════════════════════
console.log('— a relay that does not answer —');
{
  const supporter = newKey();
  const published = now - 3 * DAY;     // opened the moment it was published (the maturing length was 0)
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const settingOf = (db: any, key: string) => (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any)?.value;

  console.log('  · REBUILD while one relay is silent: a request that only that relay holds');
  {
    reset();
    const m1 = member(), m2 = member();
    relay.store.push(
      request(m1, 'uf:on-both', { createdAt: published, publishedAt: published, fundingOpensAt: published }),
      contribution(supporter, 'uf:on-both', now - 1 * DAY),
    );
    relay2.store.push(
      request(m2, 'uf:only-on-2', { createdAt: published, publishedAt: published, fundingOpensAt: published }),
      contribution(supporter, 'uf:only-on-2', now - 1 * DAY),
    );
    const db = freshDb({ relayUrls: [relay.url, relay2.url] });
    relay2.down = true;
    await quiet(() => scan(db));
    check('first scan: what the answering relay holds is listed', !!rowOf(db, 'uf:on-both'));
    check('…what only the silent relay holds is not seen yet', !rowOf(db, 'uf:only-on-2'));
    check('…and the database is STILL "from scratch": a scan that missed a relay settled nothing', watermarkOf(db) === 0, watermarkOf(db));
    relay2.down = false;
    await settle();
    await quiet(() => scan(db));
    check('second scan: the request only the other relay held is listed with the window it really had',
      rowOf(db, 'uf:only-on-2')?.funding_opens_at === published, rowOf(db, 'uf:only-on-2'));
    check('…its real contribution kept (a live-mode scan would have dropped it)', contributionsOf(db, 'uf:only-on-2') === 1, contributionsOf(db, 'uf:only-on-2'));
    check('…and now that every relay answered, the watermark moved', watermarkOf(db) > 0, watermarkOf(db));
  }

  console.log('  · LIVE: "no plan found" while a relay is silent is not "not a member"');
  {
    reset();
    const m = newKey();
    relay2.store.push(plan(service, m.pk, now - 200 * DAY));                 // the plan sits on relay 2 only
    relay.store.push(request(m, 'uf:late-plan', { createdAt: now, publishedAt: now }));
    const db = freshDb({ relayUrls: [relay.url, relay2.url], lastScanAt: now - 600 });
    relay2.down = true;
    await quiet(() => scan(db));
    check('relay 1 knows no plan and relay 2 is silent → not listed', !rowOf(db, 'uf:late-plan'));
    check('…the watermark was held back: the request has not been settled', watermarkOf(db) === now - 600, watermarkOf(db));
    relay2.down = false;
    await settle();
    await quiet(() => scan(db));
    check('once relay 2 answers, the member is listed — not shut out for an hour on the memory of a wrong "no"', !!rowOf(db, 'uf:late-plan'));
    check('…and the watermark moved', watermarkOf(db) > now - 600, watermarkOf(db));
  }

  console.log('  · the same rule, on the shared function');
  {
    const dbE = freshDb();
    const stranger = newKey();
    const reader = (answered: string[], failed: { url: string; reason: string }[], events: any[]) => async () => ({ events, answered, failed });
    let res: any = await computeEligibility(dbE, stranger.pk, reader(['a'], [{ url: 'b', reason: 'closed' }], []));
    check('"nothing found" while a relay did not answer is "cannot tell" (an error), never "no plan"', !!res.error && res.exists === undefined, res);
    res = await computeEligibility(dbE, stranger.pk, reader(['a', 'b'], [], []));
    check('"nothing found" with EVERY relay answering is a plain "no plan"', !res.error && res.exists === false && res.eligible === false, res);
    res = await computeEligibility(dbE, stranger.pk, reader([], [{ url: 'a', reason: 'x' }, { url: 'b', reason: 'y' }], []));
    check('nobody answering is an error too', !!res.error, res);
  }

  console.log('  · a watermark held back for long moves on — never on a database being rebuilt');
  {
    reset();
    const m = member();
    relay.store.push(request(m, 'uf:held', { createdAt: now, publishedAt: now }));
    const HELD = 'unconditional_financing_watermark_held_since';
    const run = async (o: { lastScanAt?: number; heldSince?: number }) => {
      const db = freshDb({ lastScanAt: o.lastScanAt });
      if (o.heldSince) setSetting(db, HELD, String(o.heldSince));
      relay.refuse88888 = true;              // the membership check cannot be answered: the scan cannot settle
      resetUfIndexerCaches();
      await quiet(() => scan(db));
      relay.refuse88888 = false;
      return db;
    };
    let db = await run({ lastScanAt: now - 600 });
    check('the first scan that cannot settle records when the hold began', near(parseInt(settingOf(db, HELD) ?? '0', 10), now, 15), settingOf(db, HELD));
    check('…and keeps the watermark where it was', watermarkOf(db) === now - 600, watermarkOf(db));
    db = await run({ lastScanAt: now - 600, heldSince: now - 1 * 3600 });
    check('held for 1 hour: the watermark stays', watermarkOf(db) === now - 600, watermarkOf(db));
    db = await run({ lastScanAt: now - 600, heldSince: now - 7 * 3600 });
    check('held for 7 hours on a database that has been scanning: it moves on, so junk cannot hold the horizon for ever', near(watermarkOf(db), now, 15), watermarkOf(db));
    check('…and the hold is over', settingOf(db, HELD) === undefined, settingOf(db, HELD));
    db = await run({ heldSince: now - 7 * 3600 });
    check('held for 7 hours on a database being built from scratch: it does NOT move on', watermarkOf(db) === 0, watermarkOf(db));
  }

  console.log('  · one person with many unknown requests is asked once per scan, even when nobody answers');
  {
    reset();
    const m = member();
    for (let i = 0; i < 7; i++) relay.store.push(request(m, `uf:many-${i}`, { createdAt: now, publishedAt: now }));
    const db = freshDb({ lastScanAt: now - 600 });
    relay.refuse88888 = true;
    relay.count88888 = 0;
    await quiet(() => scan(db));
    check('7 requests, 1 person: the question and its retry — 2 queries, not 14', relay.count88888 <= 2, relay.count88888);
  }

  console.log('  · a refusal is remembered between scans, and forgotten on demand');
  {
    reset();
    const k = newKey();
    relay.store.push(request(k, 'uf:nobody', { createdAt: now, publishedAt: now }));
    const db = freshDb({ lastScanAt: now - 600 });
    await quiet(() => scan(db));
    const asked = relay.count88888;
    check('a stranger is asked about', asked > 0, asked);
    await quiet(() => scan(db));
    check('…and not again by the next scan', relay.count88888 === asked, { asked, now: relay.count88888 });
    resetUfIndexerCaches();
    await quiet(() => scan(db));
    check('…until the memory is cleared', relay.count88888 > asked, { asked, now: relay.count88888 });
  }
}

// ════════════════════════════════════════════════════════
console.log('— the membership gate does not rest on the relay’s filters —');
{
  console.log('  · a relay that ignores `authors` and `#p`');
  {
    reset();
    relay.lax88888 = true;
    const victim = newKey(), liar = newKey(), somebodyElse = member();    // somebodyElse has a GENUINE plan, about themselves
    relay.store.push(plan(liar, victim.pk, now - 400 * DAY));                // (a) perfectly signed — by the wrong key
    const tampered = JSON.parse(JSON.stringify(plan(service, victim.pk, now - 300 * DAY)));
    tampered.content = JSON.stringify({ subject_hex: victim.pk, extra: 1 });  // (b) "by the service key", altered after signing
    relay.store.push(tampered);
    // (c) somebodyElse's genuine, service-signed plan is in the store too, and the lax relay hands it out for any question
    relay.store.push(request(victim, 'uf:victim', { createdAt: now, publishedAt: now }));
    const db = freshDb({ lastScanAt: now - 600 });
    await quiet(() => scan(db));
    check('a plan by the wrong key, an altered plan and somebody else’s plan: none makes the victim a member', !rowOf(db, 'uf:victim'));
  }
  console.log('  · a forged ANCIENT plan cannot grandfather a recent member');
  {
    reset();
    relay.lax88888 = true;
    const recent = newKey(), liar = newKey();
    relay.store.push(plan(service, recent.pk, now - 10 * DAY), plan(liar, recent.pk, now - 400 * DAY));
    relay.store.push(request(recent, 'uf:recent', { createdAt: now, publishedAt: now }));
    const db = freshDb({ lastScanAt: now - 600 });
    await quiet(() => scan(db));
    check('enrolled 10 days ago (the forged year-old plan does not count): not listed', !rowOf(db, 'uf:recent'));
  }
  console.log('  · the EARLIEST version of a plan is the enrolment');
  {
    reset();
    const m = newKey();
    relay.store.push(plan(service, m.pk, now - 200 * DAY), plan(service, m.pk, now - 10 * DAY));   // the plan was re-published since
    relay.store.push(request(m, 'uf:two-versions', { createdAt: now, publishedAt: now }));
    const db = freshDb({ lastScanAt: now - 600 });
    await quiet(() => scan(db));
    check('two versions of one plan: enrolled when the first one was made → listed', !!rowOf(db, 'uf:two-versions'), rowOf(db, 'uf:two-versions'));
  }
  console.log('  · a transient empty answer is asked again');
  {
    reset();
    const m = member();
    relay.store.push(request(m, 'uf:retry', { createdAt: now, publishedAt: now }));
    relay.emptyNext88888 = 1;
    const db = freshDb({ lastScanAt: now - 600 });
    await quiet(() => scan(db));
    check('the first answer was empty (a clean EOSE, no plan), the second had it → listed', !!rowOf(db, 'uf:retry'), rowOf(db, 'uf:retry'));
  }
}

// ════════════════════════════════════════════════════════
console.log('— what the indexer will not take from the relays —');
{
  const seedKnown = (db: any, id: string, owner: Key, opens: number, extra: { title?: string; nostrCreatedAt?: number; published?: number } = {}) =>
    db.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, wallet, published_at, funding_opens_at, nostr_created_at)
                VALUES (?, ?, ?, ?, 'LW', ?, ?, ?)`).run(id, `ev-${id}`, owner.pk, extra.title ?? 'Seeded', extra.published ?? now - 30 * DAY, opens, extra.nostrCreatedAt ?? 0);

  console.log('  · contributions and repayments need a valid signature, like everything else');
  {
    reset();
    const owner = newKey(), supporter = newKey(), other = newKey();
    const db = freshDb({ lastScanAt: now - 600 });
    seedKnown(db, 'uf:signed', owner, now - 15 * DAY);
    const bad = JSON.parse(JSON.stringify(contribution(other, 'uf:signed', now - 9 * DAY)));
    bad.tags = bad.tags.map((t: string[]) => (t[0] === 'amount_fiat' ? ['amount_fiat', '999999'] : t));      // altered after signing
    relay.store.push(contribution(supporter, 'uf:signed', now - 10 * DAY), bad);
    const repayment = (rate: string) => finalizeEvent({
      kind: 60211, created_at: now - 1 * DAY,
      tags: [['service', 'unconditional-financing'], ['request', 'uf:signed'], ['amount_lanoshis_total', '100000000'], ['amount_fiat_total', '10'],
        ['currency', 'EUR'], ['rate', rate], ['tx', `tx-r-${rate}`], ['out', supporter.pk, 'LSup', '100000000', '10']],
      content: '',
    }, owner.sk);
    const badRepayment = JSON.parse(JSON.stringify(repayment('0.2')));
    badRepayment.tags = badRepayment.tags.map((t: string[]) => (t[0] === 'rate' ? ['rate', '999'] : t));      // altered after signing
    relay.store.push(repayment('0.1'), badRepayment);
    await quiet(() => scan(db));
    check('a contribution whose signature does not hold is not indexed; the genuine one is', contributionsOf(db, 'uf:signed') === 1, contributionsOf(db, 'uf:signed'));
    const repayments = (db.prepare("SELECT COUNT(*) AS n FROM uf_repayments WHERE request_id = 'uf:signed'").get() as any).n;
    check('a repayment whose signature does not hold is not indexed; the genuine one is', repayments === 1, repayments);
  }

  console.log('  · a contribution dated after the opening, on a request that is still maturing');
  {
    reset();
    const owner = newKey(), supporter = newKey();
    const db = freshDb({ lastScanAt: now - 600 });
    seedKnown(db, 'uf:still-maturing', owner, now + 5 * DAY);
    relay.store.push(contribution(supporter, 'uf:still-maturing', now + 6 * DAY));       // dated in the future: the route answers 409 for it
    await quiet(() => scan(db));
    check('not indexed: the request is still maturing by OUR clock, whatever date the event carries', contributionsOf(db, 'uf:still-maturing') === 0, contributionsOf(db, 'uf:still-maturing'));
  }

  console.log('  · a row with no window (open) is left open');
  {
    reset();
    const owner = newKey();
    const db = freshDb({ lastScanAt: now - 600 });
    db.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, wallet) VALUES ('uf:legacy', 'ev-legacy', ?, 'Legacy', 'LW')`).run(owner.pk);
    relay.store.push(request(owner, 'uf:legacy', { createdAt: now - 5 * DAY, publishedAt: now - 30 * DAY, fundingOpensAt: now - 30 * DAY }));
    await quiet(() => scan(db));
    check('it does not flip to "maturing", and it did not need to pass the membership gate', rowOf(db, 'uf:legacy')?.funding_opens_at === 0, rowOf(db, 'uf:legacy'));
  }

  console.log('  · an OLDER version of a request the database has is not applied');
  {
    reset();
    const owner = newKey();
    const db = freshDb({ lastScanAt: now - 600 });
    seedKnown(db, 'uf:newest', owner, now + 5 * DAY, { title: 'Newest', nostrCreatedAt: now });
    relay.store.push(request(owner, 'uf:newest', { createdAt: now - 1 * DAY, publishedAt: now - 10 * DAY, title: 'Stale', wallet: 'LStale' }));
    await quiet(() => scan(db));
    check('a relay that kept only an old copy cannot revert the title, or the wallet', rowOf(db, 'uf:newest')?.title === 'Newest' && rowOf(db, 'uf:newest')?.wallet === 'LW', rowOf(db, 'uf:newest'));
  }

  console.log('  · a watermark that cannot be read is not "never scanned"');
  {
    reset();
    const m = member();
    relay.store.push(request(m, 'uf:unread', { createdAt: now, publishedAt: now - 30 * DAY, fundingOpensAt: now - 30 * DAY }));
    const db = freshDb({ lastScanAt: now - 600 });
    db.prepare("UPDATE app_settings SET value = 'garbage' WHERE key = 'unconditional_financing_last_indexed_at'").run();
    await quiet(() => scan(db));
    check('the scan is abandoned instead of guessing "from scratch" (where the signer’s own dates are believed)', !rowOf(db, 'uf:unread'));
  }

  console.log('  · a tag that parses to infinity');
  {
    const huge = '9'.repeat(400);
    check('is treated as absent: every date stays a real number (both modes)',
      [0, now - 600].every((lastScanAt) => {
        const t = resolveNewRequestTiming({ claimedPublishedAt: parseInt('-' + huge), claimedFundingOpensAt: parseInt(huge), createdAt: now, now, maturingSeconds: M, lastScanAt });
        return Number.isFinite(t.publishedAt) && Number.isFinite(t.fundingOpensAt);
      }));
  }
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
relay.close();
relay2.close();
if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ ALL INDEXER TESTS PASSED');
process.exit(0);
