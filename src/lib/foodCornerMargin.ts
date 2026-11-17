/**
 * Točka obilja margin (Brilly, 17. 11. 2026).
 *
 * A Točka may add a margin of 1–20 % to the suppliers' prices: tag
 * `margin_percent` on its KIND 30905. Without one every price is 1:1 and an
 * order is exactly what it was before. With one, the KIND 36601 keeps the
 * suppliers' prices in `item` and `total` (what the suppliers get) and adds
 * `margin_percent` and `pay_total` (what the buyer pays at the Točka). The
 * Točka's KIND 36603 allocation of such an order carries the same two tags.
 *
 * Each unit price gets the margin on its own, in whole cents, half a cent up;
 * then the quantity, half a cent up. Only whole cents, never floating money.
 *
 * Twin: letsbalance-world apps/universal/lib/pointsOrder.ts. Both run the same
 * vectors: scripts/pointsMargin.vectors.json here = apps/universal/tests/
 * points-margin.vectors.json there (byte-identical). This file has no imports,
 * so the server check (server/lib/foodCornerOrderCheck.ts) runs the same code.
 */

export const FOOD_CORNER_MAX_MARGIN = 20;

/**
 * A margin in whole percent from a `margin_percent` value: absent or empty is
 * 0 (prices 1:1), "0"–"20" as written, anything else null — such a Točka takes
 * no orders, so no app guesses a different price than another.
 */
export function parseMarginPercent(raw: unknown): number | null {
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!value) return 0;
  return /^(0|[1-9]\d?)$/.test(value) && Number(value) <= FOOD_CORNER_MAX_MARGIN ? Number(value) : null;
}

/** The margin of a record's tags: none = 0, two of them = null (two prices, neither is taken). */
export function marginOfTags(tags: string[][] | undefined): number | null {
  const found = (tags || []).filter((tag) => tag[0] === "margin_percent");
  return found.length > 1 ? null : parseMarginPercent(found[0]?.[1]);
}

/** Whole cents of a price written with at most two decimals ("2.35", "4", "0.5"), else null. */
export function priceTextCents(text: string | undefined): number | null {
  const value = (text || "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, part = ""] = value.split(".");
  return Number(whole) * 100 + Number((part + "00").slice(0, 2));
}

/** A unit price with the margin, in whole cents, half a cent up (2.35 € + 20 % = 2.82 €; 7.99 € + 20 % = 9.588 → 9.59 €). */
export function withMarginCents(priceCents: number, margin: number): number {
  return Math.floor((priceCents * (100 + margin) + 50) / 100);
}

/** A unit price in cents times a quantity written in decimals ("2.5", "0.333"), half a cent up; null if the quantity is not a plain number. */
export function lineCentsOf(unitCents: number, qtyText: string | undefined): number | null {
  const value = (qtyText || "").trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, part = ""] = value.split(".");
  const numerator = BigInt(whole + part);
  const denominator = 10n ** BigInt(part.length);
  // round(a / b) half up for a, b ≥ 0 = floor((2a + b) / 2b)
  return Number((2n * BigInt(unitCents) * numerator + denominator) / (2n * denominator));
}

/** What the buyer pays, in cents, for lines of [supplier price text, quantity text] with a margin; null if a price or quantity cannot be read. */
export function payTotalCents(lines: { price: string; qty: string }[], margin: number): number | null {
  let sum = 0;
  for (const line of lines) {
    const price = priceTextCents(line.price);
    if (price === null) return null;
    const cents = lineCentsOf(withMarginCents(price, margin), line.qty);
    if (cents === null) return null;
    sum += cents;
  }
  return sum;
}

export const centsText = (cents: number) => (cents / 100).toFixed(2);

/**
 * The tags a KIND 36601 (or 36603) adds right after `total` for a margin:
 * none for 0, else `margin_percent` and `pay_total`. Throws if a line cannot
 * be priced, so an order never goes out with an amount nobody can recompute.
 */
export function marginTags(lines: { price: string; qty: string }[], margin: number, currency: string): string[][] {
  if (!margin) return [];
  const pay = payTotalCents(lines, margin);
  if (pay === null) throw new Error("A price or quantity cannot be read, so the amount to pay cannot be computed.");
  return [["margin_percent", String(margin)], ["pay_total", centsText(pay), currency]];
}
