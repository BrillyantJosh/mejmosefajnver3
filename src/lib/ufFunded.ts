/**
 * Unconditional Financing — "Financiran / Funded".
 *
 * Jasna asked, Brilly confirmed (16. 11. 2026): once a request is funded, "Prispevaj" is no longer
 * active and the request reads "Financiran".
 *
 * Funded = what the page shows as raised reaches the goal the page shows. Both are compared in
 * cents, the way the page prints them (toFixed(2)), and the goal is the one the API returns — for
 * an approved request the amount PINNED at approval, in its currency (server/lib/ufApproval.ts).
 * "1300.00 of 1300.00" is funded, "1299.99 of 1300.00" is not, and a sum of contributions that
 * lands a float hair under the goal does not keep open a request the page prints as full.
 *
 * This is the APP's gate, where no LANA has moved yet: the list and the request page offer no
 * "Prispevaj", the contribute page shows no payment form, and right before LANA is sent the page
 * asks the server again (ufPreSendRefusal) and sends nothing once the goal is reached.
 *
 * The server is deliberately left as it was (16. 11. 2026, for Brilly to decide):
 *   • POST /contributions/record is called AFTER the LANA is on-chain, so refusing it there would
 *     not stop a payment — it would only leave money that already reached the owner unrecorded;
 *   • the relay re-index must keep counting every real contribution, also one that lands after
 *     the goal (two financiers paying in the same minute, or a 60210 published straight to the
 *     relays), so a refusing route would only disagree with the next scan.
 * Repayments do not look at any of this. scripts/testUfFunded.ts pins all of it.
 */

/** Cents, exactly as the page prints the amount (toFixed(2)). Anything that is not a number is 0. */
export function ufCents(amount: unknown): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number(n.toFixed(2)) * 100);
}

/** Has what was raised reached the goal? A request without a goal is never "funded". */
export function ufIsFullyFunded(totalFunded: unknown, fiatGoal: unknown): boolean {
  const goal = ufCents(fiatGoal);
  return goal > 0 && ufCents(totalFunded) >= goal;
}

interface UfFundedRequest {
  phase: string;
  fiatGoal: number;
}

/**
 * Does the request read "Financiran"? Open for funding (phase 'repaying') and the goal reached.
 * A repaid request reads "Poplačano" instead; one that waits or matures has nothing to close.
 */
export function ufReadsFunded(request: UfFundedRequest, totalFunded: unknown): boolean {
  return request.phase === 'repaying' && ufIsFullyFunded(totalFunded, request.fiatGoal);
}

/** What stands where "Prispevaj" stands: the button, the disabled "Financiran", or nothing. */
export type UfContributeCta = 'contribute' | 'funded' | 'none';

export function ufContributeCta(
  request: UfFundedRequest & { fundable: boolean; isArchived?: boolean },
  totalFunded: unknown,
  isRequester: boolean,
): UfContributeCta {
  // The author never funds their own request, and an archived one is open for nothing.
  if (isRequester || request.isArchived) return 'none';
  if (ufReadsFunded(request, totalFunded)) return 'funded';
  return request.fundable ? 'contribute' : 'none';
}

/** Why nothing may be sent: the request could not be checked, is archived, not fundable, funded, or changed. */
export type UfPreSendRefusal = 'unchecked' | 'archived' | 'not_fundable' | 'funded' | 'changed';

interface UfFreshDetail {
  request?: {
    fundable?: boolean;
    isArchived?: boolean;
    fiatGoal?: number;
    totalFunded?: number;
    wallet?: string;
    currency?: string;
  } | null;
  totalFunded?: number;
}

/**
 * Right before any LANA is sent: may it be sent? `fresh` is GET /requests/:id asked again at that
 * moment (null when it could not be asked), `shown` is what the person confirmed. Anything but null
 * means nothing is sent. Totals that cannot be read count as "could not check" (fail-closed).
 */
export function ufPreSendRefusal(
  fresh: UfFreshDetail | null | undefined,
  shown: { wallet: string; currency: string },
): UfPreSendRefusal | null {
  const now = fresh?.request;
  if (!now) return 'unchecked';
  if (now.isArchived) return 'archived';
  if (!now.fundable) return 'not_fundable';
  const raised = typeof fresh.totalFunded === 'number' ? fresh.totalFunded
    : typeof now.totalFunded === 'number' ? now.totalFunded
    : null;
  if (raised === null || !Number.isFinite(raised)) return 'unchecked';
  if (ufIsFullyFunded(raised, now.fiatGoal)) return 'funded';
  if (now.wallet !== shown.wallet || now.currency !== shown.currency) return 'changed';
  return null;
}
