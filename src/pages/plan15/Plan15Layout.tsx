import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Users, User, Wallet } from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { Card, CardContent } from "@/components/ui/card";

export default function Plan15Layout() {
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(plan15Translations);
  const floor = parameters?.plan15Floor || 0;
  const priceEur = parameters?.plan15Price?.EUR || 0;

  const navItems = [
    { title: t("nav.followers"), path: "/plan15", icon: Users },
    { title: t("nav.me"), path: "/plan15/me", icon: User },
    { title: t("nav.payouts"), path: "/plan15/payouts", icon: Wallet },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-24 px-4 sm:px-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">PLAN15</h1>
        <p className="text-sm sm:text-base text-muted-foreground">{t("layout.subtitle")}</p>
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">{t("layout.floor")} </span>
            <span className="font-semibold">{floor ? floor.toLocaleString("en-US") + " LANA" : t("layout.notPublished")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("layout.price")} </span>
            <span className="font-semibold">{priceEur ? priceEur + " EUR / LANA" : t("layout.notPublished")}</span>
          </div>
        </CardContent>
      </Card>

      {(!floor || !priceEur) && (
        <Card className="mb-6 border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
          <CardContent className="p-3 text-sm text-yellow-800 dark:text-yellow-300">
            {t("layout.paramsWarning")}
          </CardContent>
        </Card>
      )}

      <Outlet />

      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
