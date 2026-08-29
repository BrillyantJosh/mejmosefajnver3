/**
 * Which SPLIT did this plan holder enter at, and on what terms?
 *
 * Derived from PRICE, never from dates. A KIND 88888 annuity plan is built
 * from one starting price, and every SPLIT has its own published reference
 * price for 1 LANA. Because a SPLIT doubles that reference value, a starting
 * price falls inside exactly one SPLIT's price band — so the entry SPLIT is a
 * fact that can be read back out of the plan, not a date that has to be
 * guessed at. That matters: a KIND 88888 event is re-published whenever the
 * plan changes, so its `created_at` is NOT the enrolment date. The price is.
 *
 * This is money history. Every branch below either returns a fact we can
 * point at, or refuses. There is no nearest-match, no fallback price table,
 * and no assumption that survives a contradiction in the published data.
 */

/** One published `split_price` row: value of 1 LANA in that currency AT that SPLIT. */
export interface SplitPriceRow {
  split: number;
  currency: string;
  price: number;
}

/** One published `split_history` row: when that SPLIT happened. */
export interface SplitHistoryRow {
  split: number;
  happenedAt: number;
}

/** The shape we need out of a KIND 88888 plan — structurally compatible with
 * the page's own AnnuityPlan, so no coupling to that interface. */
export interface PlanLevelLike {
  level_no: number;
  trigger_price: number;
}
export interface PlanAccountLike {
  account_id: number;
  levels: PlanLevelLike[];
}
export interface PlanLike {
  currency: string;
  accounts: PlanAccountLike[];
}

/** What the plan itself says about the holder's entry — no system data needed. */
export interface EntryTerms {
  /** Currency per 1 LANA the plan was built from, premium included. */
  startPrice: number;
  currency: string;
  /** What 100 units of that currency came to at that starting price. */
  lanaPerHundred: number;
}

/** Why a published ladder cannot be used to place someone's entry. */
export type LadderProblem = 'not-doubling' | 'contradicts-fx';

export type LadderReading =
  | {
      status: 'determined';
      split: number;
      /** Published reference value of 1 LANA at that SPLIT. */
      splitPrice: number;
      /** How far the plan's starting price sat above the reference, in percent. */
      premiumPercent: number;
      /** When that SPLIT happened, if published. */
      happenedAt: number | null;
    }
  | { status: 'no-parameters' }
  | { status: 'no-ladder' }
  | { status: 'ladder-inconsistent'; reason: LadderProblem }
  | { status: 'no-match' };

export type EntryReading =
  | { plan: 'unreadable' }
  | { plan: 'readable'; terms: EntryTerms; ladder: LadderReading };

/**
 * Plan trigger prices are stored to 5 decimals, so a value may sit up to 5e-6
 * away from the price it was built from. Everything else is float noise.
 */
const QUANTISATION = 5e-6;
const RELATIVE_EPS = 1e-6;

const isPositiveFinite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Round the way the plan generator does, so we can re-derive its own numbers. */
const toPlanPrecision = (n: number) => parseFloat(n.toFixed(5));

/**
 * The starting price of a plan, read back out of the plan itself.
 *
 * Account 1 is the linear account: its level i triggers at startPrice * i, so
 * level 1 IS the starting price. We only trust that reading if the whole
 * account still satisfies the linear rule (and, when account 2 is present,
 * that it sits at 10x — the generator's own relationship between accounts).
 * A plan that fails those checks is not the shape we know how to read, and we
 * say so rather than reporting a number we cannot vouch for.
 */
export function readStartPrice(plan: PlanLike | null | undefined): number | null {
  if (!plan || !Array.isArray(plan.accounts)) return null;

  const account1 = plan.accounts.find((a) => a?.account_id === 1);
  if (!account1 || !Array.isArray(account1.levels) || account1.levels.length === 0) return null;

  const first = account1.levels.find((l) => l?.level_no === 1);
  if (!first || !isPositiveFinite(first.trigger_price)) return null;
  const startPrice = first.trigger_price;

  for (const level of account1.levels) {
    if (!level || !Number.isFinite(level.level_no) || !isPositiveFinite(level.trigger_price)) return null;
    if (Math.abs(level.trigger_price - toPlanPrecision(startPrice * level.level_no)) > 1e-9) return null;
  }

  const account2 = plan.accounts.find((a) => a?.account_id === 2);
  if (account2) {
    const a2First = Array.isArray(account2.levels)
      ? account2.levels.find((l) => l?.level_no === 1)
      : undefined;
    if (!a2First || !isPositiveFinite(a2First.trigger_price)) return null;
    if (Math.abs(a2First.trigger_price - toPlanPrecision(startPrice * 10)) > 1e-9) return null;
  }

  return startPrice;
}

/** The published price ladder for one currency, lowest SPLIT first. */
export function buildLadder(rows: SplitPriceRow[] | null | undefined, currency: string): SplitPriceRow[] {
  if (!Array.isArray(rows) || !currency) return [];
  const wanted = currency.toUpperCase();
  const bySplit = new Map<number, SplitPriceRow>();
  for (const row of rows) {
    if (!row || String(row.currency ?? '').toUpperCase() !== wanted) continue;
    if (!Number.isInteger(row.split) || row.split < 1) continue;
    if (!isPositiveFinite(row.price)) continue;
    if (!bySplit.has(row.split)) bySplit.set(row.split, { split: row.split, currency: wanted, price: row.price });
  }
  return [...bySplit.values()].sort((a, b) => a.split - b.split);
}

/**
 * Is the published ladder safe to tell someone their own money history from?
 *
 * Two independent checks against the SAME published event:
 *  - a SPLIT doubles the reference value, so price must double per SPLIT step;
 *  - `split_price` is documented as the historical counterpart of the current
 *    `fx` tags, so the CURRENT split's entry must equal the current rate.
 *
 * If either fails, the published table contradicts itself and we refuse. We do
 * not repair it, and we do not fall back to a price table baked into this app.
 */
export function checkLadder(
  ladder: SplitPriceRow[],
  currentSplit: number | null,
  fxRate: number | null,
): LadderProblem | null {
  for (let i = 1; i < ladder.length; i++) {
    const prev = ladder[i - 1];
    const curr = ladder[i];
    const expected = prev.price * Math.pow(2, curr.split - prev.split);
    if (Math.abs(curr.price - expected) > expected * RELATIVE_EPS) {
      return 'not-doubling';
    }
  }

  if (currentSplit != null && isPositiveFinite(fxRate)) {
    const atCurrent = ladder.find((r) => r.split === currentSplit);
    if (atCurrent && Math.abs(atCurrent.price - fxRate) > fxRate * RELATIVE_EPS) {
      return 'contradicts-fx';
    }
  }

  return null;
}

/**
 * The one SPLIT whose price band contains this starting price.
 *
 * The band is [splitPrice, 2 * splitPrice) — exact interval containment, not a
 * nearest match. Because the ladder doubles, at most one SPLIT can qualify;
 * we still require exactly one and refuse otherwise.
 */
export function matchSplit(startPrice: number, ladder: SplitPriceRow[]): SplitPriceRow | null {
  if (!isPositiveFinite(startPrice) || ladder.length === 0) return null;
  // The quantisation allowance is added ONCE and then both bounds are tested
  // against that same value. Widening each end separately would overlap the
  // bands, and a starting price sitting exactly on a boundary — a plan bought
  // at a SPLIT's reference price with no premium — would match two SPLITs and
  // be thrown away as ambiguous.
  const adjusted = startPrice + QUANTISATION;
  const hits = ladder.filter(
    (row) =>
      adjusted >= row.price * (1 - RELATIVE_EPS) &&
      adjusted < row.price * 2 * (1 - RELATIVE_EPS),
  );
  return hits.length === 1 ? hits[0] : null;
}

export interface ResolveInput {
  plan: PlanLike | null | undefined;
  /** Published `split_price` rows, or null when KIND 38888 could not be read. */
  splitPrices: SplitPriceRow[] | null;
  splitHistory: SplitHistoryRow[] | null;
  /** Current SPLIT number from KIND 38888, for the fx cross-check. */
  currentSplit: number | null;
  /** Current published rate for the plan's currency, for the fx cross-check. */
  fxRate: number | null;
}

/**
 * Everything the screen needs. The plan's own terms (starting price, and what
 * 100 of the holder's currency came to at it) come straight from their plan
 * and never depend on system parameters. The SPLIT number does, and degrades
 * to a stated reason rather than a guess.
 */
export function resolveEntry({
  plan,
  splitPrices,
  splitHistory,
  currentSplit,
  fxRate,
}: ResolveInput): EntryReading {
  const startPrice = readStartPrice(plan);
  const currency = String(plan?.currency ?? '').toUpperCase();
  if (startPrice == null || !currency) return { plan: 'unreadable' };

  const terms: EntryTerms = { startPrice, currency, lanaPerHundred: 100 / startPrice };

  if (splitPrices == null) return { plan: 'readable', terms, ladder: { status: 'no-parameters' } };

  const ladder = buildLadder(splitPrices, currency);
  if (ladder.length === 0) return { plan: 'readable', terms, ladder: { status: 'no-ladder' } };

  const problem = checkLadder(ladder, currentSplit, fxRate);
  if (problem) {
    return { plan: 'readable', terms, ladder: { status: 'ladder-inconsistent', reason: problem } };
  }

  const hit = matchSplit(startPrice, ladder);
  if (!hit) return { plan: 'readable', terms, ladder: { status: 'no-match' } };

  const history = Array.isArray(splitHistory) ? splitHistory.find((h) => h?.split === hit.split) : undefined;
  const happenedAt = history && Number.isFinite(history.happenedAt) ? history.happenedAt : null;

  return {
    plan: 'readable',
    terms,
    ladder: {
      status: 'determined',
      split: hit.split,
      splitPrice: hit.price,
      premiumPercent: (startPrice / hit.price - 1) * 100,
      happenedAt,
    },
  };
}
