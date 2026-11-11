/**
 * Unconditional Financing — may the owner of a request that is already OPEN move
 * its receiving wallet to this address?
 *
 * Brilly, 11. 11. 2026: "naredi da tukaj lahko zamenja lastnik svojo denarnico iz
 * seznama" (/unconditional-financing/edit/…). Until then an open request's wallet
 * was pinned for good: an edit must never redirect contributions away from the
 * address people are giving to. The pin stays for everything but this: the new
 * address must be one of the OWNER'S OWN registered wallets — listed in the newest
 * wallet record (KIND 30889) the Lana Registrar signed for them, of a type that may
 * receive a financing (Main Wallet, Wallet, Lana.Discount — the form's own list),
 * and not frozen. Money can only move from one of the owner's wallets to another.
 *
 * Contributions are not tied to the request's wallet (each records its own
 * to_wallet), so one already on its way to the old address still counts.
 *
 * Three answers: yes, no (with why), and "could not tell" — the registry could not
 * be read. "Could not tell" never changes the wallet: the route says try again, the
 * relay indexer keeps the old one and asks again on its next scan.
 */
import { verifyEvent } from 'nostr-tools';
import type { RelayReader } from './ufEligibility.js';

export const UF_RECEIVING_WALLET_TYPES = ['Main Wallet', 'Wallet', 'Lana.Discount'];

export type WalletVerdict =
  | { ok: true; walletType: string }
  | { ok: false; reason: string }
  | { unknown: string };

type EventLike = { id?: string; kind?: number; pubkey?: string; created_at?: number; tags?: string[][]; content?: string; sig?: string };

const aboutPerson = (e: EventLike, pubkey: string): boolean =>
  Array.isArray(e.tags) && e.tags.some((t) =>
    (t[0] === 'd' && (t[1] === pubkey || t[1] === `wallet-list-${pubkey}`)) || (t[0] === 'p' && t[1] === pubkey));

/**
 * The verdict from the wallet records the relays returned (pure — tested on its own).
 * Only records about this person, signed (and verifiably so) by a registrar key, that
 * list wallets; the newest of those decides, as everywhere else in the app.
 */
export function judgeReceivingWallet(
  events: EventLike[],
  pubkey: string,
  walletId: string,
  registrarSigners: string[],
  verify: (e: EventLike) => boolean = (e) => { try { return verifyEvent(e as any); } catch { return false; } },
): WalletVerdict {
  if (registrarSigners.length === 0) return { unknown: 'no registrar key is known to check the wallet list against' };
  const lists = events
    .filter((e) => e && e.kind === 30889 && typeof e.pubkey === 'string' && registrarSigners.includes(e.pubkey))
    .filter((e) => aboutPerson(e, pubkey))
    .filter((e) => (e.tags || []).some((t) => t[0] === 'w'))
    .filter((e) => verify(e))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const newest = lists[0];
  if (!newest) return { ok: false, reason: 'This wallet is not one of your registered wallets.' };

  const accountFrozen = (newest.tags || []).find((t) => t[0] === 'status')?.[1] === 'frozen';
  const row = (newest.tags || []).find((t) => t[0] === 'w' && t[1] === walletId);
  if (!row) return { ok: false, reason: 'This wallet is not one of your registered wallets.' };
  const walletType = row[2] || '';
  if (!UF_RECEIVING_WALLET_TYPES.includes(walletType)) {
    return { ok: false, reason: `A financing cannot be received on a ${walletType || 'wallet of this kind'} wallet.` };
  }
  if (accountFrozen || (row[6] || '') !== '') return { ok: false, reason: 'This wallet is frozen and cannot receive a financing.' };
  return { ok: true, walletType };
}

/** The Lana Registrar's keys, from the stored (signed) KIND 38888. */
export function registrarSignersOf(db: any): string[] {
  try {
    const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    const listed = JSON.parse(row?.trusted_signers || '{}')?.LanaRegistrar;
    return Array.isArray(listed) ? listed.filter((k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k)) : [];
  } catch {
    return [];
  }
}

/** Reads the owner's wallet records from the relays and judges `walletId`. */
export async function checkOwnReceivingWallet(
  db: any,
  relays: string[],
  pubkey: string,
  walletId: string,
  read: RelayReader,
): Promise<WalletVerdict> {
  if (!relays.length) return { unknown: 'no relays are known' };
  const signers = registrarSignersOf(db);
  if (signers.length === 0) return { unknown: 'no registrar key is known to check the wallet list against' };
  const reads = await Promise.all([
    read(relays, { kinds: [30889], '#d': [pubkey], authors: signers }, 10000),
    read(relays, { kinds: [30889], '#d': [`wallet-list-${pubkey}`], authors: signers }, 10000),
    read(relays, { kinds: [30889], '#p': [pubkey], authors: signers }, 10000),
  ]);
  if (reads.every((r) => r.answered.length === 0)) return { unknown: 'no relay answered for the wallet list' };
  const byId = new Map<string, EventLike>();
  for (const r of reads) for (const e of r.events || []) if (e?.id) byId.set(e.id, e);
  return judgeReceivingWallet([...byId.values()], pubkey, walletId, signers);
}
