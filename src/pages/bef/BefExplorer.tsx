import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, HandHeart, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BefText } from "@/components/bef/BefText";
import { ExplorerInfo } from "@/components/bef/explorer/ExplorerInfo";
import { ScenarioAssumptions } from "@/components/bef/explorer/ScenarioAssumptions";
import { ScenarioInputs } from "@/components/bef/explorer/ScenarioInputs";
import { ScenarioLegs } from "@/components/bef/explorer/ScenarioLegs";
import { PublicInterestsList } from "@/components/bef/explorer/PublicInterestsList";
import {
  bindingLimit,
  CALC_DEFAULTS,
  interestQuery,
  offeredRounds,
  parseCalcAmount,
  publishedLimits,
  scenarioIsStale,
  type CalcScope,
  type ExplorerFigures,
  type PublishedLimit,
  type ScenarioOutcome,
} from "@/components/bef/explorer/scenarioModel";
import { useExplorerFigures, useScenario } from "@/components/bef/explorer/useExplorer";
import { useExplorerText } from "@/components/bef/explorer/useExplorerText";
import { BEF_PUBLIC_URL } from "@/lib/bef/base";
import { befClient } from "@/lib/bef/config";
import { offersBef, type BefProblem } from "@/lib/bef/problems";
import { fmtMoney } from "@/lib/bef/vendor/src/lib/format.ts";

const BEF_CALCULATOR_URL = `${BEF_PUBLIC_URL}/calculator`;

/**
 * Explorer — BEF Explorer's scenario calculator (befexplorer.com/calculator),
 * drawn in MejmoSefajn's look.
 *
 * Every figure is BEF's: the page reads BEF's public figures (bootstrap,
 * splits, companies) and asks BEF's /api/scenario for each result, straight
 * from this browser through the module's client — no token, no sign-in, and
 * nothing recomputed here. What it works out itself is only what BEF's own
 * page does before asking: which rounds are offered and which published limit
 * binds the amount (@/components/bef/explorer/scenarioModel.ts).
 *
 * "Express interest" opens the module's Interest page with the same query BEF
 * Explorer's calculator gives its own: split number, currency, round and a
 * whole amount. An interest is not an order, and nothing is sold here.
 *
 * At the foot of the page, who has already expressed interest — BEF's own
 * public list (GET /api/interests), as krogmenjave.com/povprasevanja shows it.
 *
 * Ported from bef-explorer src/pages/CalculatorPage.tsx and
 * src/components/Calculator.tsx; the order is phone first — inputs, then the
 * result, then what it rests on.
 */
export default function BefExplorer() {
  const { t } = useExplorerText();
  const { state, reload } = useExplorerFigures(befClient);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-semibold">{t("page.calcTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{t("page.calcSub")}</p>
      </div>

      <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs sm:text-sm font-semibold text-primary">
        <span className="min-w-0">{t("calc.banner")}</span>
        <ExplorerInfo text={t("calc.bannerInfo")} />
      </div>

      {state.kind === "loading" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{t("explorer.loading")}</span>
          </CardContent>
        </Card>
      )}

      {state.kind === "failed" && <FiguresProblem problem={state.problem} onRetry={reload} />}

      {state.kind === "ready" && <Calculator figures={state.figures} />}

      <ExplorerNotice />

      <PublicInterestsList client={befClient} />
    </div>
  );
}

function Calculator({ figures }: { figures: ExplorerFigures }) {
  const { t } = useExplorerText();
  const [amount, setAmount] = useState(CALC_DEFAULTS.amount);
  const [currency, setCurrency] = useState(CALC_DEFAULTS.currency);
  const [round, setRound] = useState(CALC_DEFAULTS.round);
  const [scope, setScope] = useState<CalcScope>(CALC_DEFAULTS.scope);
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [treasuryId, setTreasuryId] = useState<number | null>(null);

  const { splits } = figures;
  const currentSplit = figures.bootstrap.currentSplit ?? null;

  // Switching currency or split can leave the chosen round without room. Move
  // to the first round that has some rather than showing an error for a choice
  // the reader did not make (Calculator.tsx:61-66).
  const offered = offeredRounds(splits, scope, currency);
  const firstOffered = offered[0] ?? null;
  const selectedIsOffered = offered.includes(round);
  useEffect(() => {
    if (!selectedIsOffered && firstOffered != null) setRound(firstOffered);
  }, [selectedIsOffered, firstOffered]);

  // Kept as the same object while the limit is the same: the scenario is asked
  // for again only when something it depends on changed.
  const binding = useMemo(
    () => bindingLimit(publishedLimits(splits, scope, currency, round, currentSplit)),
    [splits, scope, currency, round, currentSplit],
  );
  const typedAmount = parseCalcAmount(amount);
  const overLimit = !!binding && Number.isFinite(typedAmount) && typedAmount > binding.amount;

  const { outcome, scenario, loading, recalculate } = useScenario(befClient, {
    amountText: amount,
    currency,
    round,
    scope,
    sellerId,
    treasuryId,
    binding,
  });
  const dimmed = loading || scenarioIsStale(scenario, { amountText: amount, currency, round, scope, sellerId, treasuryId });

  const query = interestQuery({ splits, scope, currentSplit, currency, round, amount: typedAmount });

  return (
    <div className="space-y-4">
      <ScenarioInputs
        figures={figures}
        choices={{ amount, currency, scope, round, sellerId, treasuryId }}
        binding={binding}
        overLimit={overLimit}
        onAmount={setAmount}
        onCurrency={(next) => {
          // A company chosen for one currency may not trade in the next.
          setCurrency(next);
          setSellerId(null);
          setTreasuryId(null);
        }}
        onScope={setScope}
        onRound={setRound}
        onSeller={setSellerId}
        onTreasury={setTreasuryId}
      />

      {outcome && outcome.kind !== "result" && (
        <ScenarioProblem
          outcome={outcome}
          binding={binding}
          currency={currency}
          onUseMaximum={(limit) => setAmount(String(limit))}
          onRetry={() => void recalculate()}
        />
      )}

      {/* The figures dim while they update; a screen reader hears it. */}
      <p className="sr-only" aria-live="polite">
        {loading ? t("explorer.updating") : ""}
      </p>

      <ScenarioLegs scenario={scenario} currency={currency} round={round} dimmed={dimmed} />

      {/* The figures follow every change, so this is no calculate button. It
          opens the non-binding interest page for the split NUMBER, currency,
          round and amount shown here — an interest is not an order, and
          nothing is sold here. */}
      <div className="space-y-2 pt-1">
        <Button asChild size="lg" className="h-12 w-full whitespace-normal sm:w-auto sm:min-w-[16rem]">
          <Link to={{ pathname: "/bef/interest", search: `?${query}` }}>
            <HandHeart className="h-4 w-4" />
            {t("calc.expressInterest")}
          </Link>
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("explorer.expressInterestNote")}</p>
      </div>

      <ScenarioAssumptions scenario={scenario} round={round} currentSplit={currentSplit} />
    </div>
  );
}

/**
 * Why there is no result, in BEF's words: an amount that is not a positive
 * number, an amount above a published limit (with the limit and a way to use
 * it), or the figures not being available right now.
 */
function ScenarioProblem({
  outcome,
  binding,
  currency,
  onUseMaximum,
  onRetry,
}: {
  outcome: Exclude<ScenarioOutcome, { kind: "result" }>;
  binding: PublishedLimit | null;
  currency: string;
  onUseMaximum: (limit: number) => void;
  onRetry: () => void;
}) {
  const { t } = useExplorerText();
  const limitHint = (limit: PublishedLimit) => `${t(limit.key, limit.vars)}: ${fmtMoney(limit.amount, currency)}.`;

  let text: string;
  let useMaximum: number | null = null;
  let problem: BefProblem | null = null;
  switch (outcome.kind) {
    case "enterPositive":
      text = t("calc.enterPositive");
      break;
    case "overLimit":
      text = `${t("calc.overLimit")} ${limitHint(binding ?? outcome.limit)}`;
      break;
    case "aboveLimit":
      // BEF refused it as above a limit the published splits here did not show:
      // say the amount BEF named, and offer it.
      if (binding) {
        text = `${t("calc.aboveLimitError")} ${limitHint(binding)}`;
      } else {
        text = outcome.limit != null ? `${t("calc.aboveLimitError")} ${fmtMoney(outcome.limit, currency)}.` : t("calc.aboveLimitError");
        useMaximum = outcome.limit;
      }
      break;
    case "problem":
      problem = outcome.problem;
      text = t(problem.text, problem.vars);
      break;
  }
  const tryAgain = problem?.action === "retry";
  const openOnBef = problem != null && offersBef(problem);

  return (
    <Alert variant={tryAgain ? "default" : "destructive"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p className="leading-relaxed">
          <BefText text={text} />
        </p>
        {(tryAgain || useMaximum != null || openOnBef) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {useMaximum != null && (
              <Button size="sm" variant="outline" onClick={() => onUseMaximum(useMaximum)}>
                {t("calc.useMaximum")}
              </Button>
            )}
            {tryAgain && (
              <Button size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("explorer.tryAgain")}
              </Button>
            )}
            {openOnBef && <OpenOnBef />}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The figures could not be read at all: nothing is shown rather than a wrong number. */
function FiguresProblem({ problem, onRetry }: { problem: BefProblem; onRetry: () => void }) {
  const { t } = useExplorerText();
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t("explorer.loadFailedTitle")}</AlertTitle>
      <AlertDescription>
        <p className="leading-relaxed">
          <BefText text={t(problem.text, problem.vars)} /> {t("explorer.loadFailed")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {problem.action !== "openBef" && (
            <Button size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("explorer.tryAgain")}
            </Button>
          )}
          <OpenOnBef />
        </div>
      </AlertDescription>
    </Alert>
  );
}

function OpenOnBef() {
  const { t } = useExplorerText();
  return (
    <Button asChild size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal py-2 text-left">
      <a href={BEF_CALCULATOR_URL} target="_blank" rel="noopener noreferrer">
        {t("explorer.openOnBef")}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </Button>
  );
}

/**
 * BEF Explorer's own words under the calculator: the result is a scenario,
 * not a promise (CalculatorPage.tsx), and BEF Explorer sells nothing and
 * advises no one (its site-wide disclaimer).
 */
function ExplorerNotice() {
  const { t } = useExplorerText();
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>{t("page.calcNoticeTitle")}</strong> {t("page.calcNotice")}
      </div>
      <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold text-foreground">{t("explorer.disclaimerTitle")}</p>
          <p className="mt-1">{t("explorer.disclaimer")}</p>
        </div>
      </div>
    </div>
  );
}
