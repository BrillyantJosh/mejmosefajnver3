import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { ScenarioResponse } from "@/lib/bef/api";
import { fmtDecimal, fmtLana, fmtMoney, fmtPrice, fmtSignedMoney, fmtSignedPercent } from "@/lib/bef/vendor/src/lib/format.ts";
import { cn } from "@/lib/utils";
import { ExplorerInfo } from "./ExplorerInfo";
import { ExplorerStatusChip } from "./ExplorerStatusChip";
import { useExplorerText } from "./useExplorerText";

/**
 * The two sides of one scenario, each in the framework's own terms
 * (bef-explorer src/components/Calculator.tsx:360-465): what is offered on
 * the buy side, and what an independent treasury may indicate on the sale side
 * — never merged into one number and never presented as an executable quote.
 * Under them, the published statuses the result rests on.
 *
 * Every figure is BEF's, from /api/scenario. Before the first answer each one
 * reads "—"; a result asked for with other inputs is shown dimmed until the
 * new one arrives.
 */
export function ScenarioLegs({
  scenario,
  currency,
  round,
  dimmed,
}: {
  scenario: ScenarioResponse | null;
  /** The chosen currency and round, for the moment there is no scenario to say its own. */
  currency: string;
  round: number;
  dimmed: boolean;
}) {
  const { t } = useExplorerText();
  const r = scenario?.result ?? null;
  // A scenario is written in the currency and round it was asked for.
  const cur = scenario?.input.currency ?? currency;
  const askedRound = scenario?.input.round ?? round;
  const positive = (r?.difference ?? 0) >= 0;

  return (
    <div aria-busy={dimmed} className={cn("space-y-3 transition-opacity", dimmed && "opacity-60")}>
      <div className="grid gap-3 md:grid-cols-2">
        <LegCard title={t("calc.buyLeg")} status={scenario?.statuses.round ?? "INDICATIVE"}>
          <dl>
            <LegRow label={t("calc.buyPay")} value={r ? fmtMoney(r.amount, cur) : "—"} />
            <LegRow
              label={
                <>
                  {t("calc.buyPricePerLana")}{" "}
                  <ExplorerInfo text={r?.purchasePriceIsPublished ? t("calc.priceInfoPublished") : t("calc.priceInfoComputed")} />
                </>
              }
              value={r ? fmtPrice(r.purchasePrice, cur) : "—"}
              note={r ? t("calc.buyPriceBreak", { reference: fmtPrice(r.rate, cur), fee: fmtDecimal(r.commissionPercent, 0) }) : null}
            />
            <LegRow
              emphasis="total"
              label={t("calc.buyReceive")}
              value={
                <>
                  {r ? fmtLana(r.lanaQty) : "—"} <span className="text-xs font-semibold text-muted-foreground">LANA</span>
                </>
              }
            />
          </dl>
        </LegCard>

        <LegCard title={t("calc.sellLeg")} status="INDICATIVE" lead={t("calc.sellLegLead")} muted>
          <dl>
            <LegRow
              label={t("calc.sellQty")}
              value={
                <>
                  {r ? fmtLana(r.lanaQty) : "—"} <span className="text-xs font-semibold text-muted-foreground">LANA</span>
                </>
              }
            />
            <LegRow
              label={
                <>
                  {scenario?.saleSplit ? t("calc.sellPriceAtSplit", { number: scenario.saleSplit }) : t("calc.sellPrice")}{" "}
                  <ExplorerInfo text={r?.salePriceIsPublished ? t("calc.saleInfoPublished") : t("calc.saleInfoComputed")} />
                </>
              }
              value={r ? fmtPrice(r.salePrice, cur) : "—"}
              note={r ? t("calc.sellPriceBreak", { reference: fmtPrice(r.postSplitRate, cur), discount: fmtDecimal(r.feePercent, 0) }) : null}
            />
            <LegRow emphasis="total" label={t("calc.sellTotal")} value={r ? fmtMoney(r.saleNet, cur) : "—"} />
            <LegRow
              emphasis={r ? (positive ? "positive" : "negative") : "total"}
              label={
                <>
                  {t("calc.sellReturn")} <ExplorerInfo text={t("calc.differenceInfo")} />
                </>
              }
              value={r ? fmtSignedPercent(r.differencePercent) : "—"}
              aside={r ? fmtSignedMoney(r.difference, cur) : null}
            />
          </dl>
        </LegCard>
      </div>

      {scenario && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <StatusLine status={scenario.statuses.round}>{t("calc.roundAvailability", { round: askedRound })}</StatusLine>
          <StatusLine status={scenario.statuses.carry}>
            {t("calc.oneSplitCarry")} <ExplorerInfo text={scenario.carryNote || t("calc.carryFallback")} />
          </StatusLine>
          {scenario.statuses.seller && <StatusLine status={scenario.statuses.seller}>{t("calc.sellerStatus")}</StatusLine>}
          {scenario.statuses.treasury && <StatusLine status={scenario.statuses.treasury}>{t("calc.treasuryStatus")}</StatusLine>}
        </div>
      )}
    </div>
  );
}

function LegCard({
  title,
  status,
  lead,
  muted = false,
  children,
}: {
  title: string;
  status: string;
  lead?: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn("h-full", muted && "bg-muted/30")}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 text-base font-semibold leading-snug text-foreground">{title}</h3>
          <ExplorerStatusChip status={status} />
        </div>
        {lead && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{lead}</p>}
        <div className="mt-2">{children}</div>
      </CardContent>
    </Card>
  );
}

/** A label on the left and its figure on the right; the arithmetic under both spans the row. */
function LegRow({
  label,
  value,
  note,
  aside,
  emphasis,
}: {
  label: ReactNode;
  value: ReactNode;
  /** How the figure is made up, under the whole row. */
  note?: string | null;
  /** A second figure under the first, on the right. */
  aside?: string | null;
  emphasis?: "total" | "positive" | "negative";
}) {
  const large = emphasis != null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-dashed border-border py-2 last:border-b-0">
      <dt className={cn("text-sm", large ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</dt>
      <dd
        className={cn(
          "text-right font-semibold tabular-nums",
          large ? "text-xl font-bold" : "text-base text-foreground",
          emphasis === "positive" && "text-emerald-700 dark:text-emerald-400",
          emphasis === "negative" && "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </dd>
      {aside && (
        <dd
          className={cn(
            "col-span-2 text-right text-xs font-semibold tabular-nums",
            emphasis === "positive" && "text-emerald-700 dark:text-emerald-400",
            emphasis === "negative" && "text-red-700 dark:text-red-400",
          )}
        >
          {aside}
        </dd>
      )}
      {note && <dd className="col-span-2 mt-0.5 text-xs leading-relaxed text-muted-foreground tabular-nums">{note}</dd>}
    </div>
  );
}

function StatusLine({ status, children }: { status: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ExplorerStatusChip status={status} />
      <span className="inline-flex items-center gap-1">{children}</span>
    </span>
  );
}
