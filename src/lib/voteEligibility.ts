/**
 * Who may cast an acknowledgement in Lana Aligns World.
 *
 * Kept pure and in one file because two very different screens ask the same
 * question — the status page ("may I?") and the proposal page ("may this
 * click go through?") — and a rule that lives in two places drifts into two
 * rules. `scripts/testVoteEligibility.ts` pins the answers.
 *
 * A frozen person does not vote. Brilly, 2026-08-25.
 *
 * The freeze lives in KIND 30889 in two independent places:
 *   • the event's `status` tag  = 'frozen'  → the whole account
 *   • the `w` tag's 7th field              → that one wallet
 * Either one counts. The single frozen voter found in production carries
 * twelve wallet-level freezes and an `active` account status, so reading only
 * the account tag would have let them through.
 */

/** Just enough of a wallet to judge it — both wallet hooks satisfy this. */
export interface FreezeCheckableWallet {
  status?: string;
  freezeStatus?: string;
}

export type FreezeGateState = 'clear' | 'frozen' | 'unknown';

export interface FreezeGate {
  state: FreezeGateState;
  /** The registrar froze the account as a whole (`status` tag). */
  accountFrozen: boolean;
  frozenWallets: number;
  totalWallets: number;
  /** Distinct freeze codes found, for showing the person why. */
  reasons: string[];
  /** Set when the state is 'unknown' — says which silence we are looking at. */
  unknownBecause?: 'unreachable' | 'no_wallet_list';
}

/**
 * `resolved` must be false whenever the wallet list could not be read —
 * a relay timeout returns an empty array that is indistinguishable from an
 * honest "no wallets", and silence must never be reported as "not frozen".
 */
export function evaluateFreezeGate(
  wallets: FreezeCheckableWallet[] | null | undefined,
  resolved: boolean
): FreezeGate {
  if (!resolved) {
    return {
      state: 'unknown',
      accountFrozen: false,
      frozenWallets: 0,
      totalWallets: 0,
      reasons: [],
      unknownBecause: 'unreachable',
    };
  }

  const list = wallets || [];
  if (list.length === 0) {
    // Nothing to inspect. We cannot show this person is unfrozen, so we do
    // not claim it — the app already asks everyone to register a wallet.
    return {
      state: 'unknown',
      accountFrozen: false,
      frozenWallets: 0,
      totalWallets: 0,
      reasons: [],
      unknownBecause: 'no_wallet_list',
    };
  }

  const accountFrozen = list.some((w) => w.status === 'frozen');
  const frozen = list.filter((w) => !!w.freezeStatus);
  const reasons = Array.from(
    new Set(frozen.map((w) => w.freezeStatus as string).filter(Boolean))
  );

  return {
    state: accountFrozen || frozen.length > 0 ? 'frozen' : 'clear',
    accountFrozen,
    frozenWallets: frozen.length,
    totalWallets: list.length,
    reasons,
  };
}

/** The gate itself. Only a positively clear reading opens it. */
export function canVoteWith(gate: FreezeGate): boolean {
  return gate.state === 'clear';
}

/** Human-readable freeze codes, including the ones the registrar added later. */
export function freezeReasonLabel(code: string): string {
  switch (code) {
    case 'frozen_l8w': return 'Late wallet registration';
    case 'frozen_max_cap': return 'Maximum balance cap exceeded';
    case 'frozen_too_wild': return 'Irregular or suspicious activity';
    case 'frozen_unreg_Lanas': return 'Received unregistered LANA exceeding threshold';
    case 'frozen_own_person': return 'Frozen by the self-responsibility process';
    case 'frozen': return 'All accounts frozen by the registrar';
    default: return 'Frozen';
  }
}

/** One line explaining why the gate is shut, or null when it is open. */
export function freezeGateExplanation(gate: FreezeGate): string | null {
  if (gate.state === 'clear') return null;

  if (gate.state === 'unknown') {
    return gate.unknownBecause === 'no_wallet_list'
      ? 'No wallet list found for you, so your freeze status cannot be confirmed. Register a wallet to take part.'
      : 'Your freeze status could not be verified right now. Please try again in a moment.';
  }

  const why = gate.reasons.map(freezeReasonLabel).join(', ');
  if (gate.accountFrozen) {
    return `Your account is frozen${why ? ` — ${why}` : ''}. Frozen accounts cannot vote.`;
  }
  return `${gate.frozenWallets} of your ${gate.totalWallets} wallets ${
    gate.frozenWallets === 1 ? 'is' : 'are'
  } frozen${why ? ` — ${why}` : ''}. Frozen accounts cannot vote.`;
}
