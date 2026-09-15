// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor — after changing, run scripts/syncBef.ts there.
/**
 * The cards page's own bookkeeping, in the browser: which changes wait to be
 * published, what a new list will hold, and the checks a card needs no server
 * for. Only hex ids pass through here — never a key.
 *
 * Waiting changes are kept in this tab's sessionStorage under the person's hex,
 * so a reload or a visit to another page of the site keeps them; they are gone
 * when the tab closes. Storage that is blocked or unreadable is not an error:
 * the changes then last as long as the page.
 */
import { MAX_CARDS } from '../../server/lib/cardListEvent.ts';

const HEX64 = /^[0-9a-f]{64}$/;

export type CardLocalVerdict = 'own' | 'alreadyYours' | 'alreadyPending' | 'monthlyLimit' | 'full' | 'ok';

/**
 * What can be said about a card before the server is asked, in this order:
 *   own            the signed-in person's own key
 *   alreadyYours   on the published list — also when waiting to be removed
 *                  ("Undo" on that change brings it back)
 *   alreadyPending already waiting to be added
 *   monthlyLimit   the cards waiting to be added already take every new card
 *                  the person may still add (`remaining`, from the server)
 *   full           the new list would hold more than MAX_CARDS
 */
export function checkCardLocally(
  hex: string,
  ctx: { self: string; published: readonly string[]; pendingAdds: readonly string[]; pendingRemoves: readonly string[]; remaining: number },
): CardLocalVerdict {
  if (hex === ctx.self) return 'own';
  if (ctx.published.includes(hex)) return 'alreadyYours';
  if (ctx.pendingAdds.includes(hex)) return 'alreadyPending';
  if (ctx.pendingAdds.length >= ctx.remaining) return 'monthlyLimit';
  const kept = ctx.published.filter((card) => !ctx.pendingRemoves.includes(card)).length;
  if (kept + ctx.pendingAdds.length >= MAX_CARDS) return 'full';
  return 'ok';
}

/** The list to sign: the published cards in their order without the removed
 * ones, then the new ones in the order they were added — each card once. */
export function nextCardList(published: readonly string[], pendingAdds: readonly string[], pendingRemoves: readonly string[]): string[] {
  const removed = new Set(pendingRemoves);
  const cards: string[] = [];
  const seen = new Set<string>();
  for (const card of [...published.filter((c) => !removed.has(c)), ...pendingAdds]) {
    if (seen.has(card)) continue;
    seen.add(card);
    cards.push(card);
  }
  return cards;
}

export const shortCardId = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-8)}`;

export interface PendingCards {
  adds: string[];
  removes: string[];
}

export const pendingStorageKey = (hex: string) => `bef_cards_pending:${hex}`;

/** Hex ids only, each once; anything else is dropped. */
const cleanIds = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && HEX64.test(v)))] : [];

/** The changes kept for `hex`. Never throws: unreadable or blocked storage keeps nothing. */
export function loadPendingCards(storage: () => Pick<Storage, 'getItem'>, hex: string): PendingCards {
  try {
    const raw = storage().getItem(pendingStorageKey(hex));
    if (raw == null) return { adds: [], removes: [] };
    const parsed = JSON.parse(raw) as { adds?: unknown; removes?: unknown } | null;
    return { adds: cleanIds(parsed?.adds), removes: cleanIds(parsed?.removes) };
  } catch {
    return { adds: [], removes: [] };
  }
}

/** Keep the changes for `hex`; none left removes the entry. Never throws. */
export function savePendingCards(storage: () => Pick<Storage, 'setItem' | 'removeItem'>, hex: string, pending: PendingCards): void {
  try {
    if (pending.adds.length === 0 && pending.removes.length === 0) storage().removeItem(pendingStorageKey(hex));
    else storage().setItem(pendingStorageKey(hex), JSON.stringify({ adds: pending.adds, removes: pending.removes }));
  } catch {
    // Storage blocked: the changes last as long as this page.
  }
}

/** Against the list as the server holds it now: an addition it already carries,
 * and a removal of a card it no longer carries, are no longer waiting. */
export function reconcilePending(pending: PendingCards, published: readonly string[]): PendingCards {
  const onList = new Set(published);
  return { adds: pending.adds.filter((card) => !onList.has(card)), removes: pending.removes.filter((card) => onList.has(card)) };
}
