import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { MapPin, Globe, CreditCard } from "lucide-react";

const lanaPaysNavItems = [
  { title: "Location", path: "/lanapays/location", icon: MapPin },
  { title: "Online", path: "/lanapays/online", icon: Globe },
  { title: "Pay", path: "/lanapays/pay", icon: CreditCard },
];

export default function LanaPaysLayout() {
  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container px-3 md:px-4 py-3 md:py-4">
          <h1 className="text-2xl md:text-3xl font-bold">LanaPays.Us</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Discover merchants accepting LanaCoins
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="container px-3 md:px-4 py-4 md:py-6">
        <Outlet />
      </div>

      {/* Bottom Navigation */}
      <SubNavigation items={lanaPaysNavItems} variant="bottom" />
    </div>
  );
}
