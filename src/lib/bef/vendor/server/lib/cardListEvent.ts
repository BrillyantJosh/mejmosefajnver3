// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor — after changing, run scripts/syncBef.ts there.
/**
 * KIND 30971 — BEF Brought Cards. The ONE definition of the event, shared by
 * the server (which verifies and publishes) and the browser (which builds and
 * signs), so the two can never disagree about its shape.
 *
 * A person, signing with their own key, says: "these are the cards I brought
 * into the Circle of Abundance (Krog Obilja)". Each card is named ONLY by its
 * Nostr hex id. A card's key never signs anything; nothing in the event proves
 * that the signer ever held one. It is not a commission agreement and not the
 * card holder's consent: the card holder signs nothing.
 *
 * Addressable (NIP-33): one live list per person — `d` is always `cards`, so
 * adding or removing a card is a newer list. Who brought a card is decided by
 * BEF Explorer's register (./cardStore.ts), never by what relays hold.
 *
 * No Node or browser APIs (only @noble, pure JavaScript), so both sides can
 * import it.
 *
 * Canonical event (tags in exactly this order, each with exactly 2 strings):
 *
 *   ["d", "cards"]
 *   ["p", "<64 hex>"]                 0–100, one per card, in the order added
 *   ["alt", CARD_LIST_ALT]            (NIP-31), byte for byte
 *
 *   content = ""
 */

import { schnorr } from '@noble/curves/secp256k1.js';

export const CARD_LIST_KIND = 30971;
export const CARD_LIST_D = 'cards';
export const CARD_LIST_ALT = 'List of cards brought into the Circle of Abundance (BEF Explorer)';
/** The most cards one list holds (the owner's figure). A full list signs to
 * under 8 KB — far below any relay's event size limit. */
export const MAX_CARDS = 100;

// BEF Explorer's own acceptance limit — not part of the event definition. New
// cards are counted per person over a rolling window: every card an accepted
// list added counts, also one that was removed and added again.
export const MAX_NEW_CARDS_PER_30_DAYS = 10;
export const CARD_ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;

export type CardListShapeError =
  | 'wrong_kind'
  | 'malformed_tags'
  | 'bad_d'
  | 'bad_card'
  | 'duplicate_card'
  | 'too_many_cards'
  | 'non_canonical';

/** d, the cards in the order given (a later repeat is dropped), alt. */
export function buildCardListTags(cards: readonly string[]): string[][] {
  const tags: string[][] = [['d', CARD_LIST_D]];
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card)) continue;
    seen.add(card);
    tags.push(['p', card]);
  }
  tags.push(['alt', CARD_LIST_ALT]);
  return tags;
}

/** The unsigned template the browser signs. `created_at` is the caller's. */
export function buildCardListTemplate(
  cards: readonly string[],
  createdAt: number,
): { kind: number; created_at: number; tags: string[][]; content: string } {
  return { kind: CARD_LIST_KIND, created_at: createdAt, tags: buildCardListTags(cards), content: '' };
}

/**
 * Read an event's cards back, accepting ONLY the canonical form above. Anything
 * else is refused, never repaired. Signature and author are the caller's to
 * check; this checks shape — and that no card is the author.
 */
export function parseCardListEvent(event: {
  kind: unknown;
  pubkey: unknown;
  tags: unknown;
  content: unknown;
}): { ok: true; cards: string[] } | { ok: false; error: CardListShapeError } {
  if (event.kind !== CARD_LIST_KIND) return { ok: false, error: 'wrong_kind' };
  const tags = event.tags;
  if (
    !Array.isArray(tags) ||
    !tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string')) ||
    typeof event.content !== 'string' ||
    typeof event.pubkey !== 'string'
  ) {
    return { ok: false, error: 'malformed_tags' };
  }
  const list = tags as string[][];
  const first = list[0];
  if (!first || first.length !== 2 || first[0] !== 'd' || first[1] !== CARD_LIST_D) return { ok: false, error: 'bad_d' };

  const cards: string[] = [];
  const seen = new Set<string>();
  let i = 1;
  while (list[i]?.[0] === 'p') {
    const t = list[i];
    // Counted before the value is read: a list one card too long is too long,
    // whatever that card says.
    if (cards.length === MAX_CARDS) return { ok: false, error: 'too_many_cards' };
    // A third element would be read as a relay hint.
    if (t.length !== 2 || !HEX64.test(t[1]) || t[1] === event.pubkey) return { ok: false, error: 'bad_card' };
    if (seen.has(t[1])) return { ok: false, error: 'duplicate_card' };
    seen.add(t[1]);
    cards.push(t[1]);
    i += 1;
  }

  const alt = list[i];
  if (!alt || alt.length !== 2 || alt[0] !== 'alt' || alt[1] !== CARD_LIST_ALT) return { ok: false, error: 'non_canonical' };
  if (i + 1 !== list.length) return { ok: false, error: 'non_canonical' };
  if (event.content !== '') return { ok: false, error: 'non_canonical' };
  return { ok: true, cards };
}

/**
 * A card named by its Nostr hex id typed by hand, not worked out from its key:
 * 64 lowercase hex that is also a real public key — an x coordinate on the curve
 * (BIP-340). A typo is usually not one. Ids worked out from a key always are.
 */
export function isNostrPublicKey(hex: string): boolean {
  if (!HEX64.test(hex)) return false;
  try {
    schnorr.utils.lift_x(BigInt(`0x${hex}`));
    return true;
  } catch {
    return false;
  }
}

/** added: in `after` order; removed: in `before` order. */
export function diffCards(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const is = new Set(after);
  return { added: after.filter((card) => !was.has(card)), removed: before.filter((card) => !is.has(card)) };
}
