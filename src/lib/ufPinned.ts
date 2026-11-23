/**
 * Unconditional Financing — "Na vrh" (Jasna asked, Brilly approved, 23. 11. 2026).
 *
 * An administrator (the same people who approve requests) may put a request on top of the
 * "Odprti" tab. Pinned requests come first, marked 📌; with several, the one put on top most
 * recently is highest. Every other request keeps the order it already had. Display order only:
 * nothing about amounts, funding, statuses or repayments reads this, and the other tabs keep
 * their order. The server records it (POST /requests/:id/pin, signed, administrators only).
 */

/** Is the request on top? */
export function ufIsPinned(request: { pinnedAt?: number | null }): boolean {
  return typeof request.pinnedAt === 'number' && Number.isFinite(request.pinnedAt) && request.pinnedAt > 0;
}

/**
 * The "Odprti" order: pinned first (most recently pinned highest), then the rest exactly in the
 * order given. Returns a new array; the input is not changed.
 */
export function ufOpenOrder<T extends { pinnedAt?: number | null }>(requests: readonly T[]): T[] {
  const pinned = requests
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => ufIsPinned(r))
    // Most recently pinned first; the same second keeps the order it had.
    .sort((a, b) => (b.r.pinnedAt as number) - (a.r.pinnedAt as number) || a.i - b.i)
    .map(({ r }) => r);
  const rest = requests.filter((r) => !ufIsPinned(r));
  return [...pinned, ...rest];
}
