import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Shield, Search, Briefcase } from "lucide-react";

const ownNavItems = [
  { title: "OWN", path: "/own", icon: Shield },
  { title: "Cases", path: "/own/search", icon: Search },
  { title: "MY cases", path: "/own/my-cases", icon: Briefcase },
];

export default function OwnLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-2 md:mb-3 px-4 md:px-0">
        <h1 className="text-lg md:text-xl font-bold">
          OWN <span className="text-xs md:text-sm font-normal text-muted-foreground">— Unconditional Self Responsibility</span>
        </h1>
      </div>

      <Outlet />
      
      <SubNavigation items={ownNavItems} variant="bottom" />
    </div>
  );
}
