/**
 * The pre-payment duplicate guard must refuse when it cannot verify — and must
 * not refuse because a phone blinked.
 *
 *   npx tsx scripts/testGuardRelayRead.ts
 *
 * On 2026-09-15 a payer on an iPhone scanned her key with the camera and was
 * refused on a 66.41 LANA batch ("no relay answered") while all four relays
 * were healthy — 356–912 ms to EOSE for exactly her filter, measured the same
 * day. One attempt, 8 s, on sockets iOS had just suspended.
 *
 * The relays here are fakes, so these are decisions about time and retries,
 * not a network test (scripts/testRelayRead.ts already reads the real ones).
 * What must hold, in both directions:
 *   - no relay ever answers        → reported unanswered, after every attempt
 *                                    (the page then lets the server's fail-closed
 *                                    guard decide: scripts/testPaymentServerDecides.ts);
 *   - one relay answers, slowly    → succeeds, where 8 s missed it;
 *   - first attempt dies, then ok  → succeeds, without the user pressing again;
 *   - one relay answers, fast      → succeeds on attempt 1, no pointless retry;
 *   - the refusal names what happened to the money.
 */
import type { SimplePool } from 'nostr-tools';
import { readFileSync } from 'node:fs';
import { readFromRelays, readFromRelaysWithRetry } from '../src/lib/relayRead.js';
import {
  GUARD_READ_ATTEMPTS,
  GUARD_READ_BUDGET_MS,
  GUARD_READ_PAUSE_MS,
  GUARD_READ_WORST_CASE_MS,
  GUARD_UNVERIFIABLE_MESSAGE,
  GUARD_NO_RELAY_LIST_MESSAGE,
} from '../src/lib/unconditionalPaymentGuard.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 220) : ''); }
};

const RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lana-eternity.com',
  'wss://relay.lanaheartvoice.com',
  'wss://relay.lovelana.org',
];
const FILTER = { kinds: [90901], authors: ['a'.repeat(64)], limit: 500 };

/** How one fake relay behaves on one attempt. */
interface Plan {
  /** ms before connect settles. */
  connectMs?: number;
  /** connect rejects, the way a dead socket does. */
  connectFails?: boolean;
  /** ms before a real EOSE frame; undefined = the relay never answers. */
  eoseMs?: number;
}

/**
 * Pools that behave differently per attempt — which is the only way to model
 * the thing being fixed: the network is broken at press time and fine a second
 * later. Counting pools also proves each attempt got a NEW one, since
 * nostr-tools never re-dials a relay a pool already holds.
 */
function poolFactory(plan: (attempt: number, url: string) => Plan) {
  let attempts = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const make = (): SimplePool => {
    attempts++;
    const attempt = attempts;
    return {
      ensureRelay(url: string) {
        const p = plan(attempt, url);
        return new Promise((resolve, reject) => {
          timers.push(setTimeout(() => {
            if (p.connectFails) { reject(new Error('websocket error')); return; }
            resolve({
              subscribe(_filters: unknown, params: { oneose?: () => void }) {
                if (p.eoseMs !== undefined) {
                  timers.push(setTimeout(() => params.oneose?.(), p.eoseMs));
                }
                return { close() { /* no socket to close */ } };
              },
            });
          }, p.connectMs ?? 5));
        });
      },
      close() { for (const t of timers) clearTimeout(t); timers.length = 0; },
    } as unknown as SimplePool;
  };
  return { make, poolsCreated: () => attempts };
}

const SILENT: Plan = { eoseMs: undefined };
const DEAD: Plan = { connectFails: true, connectMs: 20 };

async function main() {
  console.log('— an unverifiable read is reported as unanswered, however many attempts —');
  {
    const f = poolFactory(() => SILENT);
    const t0 = Date.now();
    const r = await readFromRelaysWithRetry(f.make, RELAYS, FILTER, {
      budgetMs: 200, attempts: 3, pauseMs: 30,
    });
    const took = Date.now() - t0;
    check('no relay is reported as answered', r.answered.length === 0, r.answered);
    check('every relay is reported as failed', r.failed.length === RELAYS.length, r.failed);
    check('it never throws — the caller stays the one that decides', true);
    check('all three attempts were spent before giving up', f.poolsCreated() === 3, f.poolsCreated());
    check('each attempt got a FRESH pool', f.poolsCreated() === 3);
    check('bounded by our own clock', took >= 600 && took < 2000, `${took}ms`);
  }

  console.log('\n— one slow relay is enough, where 8 s missed it —');
  {
    // Only one relay is reachable at all, and it answers at 8.5 s: inside the
    // budget we ship, outside the 8 s that refused the 66.41 LANA batch.
    const plan = (_a: number, url: string): Plan =>
      url === RELAYS[2] ? { connectMs: 300, eoseMs: 8200 } : DEAD;
    const old = poolFactory(plan);
    const now = poolFactory(plan);
    const t0 = Date.now();
    const [oldRead, newRead] = await Promise.all([
      readFromRelays(old.make(), RELAYS, FILTER, { budgetMs: 8000 }),
      readFromRelaysWithRetry(now.make, RELAYS, FILTER, {
        budgetMs: GUARD_READ_BUDGET_MS, attempts: GUARD_READ_ATTEMPTS, pauseMs: GUARD_READ_PAUSE_MS,
      }),
    ]);
    console.log(`    (both reads ran in parallel, ${Date.now() - t0}ms)`);
    check('the old 8 s budget called that relay dead', oldRead.answered.length === 0, oldRead.answered);
    check('the shipped budget lets it answer', newRead.answered.length === 1, { answered: newRead.answered, failed: newRead.failed });
    check('one answer is enough — no second attempt was spent', now.poolsCreated() === 1, now.poolsCreated());
  }

  console.log('\n— a socket that died with the camera sheet is recovered —');
  {
    // Attempt 1: every relay refuses to connect, exactly as on a page iOS has
    // just resumed. Attempt 2: the network is back.
    const f = poolFactory((attempt, url) =>
      attempt === 1 ? DEAD : (url === RELAYS[0] ? { connectMs: 10, eoseMs: 30 } : DEAD));
    const seen: number[] = [];
    const r = await readFromRelaysWithRetry(f.make, RELAYS, FILTER, {
      budgetMs: 500, attempts: GUARD_READ_ATTEMPTS, pauseMs: 40,
      onAttempt: (n) => seen.push(n),
    });
    check('the payment is no longer refused', r.answered.length === 1, { answered: r.answered, failed: r.failed });
    check('it took a second attempt to get there', f.poolsCreated() === 2, f.poolsCreated());
    check('the second attempt re-dialled on a new pool', f.poolsCreated() === 2);
    check('the user was told which attempt was running', seen.length === 2 && seen[0] === 1 && seen[1] === 2, seen);
    check('it stopped as soon as a relay answered', f.poolsCreated() < GUARD_READ_ATTEMPTS, f.poolsCreated());
  }

  console.log('\n— the healthy case is untouched: one attempt, one answer —');
  {
    const f = poolFactory((_a, url) => (url === RELAYS[1] ? { connectMs: 10, eoseMs: 20 } : DEAD));
    const t0 = Date.now();
    const r = await readFromRelaysWithRetry(f.make, RELAYS, FILTER, {
      budgetMs: GUARD_READ_BUDGET_MS, attempts: GUARD_READ_ATTEMPTS, pauseMs: GUARD_READ_PAUSE_MS,
    });
    const took = Date.now() - t0;
    check('answered on the first attempt', r.answered.length === 1 && f.poolsCreated() === 1, { answered: r.answered, pools: f.poolsCreated() });
    check('a healthy read pays nothing for the retry', took < 1000, `${took}ms`);
  }

  console.log('\n— the wait before a refusal stays bounded —');
  {
    check('more than one attempt', GUARD_READ_ATTEMPTS >= 2, GUARD_READ_ATTEMPTS);
    check('more room than the 8 s that failed', GUARD_READ_BUDGET_MS > 8000, GUARD_READ_BUDGET_MS);
    check('there is a pause between attempts', GUARD_READ_PAUSE_MS > 0, GUARD_READ_PAUSE_MS);
    check('worst case before refusing is under 40 s', GUARD_READ_WORST_CASE_MS <= 40_000, GUARD_READ_WORST_CASE_MS);
    console.log(`    (${GUARD_READ_ATTEMPTS} × ${GUARD_READ_BUDGET_MS}ms + ${GUARD_READ_ATTEMPTS - 1} × ${GUARD_READ_PAUSE_MS}ms = ${GUARD_READ_WORST_CASE_MS}ms)`);
  }

  console.log('\n— the refusal says what happened to the money —');
  {
    for (const [name, msg] of [['no relay answered', GUARD_UNVERIFIABLE_MESSAGE], ['no relay list', GUARD_NO_RELAY_LIST_MESSAGE]] as const) {
      check(`${name}: says nothing was sent`, /nothing was sent/i.test(msg), msg);
      check(`${name}: says no LANA left the wallet`, /no LANA has left your wallet/i.test(msg), msg);
      check(`${name}: says what to do next`, /(try again|press Confirm & Send Payment again)/i.test(msg), msg);
    }
    check('it does not stop at the bare old "Please try again."',
      !/^Could not verify previous payments/.test(GUARD_UNVERIFIABLE_MESSAGE), GUARD_UNVERIFIABLE_MESSAGE);
  }

  console.log('\n— the page reads through the retry; an unanswered read goes to the server\'s fail-closed guard —');
  {
    const page = readFileSync(new URL('../src/pages/unconditional-payment/ConfirmPayment.tsx', import.meta.url), 'utf8');
    check('the guard read is the retrying one', page.includes('readFromRelaysWithRetry('));
    check('a fresh pool per attempt', page.includes('() => new SimplePool()'));
    check('the budget is the shared constant, not a literal 8000', page.includes('budgetMs: GUARD_READ_BUDGET_MS') && !page.includes('budgetMs: 8000'));
    // Since 2026-09-17 the page no longer refuses on its own empty read: a
    // network that blocks relay WebSockets made payment impossible. The read
    // feeds guardAndSend, and the refusal comes from the server's 503.
    const flow = readFileSync(new URL('../src/lib/unconditionalPaymentFlow.ts', import.meta.url), 'utf8');
    check('an unanswered read is decided by guardAndSend, not by the page alone',
      page.includes('guardAndSend(') && !page.includes('answered.length === 0'));
    check("the server's refusal maps to the honest message", flow.includes("kind: 'refused', message: GUARD_UNVERIFIABLE_MESSAGE"));
    check('and the page shows it', page.includes('refuseUnverified(outcome.message)'));
    check('the old wording is gone', !page.includes('no relay answered. Please try again.'));
    check('nothing was turned into a "pay anyway"', !/pay\s*anyway/i.test(page));
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ the guard refuses only when it truly cannot verify');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
