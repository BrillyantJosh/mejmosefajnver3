import { useId, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n/I18nContext";
import befInterestText from "@/i18n/modules/befInterest";
import type { InterestView, InterestWindow } from "@/lib/bef/api";
import { BEF_PUBLIC_URL } from "@/lib/bef/base";
import { INTEREST_CURRENCIES, roundLimit, type InterestCurrency } from "@/lib/bef/vendor/server/lib/interestEvent.ts";
import { currencySymbol, fmtDateTime, fmtMoney } from "@/lib/bef/vendor/src/lib/format.ts";
import { cn } from "@/lib/utils";
import { BefText } from "../BefText";
import { NonBindingNotice } from "./NonBindingNotice";
import {
  beyondLimits,
  droppedRounds,
  limitMessage,
  offeredIn,
  readInterestForm,
  sentText,
  type InterestEditor,
  type InterestOutcome,
  type InterestProblem,
} from "./interestModel";

/**
 * One split on the Interest page: the interest the person holds there (with
 * Change and Withdraw), and — while the split is open — the form: a currency,
 * one whole amount per open round within its published limit, the split's
 * co-creation maximum, the total, and what does not fit, said before anything
 * is signed. Below it, BEF's answer: how many relays took the event, or why
 * nothing was sent.
 *
 * Ported from the card in bef-explorer src/components/person/InterestForm.tsx;
 * the reasoning is in ./interestModel.ts, the sending in ./InterestForm.tsx.
 */
export function InterestSplitCard({
  win,
  existing,
  editor,
  wallet,
  paramsEventId,
  busy,
  locked,
  outcome,
  problem,
  onPatch,
  onSend,
  onChange,
  onWithdraw,
}: {
  win: InterestWindow;
  /** What BEF holds for the person in this split, whatever its status. */
  existing: InterestView | undefined;
  editor: InterestEditor;
  wallet: string;
  paramsEventId: string;
  /** This split is being signed and sent. */
  busy: boolean;
  /** Some split is being sent: one at a time. */
  locked: boolean;
  outcome: InterestOutcome | undefined;
  problem: InterestProblem | undefined;
  onPatch: (patch: Partial<InterestEditor>) => void;
  onSend: () => void;
  onChange: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation(befInterestText);
  const id = useId();

  const active = existing?.status === "active";
  const showForm = win.open && (!existing || existing.status === "withdrawn" || editor.editing);
  const openRounds = win.rounds.filter((r) => r.open).sort((a, b) => a.round - b.round);
  const form = readInterestForm(win, editor, wallet, paramsEventId);
  const capacity = win.capacity?.[editor.currency] ?? null;
  const total = form.draft.rounds.reduce((sum, r) => sum + r.amount, 0);
  const dropped = editor.editing && active ? droppedRounds(existing, win, editor.currency) : [];
  const beyond = active && !editor.editing ? beyondLimits(existing, win, wallet, paramsEventId) : [];

  // A late answer says "check below" / "shown below": true only when it is said
  // above the interest it points at, so those two go to the top of the card.
  const lateProblem = problem?.code === "outcome_unknown";
  const lateOutcome = outcome != null && outcome.relays == null;

  const limitList = (errors: typeof beyond, currency: InterestCurrency) => (
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      {errors.map((e, i) => {
        const message = limitMessage(e, currency);
        return <li key={i}>{t(message.key, message.vars)}</li>;
      })}
    </ul>
  );

  // "It may have gone through" is not a refusal: said plainly, not in red.
  const problemBox = problem && (
    <Alert variant={lateProblem ? "default" : "destructive"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p>
          <BefText text={t(problem.text, problem.vars)} />
        </p>
        {problem.limits && problem.limits.length > 0 && limitList(problem.limits, problem.currency ?? editor.currency)}
        {problem.openBef && (
          <Button asChild size="sm" variant="outline" className="mt-3">
            <a href={BEF_PUBLIC_URL} target="_blank" rel="noopener noreferrer">
              {t("door.openBef")}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );

  const outcomeBox = outcome && (
    <div role="status" className="flex gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="min-w-0">
        <p className="font-medium">
          {outcome.relays ? t(sentText(outcome.status), outcome.relays) : t("interest.arrived")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("interest.eventId")}: <code className="break-all font-mono">{outcome.eventId}</code>
        </p>
      </div>
    </div>
  );

  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id={`${id}-title`} className="text-lg sm:text-xl">
            {t("interest.splitTitle", { number: win.split })}
          </CardTitle>
          <Badge variant="outline">{t(win.scope === "next" ? "interest.scopeNext" : "interest.scopeCurrent")}</Badge>
          <Badge
            variant="secondary"
            className={cn(win.open && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}
          >
            {t(win.open ? "interest.openChip" : "interest.closedChip")}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {lateProblem && problemBox}
        {lateOutcome && outcomeBox}

        {existing && !editor.editing && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t("interest.yours")}</span>
              <Badge
                variant="secondary"
                className={cn(active && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}
              >
                {t(active ? "interest.statusActive" : "interest.statusWithdrawn")}
              </Badge>
            </div>

            {active ? (
              <dl className="space-y-1 text-sm">
                {existing.rounds.map((r) => (
                  <Row key={r.round} label={t("interest.round", { round: r.round })}>
                    {fmtMoney(r.amount, existing.currency)}
                  </Row>
                ))}
                <Row label={t("interest.total")} strong>
                  {fmtMoney(existing.total, existing.currency)}
                </Row>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("interest.withdrawnNote")}</p>
            )}

            <p className="text-xs text-muted-foreground">
              {t("interest.signedOn", { date: fmtDateTime(existing.createdAt) })} ·{" "}
              {existing.relaysAccepted != null && existing.relaysTotal != null && (
                <>{t("interest.relays", { accepted: existing.relaysAccepted, total: existing.relaysTotal })} · </>
              )}
              {t("interest.eventId")}{" "}
              <code className="font-mono" title={existing.eventId}>
                {existing.eventId.slice(0, 12)}…
              </code>
            </p>

            {active && !win.open && <p className="text-sm text-muted-foreground">{t("interest.closedNote")}</p>}

            {beyond.length > 0 && (
              <Alert role="status">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t("interest.beyondNow")}
                  {limitList(beyond, existing.currency)}
                </AlertDescription>
              </Alert>
            )}

            {active && (
              <div className="flex flex-wrap gap-2">
                {win.open && (
                  <Button type="button" size="sm" variant="outline" onClick={onChange} disabled={locked}>
                    {t("interest.change")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="destructive" onClick={onWithdraw} disabled={locked}>
                  {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {busy ? t("interest.submitting") : t("interest.withdraw")}
                </Button>
              </div>
            )}
          </div>
        )}

        {showForm && openRounds.length === 0 && <p className="text-sm text-muted-foreground">{t("interest.noRoundsOpen")}</p>}

        {showForm && openRounds.length > 0 && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <div className="space-y-1.5">
              <Label>{t("interest.currency")}</Label>
              <div role="group" aria-label={t("interest.currency")} className="flex flex-wrap gap-2">
                {INTEREST_CURRENCIES.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={c === editor.currency ? "default" : "outline"}
                    aria-pressed={c === editor.currency}
                    onClick={() => onPatch({ currency: c })}
                    disabled={busy}
                    className="min-w-[4rem]"
                  >
                    {c}
                  </Button>
                ))}
              </div>
            </div>

            {dropped.length > 0 && existing && (
              <Alert role="status">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="space-y-1">
                  {dropped.map((r) => (
                    <p key={r.round}>
                      {t(r.stillOpen ? "interest.roundNotOfferedWillDrop" : "interest.roundClosedWillDrop", {
                        round: r.round,
                        amount: fmtMoney(r.amount, existing.currency),
                        currency: editor.currency,
                      })}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("interest.amounts")}</p>
              {openRounds.map((r) => {
                const size = r.size?.[editor.currency];
                const offered = offeredIn(size);
                // The limit shown is the one the check refuses with: the
                // per-person maximum when it is the smaller, else the round size.
                const binding = roundLimit(size, r.perPerson?.[editor.currency]);
                const inputId = `${id}-r${r.round}`;
                return (
                  <div
                    key={r.round}
                    className={cn(
                      "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[6rem_12rem_minmax(0,1fr)]",
                      !offered && "opacity-60",
                    )}
                  >
                    <Label htmlFor={inputId}>{t("interest.round", { round: r.round })}</Label>
                    <div className="relative">
                      <Input
                        id={inputId}
                        inputMode="numeric"
                        autoComplete="off"
                        value={offered ? (editor.amounts[r.round] ?? "") : ""}
                        placeholder="0"
                        disabled={!offered || busy}
                        onChange={(e) => onPatch({ amounts: { ...editor.amounts, [r.round]: e.target.value } })}
                        className="pr-9 text-right tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol(editor.currency).trim()}
                      </span>
                    </div>
                    <span className="col-start-2 text-xs text-muted-foreground sm:col-start-3">
                      {binding
                        ? t(binding.perPerson ? "interest.maxPerPerson" : "interest.max", {
                            amount: fmtMoney(binding.limit, editor.currency),
                          })
                        : t("interest.notOffered", { currency: editor.currency })}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {offeredIn(capacity)
                ? t("interest.capacity", { number: win.split, currency: editor.currency, amount: fmtMoney(capacity, editor.currency) })
                : t("interest.capacityUnpublished", { number: win.split, currency: editor.currency })}
            </p>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm">{t("interest.total")}</span>
              <strong className="text-lg tabular-nums">{fmtMoney(total, editor.currency)}</strong>
            </div>

            {(form.notWhole.length > 0 || form.limitErrors.length > 0 || (editor.tried && form.draft.rounds.length === 0)) && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
                {form.notWhole.map((round) => (
                  <li key={`w${round}`}>{t("interest.err.wholeNumber", { round })}</li>
                ))}
                {form.limitErrors.map((e, i) => {
                  const message = limitMessage(e, editor.currency);
                  return <li key={`l${i}`}>{t(message.key, message.vars)}</li>;
                })}
                {editor.tried && form.notWhole.length === 0 && form.draft.rounds.length === 0 && <li>{t("interest.err.empty")}</li>}
              </ul>
            )}

            <NonBindingNotice compact />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={locked || form.notWhole.length > 0 || form.limitErrors.length > 0} className="w-full sm:w-auto">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? t("interest.submitting") : t(editor.editing ? "interest.submitChange" : "interest.submit")}
              </Button>
              {editor.editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onPatch({ editing: false, tried: false, amounts: {} })}
                  disabled={busy}
                  className="w-full sm:w-auto"
                >
                  {t("interest.cancel")}
                </Button>
              )}
            </div>
          </form>
        )}

        {!lateProblem && problemBox}
        {!lateOutcome && outcomeBox}
      </CardContent>
    </Card>
  );
}

function Row({ label, strong = false, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t border-border pt-1 font-semibold")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
