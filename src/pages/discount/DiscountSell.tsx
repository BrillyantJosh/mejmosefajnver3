import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import discountTranslations from "@/i18n/modules/discount";

/** Where an offer is actually made. The page sends a logged-out visitor to its own login. */
const OFFER_URL = "https://lana.discount/offer";

/**
 * Selling used to happen here: five steps ending in a WIF field, a LANA transfer
 * to the buyback wallet, and a sale booked on lana.discount through its external
 * API — with the exchange rate supplied by this client and no decision on the
 * other side about whether to buy at all.
 *
 * Lana.discount now decides before any LANA moves: an offer is submitted, the
 * treasury accepts, declines or reviews it, and only an accepted offer opens the
 * transfer. That decision cannot be made from in here, so this page no longer
 * pretends to sell — it points at the place that does.
 *
 * The nav entry and the Transactions page stay: the history of what was sold and
 * paid is still this app's to show.
 */
export default function DiscountSell() {
  const { t } = useTranslation(discountTranslations);

  return (
    <div className="mx-auto max-w-xl px-1 py-8 sm:py-12">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 text-center">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
          {t("sell.moved.title")}
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          {t("sell.moved.body")}
        </p>

        <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
          <a href={OFFER_URL} target="_blank" rel="noopener noreferrer">
            {t("sell.moved.cta")}
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>

        <p className="mt-5 text-xs text-muted-foreground">{t("sell.moved.note")}</p>
      </div>
    </div>
  );
}
