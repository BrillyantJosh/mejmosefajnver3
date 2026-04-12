import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Zap, CalendarPlus, Users } from "lucide-react";

export default function MeetLayout() {
  const meetNavItems = [
    {
      title: "Instant",
      path: "/meet",
      icon: Zap
    },
    {
      title: "Načrtovani",
      path: "/meet/schedule",
      icon: CalendarPlus
    },
    {
      title: "Active",
      path: "/meet/active",
      icon: Users
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
