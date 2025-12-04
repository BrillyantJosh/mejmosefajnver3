import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Music, TrendingUp } from "lucide-react";

const musicNavItems = [
  { title: "Songs", path: "/music", icon: Music },
  { title: "Popular", path: "/music/popular", icon: TrendingUp },
];

export default function LanaMusicLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Lana Music</h1>
        <p className="text-muted-foreground">Listen to LanaKnights.eu radio, songs, and albums</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={musicNavItems} variant="bottom" />
    </div>
  );
}
