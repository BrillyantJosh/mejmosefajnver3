import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/I18nContext";
import befText from "@/i18n/modules/befText";
import { BEF_SELL_URL } from "./BefLayout";

/**
 * The Sell tab opens lana.discount/offer straight away; this page is only for
 * /bef/sell typed or shared as a link. Lana.discount decides about an offer
 * before any LANA moves, so it cannot be made from in here — the Lana Discount
 * module's Sell page says the same, in the module's own words (./bef.ts) so
 * every MejmoSefajn language has them.
 */
export default function BefSell() {
  const { t } = useTranslation(befText);

  return (
    <div className="mx-auto max-w-xl px-1 py-8 sm:py-12">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 text-center">
        <h2 className="text-xl sm:text-2xl font-semibold text-foreground">{t("sell.title")}</h2>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">{t("sell.body")}</p>

        <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
          <a href={BEF_SELL_URL} target="_blank" rel="noopener noreferrer">
            {t("sell.cta")}
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}
