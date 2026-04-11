import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Video, Users, CalendarPlus } from "lucide-react";

export default function MeetLayout() {
  const meetNavItems = [
    {
      title: "Join",
      path: "/meet",
      icon: Video
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
