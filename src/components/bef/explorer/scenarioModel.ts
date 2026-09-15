/**
 * The Explorer's calculator without React: what BEF Explorer's calculator
 * (bef-explorer src/components/Calculator.tsx) works out in the browser before
 * it asks the server — which rounds are offered, which published limits bind,
 * what "Express interest" carries — and the reads it makes.
 *
 * The scenario itself is BEF's. /api/scenario computes every figure and BEF is
 * the single mathematical authority; nothing here recomputes one. The limits
 * are read from BEF's published split parameters (/api/splits) the same way
 * BEF's own page reads them, and BEF refuses anything above them again.
 *
 * Each function names the Calculator.tsx lines it ports, and
 * scripts/testBefExplorer.ts fails when those lines change in BEF.
 *
 * Relative imports only, so the test script can load it without Vite.
 */
import { BefApiError, type BefClient, type Bootstrap, type Company, type ScenarioResponse, type SplitsResponse } from "../../../lib/bef/api";
import { prefillQuery } from "../../../lib/bef/prefill";
import { scenarioProblem, type BefProblem } from "../../../lib/bef/problems";
import type { InterestCurrency } from "../../../lib/bef/vendor/server/lib/interestEvent.ts";

/** Calculator.tsx:14 */
export const CALC_CURRENCIES = ["EUR", "GBP", "USD"] as const;
export const CALC_ROUNDS = [1, 2, 3] as const;

export type CalcScope = "current" | "next";

/** BEF's page starts at 1,000 EUR, round 1, the current split (Calculator.tsx:30-33). */
export const CALC_DEFAULTS = { amount: "1000", currency: "EUR", round: 1, scope: "current" as CalcScope };

/** What BEF's App loads once and hands the calculator (bef-explorer src/App.tsx:35-49). */
export interface ExplorerFigures {
  bootstrap: Bootstrap;
  splits: SplitsResponse | null;
  sellers: Company[];
  treasuries: Company[];
}

/**
 * The amount as the reader typed it, in their own way of writing numbers:
 * "10.000", "10,000" and "10 000" are ten thousand; "1000,50" and "1000.50"
 * are the same; "1.000,50" and "1,000.50" too. NaN when it is not a number.
 *
 * BEF reads the field as Number(the text without commas and spaces)
 * (Calculator.tsx:112). That turns "10.000" — how the limit line itself writes
 * ten thousand in Slovenian, German or Italian — into 10, and "12,5" into 125.
 * Here grouping is read as grouping, as the Interest page reads a whole amount
 * (src/lib/bef/prefill.ts parseWholeAmount), and a decimal comma as a decimal.
 * Whatever is read, the scenario says it back as "You pay".
 */
export function parseCalcAmount(text: string): number {
  const compact = text.replace(/[\s'\u2019\u00a0\u202f]/g, "");
  // Only grouping: 1,000 · 10.000 · 1,000,000
  if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) return Number(compact.replace(/[.,]/g, ""));
  // Plain, or one decimal separator of either kind: 1000 · 1000.5 · 1000,50
  if (/^\d+([.,]\d{1,2})?$/.test(compact)) return Number(compact.replace(",", "."));
  // Grouped with decimals, the two separators different: 1.000,50 · 1,000.50
  const grouped = /^(\d{1,3}(?:[.,]\d{3})+)([.,])(\d{1,2})$/.exec(compact);
  if (grouped) {
    const separators = new Set(grouped[1].replace(/\d/g, ""));
    if (separators.size === 1 && !separators.has(grouped[2])) return Number(`${grouped[1].replace(/[.,]/g, "")}.${grouped[3]}`);
  }
  return NaN;
}

/**
 * Whether a round can be chosen for this split and currency (Calculator.tsx:41-57).
 * Only what the published event covers is offered: a round published with size
 * 0 has no room in that currency, and one without both fees cannot be
 * calculated. Until the published parameters arrive, nothing is known to be
 * missing.
 */
export function roundIsOffered(splits: SplitsResponse | null, scope: CalcScope, currency: string, round: number): boolean {
  if (!splits) return true;
  if (scope === "next") {
    const row = (splits.next?.byCurrency?.[currency] ?? []).find((r) => r.round === round);
    return !!row && row.plannedIsPublished && (row.plannedMaxAmount ?? 0) > 0;
  }
  const row = (splits.current?.byCurrency?.[currency] ?? []).find((r) => r.round === round);
  return !!row && row.buyFeePercent != null && row.feePercent != null && row.maxFiat !== 0;
}

export const offeredRounds = (splits: SplitsResponse | null, scope: CalcScope, currency: string): number[] =>
  CALC_ROUNDS.filter((n) => roundIsOffered(splits, scope, currency, n));

/** The next split is offered once any of its rounds is published in this currency (Calculator.tsx:47). */
export const nextHasAnyPublished = (splits: SplitsResponse | null, currency: string): boolean =>
  (splits?.next?.byCurrency?.[currency] ?? []).some((r) => r.plannedIsPublished);

export interface PublishedLimit {
  /** The words, from BEF's own texts; `vars` fill them in. */
  key: "calc.limitSplitCeiling" | "calc.limitRoundSize" | "calc.limitPerPerson";
  vars: Record<string, string | number>;
  amount: number;
}

/**
 * The published ceilings that bind this exact combination, all of them from
 * KIND 38888 as BEF's server enforces them (Calculator.tsx:68-105): the split's
 * co-creation maximum, the round size, then the maximum per co-creator — in
 * that order, so on a tie the round size is the limit named, as on the server.
 */
export function publishedLimits(
  splits: SplitsResponse | null,
  scope: CalcScope,
  currency: string,
  round: number,
  currentSplit: number | null,
): PublishedLimit[] {
  const limits: PublishedLimit[] = [];
  if (scope === "current") {
    const ceiling = splits?.current?.maxInvestment?.[currency];
    if (ceiling) limits.push({ key: "calc.limitSplitCeiling", vars: { number: currentSplit ?? "—", currency }, amount: ceiling });
    const cur = (splits?.current?.byCurrency?.[currency] ?? []).find((r) => r.round === round);
    if (cur?.sizeIsPublished && cur.maxFiat != null && cur.maxFiat > 0) {
      limits.push({ key: "calc.limitRoundSize", vars: { round }, amount: cur.maxFiat });
    }
    if (cur?.maxPerPerson != null && cur.maxPerPerson > 0) {
      limits.push({ key: "calc.limitPerPerson", vars: { round }, amount: cur.maxPerPerson });
    }
  } else {
    const ceilingNext = splits?.next?.maxInvestment?.[currency];
    if (ceilingNext) limits.push({ key: "calc.limitSplitCeiling", vars: { number: splits?.next?.number ?? "—", currency }, amount: ceilingNext });
    const nxt = (splits?.next?.byCurrency?.[currency] ?? []).find((r) => r.round === round);
    if (nxt?.plannedIsPublished && nxt.plannedMaxAmount) {
      limits.push({ key: "calc.limitRoundSize", vars: { round }, amount: nxt.plannedMaxAmount });
    }
    if (nxt?.maxPerPerson != null && nxt.maxPerPerson > 0) {
      limits.push({ key: "calc.limitPerPerson", vars: { round }, amount: nxt.maxPerPerson });
    }
  }
  return limits;
}

/** The smallest published limit is the one the amount may not exceed; the first on a tie (Calculator.tsx:106-108). */
export const bindingLimit = (limits: PublishedLimit[]): PublishedLimit | null =>
  limits.length ? limits.reduce((a, b) => (b.amount < a.amount ? b : a)) : null;

/**
 * What "Express interest" carries to the Interest page (Calculator.tsx:115-123):
 * the split as a NUMBER — the Interest page knows splits by number, not as
 * current or next — the currency, the round and a whole amount.
 */
export function interestQuery({
  splits,
  scope,
  currentSplit,
  currency,
  round,
  amount,
}: {
  splits: SplitsResponse | null;
  scope: CalcScope;
  currentSplit: number | null;
  currency: string;
  round: number;
  amount: number;
}): string {
  const split = scope === "next" ? (splits?.next?.number ?? (currentSplit != null ? currentSplit + 1 : null)) : currentSplit;
  return prefillQuery({
    split,
    currency: currency as InterestCurrency,
    round,
    amount: Number.isFinite(amount) && amount >= 1 ? amount : null,
  });
}

/**
 * A company belongs in a route selector when it is active and actually trades
 * LANA in this currency (Calculator.tsx:167-173). It names who you would
 * transact with; the figures come from the published parameters either way.
 */
export const companyTradesIn = (company: Company, currency: string): boolean =>
  (company.currencies ?? [company.currency]).includes(currency) && String(company.asset).toUpperCase() === "LANA" && company.enabled === 1;

/* ─────────────────────────────────────────────────────────────── reads ── */

export type FiguresAnswer = { figures: ExplorerFigures } | { problem: BefProblem };

/**
 * BEF's App reads (src/App.tsx:35-49): the bootstrap, the splits and the
 * companies, each on its own. Without the bootstrap nothing can be calculated,
 * so its refusal is the answer; without the splits the calculator still runs
 * as BEF's does (every round offered, no limit line — the server still
 * refuses an amount above a limit); without the companies the route selectors
 * are empty.
 */
export async function loadFigures(client: Pick<BefClient, "figures">): Promise<FiguresAnswer> {
  let bootstrapError: unknown = null;
  const [bootstrap, splits, companies] = await Promise.all([
    client.figures.bootstrap().catch((err: unknown) => {
      bootstrapError = err;
      return null;
    }),
    client.figures.splits().catch(() => null),
    client.figures.companies().catch(() => null),
  ]);
  if (!bootstrap || typeof bootstrap !== "object") return { problem: scenarioProblem(bootstrapError) };
  const list = Array.isArray(companies?.companies) ? companies.companies : [];
  return {
    figures: {
      bootstrap,
      splits: splits && typeof splits === "object" ? splits : null,
      sellers: list.filter((c) => c.role === "seller"),
      treasuries: list.filter((c) => c.role === "treasury"),
    },
  };
}

export interface ScenarioInput {
  amountText: string;
  currency: string;
  round: number;
  scope: CalcScope;
  sellerId: number | null;
  treasuryId: number | null;
  /** The binding published limit, when the splits are known. */
  binding: PublishedLimit | null;
}

export type ScenarioOutcome =
  | { kind: "result"; scenario: ScenarioResponse }
  /** Not a positive number: nothing is asked. */
  | { kind: "enterPositive" }
  /** Above the binding published limit: refused here, before asking. */
  | { kind: "overLimit"; limit: PublishedLimit }
  /** Refused by BEF as above a published limit; `limit` is the amount it names. */
  | { kind: "aboveLimit"; limit: number | null }
  | { kind: "problem"; problem: BefProblem };

/** BEF changed what a scenario looks like: said as "MejmoSefajn is behind BEF Explorer". */
const UNREADABLE: BefProblem = { code: "unreadable_scenario", text: "door.behind", action: "openBef" };

const readableScenario = (answer: unknown): answer is ScenarioResponse => {
  const s = answer as ScenarioResponse | null;
  return (
    !!s &&
    typeof s === "object" &&
    !!s.input &&
    !!s.result &&
    typeof s.result.amount === "number" &&
    !!s.statuses &&
    Array.isArray(s.assumptions) &&
    Array.isArray(s.sources)
  );
};

/**
 * One scenario, as BEF's calculate() asks for it (Calculator.tsx:125-154). An
 * amount over the binding published limit is not sent; a refusal because the
 * amount is over a limit is not an outage, so it keeps the limit it names —
 * read from BEF's JSON answer, which BEF's own page never manages to read.
 */
export async function runScenario(client: Pick<BefClient, "figures">, input: ScenarioInput): Promise<ScenarioOutcome> {
  const value = parseCalcAmount(input.amountText);
  if (!Number.isFinite(value) || value <= 0) return { kind: "enterPositive" };
  if (input.binding && value > input.binding.amount) return { kind: "overLimit", limit: input.binding };
  try {
    const scenario = await client.figures.scenario({
      amount: value,
      currency: input.currency,
      round: input.round,
      split: input.scope,
      sellerId: input.sellerId,
      treasuryId: input.treasuryId,
    });
    return readableScenario(scenario) ? { kind: "result", scenario } : { kind: "problem", problem: UNREADABLE };
  } catch (err) {
    if (err instanceof BefApiError && err.code === "amount_above_limit") {
      return { kind: "aboveLimit", limit: typeof err.body.limit === "number" && Number.isFinite(err.body.limit) ? err.body.limit : null };
    }
    return { kind: "problem", problem: scenarioProblem(err) };
  }
}

/**
 * Whether a scenario on screen was asked for with other inputs than the ones
 * now chosen — it is shown dimmed until the new one arrives, never as the
 * answer to the new inputs.
 */
export function scenarioIsStale(scenario: ScenarioResponse | null, input: Omit<ScenarioInput, "binding">): boolean {
  if (!scenario) return false;
  const asked = scenario.input;
  return (
    asked.amount !== parseCalcAmount(input.amountText) ||
    asked.currency !== input.currency ||
    asked.round !== input.round ||
    asked.split !== input.scope ||
    (asked.sellerId ?? null) !== input.sellerId ||
    (asked.treasuryId ?? null) !== input.treasuryId
  );
}
