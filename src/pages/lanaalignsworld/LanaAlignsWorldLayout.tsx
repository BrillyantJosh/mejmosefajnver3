import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Activity, Archive, User } from "lucide-react";

const alignsNavItems = [
  {
    title: "My Status",
    path: "/lana-aligns-world/my-status",
    icon: User
  },
  {
    title: "Align",
    path: "/lana-aligns-world/align",
    icon: Activity
  },
  {
    title: "Closed",
    path: "/lana-aligns-world/closed",
    icon: Archive
  }
];

export default function LanaAlignsWorldLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6"></div>
      
      <Outlet />
      
      <SubNavigation 
        items={alignsNavItems} 
        variant="bottom" 
      />
    </div>
  );
}
