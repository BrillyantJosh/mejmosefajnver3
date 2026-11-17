/**
 * The server's check of a Točka obilja order (KIND 36601) before it is
 * published (Brilly, 17. 11. 2026): the buyer must not pay more — or less —
 * than the Točka has published.
 *
 * Before margins the server published every order unread. Now an order routed
 * through a Točka is held against that Točka's newest KIND 30905:
 *   - its `margin_percent` must be the Točka's current margin (none = none);
 *   - with a margin, `pay_total` must be exactly what the order's own supplier
 *     prices and quantities give with that margin (foodCornerMargin.ts, the
 *     same code the browser signs with);
 *   - a Točka whose margin cannot be read takes no orders.
 * An order of before (no margin tags) to a Točka without a margin passes
 * exactly as before. An old page still open in a browser, which knows nothing
 * of margins, is refused at a Točka that has one — that is what this is for.
 *
 * When the Točka cannot be read (no relay answers in time, or the answering
 * relays do not hold it) nothing new is refused for an order of before: it
 * goes out as it always did. A margin order is then held only to its own
 * arithmetic (a readable margin, a pay_total its prices give). The Točka's
 * page marks an order whose margin is not the one the Točka had set before it
 * (FoodCornerEcoPoint.tsx), so a slip through here is seen where it is paid.
 *
 * The suppliers' prices themselves are not checked here (they never were);
 * the Točka's pages recompute every amount from the order's prices, and an
 * order whose `pay_total` does not add up is marked there.
 */
import { centsText, marginOfTags, payTotalCents } from '../../src/lib/foodCornerMargin.js';

export const FOOD_CORNER_ORDER_KIND = 36601;
export const FOOD_CORNER_NODE_KIND = 30905;

type Event = { kind: number; pubkey: string; created_at: number; tags: string[][] };

export type OrderCheck =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): OrderCheck => ({ ok: false, status, code, error });

/** The Točka an order is routed through, as [pubkey, d], or null. */
export function orderPointAddress(event: Event): [string, string] | null {
  const ref = event.tags?.find((tag) => tag[0] === 'distribution_point')?.[1] || '';
  const match = /^30905:([0-9a-f]{64}):(.+)$/.exec(ref);
  return match ? [match[1], match[2]] : null;
}

/**
 * Why an order does not fit the Točka's current margin, or null.
 * `pointMargin` is the Točka's margin as its newest 30905 says it (0 = none,
 * null = unreadable), or undefined when the Točka could not be read: then
 * only the order's own arithmetic is checked.
 */
export function orderMarginProblem(event: Event, pointMargin: number | null | undefined): OrderCheck {
  if (pointMargin === null) return refuse(409, 'FOOD_CORNER_POINT_MARGIN_UNREADABLE', "This Abundance point's margin cannot be read, so it takes no orders.");
  const orderMargin = marginOfTags(event.tags);
  const pays = (event.tags || []).filter((tag) => tag[0] === 'pay_total');
  if (orderMargin === null || pays.length > 1) return refuse(422, 'FOOD_CORNER_ORDER_MARGIN_INVALID', 'The margin on this order cannot be read.');
  if (pointMargin !== undefined && orderMargin !== pointMargin) return refuse(409, 'FOOD_CORNER_MARGIN_CHANGED', "The Abundance point's margin is not the one on this order. Reload the page and review the order.");
  if (!orderMargin) {
    // No margin: the order of before. A stray amount to pay would be read by no one the same way.
    if (pays.length) return refuse(422, 'FOOD_CORNER_ORDER_MARGIN_INVALID', 'An order without a margin carries no pay_total.');
    return { ok: true };
  }
  const total = (event.tags || []).find((tag) => tag[0] === 'total');
  const lines = (event.tags || []).filter((tag) => tag[0] === 'item').map((tag) => ({ price: tag[4] || '', qty: tag[2] || '' }));
  const pay = lines.length ? payTotalCents(lines, orderMargin) : null;
  const written = pays[0];
  if (pay === null || !written || written[1] !== centsText(pay) || (written[2] || '') !== (total?.[2] || 'EUR'))
    return refuse(422, 'FOOD_CORNER_PAY_TOTAL_MISMATCH', 'The amount to pay on this order is not what its prices and margin give.');
  return { ok: true };
}

/** The relay read the check needs: the newest events of a filter and how many relays answered. */
export type RelayRead = (filter: Record<string, unknown>) => Promise<{ events: Event[]; answered: number }>;

/**
 * The whole check for one event about to be published. Anything that is not a
 * Točka order passes untouched. The Točka is read from the relays the order is
 * published to; if none answers, the order is not published (it could not be
 * published there either) and the buyer tries again.
 */
export async function checkFoodCornerOrder(event: Event, read: RelayRead): Promise<OrderCheck> {
  if (!event || event.kind !== FOOD_CORNER_ORDER_KIND) return { ok: true };
  const address = orderPointAddress(event);
  if (!address) return { ok: true };
  const [pubkey, d] = address;
  const result = await read({ kinds: [FOOD_CORNER_NODE_KIND], authors: [pubkey], '#d': [d], limit: 10 }).catch(() => ({ events: [], answered: 0 }));
  const newest = result.events
    .filter((e) => e.kind === FOOD_CORNER_NODE_KIND && e.pubkey === pubkey && e.tags?.some((tag) => tag[0] === 'd' && tag[1] === d))
    .sort((a, b) => b.created_at - a.created_at)[0];
  // Not read (no answer, or not held): an order of before goes out as before; a margin order only by its own arithmetic.
  return orderMarginProblem(event, newest ? marginOfTags(newest.tags) : undefined);
}
