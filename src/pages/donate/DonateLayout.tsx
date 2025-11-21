import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, CheckCircle } from "lucide-react";

const donateNavItems = [
  { title: "Pending", path: "/donate", icon: Clock },
  { title: "Donated", path: "/donate/donated", icon: CheckCircle }
];

export default function DonateLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Let's Donate</h1>
        <p className="text-muted-foreground">Support projects in the Lana ecosystem</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={donateNavItems} variant="bottom" />
    </div>
  );
}
