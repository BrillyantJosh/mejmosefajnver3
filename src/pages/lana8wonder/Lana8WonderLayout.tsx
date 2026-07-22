import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Sparkles, TrendingUp } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import lana8wonderTranslations from "@/i18n/modules/lana8wonder";

export default function Lana8WonderLayout() {
  const { t } = useTranslation(lana8wonderTranslations);

  const lana8wonderNavItems = [
    {
      title: t('nav.plan'),
      path: "/lana8wonder",
      icon: Sparkles
    },
    {
      title: t('nav.splits'),
      path: "/lana8wonder/splits",
      icon: TrendingUp
    }
  ];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <Outlet />
      <SubNavigation items={lana8wonderNavItems} variant="bottom" />
    </div>
  );
}
