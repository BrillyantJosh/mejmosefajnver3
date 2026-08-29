/**
 * A plan holder's entry SPLIT is money history: shown wrong, it tells someone
 * a false story about their own money that they will believe. This asserts
 * the two halves of that promise — that a real starting price resolves to the
 * one SPLIT it actually belongs to, and that everything else REFUSES.
 *
 * Every number below was observed, not invented:
 *  - the published ladder is the real KIND 38888 (`d=main`, version 8) as it
 *    stood on the Lana relays on 2026-08-29;
 *  - the starting prices are the distinct account-1/level-1 trigger prices of
 *    the 444 live KIND 88888 plans read off those same relays.
 *
 *   npx tsx scripts/testSplitEntry.ts
 */
import {
  buildLadder,
  checkLadder,
  matchSplit,
  readStartPrice,
  resolveEntry,
  type PlanLike,
  type SplitPriceRow,
} from '../src/lib/splitEntry.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 220) : ''); }
}

const eur = (rows: [number, number][]): SplitPriceRow[] =>
  rows.map(([split, price]) => ({ split, currency: 'EUR', price }));

/** Exactly what KIND 38888 carried on 2026-08-29 — descending with SPLIT. */
const PUBLISHED_TODAY = eur([
  [8, 0.0001], [7, 0.0002], [6, 0.0004], [5, 0.0008],
  [4, 0.0016], [3, 0.0032], [2, 0.0064], [1, 0.0128],
]);

/** The ladder the 444 live plans and the published `fx` both agree on. */
const COHERENT = eur([
  [1, 0.001], [2, 0.002], [3, 0.004], [4, 0.008],
  [5, 0.016], [6, 0.032], [7, 0.064], [8, 0.128],
]);

const HISTORY = [
  { split: 1, happenedAt: 1751328000 }, { split: 2, happenedAt: 1752537600 },
  { split: 3, happenedAt: 1757894400 }, { split: 4, happenedAt: 1766620800 },
  { split: 5, happenedAt: 1775001600 }, { split: 6, happenedAt: 1776211200 },
  { split: 7, happenedAt: 1780272000 }, { split: 8, happenedAt: 1782950400 },
];

/** A plan the way publishPlan.ts builds it: account 1 linear, account 2 at 10x. */
function planAt(startPrice: number, currency = 'EUR'): PlanLike {
  const round5 = (n: number) => parseFloat(n.toFixed(5));
  const linear = (base: number) =>
    Array.from({ length: 10 }, (_, i) => ({ level_no: i + 1, trigger_price: round5(base * (i + 1)) }));
  return {
    currency,
    accounts: [
      { account_id: 1, levels: linear(startPrice) },
      { account_id: 2, levels: linear(round5(startPrice * 10)) },
    ],
  };
}

console.log('— the plan carries its own starting price —');
{
  check('account 1 / level 1 is the starting price', readStartPrice(planAt(0.13824)) === 0.13824);
  check('the smallest real starting price survives 5-decimal storage', readStartPrice(planAt(0.00108)) === 0.00108);

  const broken = planAt(0.00864);
  broken.accounts[0].levels[4].trigger_price = 0.05;
  check('a plan whose linear account is not linear is REFUSED', readStartPrice(broken) === null);

  const skewed = planAt(0.00864);
  skewed.accounts[1].levels[0].trigger_price = 0.0864 * 2;
  check('a plan whose account 2 is not at 10x is REFUSED', readStartPrice(skewed) === null);

  check('a plan with no accounts is REFUSED', readStartPrice({ currency: 'EUR', accounts: [] }) === null);
  check('a null plan is REFUSED', readStartPrice(null) === null);
}

console.log('\n— the published ladder is checked before it is trusted —');
{
  const ladder = buildLadder(PUBLISHED_TODAY, 'EUR');
  check('all 8 published SPLIT prices are read', ladder.length === 8, ladder.length);
  check('and sorted by SPLIT number', ladder[0].split === 1 && ladder[7].split === 8);

  const verdict = checkLadder(ladder, 8, 0.128);
  check('the ladder published on 2026-08-29 is REJECTED', verdict !== null, verdict);
  check('  because it does not double per SPLIT', verdict === 'not-doubling', verdict);

  // Same values, right way round, but still 10x below the published fx.
  const scaled = eur([[1, 0.0001], [2, 0.0002], [3, 0.0004], [4, 0.0008],
                      [5, 0.0016], [6, 0.0032], [7, 0.0064], [8, 0.0128]]);
  const v2 = checkLadder(buildLadder(scaled, 'EUR'), 8, 0.128);
  check('a doubling ladder that contradicts the published fx is REJECTED', v2 === 'contradicts-fx', v2);

  check('the coherent ladder passes', checkLadder(buildLadder(COHERENT, 'EUR'), 8, 0.128) === null);
  check('a currency with no published prices yields an empty ladder',
    buildLadder(COHERENT, 'CHF').length === 0);
}

console.log('\n— every real starting price lands on exactly one SPLIT —');
{
  const ladder = buildLadder(COHERENT, 'EUR');
  // [starting price, expected SPLIT, expected premium %] — all 11 distinct
  // EUR starting prices across the 444 live plans.
  const observed: [number, number, number][] = [
    [0.00108, 1, 8], [0.0013, 1, 30],
    [0.00216, 2, 8], [0.0026, 2, 30],
    [0.004, 3, 0], [0.00432, 3, 8],
    [0.00864, 4, 8], [0.01728, 5, 8],
    [0.03456, 6, 8], [0.06912, 7, 8], [0.13824, 8, 8],
  ];
  for (const [start, expected, premium] of observed) {
    const hit = matchSplit(start, ladder);
    const gotPremium = hit ? Math.round((start / hit.price - 1) * 100) : NaN;
    check(`${start} EUR → SPLIT ${expected} at +${premium}%`,
      hit?.split === expected && gotPremium === premium, { got: hit?.split, gotPremium });
  }

  check('a price below every published SPLIT is REFUSED', matchSplit(0.0001, ladder) === null);
  check('a price above every published SPLIT is REFUSED', matchSplit(0.3, ladder) === null);
  check('the top SPLIT still matches up to (not including) double',
    matchSplit(0.2559, ladder)?.split === 8);
}

console.log('\n— what the screen is handed —');
{
  const ok = resolveEntry({
    plan: planAt(0.13824), splitPrices: COHERENT, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('a coherent read determines SPLIT 8',
    ok.plan === 'readable' && ok.ladder.status === 'determined' && ok.ladder.split === 8, ok);
  check('  and reports the SPLIT date it was published with',
    ok.plan === 'readable' && ok.ladder.status === 'determined' && ok.ladder.happenedAt === 1782950400);
  check('  and 100 EUR at that starting price is 723.38 LANA',
    ok.plan === 'readable' && Math.abs(ok.terms.lanaPerHundred - 723.3796) < 0.0001,
    ok.plan === 'readable' ? ok.terms.lanaPerHundred : null);

  const today = resolveEntry({
    plan: planAt(0.13824), splitPrices: PUBLISHED_TODAY, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('against the ladder published today the SPLIT is NOT determined',
    today.plan === 'readable' && today.ladder.status === 'ladder-inconsistent', today);
  check('  but the holder is still told their own starting price',
    today.plan === 'readable' && today.terms.startPrice === 0.13824);
  check('  and what 100 EUR came to at it',
    today.plan === 'readable' && Math.abs(today.terms.lanaPerHundred - 723.3796) < 0.0001);

  const noParams = resolveEntry({
    plan: planAt(0.13824), splitPrices: null, splitHistory: null, currentSplit: null, fxRate: null,
  });
  check('unreadable system parameters do not fall back to a baked-in table',
    noParams.plan === 'readable' && noParams.ladder.status === 'no-parameters', noParams);

  const wrongCurrency = resolveEntry({
    plan: planAt(0.13824, 'CHF'), splitPrices: COHERENT, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('a currency with no published ladder is REFUSED, not borrowed from EUR',
    wrongCurrency.plan === 'readable' && wrongCurrency.ladder.status === 'no-ladder', wrongCurrency);

  const offLadder = resolveEntry({
    plan: planAt(0.3), splitPrices: COHERENT, splitHistory: HISTORY, currentSplit: 8, fxRate: 0.128,
  });
  check('a starting price matching no SPLIT is REFUSED, not rounded to the nearest',
    offLadder.plan === 'readable' && offLadder.ladder.status === 'no-match', offLadder);

  const unreadable = resolveEntry({
    plan: { currency: 'EUR', accounts: [] }, splitPrices: COHERENT, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('an unreadable plan reports nothing at all', unreadable.plan === 'unreadable');
}

if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ the entry SPLIT is either a fact or a refusal — never a guess');
process.exit(0);
