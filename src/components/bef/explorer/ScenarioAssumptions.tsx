import { ExternalLink, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ScenarioResponse, SourceNote } from "@/lib/bef/api";
import { BEF_PUBLIC_URL } from "@/lib/bef/base";
import { fillText, hasExplorerText } from "./explorerText";
import { useExplorerText } from "./useExplorerText";

/** The languages BEF Explorer's own pages speak of this app's; any other opens in BEF's choice. */
const BEF_PAGE_LANGS = ["en", "sl", "de", "it"];

/**
 * What the scenario rests on (bef-explorer src/components/Calculator.tsx:317-357):
 * the key assumptions in short, with BEF Explorer's full risks and
 * assumptions page one tap away; then, once there is a result, every
 * assumption this exact scenario makes and the sources of its figures.
 *
 * The server owns the numbers and the reader's language owns the words: an
 * assumption arrives as a text key with its numbers, and one these texts do
 * not know still reads — as the English sentence the server sent with it.
 */
export function ScenarioAssumptions({
  scenario,
  round,
  currentSplit,
}: {
  scenario: ScenarioResponse | null;
  round: number;
  currentSplit: number | null;
}) {
  const { t, lang } = useExplorerText();
  const r = scenario?.result ?? null;
  const risksUrl = `${BEF_PUBLIC_URL}/risks${BEF_PAGE_LANGS.includes(lang) ? `?lang=${lang}` : ""}`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {t("calc.keyAssumptions")}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground marker:text-amber-500">
            <li>
              {t("calc.assumeSplitParams", {
                number: scenario?.purchaseSplit ?? currentSplit ?? "—",
                state: r?.purchasePriceIsPublished ? t("calc.published") : t("calc.indicative"),
              })}
            </li>
            <li>
              {t("calc.assumeRoundPricing", {
                round: scenario?.input.round ?? round,
                state: scenario?.statuses.round === "CURRENT" ? t("calc.stateCurrent") : t("calc.indicative"),
              })}
            </li>
            <li>{t("calc.assumeSale")}</li>
            <li>{t("calc.assumeFees")}</li>
          </ul>
          <a
            href={risksUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("calc.viewAllAssumptions")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      {scenario && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-foreground">{t("calc.thisScenarioAssumes")}</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
              {scenario.assumptions.map((a, i) => (
                <li key={i}>{hasExplorerText(a.key) ? fillText(t(a.key), a.vars ?? {}) : a.text}</li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("calc.assumptionsClose")}</p>
            <ExplorerSources sources={scenario.sources} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Where each figure comes from, as BEF Explorer lists it (bef-explorer src/components/Bits.tsx SourceLine). */
function ExplorerSources({ sources }: { sources: SourceNote[] }) {
  const { t } = useExplorerText();
  if (!sources.length) return null;

  // Labels, details and times are BEF's own, and go in exactly as they came.
  const sourceText = (source: SourceNote) =>
    [source.label, source.detail, source.fetchedAt ? fillText(t("explorer.lastChecked"), { time: source.fetchedAt }) : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
      {sources.map((source, i) => (
        <p key={i}>{fillText(t("explorer.source"), { source: sourceText(source) })}</p>
      ))}
    </div>
  );
}
