/**
 * The OWN page must never say "you have no processes" because the network was
 * unreachable. This exercises the read layer against the REAL relays plus
 * deliberately broken ones, and asserts the distinction the page depends on:
 * `answered` is non-empty only when a relay genuinely spoke.
 *
 *   npx tsx scripts/testRelayRead.ts
 */
import { SimplePool } from 'nostr-tools';
import { readFromRelays } from '../src/lib/relayRead.js';

const LIVE = [
  'wss://relay.lanavault.space',
  'wss://relay.lanaheartvoice.com',
];
/** Routable-but-dead and non-resolving: the two shapes of a bad connection. */
const DEAD = ['wss://127.0.0.1:9', 'wss://relay.invalid.example'];

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 220) : ''); }
}

async function main() {
  console.log('— a total outage must NOT look like an empty result —');
  {
    const pool = new SimplePool();
    const t0 = Date.now();
    const r = await readFromRelays(pool, DEAD, { kinds: [37044], limit: 10 }, { budgetMs: 6000 });
    const took = Date.now() - t0;
    check('no relay is reported as answered', r.answered.length === 0, r.answered);
    check('every relay is reported as failed', r.failed.length === DEAD.length, r.failed);
    check('no events', r.events.length === 0);
    check('bounded by our own clock, not left hanging', took < 9000, `${took}ms`);
    console.log(`    (reasons: ${r.failed.map(f => f.reason).join(' | ')})`);
    try { pool.close(DEAD); } catch { /* already gone */ }
  }

  console.log('\n— a real relay must report itself as answered —');
  {
    const pool = new SimplePool();
    const r = await readFromRelays(pool, LIVE, { kinds: [37044], limit: 20 }, { budgetMs: 12000 });
    check('at least one live relay answered', r.answered.length > 0, { answered: r.answered, failed: r.failed });
    check('an answered read is what licenses an empty list', r.answered.length > 0 || r.events.length > 0);
    console.log(`    (answered ${r.answered.length}/${LIVE.length}, events ${r.events.length})`);
    try { pool.close(LIVE); } catch { /* already gone */ }
  }

  console.log('\n— mixed: dead relays must not hide a good one —');
  {
    const pool = new SimplePool();
    const mixed = [...DEAD, ...LIVE];
    const partials: number[] = [];
    const r = await readFromRelays(pool, mixed, { kinds: [37044], limit: 20 }, {
      budgetMs: 12000,
      onRelayDone: (p) => partials.push(p.answered.length),
    });
    check('the live relay still answers', r.answered.length > 0, { answered: r.answered });
    check('the dead ones are still reported failed', r.failed.length >= DEAD.length, r.failed);
    check('progress was reported per relay, not only at the end', partials.length === mixed.length, partials.length);
    check('a failed relay never counts as answered', r.answered.every(u => !DEAD.includes(u)), r.answered);
    try { pool.close(mixed); } catch { /* already gone */ }
  }

  console.log('\n— what the old code did, for contrast —');
  {
    const pool = new SimplePool();
    const t0 = Date.now();
    const events = await pool.querySync(DEAD, { kinds: [37044], limit: 10 });
    const took = Date.now() - t0;
    check('querySync resolves (never throws) on a dead network', Array.isArray(events), typeof events);
    check('and returns an empty array indistinguishable from "you have none"', events.length === 0);
    console.log(`    (resolved in ${took}ms with ${events.length} events — this is the bug)`);
    try { pool.close(DEAD); } catch { /* already gone */ }
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ a failed read is now distinguishable from an empty one');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
