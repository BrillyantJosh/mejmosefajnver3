import { ExternalLink, HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/I18nContext";
import befInterestText from "@/i18n/modules/befInterest";
import { LETSBALANCE_BEF_URL } from "@/lib/bef/base";

/**
 * Interest — where an interest is expressed now: the BEF page of
 * LetsBalance.world, where a person signs a KIND 30975 BEF Interest (support,
 * sell, or sell and buy, valid at most 30 days) and one firm takes it up with
 * a KIND 40971. The buy-only KIND 30970 this page used to sign with the
 * MejmoSefajn key and send through BEF Explorer is replaced; earlier interests
 * here are closed (Brilly, 3. 11. 2026).
 *
 * So the page signs nothing, sends nothing and opens no BEF Explorer session:
 * it says so, and links to LetsBalance.world in a new tab. A link from the
 * Explorer with the old query (split, currency, round, amount) lands here too
 * and the query is ignored — LetsBalance.world asks for what it needs itself.
 *
 * An h2: BefLayout already has the page's h1 ("BEF").
 */
export default function BefInterest() {
  const { t, lang } = useTranslation(befInterestText);

  return (
    <div className="mx-auto max-w-2xl px-1 py-6 sm:py-10">
      <section
        data-testid="interest-moved"
        lang={lang}
        className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-8 text-center"
      >
        <HandHeart className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <h2 className="mt-3 text-xl sm:text-2xl font-semibold text-foreground leading-snug break-words">
          {t("interest.moved.title")}
        </h2>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">{t("interest.moved.text")}</p>

        <Button asChild size="lg" className="mt-6 h-auto min-h-12 w-full whitespace-normal sm:w-auto sm:min-w-[16rem]">
          <a href={LETSBALANCE_BEF_URL} target="_blank" rel="noopener noreferrer">
            {t("interest.moved.open")}
            <ExternalLink className="h-4 w-4 shrink-0" />
          </a>
        </Button>

        <p className="mt-6 text-xs text-muted-foreground leading-relaxed">{t("interest.moved.closed")}</p>
      </section>
    </div>
  );
}
