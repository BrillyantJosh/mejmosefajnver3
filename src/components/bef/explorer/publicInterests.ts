/**
 * The public list of expressed interests, without React: what of BEF's
 * GET /api/interests a reader is shown, and in which order.
 *
 * BEF Explorer is the only source. It sends the current split (and the next
 * one once somebody has expressed interest in it), every round of each, the
 * name from each person's own public profile, their shortened key, the amount
 * and when they signed — never a whole key, a wallet, an e-mail, a telephone
 * or a country. Nothing here is recomputed: only chosen and ordered.
 *
 * Relative imports only, so scripts/testBefExplorer.ts can run it against BEF
 * Explorer's own route where bef-explorer is at hand.
 */
import type { PublicInterestEntry, PublicInterestRound, PublicInterestSplit, PublicInterests } from '../../../lib/bef/api';
import type { InterestCurrency } from '../../../lib/bef/vendor/server/lib/interestEvent.ts';

/**
 * The rounds of a split that get a block: those somebody is in, and those open
 * for interest — an open round with nobody in it says so, and invites the
 * first. A round that is closed and empty is left out; it has nothing to say.
 */
export const roundsToShow = (split: PublicInterestSplit): PublicInterestRound[] =>
  split.rounds.filter((r) => r.entries.length > 0 || r.openForInterest).sort((a, b) => a.round - b.round);

/** A split with nobody in any round: the page says so instead of three empty rounds. */
export const splitIsEmpty = (split: PublicInterestSplit): boolean => split.rounds.every((r) => r.entries.length === 0);

/** Somebody's amount no longer fits the limits published now: the note under the list is shown. */
export const anyBeyondLimit = (data: PublicInterests): boolean =>
  data.splits.some((s) => s.rounds.some((r) => r.entries.some((e) => e.beyondLimit)));

/** The totals of one round, per currency, biggest first — never added across currencies. */
export const roundTotals = (round: PublicInterestRound): { currency: InterestCurrency; amount: number }[] =>
  (Object.entries(round.totals) as [InterestCurrency, number][])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => ({ currency, amount }));

/**
 * One row per entry, in BEF's order (earliest signature first). The key is
 * BEF's shortened one, so two people are told apart even when both published
 * the same name — or none.
 */
export const entryKey = (entry: PublicInterestEntry, index: number): string => `${entry.key}-${entry.currency}-${index}`;
