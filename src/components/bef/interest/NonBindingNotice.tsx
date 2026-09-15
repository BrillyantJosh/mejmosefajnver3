import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTranslation } from "@/i18n/I18nContext";
import befText from "@/i18n/modules/befText";

/**
 * The notice every surface of the interest flow carries: an expressed interest
 * is not an order, not a reservation and not a co-creation agreement; BEF
 * Explorer receives no money; any agreement is made only directly with an
 * independent company. BEF Explorer's own words
 * (bef-explorer src/components/person/NonBindingNotice.tsx).
 */
export function NonBindingNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation(befText);
  if (compact) return <p className="text-xs text-muted-foreground leading-relaxed">{t("interest.noticeShort")}</p>;
  return (
    <Alert role="note">
      <Info className="h-4 w-4" />
      <AlertDescription className="leading-relaxed">
        <strong>{t("interest.noticeTitle")}</strong> {t("interest.notice")}
      </AlertDescription>
    </Alert>
  );
}
