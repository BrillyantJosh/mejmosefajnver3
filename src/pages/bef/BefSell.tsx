import SellingMovedNotice from "@/components/discount/SellingMovedNotice";

/**
 * The BEF module's Sell tab. It used to open lana.discount/offer straight
 * away; lana.discount no longer buys LANA (8 Oct 2026), so the tab now opens
 * this page, and it says what the Lana Discount module's Sell page says, with
 * the same notice: the firms that buy LANA now — BEF dealers whose own signed
 * profile says they buy, read from the relays (GET /api/buying-dealers) — each
 * with its own registration and sell pages. "naredi ta isti popravek za
 * prodajo tudi na strani https://app.mejmosefajn.org/discount/sell preko
 * katere uporabniki isto jih preusmer na ta podjetja" (Brilly, 8. 10. 2026).
 *
 * An h2: BefLayout already has the page's h1 ("BEF").
 */
export default function BefSell() {
  return (
    <div className="mx-auto max-w-2xl px-1 py-6 sm:py-10">
      <SellingMovedNotice headingLevel="h2" />
    </div>
  );
}
