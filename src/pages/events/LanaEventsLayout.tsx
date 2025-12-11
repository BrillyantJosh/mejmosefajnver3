import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Globe, MapPin, Plus, CalendarDays, History } from "lucide-react";

const eventsNavItems = [
  {
    title: "Online",
    path: "/events/online",
    icon: Globe
  },
  {
    title: "Live",
    path: "/events/live",
    icon: MapPin
  },
  {
    title: "Past",
    path: "/events/past",
    icon: History
  },
  {
    title: "My Events",
    path: "/events/my",
    icon: CalendarDays
  },
  {
    title: "Add",
    path: "/events/add",
    icon: Plus
  }
];

export default function LanaEventsLayout() {
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
