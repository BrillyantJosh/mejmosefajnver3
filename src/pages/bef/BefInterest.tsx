import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BefDoor } from "@/components/bef/BefDoor";
import { InterestForm } from "@/components/bef/interest/InterestForm";
import { NonBindingNotice } from "@/components/bef/interest/NonBindingNotice";
import { anyRoundOpen } from "@/components/bef/interest/interestModel";
import { useTranslation } from "@/i18n/I18nContext";
import befInterestText from "@/i18n/modules/befInterest";
import { readPrefill } from "@/lib/bef/prefill";
import { useBefPerson } from "./BefPersonProvider";

/**
 * Interest — a non-binding interest in a split's rounds (KIND 30970), signed
 * with the MejmoSefajn key and sent through BEF Explorer.
 *
 * Whether any split is open for interest is read first, without signing in, so
 * nobody registers a wallet and publishes a profile only to learn afterwards
 * that there is nothing to express interest in; a failed read says nothing and
 * never stands in the way of the door. The door then signs in by itself
 * (BefPersonProvider), and the form shows the person's interests and one card
 * per open split.
 *
 * Query parameters from the Explorer pre-fill the form: split (the split
 * NUMBER), currency, round, amount — the same query BEF Explorer's calculator
 * links to its own /interest with.
 *
 * Ported from bef-explorer src/pages/InterestPage.tsx.
 */
export default function BefInterest() {
  const { t } = useTranslation(befInterestText);
  const [params] = useSearchParams();
  const prefill = useMemo(() => readPrefill(params), [params]);
  const { stage, client } = useBefPerson();
  /** true / false once read; null while loading or when the read failed. */
  const [interestOpen, setInterestOpen] = useState<boolean | null>(null);

  // Read when the page opens, and again when the registration card opens: a new
  // KIND 38888 may have opened or closed a split in the meantime.
  const registering = stage.kind === "register";
  useEffect(() => {
    let cancelled = false;
    client.interest.windows().then(
      (windows) => {
        if (!cancelled) setInterestOpen(anyRoundOpen(windows));
      },
      () => {
        if (!cancelled) setInterestOpen(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, registering]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-semibold">{t("interest.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("interest.sub")}</p>
      </div>

      <NonBindingNotice />

      {stage.kind !== "signedIn" && interestOpen === false && (
        <Card role="status">
          <CardContent className="space-y-2 p-6">
            <h3 className="text-lg font-semibold">{t("interest.noneOpen")}</h3>
            <p className="text-sm text-muted-foreground">{t("interest.noneOpenText")}</p>
            <p className="text-xs text-muted-foreground">{t("interest.noneOpenSignIn")}</p>
            <Link to="/bef" className="inline-block text-sm font-medium text-primary hover:underline">
              {t("interest.backToCalculator")}
            </Link>
          </CardContent>
        </Card>
      )}

      <BefDoor interestOpen={interestOpen}>
        {(signedIn) => <InterestForm key={signedIn.hex} signedIn={signedIn} prefill={prefill} />}
      </BefDoor>
    </div>
  );
}
