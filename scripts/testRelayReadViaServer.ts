/**
 * Reading a long list off the relays through this app's own server.
 *
 * The Eco Point catalogue showed 140 offers on a desktop and 20, 35 or 73 on
 * an iPhone (Brilly, 21. 9. 2026): nostr-tools closes a subscription 4.4 s
 * after it is opened if the relay has not said EOSE yet, and throws away every
 * message still queued — which on a phone is most of them. The server now
 * collects, the phone reads one answer, and a list longer than a relay will
 * answer in one go (500) is read page by page instead of silently cut.
 *   npx tsx scripts/testRelayReadViaServer.ts
 */
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { getEventViaServer, queryEventsViaServer, readAllPages, readRelayEventsViaServer } from '../src/lib/relayReadViaServer.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 240)}`);
  if (!cond) failures++;
};

const secret = generateSecretKey();
let n = 0;
/** An event as a relay hands it over: signed, with a created_at we choose. */
const event = (created_at: number) =>
  JSON.parse(JSON.stringify(finalizeEvent({ kind: 36500, created_at, tags: [['d', `item-${++n}`]], content: '{}' }, secret)));

/** A relay holding `total` events, one per second, answering newest-first. */
function fakeRelay(total: number, pageSize = 500) {
  const all = Array.from({ length: total }, (_, i) => event(1_700_000_000 - i));
  const asked: (number | undefined)[] = [];
  return {
    asked,
    all,
    fetchPage: async (until?: number) => {
      asked.push(until);
      const from = until === undefined ? all : all.filter((e) => e.created_at <= until);
      return from.slice(0, pageSize);
    },
  };
}

console.log('— a list that fits in one answer —');
{
  const relay = fakeRelay(277);
  const read = await readAllPages(relay.fetchPage);
  check('everything, in one page', read.events.length === 277 && read.pages === 1 && read.complete, { events: read.events.length, pages: read.pages });
  check('and it never asked for a second', relay.asked.length === 1 && relay.asked[0] === undefined, relay.asked);
}

console.log('— a list longer than one answer —');
{
  const relay = fakeRelay(1180);
  const read = await readAllPages(relay.fetchPage);
  check('all 1180, not the newest 500', read.events.length === 1180, read.events.length);
  check('read as three pages, and it says it is complete', read.pages === 3 && read.complete, { pages: read.pages, complete: read.complete });
  check('each page continued from the oldest of the last', relay.asked.length === 3 && relay.asked[0] === undefined && relay.asked[1]! > relay.asked[2]!, relay.asked);
  check('no event counted twice at the seam', new Set(read.events.map((e) => e.id)).size === 1180);
}

console.log('— what it does not pretend —');
{
  const relay = fakeRelay(5000);
  const read = await readAllPages(relay.fetchPage, { maxPages: 3 });
  // 3 × 500 less the two seam events, which each page repeats because `until`
  // is inclusive — the price of never skipping an event written in that second.
  check('stopping at the page cap is reported, not hidden', read.complete === false && read.pages === 3 && read.events.length === 1498, { complete: read.complete, events: read.events.length });

  // Every event in the same second: paging cannot move past it.
  const sameSecond = Array.from({ length: 900 }, () => event(1_700_000_000));
  let calls = 0;
  const stuck = await readAllPages(async (until) => {
    calls++;
    return sameSecond.filter((e) => until === undefined || e.created_at <= until).slice(0, 500);
  });
  check('a page written in one second does not loop for ever', calls === 2 && stuck.complete === false, { calls, complete: stuck.complete });

  const empty = await readAllPages(async () => []);
  check('a relay with nothing to say is complete, not broken', empty.complete && empty.events.length === 0);
  const rubbish = await readAllPages(async () => [null, 'x', { id: 1 }, event(1_700_000_000)] as never);
  check('rubbish in the answer is dropped, the rest kept', rubbish.events.length === 1 && rubbish.complete);
}

console.log('— what the server hands over is still checked —');
{
  const genuine = event(1_700_000_100);
  const tampered = { ...JSON.parse(JSON.stringify(event(1_700_000_101))), content: '{"price":"1"}' };
  const otherKey = JSON.parse(JSON.stringify(finalizeEvent({ kind: 36500, created_at: 1_700_000_102, tags: [['d', 'x']], content: '{}' }, generateSecretKey())));
  const stolenName = { ...otherKey, pubkey: genuine.pubkey };
  const answers = [{ events: [genuine, tampered, stolenName] }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(answers.shift() ?? { events: [] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const read = await readRelayEventsViaServer({ kinds: [36500] });
    check('an altered event and one signed by another key are dropped', read.events.length === 1 && read.events[0].id === genuine.id, read.events.map((e) => e.id.slice(0, 8)));
    check('…and it says how many were dropped', read.forged === 2, read.forged);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('— a caller that asked for a fixed number gets that many —');
{
  /** Serves one page per call and records the filter it was asked for. */
  const server = (pages: unknown[][]) => {
    const asked: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      asked.push(JSON.parse(init.body).filter);
      return new Response(JSON.stringify({ events: pages.shift() ?? [] }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { asked, restore: () => { globalThis.fetch = realFetch; } };
  };

  {
    // Fifty posts on a profile page: the old pool.querySync asked for fifty.
    const fifty = Array.from({ length: 50 }, (_, i) => event(1_700_001_000 - i));
    const s = server([fifty, fifty]);
    try {
      const events = await queryEventsViaServer({ kinds: [36500], authors: ['abc'], limit: 50 });
      check('it asks the relays for the fifty the caller wanted, not five hundred', s.asked[0]?.limit === 50, s.asked[0]);
      check('and it stops there instead of paging on', s.asked.length === 1 && events.length === 50, { calls: s.asked.length, events: events.length });
    } finally { s.restore(); }
  }

  {
    const s = server([[event(1_700_002_000)]]);
    try {
      const read = await readRelayEventsViaServer({ kinds: [36500], limit: 1 });
      check('a limit the read honoured is complete, not "cut short"', read.complete === true, read);
    } finally { s.restore(); }
  }

  {
    // No limit named: everything, and a full page means there is more.
    const full = Array.from({ length: 500 }, (_, i) => event(1_700_003_000 - i));
    const s = server([full, [event(1_600_000_000)]]);
    try {
      await queryEventsViaServer({ kinds: [36500] });
      check('with no limit named it still pages to the end', s.asked.length === 2 && s.asked[0]?.limit === 500, s.asked.map((f) => f.limit));
    } finally { s.restore(); }
  }

  {
    // A limit above one page is still a number the caller meant: two pages for
    // a thousand, not the six a limitless read is allowed.
    const page = (n) => Array.from({ length: 500 }, (_, i) => event(1_700_010_000 - n * 500 - i));
    const s = server([page(0), page(1), page(2), page(3), page(4), page(5), page(6)]);
    try {
      const events = await queryEventsViaServer({ kinds: [36500], limit: 1000 });
      check('a thousand is read as two pages, not six', s.asked.length === 2, s.asked.length);
      check('…and a thousand is what comes back', events.length === 1000, events.length);
    } finally { s.restore(); }
  }

  {
    const page = (n) => Array.from({ length: 500 }, (_, i) => event(1_700_020_000 - n * 500 - i));
    const s = server([page(0), page(1), page(2), [event(1_600_000_001)]]);
    try {
      const read = await readRelayEventsViaServer({ kinds: [36500], limit: 2000 });
      check('two thousand asked, four pages allowed, and it stops early when the relay runs out', read.pages === 4 && read.complete, { pages: read.pages, complete: read.complete });
    } finally { s.restore(); }
  }

  {
    const older = event(1_700_004_000);
    const newer = event(1_700_004_500);
    const s = server([[older, newer]]);
    try {
      const one = await getEventViaServer({ kinds: [36500], authors: ['abc'], limit: 1 });
      check('one event means the NEWEST, not whichever relay spoke first', one?.id === newer.id);
    } finally { s.restore(); }
  }
}

console.log('— wired where it has to be —');
{
  const root = new URL('..', import.meta.url).pathname;
  const hook = readFileSync(`${root}src/hooks/useFoodCornerData.ts`, 'utf8');
  const lib = readFileSync(`${root}src/lib/relayReadViaServer.ts`, 'utf8');

  check('the Eco Point module no longer opens its own relay sockets', !/SimplePool/.test(hook) && !/querySync/.test(hook), hook.match(/SimplePool|querySync/g));
  check('…it reads through the app’s server', /readRelayEventsViaServer/.test(hook));
  check('offers and activity are read separately, so neither crowds out the other', /CATALOG_KINDS = \[/.test(hook) && /ACTIVITY_KINDS = \[/.test(hook) && /kinds: CATALOG_KINDS/.test(hook) && /kinds: ACTIVITY_KINDS/.test(hook));
  check('a failed activity read still shows the offers', /catalog\.status === "rejected"\) throw/.test(hook) && /activity\.status === "fulfilled"/.test(hook));
  check('a slow earlier read cannot overwrite a newer one', /readCounter/.test(hook) && /if \(!isCurrent\(\)\) return;/.test(hook));
  check('the page never asks for more than a relay answers', /RELAY_PAGE_SIZE = 500/.test(lib) && /limit: pageSize/.test(lib));
  check('signatures are still checked on what the server delivers', /verifyEvent/.test(lib) && /forged/.test(lib));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
