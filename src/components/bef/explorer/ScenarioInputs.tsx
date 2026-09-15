import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencySymbol, fmtMoney } from "@/lib/bef/vendor/src/lib/format.ts";
import { cn } from "@/lib/utils";
import { ExplorerInfo } from "./ExplorerInfo";
import {
  CALC_CURRENCIES,
  CALC_ROUNDS,
  companyTradesIn,
  nextHasAnyPublished,
  roundIsOffered,
  type CalcScope,
  type ExplorerFigures,
  type PublishedLimit,
} from "./scenarioModel";
import { useExplorerText } from "./useExplorerText";

/** Radix Select has no empty value: "no company chosen" needs a word of its own. */
const NO_COMPANY = "none";

export interface ScenarioChoices {
  amount: string;
  currency: string;
  scope: CalcScope;
  round: number;
  sellerId: number | null;
  treasuryId: number | null;
}

/**
 * The calculator's inputs, as on BEF Explorer's /calculator
 * (bef-explorer src/components/Calculator.tsx:183-299): the co-creation
 * amount with the published limit that binds it, the currency, the split, the
 * purchase round, and the purchase and sale routes.
 *
 * Only what the published parameters cover can be chosen: a round without
 * room in this split and currency is shown but not offered, and the next split
 * only once its structure is published.
 */
export function ScenarioInputs({
  figures,
  choices,
  binding,
  overLimit,
  onAmount,
  onCurrency,
  onScope,
  onRound,
  onSeller,
  onTreasury,
}: {
  figures: ExplorerFigures;
  choices: ScenarioChoices;
  /** The smallest published limit for these choices, if any. */
  binding: PublishedLimit | null;
  /** The typed amount is above it. */
  overLimit: boolean;
  onAmount: (amount: string) => void;
  onCurrency: (currency: string) => void;
  onScope: (scope: CalcScope) => void;
  onRound: (round: number) => void;
  onSeller: (id: number | null) => void;
  onTreasury: (id: number | null) => void;
}) {
  const { t } = useExplorerText();
  const id = useId();
  const { amount, currency, scope, round, sellerId, treasuryId } = choices;
  const { splits } = figures;
  const currentSplit = figures.bootstrap.currentSplit ?? null;
  const nextPublished = nextHasAnyPublished(splits, currency);
  const unavailableRounds = CALC_ROUNDS.filter((n) => !roundIsOffered(splits, scope, currency, n));
  const sellerOptions = figures.sellers.filter((c) => companyTradesIn(c, currency));
  const treasuryOptions = figures.treasuries.filter((c) => companyTradesIn(c, currency));

  return (
    <Card>
      <CardContent className="grid gap-5 p-4 sm:grid-cols-2 sm:p-6">
        {/* ── amount, and the published limit that binds it ── */}
        <div className="space-y-2">
          <Label htmlFor={`${id}-amount`}>{t("calc.amount")}</Label>
          <div className="relative">
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              placeholder="1,000"
              aria-invalid={overLimit || undefined}
              aria-describedby={binding ? `${id}-limit` : undefined}
              className={cn("h-11 pr-12 text-base font-semibold tabular-nums", overLimit && "border-destructive focus-visible:ring-destructive")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-sm font-semibold text-muted-foreground">
              {currencySymbol(currency).trim()}
            </span>
          </div>
          {binding && (
            <div
              id={`${id}-limit`}
              className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed", overLimit ? "text-destructive" : "text-muted-foreground")}
            >
              <span>
                {overLimit ? t("calc.aboveLimit") : t("calc.publishedLimit")} {t(binding.key, binding.vars)}:{" "}
                <strong className={cn("tabular-nums", !overLimit && "text-foreground")}>{fmtMoney(binding.amount, currency)}</strong>
              </span>
              {overLimit && (
                <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => onAmount(String(binding.amount))}>
                  {t("calc.useMaximum")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── currency ── */}
        <div className="space-y-2">
          <Label id={`${id}-currency`}>{t("calc.currency")}</Label>
          <div role="group" aria-labelledby={`${id}-currency`} className="grid grid-cols-3 gap-2">
            {CALC_CURRENCIES.map((c) => (
              <Button
                key={c}
                type="button"
                variant={c === currency ? "default" : "outline"}
                aria-pressed={c === currency}
                className="h-11 font-semibold"
                onClick={() => onCurrency(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        {/* ── split ── */}
        <div className="space-y-2">
          <Label htmlFor={`${id}-split`}>{t("calc.split")}</Label>
          <Select value={scope} onValueChange={(value) => onScope(value === "next" ? "next" : "current")}>
            <SelectTrigger id={`${id}-split`} className="h-11 text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">
                {currentSplit ? t("calc.splitCurrentOpt", { number: currentSplit }) : t("calc.loadingSplit")}
              </SelectItem>
              {currentSplit != null && (
                <SelectItem value="next" disabled={!nextPublished}>
                  {t("calc.splitNextOpt", { number: currentSplit + 1 })}
                  {nextPublished ? "" : ` ${t("calc.splitNextUnpublished")}`}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {scope === "next" && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("calc.nextNote", { number: currentSplit != null ? currentSplit + 1 : "—" })}
            </p>
          )}
        </div>

        {/* ── purchase round ── */}
        <div className="space-y-2">
          <Label id={`${id}-round`}>{t("calc.round")}</Label>
          <div role="group" aria-labelledby={`${id}-round`} className="grid grid-cols-3 gap-2">
            {CALC_ROUNDS.map((n) => {
              const offered = !unavailableRounds.includes(n);
              return (
                <Button
                  key={n}
                  type="button"
                  variant={round === n ? "default" : "outline"}
                  aria-pressed={round === n}
                  disabled={!offered}
                  title={offered ? undefined : t("calc.roundUnavailableTitle")}
                  className="h-11 px-2 font-semibold"
                  onClick={() => onRound(n)}
                >
                  {t("splits.roundLabel", { round: n })}
                </Button>
              );
            })}
          </div>
          {/* A disabled button's title never shows on a phone: the reason is written out. */}
          {unavailableRounds.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {unavailableRounds.map((n) => t("splits.roundLabel", { round: n })).join(", ")}: {t("calc.roundUnavailableTitle")}
            </p>
          )}
        </div>

        {/* ── who you would buy from and sell to ── */}
        <CompanyChoice
          id={`${id}-seller`}
          label={t("calc.purchaseRoute")}
          info={t("calc.purchaseRouteInfo")}
          none={t("calc.noCompany")}
          value={sellerId}
          options={sellerOptions}
          onChange={onSeller}
        />
        <CompanyChoice
          id={`${id}-treasury`}
          label={t("calc.saleRoute")}
          info={t("calc.saleRouteInfo")}
          none={t("calc.noCompany")}
          value={treasuryId}
          options={treasuryOptions}
          onChange={onTreasury}
        />
      </CardContent>
    </Card>
  );
}

function CompanyChoice({
  id,
  label,
  info,
  none,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  info: string;
  none: string;
  value: number | null;
  options: ExplorerFigures["sellers"];
  onChange: (id: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <ExplorerInfo text={info} />
      </div>
      <Select value={value != null ? String(value) : NO_COMPANY} onValueChange={(next) => onChange(next === NO_COMPANY ? null : Number(next))}>
        <SelectTrigger id={id} className="h-11 text-left">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_COMPANY}>{none}</SelectItem>
          {options.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
