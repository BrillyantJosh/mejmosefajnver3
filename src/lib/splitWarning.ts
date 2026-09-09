/**
 * Whether to warn someone that their balance is over the Split cap.
 *
 * Two separate questions, deliberately kept apart:
 *
 *   overLimit — is the balance above the published cap? A fact about money,
 *               true whether or not anyone is being told about it.
 *   warn      — should the person be shown the warning right now?
 *
 * The second is governed by the authority's `split_approaching` flag in
 * KIND 38888. Brilly, 9 September 2026: when no Split is approaching, the
 * sign must not appear. It had been the other way round since 6 August —
 * shown whenever the balance was over, on the reasoning that being over is
 * the risk itself — and the owner of the system has decided otherwise.
 *
 * `overLimit` is returned alongside so the two questions never collapse into
 * one again — but no screen shows it while the flag is down: the rule is that
 * nothing appears, not that the wording softens.
 */

export interface SplitLimitVerdict {
  /** The published cap, or 0 when the authority has not set one. */
  limit: number;
  totalBalance: number;
  /** Above the cap — true regardless of whether a Split is near. */
  overLimit: boolean;
  /** Show the warning: over the cap AND a Split is approaching. */
  warn: boolean;
}

export function evaluateSplitLimit(
  limit: number,
  totalBalance: number,
  splitApproaching: boolean,
): SplitLimitVerdict {
  // No published cap means no measure to be over: the authority has not said
  // what the limit is, and a warning against an unknown number is noise.
  const published = Number.isFinite(limit) && limit > 0;
  const balance = Number.isFinite(totalBalance) ? totalBalance : 0;
  const overLimit = published && balance > limit;

  return {
    limit: published ? limit : 0,
    totalBalance: balance,
    overLimit,
    warn: overLimit && splitApproaching === true,
  };
}
