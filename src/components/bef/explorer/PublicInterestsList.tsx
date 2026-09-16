import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BefClient, PublicInterestRound, PublicInterestSplit, PublicInterests } from "@/lib/bef/api";
import { fmtDateTime, fmtMoney } from "@/lib/bef/vendor/src/lib/format.ts";
import { cn } from "@/lib/utils";
import { anyBeyondLimit, entryKey, roundsToShow, roundTotals, splitIsEmpty } from "./publicInterests";
import { useExplorerText } from "./useExplorerText";

type State = { kind: "loading" } | { kind: "ready"; data: PublicInterests } | { kind: "failed" };

/**
 * Who has already expressed interest, at the foot of the Explorer — the same
 * list krogmenjave.com/povprasevanja shows, drawn in MejmoSefajn's look.
 *
 * Every figure is BEF Explorer's (GET /api/interests): the current split, the
 * next one once somebody is in it, each round with the people who signed for
 * it, the name from their own public profile, their shortened key, the amount
 * and when they signed. Nothing else about a person is there to show — no
 * wallet, no e-mail, no telephone, no country and never a whole key — and
 * nothing is recomputed here (./publicInterests.ts only chooses and orders).
 *
 * Read once when the Explorer opens, and again on Try again: a page a reader
 * scrolls to should not keep asking by itself.
 */
export function PublicInterestsList({ client }: { client: Pick<BefClient, "figures"> }) {
  const { t } = useExplorerText();
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Counts reads; only the newest one's answer is kept (useExplorerFigures). */
  const attempts = useRef({ latest: 0 });

  const load = useCallback(() => {
    const counter = attempts.current;
    const mine = ++counter.latest;
    setState({ kind: "loading" });
    void client.figures
      .interests()
      .then((data) => {
        if (mine === counter.latest) setState({ kind: "ready", data });
      })
      .catch(() => {
        // Why is BEF's business; here it is one sentence and Try again. The
        // calculator above says more when BEF cannot be reached at all.
        if (mine === counter.latest) setState({ kind: "failed" });
      });
  }, [client]);

  useEffect(() => {
    const counter = attempts.current;
    load();
    return () => {
      counter.latest++;
    };
  }, [load]);

  const data = state.kind === "ready" ? state.data : null;

  return (
    <section className="space-y-3 pt-2" aria-labelledby="bef-expressed-title">
      <div>
        <h3 id="bef-expressed-title" className="text-lg sm:text-xl font-semibold">
          {t("expressed.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{t("expressed.lead")}</p>
      </div>

      {state.kind === "loading" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{t("expressed.loading")}</span>
          </CardContent>
        </Card>
      )}

      {state.kind === "failed" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="leading-relaxed">{t("expressed.unavailable")}</p>
            <Button size="sm" className="mt-3" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("explorer.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {data?.splits.map((split) => (
        <SplitBlock key={split.split} split={split} />
      ))}

      {data && (
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {anyBeyondLimit(data) && <p>{t("expressed.beyondNote")}</p>}
          <p>{t("expressed.source")}</p>
        </div>
      )}
    </section>
  );
}

function SplitBlock({ split }: { split: PublicInterestSplit }) {
  const { t } = useExplorerText();
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg sm:text-xl">{t("interest.splitTitle", { number: split.split })}</CardTitle>
          <Badge variant="outline">{t(split.scope === "next" ? "interest.scopeNext" : "interest.scopeCurrent")}</Badge>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t("expressed.people", { count: split.people })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {splitIsEmpty(split) ? (
          <p className="text-sm text-muted-foreground">{t("expressed.noneYet")}</p>
        ) : (
          roundsToShow(split).map((round) => <RoundBlock key={round.round} round={round} />)
        )}
      </CardContent>
    </Card>
  );
}

function RoundBlock({ round }: { round: PublicInterestRound }) {
  const { t } = useExplorerText();
  const totals = roundTotals(round);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t("interest.round", { round: round.round })}</span>
        <Badge
          variant="secondary"
          className={cn(round.openForInterest && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}
        >
          {t(round.openForInterest ? "interest.openChip" : "interest.closedChip")}
        </Badge>
        <span className="ml-auto text-sm">
          <span className="text-muted-foreground">{t("interest.total")}: </span>
          {totals.length === 0 ? (
            "—"
          ) : (
            <strong className="font-semibold">
              {totals.map((sum, i) => (
                <span key={sum.currency}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  {fmtMoney(sum.amount, sum.currency)}
                </span>
              ))}
            </strong>
          )}
        </span>
      </div>

      {round.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("expressed.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {round.entries.map((entry, i) => (
            <li key={entryKey(entry, i)} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0">
                <span className={cn("font-medium", !entry.name && "italic text-muted-foreground")}>
                  {entry.name ?? t("expressed.noName")}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  <code className="whitespace-nowrap font-mono">{entry.key}</code>
                  <span aria-hidden="true"> · </span>
                  {t("expressed.signedAt", { time: fmtDateTime(entry.signedAt) })}
                </span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="font-semibold">{fmtMoney(entry.amount, entry.currency)}</span>
                {entry.beyondLimit && (
                  <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                    {t("expressed.beyond")}
                  </Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t("expressed.people", { count: round.people })}</p>
    </div>
  );
}
