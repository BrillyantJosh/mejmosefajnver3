import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Globe, MapPin, CalendarDays, History, Ticket } from "lucide-react";
import { useTranslation } from '@/i18n/I18nContext';
import eventsTranslations from '@/i18n/modules/events';

export default function LanaEventsLayout() {
  const { t } = useTranslation(eventsTranslations);

  const eventsNavItems = [
    {
      title: t('nav.online'),
      path: "/events/online",
      icon: Globe
    },
    {
      title: t('nav.live'),
      path: "/events/live",
      icon: MapPin
    },
    {
      title: t('nav.past'),
      path: "/events/past",
      icon: History
    },
    {
      title: t('nav.tickets'),
      path: "/events/my-tickets",
      icon: Ticket
    },
    {
      title: t('nav.myEvents'),
      path: "/events/my",
      icon: CalendarDays
    }
  ];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6"></div>

      <Outlet />

      <SubNavigation
        items={eventsNavItems}
        variant="bottom"
      />
    </div>
  );
}
