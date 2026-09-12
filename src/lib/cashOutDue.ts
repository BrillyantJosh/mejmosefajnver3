/**
 * Whether a Lana8Wonder account still owes a cash-out — with money already on
 * its way subtracted first.
 *
 * The rule used to be one line in three places: balance > remaining × 1.02.
 * It reads the chain, and the chain is slow. Between pressing Transfer and the
 * transaction confirming, the balance can still look too high, the red "Cash
 * out required" alert stays up, and people pressed it again. Some sent their
 * surplus twice.
 *
 * The fix is not a timer that blindly hides the alert for a day. It is to
 * count what is already leaving:
 *
 *     effective balance = balance − what is on its way
 *     due               = effective balance > remaining × 1.02
 *
 * "On its way" is read from two independent places, because either alone has a
 * hole:
 *
 *   the chain   — Electrum reports a negative `unconfirmed` for an address
 *                 that has spent into the mempool, and `balance` already has
 *                 it subtracted. True on every device, no memory needed. Blind
 *                 for the seconds before the transaction propagates, and blind
 *                 if this Electrum does not report spends that way.
 *   the record  — what the app itself wrote down when the send went through:
 *                 wallet, amount, txid, when. Covers the propagation gap and
 *                 the seconds after broadcast. Kept on the server rather than
 *                 in the browser, so a send from a phone is known to a laptop.
 *
 * They are never counted twice: once the chain shows the spend, the record
 * stops being subtracted.
 *
 * A record does not expire the alert away forever. It is trusted for a day —
 * long enough for any Lana transaction to confirm, short enough that a
 * transfer which never landed comes back as due. And because the subtraction
 * happens before the comparison, a Split that doubles the balance while an old
 * cash-out is still in flight correctly shows as due again, rather than being
 * hidden by a timer.
 */

/** How long a recorded send is believed when the chain has not shown it yet. */
export const IN_FLIGHT_TRUSTED_MS = 24 * 60 * 60 * 1000;

/** The 2% tolerance the plan has always used, so dust never triggers a cash-out. */
export const CASH_OUT_TOLERANCE = 1.02;

export interface InFlightCashOut {
  walletId: string;
  /** LANA leaving the wallet, as recorded when the send went through. */
  amount: number;
  txid: string;
  /** Unix milliseconds. */
  sentAt: number;
}

export interface CashOutInput {
  /** confirmed + unconfirmed, as Electrum reports it. Undefined = not read. */
  balance?: number;
  /** Negative while a spend from this address sits in the mempool. */
  unconfirmedBalance?: number;
  /** What the plan says this account should hold after the cash-out. */
  expectedRemaining: number;
  /** The newest recorded send for this wallet, if any. */
  inFlight?: InFlightCashOut | null;
  /** Unix milliseconds. */
  now: number;
}

export type CashOutState =
  /** Over the line even after what is on its way — ask for a transfer. */
  | 'due'
  /** A transfer is on its way; nothing to ask for until it lands or expires. */
  | 'in_flight'
  /** Nothing owed. */
  | 'clear'
  /** The balance could not be read — say so, never ask and never reassure. */
  | 'unknown';

export interface CashOutVerdict {
  state: CashOutState;
  /** Balance minus what is on its way. */
  effectiveBalance: number;
  /** How much the effective balance is above the line; 0 when not due. */
  amountDue: number;
  /** The send being counted, when one is. */
  inFlight: InFlightCashOut | null;
  /** Whether the chain itself shows the money leaving. */
  chainShowsSpend: boolean;
}

export function evaluateCashOut(input: CashOutInput): CashOutVerdict {
  const { balance, unconfirmedBalance, expectedRemaining, now } = input;

  // A reading that never arrived is not a balance of zero. Nothing is asked
  // and nothing is promised.
  if (typeof balance !== 'number' || !Number.isFinite(balance)) {
    return {
      state: 'unknown',
      effectiveBalance: Number.NaN,
      amountDue: 0,
      inFlight: null,
      chainShowsSpend: false,
    };
  }

  const chainShowsSpend =
    typeof unconfirmedBalance === 'number' &&
    Number.isFinite(unconfirmedBalance) &&
    unconfirmedBalance < 0;

  const record = input.inFlight || null;
  const recordIsFresh =
    !!record &&
    Number.isFinite(record.sentAt) &&
    now - record.sentAt >= 0 &&
    now - record.sentAt < IN_FLIGHT_TRUSTED_MS;

  // Never both: `balance` already has the mempool spend in it, so subtracting
  // the record on top would hide a surplus that is genuinely still there.
  // A record whose amount is not a real number subtracts nothing: Math.max(0, NaN)
  // is NaN, which would make the comparison false and silence the alert on a
  // corrupt row rather than on money actually moving.
  const recordedAmount =
    recordIsFresh && Number.isFinite(record!.amount) ? Math.max(0, record!.amount) : 0;
  const onItsWay = chainShowsSpend ? 0 : recordedAmount;

  const effectiveBalance = balance - onItsWay;
  const line = Math.max(0, expectedRemaining) * CASH_OUT_TOLERANCE;
  const due = effectiveBalance > line;

  const activeRecord = recordIsFresh ? record : null;

  return {
    state: due ? 'due' : chainShowsSpend || recordIsFresh ? 'in_flight' : 'clear',
    effectiveBalance,
    amountDue: due ? effectiveBalance - Math.max(0, expectedRemaining) : 0,
    inFlight: activeRecord,
    chainShowsSpend,
  };
}
