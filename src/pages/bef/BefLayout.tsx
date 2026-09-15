import { Outlet } from "react-router-dom";
import { Calculator, HandHeart, Tag, Users } from "lucide-react";
import SubNavigation from "@/components/layout/SubNavigation";
import { BEF_LOCALES } from "@/components/bef/BefText";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, useTranslation } from "@/i18n/I18nContext";
import befText from "@/i18n/modules/befText";
import { setFormatLocale } from "@/lib/bef/vendor/src/lib/format.ts";
import { BefPersonProvider } from "./BefPersonProvider";

/** Where selling happens. It opens straight from the tab; /bef/sell typed by hand says the same. */
export const BEF_SELL_URL = "https://lana.discount/offer";

/**
 * The BEF module: BEF Explorer's calculator, interest and cards, inside
 * MejmoSefajn. Its figures and sessions come from befexplorer.com itself
 * (src/lib/bef); selling happens on lana.discount.
 */
export default function BefLayout() {
  const { t } = useTranslation(befText);
  const lang = useLang();
  const { session } = useAuth();

  // BEF's number formatting follows the reader's language. Set before the pages
  // render, not after: a figure typeset the wrong way is read wrong.
  setFormatLocale(BEF_LOCALES[lang] ?? "en-GB");

  const befNavItems = [
    { title: t("nav.explorer"), path: "/bef", icon: Calculator },
    { title: t("nav.interest"), path: "/bef/interest", icon: HandHeart },
    { title: t("nav.sell"), path: "/bef/sell", icon: Tag, href: BEF_SELL_URL },
    { title: t("nav.circle"), path: "/bef/circle", icon: Users },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4 sm:px-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">BEF</h1>
        <p className="text-sm sm:text-base text-muted-foreground">{t("layout.subtitle")}</p>
      </div>

      {/* Keyed by the person: another account logging in starts every page afresh. */}
      <BefPersonProvider key={session?.nostrHexId ?? "none"}>
        <Outlet />
      </BefPersonProvider>

      <SubNavigation items={befNavItems} variant="bottom" />
    </div>
  );
}
