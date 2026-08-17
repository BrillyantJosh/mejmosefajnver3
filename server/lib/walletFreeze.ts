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
 */
import { getDb } from '../db/connection.js';
import { queryEventsFromRelays } from './nostr.js';
import { fetchBatchBalances } from './electrum.js';

export interface FreezeVerdict {
  /** True only when a trusted list positively says the wallet is frozen. */
  frozen: boolean;
  /** The registrar's freeze code, when there is one. */
  reason?: string;
  /** False when no trusted list covering this address could be read. */
  known: boolean;
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
  if (!address) return { frozen: false, known: false };

  try {
    const relays = getRelays();
    if (relays.length === 0) return { frozen: false, known: false };

    const events = await queryEventsFromRelays(relays, {
      kinds: [30889],
      '#w': [address],
    } as any);

    const trusted = getTrustedRegistrars();
    const lists = (events || [])
      .filter((e: any) => Array.isArray(e.tags) && e.tags.some((t: string[]) => t[0] === 'w'))
      .filter((e: any) => trusted.length === 0 || trusted.includes(e.pubkey))
      .sort((a: any, b: any) => b.created_at - a.created_at);

    if (lists.length === 0) return { frozen: false, known: false };

    // The newest list from a trusted registrar is the authoritative one.
    const latest = lists[0];
    const entry = latest.tags.find((t: string[]) => t[0] === 'w' && t[1] === address);
    if (!entry) return { frozen: false, known: false };

    // Account-level freeze covers every wallet; otherwise a per-wallet code
    // (7th field) freezes just this one. Any unrecognised non-empty code counts
    // as frozen — the fail-safe reading used elsewhere in the app.
    const accountFrozen =
      latest.tags.find((t: string[]) => t[0] === 'status')?.[1] === 'frozen';
    const perWallet = entry.length >= 7 ? entry[6] || '' : '';

    if (accountFrozen) return { frozen: true, known: true, reason: perWallet || 'frozen' };
    if (perWallet) return { frozen: true, known: true, reason: perWallet };
    return { frozen: false, known: true };
  } catch (err) {
    console.warn(`⚠️ freeze check could not be completed for ${address}:`, err);
    return { frozen: false, known: false };
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
  if (verdict.frozen) {
    const amount = options?.cappedSpendLana;
    if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
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
      return `This wallet is frozen. It may still send up to ${cap.toFixed(8)} LANA (50% of funds, max €${FROZEN_SPEND_MAX_EUR}).`;
    }
    console.log(`🚫 BLOCKED ${context}: wallet ${address} is frozen (${verdict.reason})`);
    return 'This wallet is frozen. Outgoing transactions are disabled.';
  }
  if (!verdict.known) {
    console.log(`ℹ️ ${context}: freeze status undetermined for ${address} — allowing`);
  }
  return null;
}
