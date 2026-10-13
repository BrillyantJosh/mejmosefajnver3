/**
 * A Lana8Wonder cash-out never goes into a frozen wallet.
 *   npx tsx scripts/testCashOutDestinationGate.ts
 *
 * The case this pins (9 Oct 2026): an owner cashed 137.50 LANA out of
 * Lana8Wonder Account 2 into his Main Wallet while the Main Wallet was frozen
 * `frozen_max_cap`. Every gate judged only the wallet the money LEFT. The
 * registrar releases a max-cap freeze for a donation of the whole Main balance
 * less 0.01, so 1 h 46 min later the release swept the 137.50 away too.
 *
 * The owner's rule since: "Če je zamrznjena denarnica (cilj) ne dovoli
 * izplačila... naj gredo odmrznit..." — if the destination is frozen, no
 * cash-out; unfreeze it first, then cash out.
 *
 * Both sides are pinned: the server, which is the gate, and the client helper
 * that keeps the person from walking into it. The sender guard is re-checked
 * through the same composed entry point so this change cannot quietly loosen
 * it. No relays and no Electrum are touched — the freeze reader is injected.
 */
import {
  decideCashOutDestination,
  guardSendLanaTransaction,
  isLana8WonderCashOut,
  LANA8WONDER_CASHOUT_PURPOSE,
  type FreezeVerdict,
} from '../server/lib/walletFreeze.js';
import {
  cashOutDestinations,
  cashOutDestinationSummary,
  mayTransfer,
} from '../src/lib/lana8wonderTransferGate.js';

let failures = 0;
let passes = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (cond) passes++;
  else failures++;
};

// Synthetic addresses: the reader is injected, so only their identity matters.
const L8W_ACCOUNT_2 = 'LTestL8wAccount2xxxxxxxxxxxxxxxxxx';
const MAIN = 'LTestMainWalletxxxxxxxxxxxxxxxxxxx';
const OTHER_WALLET = 'LTestOrdinaryWalletxxxxxxxxxxxxxxx';
const MENTOR = 'LTestMentorWalletxxxxxxxxxxxxxxxxx';
const STRANGER = 'LTestNotOnAnyListxxxxxxxxxxxxxxxxx';

const L8W_CLEAR: FreezeVerdict = { frozen: false, known: true, walletType: 'Lana8Wonder', unreachable: false };
const L8W_FROZEN: FreezeVerdict = { frozen: true, known: true, reason: 'frozen_max_cap', walletType: 'Lana8Wonder', unreachable: false };
const MAIN_FROZEN: FreezeVerdict = { frozen: true, known: true, reason: 'frozen_max_cap', walletType: 'Main Wallet', unreachable: false };
const MAIN_CLEAR: FreezeVerdict = { frozen: false, known: true, walletType: 'Main Wallet', unreachable: false };
const WALLET_FROZEN: FreezeVerdict = { frozen: true, known: true, reason: 'frozen_max_cap', walletType: 'Wallet', unreachable: false };
const UNREACHABLE: FreezeVerdict = { frozen: false, known: false, unreachable: true };
const NOT_LISTED: FreezeVerdict = { frozen: false, known: false, unreachable: false };

/** A freeze reader that answers from a table and remembers every address it was asked. */
function reader(table: Record<string, FreezeVerdict | 'throw'>) {
  const asked: string[] = [];
  const read = async (address: string): Promise<FreezeVerdict> => {
    asked.push(address);
    const v = table[address];
    if (v === 'throw') throw new Error('relay pool exploded');
    return v ?? NOT_LISTED;
  };
  return { read, asked };
}

/** The request Lana8WonderTransfer actually sends. */
const cashOutBody = (over: Record<string, unknown> = {}) => ({
  senderAddress: L8W_ACCOUNT_2,
  recipientAddress: MAIN,
  amount: 137.5,
  privateKey: 'not-a-key-and-never-decoded-here',
  emptyWallet: false,
  purpose: LANA8WONDER_CASHOUT_PURPOSE,
  ...over,
});

async function main() {
  // ───────────────────────── the server: the rule ─────────────────────────

  console.log('— a frozen destination refuses the cash-out —');
  {
    const r = decideCashOutDestination([{ address: MAIN, verdict: MAIN_FROZEN }]);
    check('refused', r !== null, r);
    check('named DESTINATION_FROZEN', r?.code === 'DESTINATION_FROZEN', r);
    check('answered 409', r?.status === 409, r);
    check('says which wallet', !!r?.error.includes(MAIN), r?.error);
    check('carries the reason', r?.reason === 'frozen_max_cap', r);
    check('points at the registrar max-cap release for THAT wallet',
      !!r?.resolveHref.includes('/wallets/resolve-max-cap') && !!r?.resolveHref.includes(MAIN), r?.resolveHref);
  }

  console.log('— unreadable is not unfrozen —');
  {
    const u = decideCashOutDestination([{ address: MAIN, verdict: UNREACHABLE }]);
    check('no relay answered → refused', u?.code === 'DESTINATION_UNVERIFIED', u);
    check('answered 503 (try again)', u?.status === 503, u);
    check('says it could not verify', /could not be verified/i.test(u?.error || ''), u?.error);
    check('never claims "not frozen"', !/not frozen|unfrozen/i.test(u?.error || ''), u?.error);

    const n = decideCashOutDestination([{ address: STRANGER, verdict: NOT_LISTED }]);
    check('not on any registrar list → refused', n?.code === 'DESTINATION_NOT_REGISTERED', n);
    check('answered 409', n?.status === 409, n);
  }

  console.log('— a clear destination is allowed —');
  {
    check('clear Main Wallet passes', decideCashOutDestination([{ address: MAIN, verdict: MAIN_CLEAR }]) === null);
    check('no destinations is left to the signer', decideCashOutDestination([]) === null);
  }

  console.log('— a freeze outranks an unreadable answer —');
  {
    const r = decideCashOutDestination([
      { address: MENTOR, verdict: UNREACHABLE },
      { address: MAIN, verdict: MAIN_FROZEN },
    ]);
    check('the actionable answer wins', r?.code === 'DESTINATION_FROZEN' && r.address === MAIN, r);
  }

  console.log('— what counts as a cash-out —');
  {
    check('the screen says so', isLana8WonderCashOut(LANA8WONDER_CASHOUT_PURPOSE, MAIN_CLEAR) === true);
    check('the registrar says the sender is Lana8Wonder', isLana8WonderCashOut(undefined, L8W_CLEAR) === true);
    check('an ordinary send is not', isLana8WonderCashOut(undefined, MAIN_CLEAR) === false);
    check('another purpose string is not', isLana8WonderCashOut('plan15', MAIN_CLEAR) === false);
    check('an unread sender with no purpose is not', isLana8WonderCashOut(undefined, UNREACHABLE) === false);
  }

  // ─────────────── the server: the route's composed gate ───────────────

  console.log('— the 9 Oct shape is refused before anything is signed —');
  {
    const { read, asked } = reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_FROZEN });
    const r = await guardSendLanaTransaction(cashOutBody(), read);
    check('refused', r !== null, r);
    check('409', r?.status === 409, r);
    check('code DESTINATION_FROZEN', r?.body.code === 'DESTINATION_FROZEN', r);
    check('success:false', r?.body.success === false, r);
    check('names the destination', r?.body.destination === MAIN, r);
    check('gives the unfreeze link', !!r?.body.resolveHref?.includes('resolve-max-cap'), r);
    check('read the sender and the destination once each',
      asked.length === 2 && asked.includes(L8W_ACCOUNT_2) && asked.includes(MAIN), asked);
  }

  console.log('— the same send through another screen is still a cash-out —');
  {
    // /send-lana opened by hand on a Lana8Wonder wallet, or curl: no purpose.
    // The registrar's own wallet type for the sender is the unforgeable half.
    const { read } = reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_FROZEN });
    const r = await guardSendLanaTransaction(cashOutBody({ purpose: undefined }), read);
    check('refused without the purpose marker', r?.body.code === 'DESTINATION_FROZEN', r);
  }

  console.log('— an unreadable destination is refused —');
  {
    const a = await guardSendLanaTransaction(cashOutBody(),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: UNREACHABLE }).read);
    check('no relay answered → 503 DESTINATION_UNVERIFIED',
      a?.status === 503 && a.body.code === 'DESTINATION_UNVERIFIED', a);

    const b = await guardSendLanaTransaction(cashOutBody(),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: 'throw' }).read);
    check('a reader that throws is refused, not waved through',
      b?.body.code === 'DESTINATION_UNVERIFIED', b);

    const c = await guardSendLanaTransaction(cashOutBody({ recipientAddress: STRANGER }),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR }).read);
    check('a destination on no registrar list → DESTINATION_NOT_REGISTERED',
      c?.body.code === 'DESTINATION_NOT_REGISTERED', c);
  }

  console.log('— every paid output is checked, as the signer would pay it —');
  {
    const m = await guardSendLanaTransaction(
      cashOutBody({ mentorAddress: MENTOR, mentorPercent: 10 }),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_CLEAR, [MENTOR]: WALLET_FROZEN }).read,
    );
    check('a frozen mentor-split output refuses too', m?.body.destination === MENTOR, m);

    // server/lib/crypto.ts strips invisible characters before paying; the
    // freeze must be read for that same, normalised address.
    const { read, asked } = reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_FROZEN });
    const z = await guardSendLanaTransaction(cashOutBody({ recipientAddress: `\u200B${MAIN} ` }), read);
    check('a zero-width-padded address is read normalised', asked.includes(MAIN), asked);
    check('and still refused', z?.body.code === 'DESTINATION_FROZEN', z);
  }

  console.log('— an unfrozen destination is allowed —');
  {
    const r = await guardSendLanaTransaction(cashOutBody(),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_CLEAR }).read);
    check('cash-out into a clear Main Wallet proceeds', r === null, r);

    const e = await guardSendLanaTransaction(cashOutBody({ emptyWallet: true }),
      reader({ [L8W_ACCOUNT_2]: L8W_CLEAR, [MAIN]: MAIN_CLEAR }).read);
    check('so does emptying the account into it', e === null, e);
  }

  // ─────────────── the server: the sender guard is unchanged ───────────────

  console.log('— the sender guard answers exactly as before —');
  {
    const { read, asked } = reader({ [L8W_ACCOUNT_2]: L8W_FROZEN, [MAIN]: MAIN_FROZEN });
    const f = await guardSendLanaTransaction(cashOutBody(), read);
    check('a frozen Lana8Wonder sender is still refused', f !== null, f);
    check('with HTTP 200 and {success:false, error} as before', f?.status === 200 && f.body.success === false, f);
    check('in the old words', /Lana8Wonder wallet is frozen/.test(f?.body.error || ''), f?.body.error);
    check('and no destination code', f?.body.code === undefined, f);
    check('the destination is not even read', asked.length === 1 && asked[0] === L8W_ACCOUNT_2, asked);

    const u = await guardSendLanaTransaction(cashOutBody(), reader({ [L8W_ACCOUNT_2]: UNREACHABLE }).read);
    check('an unreadable sender on the cash-out is still refused (200)',
      u?.status === 200 && /could not be verified/.test(u.body.error), u);

    const d = await guardSendLanaTransaction(
      { senderAddress: OTHER_WALLET, recipientAddress: MAIN, amount: 5, emptyWallet: true },
      reader({ [OTHER_WALLET]: WALLET_FROZEN }).read,
    );
    check('emptying a frozen wallet is still refused', d?.status === 200 && /cannot be emptied/.test(d.body.error), d);
  }

  console.log('— ordinary payments are not touched —');
  {
    // A Main Wallet paying someone whose wallet is frozen is not a cash-out:
    // no destination rule, and no extra relay read.
    const { read, asked } = reader({ [MAIN]: MAIN_CLEAR, [OTHER_WALLET]: WALLET_FROZEN });
    const r = await guardSendLanaTransaction(
      { senderAddress: MAIN, recipientAddress: OTHER_WALLET, amount: 5 },
      read,
    );
    check('allowed', r === null, r);
    check('only the sender was read', asked.length === 1 && asked[0] === MAIN, asked);

    // The documented project default for an ordinary send: an unreadable
    // sender proceeds. Unchanged.
    const lenient = await guardSendLanaTransaction(
      { senderAddress: MAIN, recipientAddress: OTHER_WALLET, amount: 5 },
      reader({ [MAIN]: UNREACHABLE }).read,
    );
    check('unreadable ordinary sender still proceeds', lenient === null, lenient);
  }

  // ───────────────────────── the client helper ─────────────────────────

  /** The registrar's list as the app receives it, in the 9 Oct shape. */
  const LIST = [
    { walletId: 'LTestL8wAccount1xxxxxxxxxxxxxxxxxx', walletType: 'Lana8Wonder', status: 'active', freezeStatus: '' },
    { walletId: L8W_ACCOUNT_2, walletType: 'Lana8Wonder', status: 'active', freezeStatus: '' },
    { walletId: MAIN, walletType: 'Main Wallet', status: 'active', freezeStatus: 'frozen_max_cap' },
  ];

  console.log('— the Transfer page sees the frozen Main Wallet —');
  {
    const dests = cashOutDestinations(LIST, true, L8W_ACCOUNT_2);
    check('only Wallet / Main Wallet are destinations', dests.length === 1 && dests[0].walletId === MAIN, dests);
    check('the Main Wallet reads frozen', dests[0]?.gate.state === 'frozen', dests[0]);
    check('with the registrar’s reason', dests[0]?.gate.reason === 'frozen_max_cap', dests[0]);
    check('and cannot receive', mayTransfer(dests[0].gate) === false);

    const s = cashOutDestinationSummary(dests);
    check('the plan page is told: unfreeze the destination first',
      s.state === 'blocked' && s.destination.walletId === MAIN, s);
  }

  console.log('— one clear destination is enough —');
  {
    const withWallet = [...LIST, { walletId: OTHER_WALLET, walletType: 'Wallet', status: 'active', freezeStatus: '' }];
    const dests = cashOutDestinations(withWallet, true, L8W_ACCOUNT_2);
    check('the frozen Main stays listed (so the person sees why)', dests.some(d => d.walletId === MAIN));
    check('the clear Wallet can receive', mayTransfer(dests.find(d => d.walletId === OTHER_WALLET)!.gate));
    check('so the cash-out stays open', cashOutDestinationSummary(dests).state === 'open');
  }

  console.log('— silence is not consent, here either —');
  {
    const unresolved = cashOutDestinationSummary(cashOutDestinations(
      LIST.map(w => ({ ...w, freezeStatus: '' })), false, L8W_ACCOUNT_2));
    check('an unread list blocks', unresolved.state === 'blocked', unresolved);
    check('as unknown, not frozen', unresolved.state === 'blocked' && unresolved.destination.gate.state === 'unknown', unresolved);

    const accountFrozen = cashOutDestinationSummary(cashOutDestinations(
      LIST.map(w => ({ ...w, status: 'frozen', freezeStatus: '' })), true, L8W_ACCOUNT_2));
    check('an account-wide freeze blocks the destination', accountFrozen.state === 'blocked', accountFrozen);

    const unknownCode = cashOutDestinations(
      [{ walletId: MAIN, walletType: 'Main Wallet', status: 'active', freezeStatus: 'frozen_something_new' }],
      true, L8W_ACCOUNT_2);
    check('an unrecognised freeze code counts as frozen', unknownCode[0]?.gate.state === 'frozen', unknownCode);
  }

  console.log('— a frozen Main Wallet is the one named first —');
  {
    const dests = cashOutDestinations([
      { walletId: OTHER_WALLET, walletType: 'Wallet', status: 'active', freezeStatus: 'frozen_too_wild' },
      { walletId: MAIN, walletType: 'Main Wallet', status: 'active', freezeStatus: 'frozen_max_cap' },
    ], true, L8W_ACCOUNT_2);
    const s = cashOutDestinationSummary(dests);
    check('Main Wallet first', s.state === 'blocked' && s.destination.walletId === MAIN, s);
  }

  console.log('— no destination at all is left to the Transfer page —');
  {
    const s = cashOutDestinationSummary(cashOutDestinations(LIST.filter(w => w.walletType === 'Lana8Wonder'), true, L8W_ACCOUNT_2));
    check('reported as none, not blocked', s.state === 'none', s);
  }

  console.log(failures ? `\n❌ ${failures} FAILED, ${passes} passed` : `\n✅ all ${passes} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error('❌ test crashed:', err);
  process.exit(1);
});
