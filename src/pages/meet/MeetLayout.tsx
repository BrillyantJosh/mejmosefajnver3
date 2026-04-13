import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Zap, CalendarPlus, BarChart3 } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import meetTranslations from "@/i18n/modules/meet";

export default function MeetLayout() {
  const { t } = useTranslation(meetTranslations);

  const meetNavItems = [
    {
      title: t('nav.instant'),
      path: "/meet",
      icon: Zap
    },
    {
      title: t('nav.scheduled'),
      path: "/meet/schedule",
      icon: CalendarPlus
    },
    {
      title: t('nav.sessions'),
      path: "/meet/sessions",
      icon: BarChart3
    }
  ];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6"></div>
      <Outlet />
      <SubNavigation items={meetNavItems} variant="bottom" />
    </div>
  );
}
