import { Fragment } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/I18nContext";
import sellingMovedTranslations from "@/i18n/modules/sellingMoved";
import { useBuyingDealers } from "@/hooks/useBuyingDealers";
import { BEF_DIRECTORY_URL, noticeWords, pastSalesParts } from "@/lib/sellingMoved";

/**
 * WHERE SELLING WENT — the Sell page of the Lana Discount module (/discount/sell)
 * and of the BEF module (/bef/sell), one notice for both.
 *
 * Both pages used to send a seller to lana.discount/offer. Lana.discount no
 * longer buys LANA (8 Oct 2026): "napiši da sta odkup Lan prevzela firme Krog
 * Menjave ali Ravena Plus (beri iz Relayjev in naj se uporabniki pri enem od
 * podjetji registrirajo)", and for this app "naredi ta isti popravek za
 * prodajo tudi na strani https://app.mejmosefajn.org/discount/sell preko
 * katere uporabniki isto jih preusmer na ta podjetja" (Brilly, 8. 10. 2026).
 *
 * So it names each firm that buys LANA now, as GET /api/buying-dealers reads
 * them from the relays — the companies' own signed KIND 30972 profiles,
 * admitted by BEF Explorer's rule, the same answer lana.discount shows — with
 * the page at each firm where a person registers or signs in, and its page
 * for selling, both in a new tab. No firm is typed in here. When none can be
 * named (the read has not come back, or the relays could not be read) it
 * still says lana.discount no longer buys, and links to BEF Explorer's list of
 * companies. It never offers a form, a wallet or a key field: selling happens
 * at the firm.
 *
 * The words are lana.discount's (src/components/SellingMovedNotice.tsx there),
 * English and Slovenian word for word, in this app's i18n
 * (src/i18n/modules/sellingMoved.ts); which sentence a number of firms gets is
 * src/lib/sellingMoved.ts, tested on its own.
 *
 * One language for the whole card: /discount/sell's line about past sales is
 * the notice's own words too (moved.pastSales), not the Lana Discount
 * module's — that module has only English and Slovenian, so a German,
 * Hungarian or Italian reader used to get the notice in their language and the
 * line under it in English. The card carries `lang`, so a Slovenian card is
 * not read as index.html's "en"; only the Transactions tab's name inside that
 * line carries the language the module shows it in.
 *
 * Phone width: one column of cards (two from `sm` up, and only when there are
 * two or more), `min-w-0` on every card and buttons that wrap — no grid `auto`
 * column, which Safari sizes wrong (src/components/bef/explorer/ScenarioLegs.tsx,
 * Brilly, 21. 9. 2026).
 */
export default function SellingMovedNotice({
  headingLevel = "h1",
  pastSalesTab,
}: {
  /** /discount/sell has no heading above it; /bef/sell sits under BefLayout's h1 "BEF". */
  headingLevel?: "h1" | "h2";
  /**
   * /discount/sell keeps its line about past sales under Transactions, said at
   * the foot of the card in the notice's language: the tab's label as the Lana
   * Discount module shows it, and the language that label is in.
   */
  pastSalesTab?: { label: string; lang: string };
}) {
  const { t, lang } = useTranslation(sellingMovedTranslations);
  const answer = useBuyingDealers();
  const loading = answer === null;
  const buyers = answer?.buyers ?? [];
  const words = noticeWords(t, buyers.map((b) => b.name), loading);
  const pastSales = pastSalesTab ? pastSalesParts(t, pastSalesTab.label) : null;
  const Heading = headingLevel;

  return (
    <section
      data-testid="selling-moved"
      lang={lang}
      className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-8"
    >
      <Heading className="text-center text-xl sm:text-2xl font-semibold text-foreground leading-snug break-words">
        {words.lead === null ? (
          words.title
        ) : (
          <>
            {/* The lead in normal weight, the names bold: Krog's own name has an "in" in it, so the weight shows where a name begins and ends. */}
            <span className="font-normal">{words.lead}</span>{" "}
            {words.names.map((part, i) => (
              <Fragment key={i}>
                {part.joint && <span className="font-normal">{part.joint}</span>}
                <strong className="font-bold">{part.name}</strong>
              </Fragment>
            ))}
            {words.stop}
          </>
        )}
      </Heading>
      <p className="mt-3 text-center text-sm sm:text-base text-muted-foreground leading-relaxed">
        {words.paragraph}
      </p>

      {loading && (
        <p role="status" className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          {t("moved.loading")}
        </p>
      )}

      {!loading && buyers.length > 0 && (
        <>
          <ul
            data-testid="buying-dealers"
            className={`mt-6 grid gap-3 ${buyers.length > 1 ? "sm:grid-cols-2" : ""}`}
          >
            {buyers.map((b) => (
              <li
                key={`${b.host}/${b.slug}`}
                className="min-w-0 flex flex-col rounded-xl border border-border bg-background/60 p-4 text-center"
              >
                <p className="font-semibold text-foreground break-words">{b.name}</p>
                <a
                  href={b.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 text-xs text-muted-foreground hover:text-foreground break-all"
                >
                  {b.host}
                </a>
                <div className="mt-auto flex flex-col gap-2 pt-4">
                  <Button asChild className="h-auto min-h-10 w-full whitespace-normal py-2 text-center">
                    <a href={b.registerUrl} target="_blank" rel="noopener noreferrer">
                      {t("moved.button.register")}
                      <ExternalLink />
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="h-auto min-h-10 w-full whitespace-normal py-2 text-center">
                    <a href={b.sellUrl} target="_blank" rel="noopener noreferrer">
                      {t("moved.button.sell")}
                      <ExternalLink />
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-muted-foreground">{t("moved.source")}</p>
        </>
      )}

      {!loading && buyers.length === 0 && (
        <div className="mt-6 flex justify-center">
          <Button asChild size="lg" className="h-auto min-h-11 w-full whitespace-normal py-2 text-center sm:w-auto">
            <a href={answer?.directoryUrl || BEF_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">
              {t("moved.directory")}
              <ExternalLink />
            </a>
          </Button>
        </div>
      )}

      {pastSales && pastSalesTab && (
        <p data-testid="past-sales" className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          {pastSales.before}
          {pastSales.tab && <span lang={pastSalesTab.lang}>{pastSales.tab}</span>}
          {pastSales.after}
        </p>
      )}
    </section>
  );
}
