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
import { readAllPages, readRelayEventsViaServer } from '../src/lib/relayReadViaServer.js';

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
