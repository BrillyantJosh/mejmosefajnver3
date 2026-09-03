/**
 * The pooled relay reader against the LIVE relays.
 *   npx tsx scripts/testRelayLive.ts
 *
 * scripts/testRelayPool.ts covers the mechanism against a relay we control.
 * This covers the things only real relays show: NIP-33 newest-wins across two
 * relays, dedup, and — the part money-bearing callers key on — that a silent
 * relay is reported as failed rather than as an empty all-clear.
 *
 * When this reader was introduced it was also diffed event-for-event against
 * the previous per-socket implementation on these same five kinds; the sets and
 * the answered/failed verdicts matched exactly. That frozen copy is not kept in
 * the tree — a 1400-line duplicate would only rot.
 */
import { queryEventsWithRelayStatus as pooled } from '../server/lib/nostr.js';
import { closeRelayPool, relayPoolStats } from '../server/lib/relayPool.js';

const RELAYS = ['wss://relay.lanavault.space', 'wss://relay.lanacoin-eternity.com'];

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`);
  if (!cond) failures++;
};

const CASES: { name: string; filter: any }[] = [
  { name: 'KIND 37044 processes (NIP-33 replaceable)', filter: { kinds: [37044], limit: 100 } },
  { name: 'KIND 30889 wallet lists (NIP-33)', filter: { kinds: [30889], limit: 60 } },
  { name: 'KIND 38884 acknowledgements', filter: { kinds: [38884], limit: 200 } },
  { name: 'KIND 0 profiles', filter: { kinds: [0], limit: 80 } },
  { name: 'KIND 88888 plans by #p', filter: { kinds: [88888], limit: 40 } },
];

const ids = (evs: any[]) => new Set(evs.map((e) => e.id));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

async function main() {
  console.log('— real data comes back, and NIP-33 leaves one event per (pubkey,d) —');
  for (const c of CASES) {
    const got = await pooled(RELAYS, c.filter, 12000);
    if (got.failed.length) {
      console.log(`  ~ ${c.name}: skipped, a relay was silent (${got.failed.map((f) => f.reason).join(', ')})`);
      continue;
    }
    check(`${c.name}: both relays answered`, got.answered.length === RELAYS.length, got.answered);
    check(`${c.name}: events returned (${got.events.length})`, got.events.length > 0);
    check(`${c.name}: no duplicate ids across relays`, ids(got.events).size === got.events.length);

    const kind = c.filter.kinds[0];
    if (kind >= 30000 && kind < 40000) {
      const keys = got.events.map((e: any) =>
        `${e.pubkey}:${e.kind}:${e.tags?.find((t: string[]) => t[0] === 'd')?.[1] || ''}`);
      check(`${c.name}: one per (pubkey,kind,d)`, new Set(keys).size === keys.length, {
        events: keys.length, distinct: new Set(keys).size,
      });
    }
  }

  console.log('— a dead relay is still reported as failed, not as empty —');
  {
    const got = await pooled(['wss://127.0.0.1:9'], { kinds: [1], limit: 1 }, 3000);
    check('answered is empty', got.answered.length === 0, got.answered);
    check('failed names the relay', got.failed.length === 1, got.failed);
    check('no events invented', got.events.length === 0);
  }

  console.log('— one live relay + one dead one still returns the live data —');
  {
    const got = await pooled([RELAYS[0], 'wss://127.0.0.1:9'], { kinds: [30889], limit: 10 }, 12000);
    check('the live relay answered', got.answered.length === 1, got.answered);
    check('the dead one is recorded as failed', got.failed.length === 1, got.failed);
    check('events came through', got.events.length > 0, got.events.length);
  }

  console.log('— the pool really is holding sockets open —');
  {
    const stats = relayPoolStats();
    const open = stats.filter((s) => s.open);
    check(`${open.length} socket(s) open for ${RELAYS.length} relays, none per-query`, open.length <= RELAYS.length, stats);
    check('nothing left in flight', stats.every((s) => s.inFlight === 0), stats);
  }

  closeRelayPool();
  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}

main();
