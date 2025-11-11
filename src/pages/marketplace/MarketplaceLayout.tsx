import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { MapPin, Globe, Package } from "lucide-react";

const marketplaceNavItems = [
  { title: "Local", path: "/marketplace", icon: MapPin },
  { title: "Global", path: "/marketplace/global", icon: Globe },
  { title: "My Offers", path: "/marketplace/my-offers", icon: Package },
];

export default function MarketplaceLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Marketplace</h1>
        <p className="text-muted-foreground">Buy and sell with LanaCoins</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={marketplaceNavItems} variant="bottom" />
    </div>
  );
}
