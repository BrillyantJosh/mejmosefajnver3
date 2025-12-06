import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Globe, MapPin, Plus } from "lucide-react";

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
    title: "Add Event",
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
