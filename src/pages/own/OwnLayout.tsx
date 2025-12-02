import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Shield, Search, Briefcase } from "lucide-react";

const ownNavItems = [
  { title: "OWN", path: "/own", icon: Shield },
  { title: "Search", path: "/own/search", icon: Search },
  { title: "MY cases", path: "/own/my-cases", icon: Briefcase },
];

export default function OwnLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-4 md:mb-6 px-4 md:px-0">
        <h1 className="text-2xl md:text-3xl font-bold">OWN</h1>
        <p className="text-sm md:text-base text-muted-foreground">Unconditional Self Responsibility</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={ownNavItems} variant="bottom" />
    </div>
  );
}
