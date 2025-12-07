import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Activity, Archive, User, Users } from "lucide-react";

const alignsNavItems = [
  {
    title: "Active",
    path: "/lana-aligns-world/active",
    icon: Activity
  },
  {
    title: "Closed",
    path: "/lana-aligns-world/closed",
    icon: Archive
  },
  {
    title: "My Status",
    path: "/lana-aligns-world/my-status",
    icon: User
  },
  {
    title: "Quorum",
    path: "/lana-aligns-world/quorum",
    icon: Users
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
