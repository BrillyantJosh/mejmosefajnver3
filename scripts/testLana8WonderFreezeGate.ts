/**
 * A frozen Lana8Wonder wallet may not transfer.
 *   npx tsx scripts/testLana8WonderFreezeGate.ts
 *
 * The live case this pins: LaAKazHYDWmCVrUf3uDnT1wUR2JxtQtyVk, "Lana 8 Wonder
 * Account 1", carried freeze_status `frozen_max_cap` in the registrar's KIND
 * 30889 list while ~1,376 LANA left it. The card said FROZEN and "outgoing
 * transactions disabled" the whole time, so the display was never the problem —
 * nothing downstream of it refused.
 *
 * Both sides are pinned here because a button that hides itself is not a gate:
 * the endpoint stays reachable from a stale tab, a back-button, or curl.
 *
 * The rule these tests exist to protect: silence is not consent. A wallet list
 * that could not be read says NOTHING about a freeze, and must never be
 * reported as "not frozen".
 */
import {
  lana8wonderTransferGate,
  mayTransfer,
  transferGateExplanation,
  transferGateResolution,
} from '../src/lib/lana8wonderTransferGate.js';
import { decideFrozenSend, frozenSpendCapLana } from '../server/lib/walletFreeze.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

/** The reported wallet, and a sibling that was never frozen. */
const FROZEN = 'LaAKazHYDWmCVrUf3uDnT1wUR2JxtQtyVk';
const CLEAN = 'Lg1nJFcCrTrR4FiZTi5xYALaiW9NbxN3ur';
const MAIN = 'LSBAD4jx9foFZ1ZPM9uVyZeVT5N1GVxJ8X';

/** The registrar's list as production actually serves it for this person. */
const LIVE_LIST = [
  { walletId: FROZEN, walletType: 'Lana8Wonder', status: 'active', freezeStatus: 'frozen_max_cap' },
  { walletId: CLEAN, walletType: 'Lana8Wonder', status: 'active', freezeStatus: '' },
  { walletId: MAIN, walletType: 'Main Wallet', status: 'active', freezeStatus: '' },
];

// ───────────────────────── the button ─────────────────────────

console.log('— the reported wallet must not offer a transfer —');
{
  const g = lana8wonderTransferGate(LIVE_LIST, true, FROZEN);
  check('read as frozen', g.state === 'frozen', g);
  check('carries the registrar’s reason', g.reason === 'frozen_max_cap', g);
  check('the gate stays shut', mayTransfer(g) === false);
}

console.log('— a frozen sibling must not freeze the whole plan —');
{
  // Account 1 is frozen and Account 5 is not. Blocking every account because
  // one is frozen would break seven legitimate cash-outs.
  const g = lana8wonderTransferGate(LIVE_LIST, true, CLEAN);
  check('the unfrozen account still transfers', g.state === 'clear', g);
  check('the gate opens', mayTransfer(g) === true);
}

console.log('— silence is not consent —');
{
  // The live outage shape. fetch-user-wallets answers {success:true, wallets:[]}
  // when no relay replies, and [] is truthy, so `resolved` arrives as true and
  // the empty list is all the caller ever sees. Both spellings must refuse.
  const unread = lana8wonderTransferGate([], true, FROZEN);
  check('an empty list is not a clean bill', unread.state === 'unknown', unread);
  check('and says which silence', unread.unknownBecause === 'no_wallet_list', unread);
  check('gate shut', mayTransfer(unread) === false);

  const unresolved = lana8wonderTransferGate(LIVE_LIST, false, FROZEN);
  check('an unresolved read refuses', unresolved.state === 'unknown', unresolved);
  check('named as unreachable', unresolved.unknownBecause === 'unreachable', unresolved);
  check('gate shut', mayTransfer(unresolved) === false);

  const absent = lana8wonderTransferGate(LIVE_LIST, true, 'LNotOnTheRegistrarsList0000000000');
  check('a wallet the list does not cover refuses', absent.state === 'unknown', absent);
  check('named as not listed', absent.unknownBecause === 'wallet_not_listed', absent);
  check('gate shut', mayTransfer(absent) === false);

  check('null list refuses', mayTransfer(lana8wonderTransferGate(null, true, FROZEN)) === false);
}

console.log('— the two places a freeze can be written —');
{
  // A person can be frozen account-wide with the wallet's own 7th field empty.
  // Reading only the per-wallet code would let that through.
  const accountFrozen = LIVE_LIST.map(w => ({ ...w, status: 'frozen', freezeStatus: '' }));
  const g = lana8wonderTransferGate(accountFrozen, true, CLEAN);
  check('account-level freeze counts', g.state === 'frozen', g);
  check('gate shut', mayTransfer(g) === false);
}

console.log('— an unrecognised code is frozen, per the registrar spec —');
{
  const g = lana8wonderTransferGate(
    [{ walletId: FROZEN, walletType: 'Lana8Wonder', status: 'active', freezeStatus: 'frozen_something_new' }],
    true,
    FROZEN,
  );
  check('treated as frozen', g.state === 'frozen', g);
  check('gate shut', mayTransfer(g) === false);
}

console.log('— the refusal has to be worth reading —');
{
  const frozen = lana8wonderTransferGate(LIVE_LIST, true, FROZEN);
  const why = transferGateExplanation(frozen);
  check('says the cap was exceeded', /maximum balance cap/i.test(why), why);

  const unknown = lana8wonderTransferGate([], true, FROZEN);
  const unknownWhy = transferGateExplanation(unknown);
  check('an outage never claims "not frozen"', !/not frozen|unfrozen/i.test(unknownWhy), unknownWhy);
  check('an outage says it could not be checked', /could not|cannot/i.test(unknownWhy), unknownWhy);
}

console.log('— and it has to point somewhere that can help —');
{
  // Reused from src/lib/freezeResolution so the module cannot drift from the
  // /wallet page. A max-cap freeze is settled at the registrar; the deep link
  // carries the address so the person lands on their own wallet.
  const r = transferGateResolution(lana8wonderTransferGate(LIVE_LIST, true, FROZEN), FROZEN);
  check('goes to the registrar', /lanatrace\.us/.test(r.href), r.href);
  check('lands on the resolve page', r.href.includes('/wallets/resolve-max-cap'), r.href);
  check('carrying the wallet', r.href.includes(FROZEN), r.href);

  // An unreadable state is not a max-cap freeze, and must not be sent to the
  // page that asks for the whole balance.
  const u = transferGateResolution(lana8wonderTransferGate([], true, FROZEN), FROZEN);
  check('an outage goes to registrar review', !u.href.includes('resolve-max-cap'), u.href);
  check('still a real destination', /lanatrace\.us/.test(u.href), u.href);
}

// ───────────────────────── the endpoint ─────────────────────────

const FROZEN_L8W = { frozen: true, known: true, reason: 'frozen_max_cap', walletType: 'Lana8Wonder' };
const FROZEN_ORDINARY = { frozen: true, known: true, reason: 'frozen_max_cap', walletType: 'Wallet' };
const CLEAR = { frozen: false, known: true, walletType: 'Wallet' };
const UNREADABLE = { frozen: false, known: false, unreachable: true };

console.log('— emptying a frozen wallet is never within a cap —');
{
  // The hole. send-lana-transaction measured req.body.amount against the
  // allowance, but with emptyWallet the signer ignores amount entirely and
  // sends the whole balance (server/lib/crypto.ts). A small declared amount
  // therefore bought an unlimited drain.
  const d = decideFrozenSend({ verdict: FROZEN_ORDINARY, amountLana: 1, emptyingWallet: true });
  check('refused outright', d.outcome === 'refuse', d);
  check('never sent to the cap arm', d.outcome !== 'check-cap', d);
  check('the refusal names the registrar', /lanatrace\.us/.test((d as any).error || ''), d);
}

console.log('— a frozen Lana8Wonder wallet has no allowance at all —');
{
  // The 50% / €100 allowance exists so PLAN15 can buy unregistered LANA, and
  // PLAN15 only ever pays from Main Wallet / Wallet / Retail. An annuity
  // cash-out into your own Main Wallet is not that, so it gets no allowance.
  const d = decideFrozenSend({ verdict: FROZEN_L8W, amountLana: 0.5 });
  check('refused whatever the amount', d.outcome === 'refuse', d);
  check('even for a dust amount', decideFrozenSend({ verdict: FROZEN_L8W, amountLana: 1e-8 }).outcome === 'refuse');
}

console.log('— but PLAN15 keeps its allowance —');
{
  const d = decideFrozenSend({ verdict: FROZEN_ORDINARY, amountLana: 3.00732422 });
  check('an ordinary frozen wallet still reaches the cap', d.outcome === 'check-cap', d);
  const none = decideFrozenSend({ verdict: FROZEN_ORDINARY });
  check('a path that names no amount is still hard-blocked', none.outcome === 'refuse', none);
}

console.log('— unreadable is not unfrozen —');
{
  const strict = decideFrozenSend({ verdict: UNREADABLE, amountLana: 10, requireKnownState: true });
  check('refused when the caller demands a readable state', strict.outcome === 'refuse', strict);
  check('and says so plainly', /could not|verif/i.test((strict as any).error || ''), strict);

  // The other twelve payment paths keep today's documented behaviour: refusing
  // every payment on every relay hiccup would be worse than the case guarded.
  const lenient = decideFrozenSend({ verdict: UNREADABLE, amountLana: 10 });
  check('other paths are unchanged', lenient.outcome === 'allow', lenient);
}

console.log('— an unfrozen wallet is untouched —');
{
  check('plain send allowed', decideFrozenSend({ verdict: CLEAR, amountLana: 500 }).outcome === 'allow');
  check('emptying allowed', decideFrozenSend({ verdict: CLEAR, amountLana: 500, emptyingWallet: true }).outcome === 'allow');
  check(
    'and a readable-state demand does not block it',
    decideFrozenSend({ verdict: CLEAR, amountLana: 500, requireKnownState: true }).outcome === 'allow',
  );
}

console.log('— the allowance arithmetic is unchanged —');
{
  check('half the funds still binds', Math.abs(frozenSpendCapLana(531.25, 0.128) - 265.625) < 1e-9);
  check('the €100 arm still binds', Math.abs(frozenSpendCapLana(100000, 0.128) - 781.25) < 1e-9);
  check('no rate is still no allowance', frozenSpendCapLana(531.25, 0) === 0);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
