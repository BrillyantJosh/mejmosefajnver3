/**
 * Is this wallet frozen? — answered from the ADDRESS alone.
 *
 * The existing freeze check ran only when a caller happened to send
 * `userPubkey`, because the wallet list (KIND 30889) is addressed by owner. Ten
 * of the app's thirteen payment paths never sent it, so a frozen wallet could
 * spend through almost every screen — selling on Lana.discount among them.
 *
 * Relays index single-letter tags, and a wallet-list entry carries the address
 * as the first value of its `w` tag, so the list can be found by address with
 * no idea who owns it. That makes the check impossible for a caller to skip.
 *
 * Verdict semantics: a wallet is blocked only when a trusted registrar's newest
 * list actually says it is frozen. If nothing can be determined — no list, an
 * unregistered address, relays unreachable — the payment proceeds, because
 * refusing every transaction whenever relays hiccup would be far worse than the
 * case this guards against. Indeterminate outcomes are logged.
 *
 * That last paragraph is the project-wide default and stays the default. What
 * changed: an indeterminate answer used to be one flat `known: false`, so a
 * caller who wanted to fail closed had nothing to fail closed ON. The read now
 * reports WHICH silence it hit — no relay answered, versus relays answered and
 * the list simply does not cover this address — and a caller may demand a
 * readable state with `requireKnownState`. The Lana8Wonder cash-out does.
 */
import { getDb } from '../db/connection.js';
import { queryEventsWithRelayStatus } from './nostr.js';
import { fetchBatchBalances } from './electrum.js';
import { freezeResolution } from '../../src/lib/freezeResolution.js';

export interface FreezeVerdict {
  /** True only when a trusted list positively says the wallet is frozen. */
  frozen: boolean;
  /** The registrar's freeze code, when there is one. */
  reason?: string;
  /** False when no trusted list covering this address could be read. */
  known: boolean;
  /**
   * True when NOT ONE relay answered, so nothing at all was read. Distinct
   * from `known: false` with relays answering, which means the list is real and
   * does not mention this address.
   */
  unreachable?: boolean;
  /** The registrar's own type for this wallet ('Lana8Wonder', 'Main Wallet', …). */
  walletType?: string;
}

function getRelays(): string[] {
  try {
    const row = getDb()
      .prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1')
      .get() as any;
    if (!row?.relays) return [];
    const parsed = JSON.parse(row.relays);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getTrustedRegistrars(): string[] {
  try {
    const row = getDb()
      .prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1')
      .get() as any;
    if (!row?.trusted_signers) return [];
    const parsed = JSON.parse(row.trusted_signers);
    return Array.isArray(parsed?.LanaRegistrar) ? parsed.LanaRegistrar : [];
  } catch {
    return [];
  }
}

export async function getWalletFreezeStatus(address: string): Promise<FreezeVerdict> {
  if (!address) return { frozen: false, known: false, unreachable: true };

  try {
    const relays = getRelays();
    // No relay list configured is not "nothing is frozen" — it is no reading.
    if (relays.length === 0) return { frozen: false, known: false, unreachable: true };

    // queryEventsWithRelayStatus, not queryEventsFromRelays: the latter drops
    // `answered` on the floor, and that is the only thing separating "the
    // registrar's list does not freeze this wallet" from "we never heard back".
    // Reading a freeze through the lossy one is how an outage came to look
    // exactly like a clean wallet.
    const { events, answered } = await queryEventsWithRelayStatus(relays, {
      kinds: [30889],
      '#w': [address],
    } as any);

    // An event in hand proves a relay delivered, whether or not its EOSE
    // arrived in time; only silence on every relay is an outage.
    const unreachable = answered.length === 0 && (events || []).length === 0;
    if (unreachable) return { frozen: false, known: false, unreachable: true };

    const trusted = getTrustedRegistrars();
    const lists = (events || [])
      .filter((e: any) => Array.isArray(e.tags) && e.tags.some((t: string[]) => t[0] === 'w'))
      .filter((e: any) => trusted.length === 0 || trusted.includes(e.pubkey))
      .sort((a: any, b: any) => b.created_at - a.created_at);

    if (lists.length === 0) return { frozen: false, known: false, unreachable: false };

    // The newest list from a trusted registrar is the authoritative one.
    const latest = lists[0];
    const entry = latest.tags.find((t: string[]) => t[0] === 'w' && t[1] === address);
    if (!entry) return { frozen: false, known: false, unreachable: false };

    // Account-level freeze covers every wallet; otherwise a per-wallet code
    // (7th field) freezes just this one. Any unrecognised non-empty code counts
    // as frozen — the fail-safe reading used elsewhere in the app.
    const accountFrozen =
      latest.tags.find((t: string[]) => t[0] === 'status')?.[1] === 'frozen';
    const perWallet = entry.length >= 7 ? entry[6] || '' : '';
    const walletType = entry[2] || '';

    if (accountFrozen) {
      return { frozen: true, known: true, reason: perWallet || 'frozen', walletType, unreachable: false };
    }
    if (perWallet) return { frozen: true, known: true, reason: perWallet, walletType, unreachable: false };
    return { frozen: false, known: true, walletType, unreachable: false };
  } catch (err) {
    console.warn(`⚠️ freeze check could not be completed for ${address}:`, err);
    return { frozen: false, known: false, unreachable: true };
  }
}

/** A frozen wallet may still spend this much: half its funds, and never over €100. */
export const FROZEN_SPEND_FRACTION = 0.5;
export const FROZEN_SPEND_MAX_EUR = 100;

/**
 * The capped amount a frozen wallet may still send, in LANA.
 *
 * Pure so the arithmetic can be tested on its own. A missing or nonsensical
 * rate yields 0 — no rate means no way to honour the €100 half of the rule,
 * and letting the cap default to "unlimited" would be the wrong direction for
 * a guard.
 */
export function frozenSpendCapLana(balanceLana: number, eurPerLana: number): number {
  if (!(balanceLana > 0) || !(eurPerLana > 0)) return 0;
  return Math.min(FROZEN_SPEND_FRACTION * balanceLana, FROZEN_SPEND_MAX_EUR / eurPerLana);
}

/** Electrum servers from KIND 38888, with the app's usual fallback trio. */
function getElectrumServers(): Array<{ host: string; port: number }> {
  try {
    const row = getDb()
      .prepare('SELECT electrum_servers FROM kind_38888 ORDER BY created_at DESC LIMIT 1')
      .get() as any;
    const parsed = row?.electrum_servers
      ? (typeof row.electrum_servers === 'string' ? JSON.parse(row.electrum_servers) : row.electrum_servers)
      : null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s: any) => ({ host: s.host, port: Number(s.port) }));
    }
  } catch {
    /* fall through to the defaults */
  }
  return [
    { host: 'electrum1.lanacoin.com', port: 5097 },
    { host: 'electrum2.lanacoin.com', port: 5097 },
    { host: 'electrum3.lanacoin.com', port: 5097 },
  ];
}

function getEurRate(): number {
  try {
    const row = getDb()
      .prepare('SELECT exchange_rates FROM kind_38888 ORDER BY created_at DESC LIMIT 1')
      .get() as any;
    if (!row?.exchange_rates) return 0;
    const parsed = typeof row.exchange_rates === 'string' ? JSON.parse(row.exchange_rates) : row.exchange_rates;
    const eur = Number(parsed?.EUR);
    return Number.isFinite(eur) && eur > 0 ? eur : 0;
  } catch {
    return 0;
  }
}

export interface FreezeGuardOptions {
  /**
   * The amount (LANA) this path wants to send. Supplying it opts the path into
   * the capped allowance: a frozen wallet may proceed while the amount stays
   * within `frozenSpendCapLana`. Paths that omit it keep the hard block.
   *
   * The cap is recomputed here from the wallet's own on-chain balance and the
   * published rate — never taken from the caller, which could otherwise name
   * its own limit.
   */
  cappedSpendLana?: number;
  /**
   * This request empties the wallet, so `cappedSpendLana` is NOT what will
   * leave it — the signer ignores the amount and sends the whole balance. An
   * allowance and a drain cannot both be true, so this cancels the allowance.
   */
  emptyingWallet?: boolean;
  /**
   * Refuse when the freeze state could not be read, instead of proceeding.
   * Off by default: refusing every payment on every relay hiccup would be
   * worse than the case this guards. On for paths where a wrong "allow" moves
   * an entire balance.
   */
  requireKnownState?: boolean;
}

/**
 * Wallet types the capped allowance never applies to.
 *
 * The allowance exists for one feature: PLAN15 letting a frozen wallet buy
 * unregistered LANA with up to half its funds and never more than €100. PLAN15
 * pays from Main Wallet, Wallet or Retail and never from a Lana8Wonder account,
 * so withholding the allowance here cannot cost it anything — while a
 * Lana8Wonder cash-out is a straight move of an annuity balance into a wallet
 * the same person holds, which is not a purchase and gets no allowance.
 */
export const NO_ALLOWANCE_WALLET_TYPES = new Set(['Lana8Wonder']);

export type FrozenSendDecision =
  | { outcome: 'allow' }
  | { outcome: 'refuse'; error: string }
  /** Frozen, but this path may still spend within its allowance — compute it. */
  | { outcome: 'check-cap' };

export interface FrozenSendContext {
  verdict: FreezeVerdict;
  amountLana?: number;
  emptyingWallet?: boolean;
  requireKnownState?: boolean;
  /** Only used to build the registrar link. */
  address?: string;
}

/** Where this wallet gets released, so a refusal is an instruction, not a wall. */
function registrarHelp(reason: string, address: string): string {
  return `Get it released at ${freezeResolution(reason, address).href}`;
}

/**
 * The whole freeze policy for a send, as a pure function — no relays, no
 * Electrum, no clock. Kept separate from `blockIfFrozen` so the rules can be
 * pinned by scripts/testLana8WonderFreezeGate.ts rather than trusted to a
 * reading of the code, which is how the emptyWallet hole survived review.
 */
export function decideFrozenSend(ctx: FrozenSendContext): FrozenSendDecision {
  const { verdict, amountLana, emptyingWallet, requireKnownState } = ctx;
  const address = ctx.address || '';

  if (verdict.frozen) {
    const reason = verdict.reason || 'frozen';
    const help = registrarHelp(reason, address);

    // A drain is not a capped spend. send-lana-transaction used to measure
    // `amount` against the allowance and then hand the request to a signer
    // that, in emptyWallet mode, ignores `amount` and sends the entire
    // balance — so naming a small amount bought an unlimited withdrawal.
    if (emptyingWallet) {
      return {
        outcome: 'refuse',
        error: `This wallet is frozen and cannot be emptied. ${help}`,
      };
    }

    if (verdict.walletType && NO_ALLOWANCE_WALLET_TYPES.has(verdict.walletType)) {
      return {
        outcome: 'refuse',
        error: `This ${verdict.walletType} wallet is frozen. Outgoing transfers are disabled. ${help}`,
      };
    }

    if (typeof amountLana === 'number' && Number.isFinite(amountLana) && amountLana > 0) {
      return { outcome: 'check-cap' };
    }

    return {
      outcome: 'refuse',
      error: `This wallet is frozen. Outgoing transactions are disabled. ${help}`,
    };
  }

  if (!verdict.known) {
    if (requireKnownState) {
      return {
        outcome: 'refuse',
        error:
          'This wallet’s freeze status could not be verified right now, so the transfer was not sent. ' +
          `Please try again in a moment. ${registrarHelp('', address)}`,
      };
    }
    return { outcome: 'allow' };
  }

  return { outcome: 'allow' };
}

/**
 * Guard for a payment path: returns an error string when the wallet must not
 * send, or null when it may proceed.
 */
export async function blockIfFrozen(
  address: string,
  context: string,
  options?: FreezeGuardOptions,
): Promise<string | null> {
  const verdict = await getWalletFreezeStatus(address);

  const decision = decideFrozenSend({
    verdict,
    address,
    amountLana: options?.cappedSpendLana,
    emptyingWallet: options?.emptyingWallet,
    requireKnownState: options?.requireKnownState,
  });

  if (decision.outcome === 'refuse') {
    console.log(
      `🚫 BLOCKED ${context}: ${address} — frozen=${verdict.frozen} reason=${verdict.reason} ` +
        `type=${verdict.walletType} known=${verdict.known} unreachable=${verdict.unreachable} ` +
        `empty=${!!options?.emptyingWallet}`,
    );
    return decision.error;
  }

  if (decision.outcome === 'check-cap') {
    const amount = options!.cappedSpendLana as number;
    const eurPerLana = getEurRate();
    let balance = 0;
    try {
      const balances = await fetchBatchBalances(getElectrumServers(), [address]);
      balance = balances?.[0]?.balance || 0;
    } catch (err) {
      console.warn(`⚠️ ${context}: balance unreadable for ${address}, capped spend refused:`, err);
    }
    const cap = frozenSpendCapLana(balance, eurPerLana);
    if (amount <= cap) {
      console.log(
        `⚠️ ALLOWED ${context}: frozen wallet ${address} sending ${amount} LANA within its ${cap.toFixed(8)} LANA cap`,
      );
      return null;
    }
    console.log(
      `🚫 BLOCKED ${context}: frozen wallet ${address} wanted ${amount} LANA, cap is ${cap.toFixed(8)} LANA`,
    );
    return `This wallet is frozen. It may still send up to ${cap.toFixed(8)} LANA (50% of funds, max €${FROZEN_SPEND_MAX_EUR}). ${registrarHelp(
      verdict.reason || 'frozen',
      address,
    )}`;
  }

  if (!verdict.known) {
    console.log(
      `ℹ️ ${context}: freeze status undetermined for ${address} (unreachable=${verdict.unreachable}) — allowing`,
    );
  }
  return null;
}
