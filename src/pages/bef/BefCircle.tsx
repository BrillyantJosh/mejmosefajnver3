import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BefDoor } from "@/components/bef/BefDoor";
import { CircleCards } from "@/components/bef/circle/CircleCards";
import { useTranslation } from "@/i18n/I18nContext";
import befCircleText from "@/i18n/modules/befCircle";

/**
 * My Circle — the person's own list of the cards they brought into the Circle
 * of Abundance (KIND 30971), signed with the MejmoSefajn key and sent through
 * BEF Explorer. The port of bef-explorer src/pages/CardsPage.tsx.
 *
 * The door signs in on its own (the person is already logged in here, so no key
 * is asked for) and opens BEF's registration when the wallet or profile is
 * missing; once signed in, the list itself is ../../components/bef/circle/CircleCards.tsx.
 * Keyed by the person, so another account starts the list afresh.
 */
export default function BefCircle() {
  const { t } = useTranslation(befCircleText);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-semibold">{t("cards.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("cards.sub")}</p>
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="leading-relaxed">
          {t("cards.notice")} {t("cards.publicNote")}
        </AlertDescription>
      </Alert>
      <BefDoor>{(signedIn) => <CircleCards key={signedIn.hex} hex={signedIn.hex} />}</BefDoor>
    </div>
  );
}
