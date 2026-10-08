import SellingMovedNotice from "@/components/discount/SellingMovedNotice";
import { useTranslation } from "@/i18n/I18nContext";
import discountTranslations from "@/i18n/modules/discount";

/**
 * Selling used to happen here: five steps ending in a WIF field, a LANA transfer
 * to the buyback wallet, and a sale booked on lana.discount through its external
 * API. Then this page sent a seller to lana.discount/offer instead — and on
 * 8 Oct 2026 lana.discount stopped buying LANA altogether: the BEF dealers that
 * buy it took over. Brilly: "naredi ta isti popravek za prodajo tudi na strani
 * https://app.mejmosefajn.org/discount/sell preko katere uporabniki isto jih
 * preusmer na ta podjetja" (Brilly, 8. 10. 2026).
 *
 * So the page names those firms, read from the relays by this app's server
 * (GET /api/buying-dealers), with each firm's own registration and sell pages —
 * the notice the BEF module's Sell page shows too
 * (src/components/discount/SellingMovedNotice.tsx). Nothing is sold from in
 * here, and nothing links to lana.discount/offer any more.
 *
 * The nav entry and the Transactions page stay: the history of what was sold to
 * lana.discount and paid is still this app's to show, and the card ends with a
 * line saying so. That line is the notice's own words (moved.pastSales), so it
 * is in the notice's language — this module has only English and Slovenian, and
 * a German, Hungarian or Italian reader used to get a German, Hungarian or
 * Italian notice with an English line under it. It names the Transactions tab
 * exactly as this module labels it, in the language that label is in.
 */
export default function DiscountSell() {
  const { t, lang } = useTranslation(discountTranslations);
  // The language the tab's label really is in: this module's own, or English it falls back to.
  const tabLang = discountTranslations[lang] ? lang : "en";

  return (
    <div className="mx-auto max-w-2xl px-1 py-8 sm:py-12">
      <SellingMovedNotice headingLevel="h1" pastSalesTab={{ label: t("layout.nav.transactions"), lang: tabLang }} />
    </div>
  );
}
