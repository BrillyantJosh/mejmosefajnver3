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

/**
 * Guard for a payment path: returns an error string when the wallet must not
 * send, or null when it may proceed.
 */
export async function blockIfFrozen(address: string, context: string): Promise<string | null> {
  const verdict = await getWalletFreezeStatus(address);
  if (verdict.frozen) {
    console.log(`🚫 BLOCKED ${context}: wallet ${address} is frozen (${verdict.reason})`);
    return 'This wallet is frozen. Outgoing transactions are disabled.';
  }
  if (!verdict.known) {
    console.log(`ℹ️ ${context}: freeze status undetermined for ${address} — allowing`);
  }
  return null;
}
