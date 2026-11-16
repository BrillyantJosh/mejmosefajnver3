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
 *
 * At most what is still missing (Brilly, 16. 11. 2026, "da vse po predlogu", point c): one
 * contribution may be at most goal − raised, in the request's currency and in the same cents —
 * at 1000 of 1300 EUR the most anyone may give is 300, not 1000 (which would end at 2000 of 1300).
 * The contribute form refuses more (ufAmountVerdict), and right before LANA is sent the fresh
 * answer is asked again: if others paid in between and the chosen amount is now more than what is
 * missing, nothing is sent and the person is told the new maximum (ufPreSendRefusal
 * 'over_remaining', ufFreshRemainingCents). The amount is never changed for them on the way.
 *
 * Rounding: what is RECORDED is the fiat amount the person chose — the `amount_fiat` tag of the
 * 60210, which the record route and the re-index both read as it is — never a value worked back
 * from LANA. The form passes that amount on in whole cents as it printed it (ufChosenFiat), so the
 * amount checked, shown, signed and summed is one number. LANA = fiat / rate is only what is sent:
 * the server rounds it to whole lanoshis (at most half a lanoshi either way), which moves
 * `amount_lanoshis`, never `amount_fiat`. So the conversion cannot push the recorded total above
 * the goal at all; only two payments passing their checks in the same moment can (a), and those
 * are recorded as they are.
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

/**
 * What is still missing to the goal, in cents: goal − raised as the page prints both, never below 0
 * (a request already at or over its goal has 0 missing). A goal that cannot be read (0, not a
 * number) gives null — there is no maximum that could honestly be shown, so nothing may be given.
 */
export function ufRemainingCents(totalFunded: unknown, fiatGoal: unknown): number | null {
  const goal = ufCents(fiatGoal);
  if (!(goal > 0)) return null;
  return Math.max(0, goal - ufCents(totalFunded));
}

/**
 * The amount the person typed, in whole cents as the form prints it — the one number that is
 * checked against what is missing, shown on the buttons, signed into the 60210 and recorded.
 * "300.004" is 300, "abc" is 0.
 */
export function ufChosenFiat(input: unknown): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
  return ufCents(n) / 100;
}

/** May this amount be given now? 'ok'; 'empty' (nothing, or under a cent); 'over' (more than is missing); 'no_goal'. */
export type UfAmountVerdict = 'ok' | 'empty' | 'over' | 'no_goal';

export function ufAmountVerdict(amount: unknown, totalFunded: unknown, fiatGoal: unknown): UfAmountVerdict {
  const remaining = ufRemainingCents(totalFunded, fiatGoal);
  if (remaining === null) return 'no_goal';
  const cents = ufCents(amount);
  if (!(cents > 0)) return 'empty';
  return cents > remaining ? 'over' : 'ok';
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

/**
 * Why nothing may be sent: the request could not be checked, is archived, not fundable, funded,
 * changed, or the chosen amount is now more than what is still missing.
 */
export type UfPreSendRefusal = 'unchecked' | 'archived' | 'not_fundable' | 'funded' | 'changed' | 'over_remaining';

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

/** What a fresh answer says was raised (the detail's own sum first), or null when it cannot be read. */
function freshRaised(fresh: UfFreshDetail | null | undefined): number | null {
  const now = fresh?.request;
  if (!now) return null;
  const raised = typeof fresh.totalFunded === 'number' ? fresh.totalFunded
    : typeof now.totalFunded === 'number' ? now.totalFunded
    : null;
  return raised === null || !Number.isFinite(raised) ? null : raised;
}

/** What a fresh answer says is still missing, in cents — the new maximum to tell the person. Null: cannot be read. */
export function ufFreshRemainingCents(fresh: UfFreshDetail | null | undefined): number | null {
  const raised = freshRaised(fresh);
  if (raised === null) return null;
  return ufRemainingCents(raised, fresh?.request?.fiatGoal);
}

/**
 * Right before any LANA is sent: may it be sent? `fresh` is GET /requests/:id asked again at that
 * moment (null when it could not be asked), `shown` is what the person confirmed — the receiving
 * wallet, the currency and the amount. Anything but null means nothing is sent. Totals, a goal or
 * an amount that cannot be read count as "could not check" (fail-closed). The amount is only ever
 * refused here, never changed: with 'over_remaining' the page tells the new maximum
 * (ufFreshRemainingCents) and the person chooses again.
 */
export function ufPreSendRefusal(
  fresh: UfFreshDetail | null | undefined,
  shown: { wallet: string; currency: string; fiatAmount: number },
): UfPreSendRefusal | null {
  const now = fresh?.request;
  if (!now) return 'unchecked';
  if (now.isArchived) return 'archived';
  if (!now.fundable) return 'not_fundable';
  const raised = freshRaised(fresh);
  if (raised === null) return 'unchecked';
  if (ufIsFullyFunded(raised, now.fiatGoal)) return 'funded';
  if (now.wallet !== shown.wallet || now.currency !== shown.currency) return 'changed';
  const verdict = ufAmountVerdict(shown.fiatAmount, raised, now.fiatGoal);
  if (verdict === 'over') return 'over_remaining';
  if (verdict !== 'ok') return 'unchecked';
  return null;
}
