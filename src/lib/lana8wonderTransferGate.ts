/**
 * May this Lana8Wonder account move its money?
 *
 * The plan page already knew how to draw a frozen account — it drew the freeze
 * correctly the whole time money was leaving one. What it did not do was treat
 * an unreadable answer as a reason to stop. `frozenAddresses` was built from
 * whatever the wallet list happened to contain, and an outage hands back an
 * empty list that is byte-identical to "this person has nothing frozen", so the
 * green Transfer button appeared on a wallet the registrar had frozen.
 *
 * So the question is answered in three values, never two. `clear` has to be
 * earned: it means a registrar list was actually read, it covers this address,
 * and neither the account nor the wallet carries a freeze. Everything else —
 * an outage, an empty list, an address the list does not mention, a freeze code
 * nobody has seen before — is `unknown` or `frozen`, and both keep the gate
 * shut. Silence is not consent.
 *
 * Deliberately per-wallet: a Lana8Wonder plan has eight accounts and freezing
 * one must not strand the other seven. The account-level `status` tag is the
 * exception, because that one is written about the person.
 *
 * scripts/testLana8WonderFreezeGate.ts pins all of it.
 */
import { freezeResolution, type FreezeResolution } from './freezeResolution';
import { freezeReasonLabel } from './voteEligibility';

/** Just enough of a registrar wallet entry to judge it. */
export interface GateCheckableWallet {
  walletId: string;
  walletType?: string;
  /** Account-level status tag: 'active' | 'frozen'. */
  status?: string;
  /** Per-wallet freeze code (KIND 30889 `w` tag, 7th field). */
  freezeStatus?: string;
}

export type TransferGateState = 'clear' | 'frozen' | 'unknown';

export interface TransferGate {
  state: TransferGateState;
  /** The registrar's freeze code, when there is one. */
  reason?: string;
  /** Set when the state is 'unknown' — which silence we are looking at. */
  unknownBecause?: 'unreachable' | 'no_wallet_list' | 'wallet_not_listed';
}

/**
 * `resolved` must be false whenever the registrar's list could not be read.
 * Note that it arriving as `true` is not by itself proof of a reading — the
 * wallet route answers `{success:true, wallets:[]}` on a total relay outage —
 * which is why an empty list is judged 'unknown' rather than 'clear'.
 */
export function lana8wonderTransferGate(
  wallets: GateCheckableWallet[] | null | undefined,
  resolved: boolean,
  sourceWalletId: string,
): TransferGate {
  if (!resolved) {
    return { state: 'unknown', unknownBecause: 'unreachable' };
  }

  const list = wallets || [];
  if (list.length === 0) {
    // Nothing was read. We cannot show this wallet is unfrozen, so we do not
    // claim it — and on this path the claim would move real money.
    return { state: 'unknown', unknownBecause: 'no_wallet_list' };
  }

  // Written about the person, so it covers every account in the plan.
  const accountFrozen = list.some(w => w.status === 'frozen');

  const entry = list.find(w => w.walletId === sourceWalletId);
  if (!entry) {
    // The list was read and does not mention this address. That is not a clean
    // bill of health for it; it is the absence of one.
    return accountFrozen
      ? { state: 'frozen', reason: 'frozen' }
      : { state: 'unknown', unknownBecause: 'wallet_not_listed' };
  }

  if (accountFrozen) {
    return { state: 'frozen', reason: entry.freezeStatus || 'frozen' };
  }

  // Any non-empty code counts, including one we do not recognise — the
  // registrar's own spec calls that the fail-safe reading.
  if (entry.freezeStatus) {
    return { state: 'frozen', reason: entry.freezeStatus };
  }

  return { state: 'clear' };
}

/** The gate itself. Only a positively clear reading opens it. */
export function mayTransfer(gate: TransferGate): boolean {
  return gate.state === 'clear';
}

/** One line saying why the gate is shut, or null when it is open. */
export function transferGateExplanation(gate: TransferGate): string {
  if (gate.state === 'clear') return '';

  if (gate.state === 'unknown') {
    return gate.unknownBecause === 'unreachable'
      ? 'This wallet’s freeze status could not be verified right now, so the transfer is on hold. Please try again in a moment.'
      : 'This wallet could not be found on the registrar’s list, so its freeze status cannot be confirmed and the transfer is on hold.';
  }

  return `This wallet is frozen by the registrar — ${freezeReasonLabel(
    gate.reason || 'frozen',
  )}. Outgoing transfers are disabled until it is released.`;
}

/**
 * Where this person actually goes next. Shared with the /wallet page so the two
 * screens cannot drift, and reason-aware for the same reason it is there: the
 * registrar's max-cap page asks for the whole balance, and a freeze it cannot
 * lift must never be sent to it. An unreadable state is not a max-cap freeze,
 * so it falls to registrar review.
 */
export function transferGateResolution(gate: TransferGate, walletId: string): FreezeResolution {
  return freezeResolution(gate.state === 'frozen' ? gate.reason || '' : '', walletId);
}
