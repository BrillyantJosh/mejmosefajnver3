/**
 * Search over the offers of an Abundance point (Food Corner order tab).
 *
 * A buyer types a product ("granatno jabolko") or a supplier ("zakladnica dobrih
 * idej") and sees only the matching offers. Case and Slovenian diacritics are
 * ignored, so "cesen" finds "ČESEN" and "zakladnica" finds "ZAKLADNICA".
 *
 * Pure and dependency-free (no React, no relays): it only looks at offers that
 * are already loaded. It never touches the cart — that is keyed by offer ref in
 * the page, not by what is currently shown.
 *   npm run test:food-search
 */

/** Lower-case, strip diacritics (č→c, š→s, ž→z, ć→c, đ→d), squeeze whitespace, trim. */
export function normalizeSearchText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the (already normalised) query is a part of the product name or of
 * the supplier name. An empty query matches everything. `supplierName` is empty
 * when the supplier is not known — then only the product name can match.
 */
export function offerMatchesSearch(
  normalizedQuery: string,
  productName: string,
  supplierName?: string,
): boolean {
  if (!normalizedQuery) return true;
  return (
    normalizeSearchText(productName).includes(normalizedQuery) ||
    (!!supplierName && normalizeSearchText(supplierName).includes(normalizedQuery))
  );
}
