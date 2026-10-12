import { useTranslation } from "@/i18n/I18nContext";
import discountTranslations from "@/i18n/modules/discount";
import sellingMovedTranslations from "@/i18n/modules/sellingMoved";
import { pastSalesParts } from "@/lib/sellingMoved";

/**
 * Selling used to happen here: five steps ending in a WIF field, a LANA transfer
 * to the buyback wallet, and a sale booked on lana.discount through its external
 * API. Then this page sent a seller to lana.discount/offer instead — and on
 * 8 Oct 2026 lana.discount stopped buying LANA altogether, and the page named the
 * BEF dealers that buy it (the notice /bef/sell still shows,
 * src/components/discount/SellingMovedNotice.tsx).
 *
 * Since 12 Oct 2026 it names no firm: "Prosim napiši coming soon namesto teh
 * dveh podjetij" (Brilly, 12. 10. 2026). So the card says only that — nothing is
 * read from the relays, nothing is sold from in here, nothing links anywhere.
 *
 * The nav entry and the Transactions page stay: the history of what was sold to
 * lana.discount and paid is still this app's to show, and the card ends with a
 * line saying so. That line is in the card's language (sellingMoved's
 * moved.pastSales) — this module has only English and Slovenian, so a German,
 * Hungarian or Italian reader gets the line in their language with the
 * Transactions tab named exactly as this module labels it, marked with the
 * language that label is in.
 */
export default function DiscountSell() {
  const { t, lang } = useTranslation(discountTranslations);
  const { t: words, lang: cardLang } = useTranslation(sellingMovedTranslations);
  // The language the tab's label really is in: this module's own, or English it falls back to.
  const tabLang = discountTranslations[lang] ? lang : "en";
  const pastSales = pastSalesParts(words, t("layout.nav.transactions"));

  return (
    <div className="mx-auto max-w-2xl px-1 py-8 sm:py-12">
      <section
        data-testid="selling-coming-soon"
        lang={cardLang}
        className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-8"
      >
        <h1 className="text-center text-xl sm:text-2xl font-semibold text-foreground leading-snug break-words">
          {words("moved.comingSoon")}
        </h1>
        <p data-testid="past-sales" className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          {pastSales.before}
          {pastSales.tab && <span lang={tabLang}>{pastSales.tab}</span>}
          {pastSales.after}
        </p>
      </section>
    </div>
  );
}
