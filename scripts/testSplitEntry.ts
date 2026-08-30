/**
 * A plan holder's entry SPLIT is money history: shown wrong, it tells someone
 * a false story about their own money that they will believe. This asserts the
 * three halves of that promise — that a real starting price resolves to the one
 * SPLIT it actually belongs to, that everything else REFUSES, and that a silent
 * network can never take a holder's plan off the screen.
 *
 * Every number below was observed, not invented:
 *  - PUBLISHED is the real KIND 38888 (`d=main`, version 8, event b226f267…)
 *    as the authority republished it on 2026-08-29 at 18:40:42Z, read back off
 *    the app's own `/api/db/kind_38888` — both the 24 `split_price` tags and
 *    the content array carry these values;
 *  - SUPERSEDED is what the same `d=main` carried BEFORE that republish, kept
 *    because the refusal it triggers is the behaviour that protected holders;
 *  - the starting prices are the distinct account-1/level-1 trigger prices of
 *    the 444 live KIND 88888 plans read off the Lana relays.
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
import {
  choosePlanEvent,
  planGateStatus,
  choosePlanScreen,
  type PlanGateStatus,
} from '../src/lib/planRead.js';
import {
  readWalletList,
  readWalletTags,
  mayPublishWalletList,
  baseWalletsFor,
} from '../src/lib/walletListRead.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 220) : ''); }
}

const eur = (rows: [number, number][]): SplitPriceRow[] =>
  rows.map(([split, price]) => ({ split, currency: 'EUR', price }));

/**
 * What `d=main` carried BEFORE the 18:40:42Z republish: running the wrong way
 * with SPLIT and a tenth of the size. Kept because refusing it is the behaviour
 * that stopped every holder being mirrored onto the wrong SPLIT.
 */
const SUPERSEDED = eur([
  [8, 0.0001], [7, 0.0002], [6, 0.0004], [5, 0.0008],
  [4, 0.0016], [3, 0.0032], [2, 0.0064], [1, 0.0128],
]);

/**
 * What KIND 38888 `d=main` carries now — and what the 444 live plans and the
 * published `fx` of 0.128 both agree on.
 */
const PUBLISHED = eur([
  [1, 0.001], [2, 0.002], [3, 0.004], [4, 0.008],
  [5, 0.016], [6, 0.032], [7, 0.064], [8, 0.128],
]);
/** Same rows in the order the tags actually arrive: SPLIT 8 first, and USD and
 * GBP interleaved with EUR. The reader must not depend on either. */
const PUBLISHED_AS_TAGGED: SplitPriceRow[] = [8, 7, 6, 5, 4, 3, 2, 1].flatMap((split) => {
  const price = 0.001 * Math.pow(2, split - 1);
  return ['EUR', 'GBP', 'USD'].map((currency) => ({ split, currency, price }));
});

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
  // The 24 split_price tags arrive SPLIT 8 first with three currencies mixed
  // together, exactly as KIND 38888 carries them. Reading them must not depend
  // on that order, and must not let USD or GBP rows into a EUR ladder.
  const tagged = buildLadder(PUBLISHED_AS_TAGGED, 'EUR');
  check('the 24 published split_price rows read back as 8 EUR rungs', tagged.length === 8, tagged.length);
  check('and sorted by SPLIT number whatever order they arrived in',
    tagged[0].split === 1 && tagged[0].price === 0.001 && tagged[7].split === 8 && tagged[7].price === 0.128, tagged);
  check('the ladder KIND 38888 publishes today is ACCEPTED',
    checkLadder(tagged, 8, 0.128) === null, checkLadder(tagged, 8, 0.128));
  check('  and it places the holder who complained at SPLIT 1',
    matchSplit(0.0013, tagged)?.split === 1, matchSplit(0.0013, tagged));

  const ladder = buildLadder(SUPERSEDED, 'EUR');
  check('all 8 superseded SPLIT prices are read', ladder.length === 8, ladder.length);
  check('and sorted by SPLIT number', ladder[0].split === 1 && ladder[7].split === 8);

  const verdict = checkLadder(ladder, 8, 0.128);
  check('the ladder published before 18:40:42Z is REJECTED', verdict !== null, verdict);
  check('  because it does not double per SPLIT', verdict === 'not-doubling', verdict);

  // Same values, right way round, but still 10x below the published fx.
  const scaled = eur([[1, 0.0001], [2, 0.0002], [3, 0.0004], [4, 0.0008],
                      [5, 0.0016], [6, 0.0032], [7, 0.0064], [8, 0.0128]]);
  const v2 = checkLadder(buildLadder(scaled, 'EUR'), 8, 0.128);
  check('a doubling ladder that contradicts the published fx is REJECTED', v2 === 'contradicts-fx', v2);

  check('the published ladder passes', checkLadder(buildLadder(PUBLISHED, 'EUR'), 8, 0.128) === null);
  check('a currency with no published prices yields an empty ladder',
    buildLadder(PUBLISHED, 'CHF').length === 0);
}

console.log('\n— every real starting price lands on exactly one SPLIT —');
{
  const ladder = buildLadder(PUBLISHED, 'EUR');
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

console.log('\n— the holder who said we had it wrong —');
{
  // Joshua Andrej Brilly, KIND 88888 event 3b56f957..., read off the Lana
  // relays on 2026-08-29. His plan's account-1/level-1 trigger is 0.0013 EUR,
  // and the eight accounts it names were funded with 88,004.6653 LANA — a
  // figure the chain still corroborates (accounts 3-8 hold their original
  // ~11,000 each; 1 and 2 have run down exactly along the plan's own
  // schedule). At the published SPLIT 1 reference of 0.001 EUR that
  // is 88.00 EUR of LANA, or 100.01 EUR once the 12% commission is added
  // back — which is the purchase he described. Nothing else reconciles:
  // at 0.0001 the same coins would have cost him 8.80 EUR, and at the
  // published SPLIT 1 price of 0.0128 they would have cost 1,126.46 EUR.
  const his = resolveEntry({
    plan: planAt(0.0013), splitPrices: PUBLISHED, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('his 0.0013 EUR plan is SPLIT 1, the cheapest, not SPLIT 5',
    his.plan === 'readable' && his.ladder.status === 'determined' && his.ladder.split === 1, his);
  check('  at a 30% premium over the 0.001 EUR reference',
    his.plan === 'readable' && his.ladder.status === 'determined'
      && Math.abs(his.ladder.splitPrice - 0.001) < 1e-9
      && Math.abs(his.ladder.premiumPercent - 30) < 1e-6,
    his.plan === 'readable' && his.ladder.status === 'determined' ? his.ladder : null);

  // The reason the card refuses rather than answering from the published rows:
  // believed, they mirror every holder onto the wrong SPLIT.
  const mirrored = matchSplit(0.0013, buildLadder(SUPERSEDED, 'EUR'));
  check('  the superseded ladder would have called it SPLIT 5',
    mirrored?.split === 5, mirrored);
  check('  which is why an inconsistent ladder is refused outright',
    checkLadder(buildLadder(SUPERSEDED, 'EUR'), 8, 0.128) !== null);
}

console.log('\n— what the screen is handed —');
{
  const ok = resolveEntry({
    plan: planAt(0.13824), splitPrices: PUBLISHED, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('a coherent read determines SPLIT 8',
    ok.plan === 'readable' && ok.ladder.status === 'determined' && ok.ladder.split === 8, ok);
  check('  and reports the SPLIT date it was published with',
    ok.plan === 'readable' && ok.ladder.status === 'determined' && ok.ladder.happenedAt === 1782950400);

  const today = resolveEntry({
    plan: planAt(0.13824), splitPrices: SUPERSEDED, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('against the superseded ladder the SPLIT is NOT determined',
    today.plan === 'readable' && today.ladder.status === 'ladder-inconsistent', today);
  check('  but the holder is still told their own starting price',
    today.plan === 'readable' && today.terms.startPrice === 0.13824);

  const noParams = resolveEntry({
    plan: planAt(0.13824), splitPrices: null, splitHistory: null, currentSplit: null, fxRate: null,
  });
  check('unreadable system parameters do not fall back to a baked-in table',
    noParams.plan === 'readable' && noParams.ladder.status === 'no-parameters', noParams);

  const wrongCurrency = resolveEntry({
    plan: planAt(0.13824, 'CHF'), splitPrices: PUBLISHED, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('a currency with no published ladder is REFUSED, not borrowed from EUR',
    wrongCurrency.plan === 'readable' && wrongCurrency.ladder.status === 'no-ladder', wrongCurrency);

  const offLadder = resolveEntry({
    plan: planAt(0.3), splitPrices: PUBLISHED, splitHistory: HISTORY, currentSplit: 8, fxRate: 0.128,
  });
  check('a starting price matching no SPLIT is REFUSED, not rounded to the nearest',
    offLadder.plan === 'readable' && offLadder.ladder.status === 'no-match', offLadder);

  const unreadable = resolveEntry({
    plan: { currency: 'EUR', accounts: [] }, splitPrices: PUBLISHED, splitHistory: HISTORY,
    currentSplit: 8, fxRate: 0.128,
  });
  check('an unreadable plan reports nothing at all', unreadable.plan === 'unreadable');
}

console.log('\n— a silent network must not retire a holder\'s plan —');
{
  // The failure this section exists for: on 2026-08-29 the authority
  // republished KIND 38888 with the corrected SPLIT prices, every open page
  // re-read its system parameters, and that re-read also re-ran the KIND 88888
  // plan query. `pool.querySync` cannot distinguish a relay that never
  // connected from one that answered with nothing — both are `[]` — so a
  // moment of network silence would set the plan to null and swap the holder's
  // page for the "check your wallets" screen, taking the entry SPLIT card with
  // it. The card was then missing at exactly the moment the data became right.
  const planEvent = (created_at: number) =>
    ({ id: String(created_at), created_at, content: '{}', kind: 88888, pubkey: '', sig: '', tags: [] }) as never;

  const outage = choosePlanEvent({ answered: [], events: [] });
  check('no relay answered → UNREACHABLE, not "you have no plan"', outage.status === 'unreachable', outage);

  const genuinelyNone = choosePlanEvent({ answered: ['wss://relay.lanavault.space'], events: [] });
  check('a relay answered with nothing → the holder genuinely has no plan',
    genuinelyNone.status === 'none', genuinelyNone);

  const found = choosePlanEvent({
    answered: ['wss://relay.lanavault.space'],
    events: [planEvent(1761484769), planEvent(1700000000)],
  });
  check('a plan that came back is the NEWEST re-publication',
    found.status === 'found' && found.event.created_at === 1761484769, found);

  const noEose = choosePlanEvent({ answered: [], events: [planEvent(1761484769)] });
  check('an event in hand counts even if no EOSE arrived in the budget',
    noEose.status === 'found', noEose);

  check('a missing read is UNREACHABLE, never absence', choosePlanEvent(null).status === 'unreachable');
}

console.log('\n— a silent relay must not lock a holder out of what the plan unlocks —');
{
  // The same empty array, read a second way. `useNostrLana8Wonder` is not a
  // display: it is the gate on resisting a proposal, on creating a LanaCrowd
  // project, and on opening an Abundance point. It answered `exists: false`
  // whenever `querySync` came back empty — so a relay that never connected
  // told a real plan holder, in four different screens, that they are not one.
  // Nothing said the relays had been silent; the refusal read as a verdict.
  const planEvent = (created_at: number, d: string, id: string) =>
    ({ id, created_at, content: '{}', kind: 88888, pubkey: '', sig: '',
       tags: [['d', d], ['p', 'holder']] }) as never;

  const NOTHING_KNOWN: PlanGateStatus = { exists: false, unreachable: false };

  const outage = planGateStatus({ answered: [], events: [] }, NOTHING_KNOWN);
  check('no relay answered → the gate says UNKNOWN, never "no plan"',
    outage.exists === false && outage.unreachable === true, outage);

  const held: PlanGateStatus = {
    exists: true, planId: 'main', eventId: 'abc', createdAt: 1761484769, unreachable: false,
  };
  const keptThroughOutage = planGateStatus({ answered: [], events: [] }, held);
  check('a plan already established is NOT retired by silence',
    keptThroughOutage.exists === true && keptThroughOutage.planId === 'main'
      && keptThroughOutage.unreachable === true, keptThroughOutage);

  // The other half of the promise: this must not become a gate that opens for
  // everyone the moment a relay is slow. A relay that ANSWERED is authority.
  const genuinelyNone = planGateStatus({ answered: ['wss://relay.lanavault.space'], events: [] }, held);
  check('a relay that answered with nothing DOES retire the plan — the gate never fails open',
    genuinelyNone.exists === false && genuinelyNone.unreachable === false, genuinelyNone);

  // `querySync` merged every relay's events and the hook took `events[0]` —
  // whichever copy happened to land first. Two relays a moment apart could
  // therefore have the gate reporting the SUPERSEDED plan id and event id.
  const twoCopies = planGateStatus({
    answered: ['wss://a', 'wss://b'],
    events: [planEvent(1700000000, 'superseded', 'old'), planEvent(1761484769, 'main', 'new')],
  }, NOTHING_KNOWN);
  check('two relays a moment apart → the NEWEST plan is reported, not the first to arrive',
    twoCopies.exists === true && twoCopies.planId === 'main' && twoCopies.eventId === 'new'
      && twoCopies.createdAt === 1761484769, twoCopies);

  const noEose = planGateStatus({ answered: [], events: [planEvent(1761484769, 'main', 'new')] }, NOTHING_KNOWN);
  check('a plan in hand counts even if no EOSE arrived in the budget',
    noEose.exists === true && noEose.unreachable === false, noEose);

  check('a read that never happened is UNKNOWN, never absence',
    planGateStatus(null, NOTHING_KNOWN).unreachable === true);
}

console.log('\n— the SPLIT forecast must not answer a question the relays refused —');
{
  // /lana8wonder/splits had the same `querySync` and a harsher fallback: with
  // no plan it states "You don't have an annuity plan", points the holder at
  // lana8wonder.com to buy one, and then prints sixteen doubling price rungs
  // that belong to nobody. A holder with eight funded accounts, hit by one
  // silent moment, was told he owned nothing and handed a stranger's ladder.
  const plan = { accounts: [] };

  check('relays silent and nothing in hand → the UNREADABLE screen, not "you have no plan"',
    choosePlanScreen({ plan: null, lastRead: 'unreachable' }) === 'unreachable',
    choosePlanScreen({ plan: null, lastRead: 'unreachable' }));

  check('  so the sixteen-rung forecast is never shown in place of a plan we could not read',
    choosePlanScreen({ plan: null, lastRead: 'unreachable' }) !== 'no-plan');

  check('relays silent but the plan already on screen → the forecast STAYS',
    choosePlanScreen({ plan, lastRead: 'unreachable' }) === 'forecast',
    choosePlanScreen({ plan, lastRead: 'unreachable' }));

  check('a relay answered with nothing → the honest "you have no plan" screen',
    choosePlanScreen({ plan: null, lastRead: 'none' }) === 'no-plan');

  check('a plan that was read → the forecast',
    choosePlanScreen({ plan, lastRead: 'found' }) === 'forecast');

  check('nobody signed in, so nothing was ever asked → the page is left as it was',
    choosePlanScreen({ plan: null, lastRead: null }) === 'no-plan');
}


console.log('\n— a silent relay must not erase the wallets somebody recorded —');
{
  // The same empty array, read a third way — and this one destroys data
  // rather than mis-drawing a screen. KIND 30289 is addressable: one event per
  // person, republished IN FULL on every edit. AddWalletDialog read the list
  // with `pool.querySync`, appended, and republished. Against relays that
  // cannot be reached that read returns `[]` in ~26ms with no error and no
  // catch, so the republished event carried the new wallet ALONE and the
  // relays replaced the real list with it. The toast said "Wallet added
  // successfully!". Every address the person had recorded was gone.
  const listEvent = (created_at: number, ws: string[][]) =>
    ({ id: String(created_at), created_at, content: '', kind: 30289, pubkey: 'holder', sig: '',
       tags: [['d', 'holder'], ['p', 'holder'], ['status', 'active'], ...ws] }) as never;

  const THREE = [['w', 'LcpMain', 'main'], ['w', 'LcpLost', 'lost keys'], ['w', 'LcpOld', '']];

  const outage = readWalletList({ answered: [], events: [] });
  check('no relay answered → UNREACHABLE, not "you have recorded no wallets"',
    outage.status === 'unreachable', outage);
  check('  so nothing may be published — the list is fail-CLOSED',
    mayPublishWalletList(outage) === false, mayPublishWalletList(outage));
  check('  and there is no empty list to append the new wallet to',
    baseWalletsFor(outage) === null, baseWalletsFor(outage));

  const firstEver = readWalletList({ answered: ['wss://relay.lanavault.space'], events: [] });
  check('a relay answered with nothing → genuinely no list yet',
    firstEver.status === 'empty', firstEver);
  check('  so a first-time user CAN add their first wallet — it never fails closed on them',
    mayPublishWalletList(firstEver) === true && baseWalletsFor(firstEver)?.length === 0,
    baseWalletsFor(firstEver));

  const found = readWalletList({ answered: ['wss://a'], events: [listEvent(1761484769, THREE)] });
  check('a list that came back is appended to, not replaced',
    found.status === 'found' && baseWalletsFor(found)?.length === 3, found);
  check('  with every address and note carried across',
    JSON.stringify(baseWalletsFor(found)) ===
      JSON.stringify([{ address: 'LcpMain', note: 'main' },
                      { address: 'LcpLost', note: 'lost keys' },
                      { address: 'LcpOld', note: '' }]),
    baseWalletsFor(found));

  // The second way the old code could lose a wallet, with every relay up:
  // `events[0]` off a merged multi-relay array is whichever copy landed first.
  // A relay a minute behind hands back the list as it was BEFORE the last
  // addition — and republishing that deletes the newer wallet for good.
  const twoCopies = readWalletList({
    answered: ['wss://a', 'wss://b'],
    events: [listEvent(1700000000, THREE.slice(0, 2)), listEvent(1761484769, THREE)],
  });
  check('two relays a moment apart → the NEWEST list wins, not the first to arrive',
    twoCopies.status === 'found' && baseWalletsFor(twoCopies)?.length === 3, twoCopies);

  const noEose = readWalletList({ answered: [], events: [listEvent(1761484769, THREE)] });
  check('a list in hand counts even if no EOSE arrived in the budget',
    noEose.status === 'found' && mayPublishWalletList(noEose) === true, noEose);

  check('a read that never happened is UNREACHABLE, never absence',
    readWalletList(null).status === 'unreachable');

  // A `w` tag written with no note is still a wallet somebody recorded. The
  // old `length >= 3` filter dropped it from the rebuilt list as silently as
  // the outage did — a merge may never be the reason an entry disappears.
  const sparse = listEvent(1761484769, [['w', 'LcpNoNote'], ...THREE]);
  check('a w tag with no note survives the republish',
    readWalletTags(sparse).length === 4 && readWalletTags(sparse)[0].note === '',
    readWalletTags(sparse));
  check('  but a w tag with no address is not a wallet',
    readWalletTags(listEvent(1761484769, [['w'], ['w', ''], ...THREE])).length === 3,
    readWalletTags(listEvent(1761484769, [['w'], ['w', ''], ...THREE])));
}


if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ the entry SPLIT is either a fact or a refusal — never a guess, and a quiet relay\n   can neither take a plan off the screen, nor take away what it unlocks,\n   nor erase the wallets somebody recorded');
process.exit(0);
