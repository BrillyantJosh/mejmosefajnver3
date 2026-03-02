import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Sparkles, TrendingUp, ArrowRightLeft } from "lucide-react";

const lana8wonderNavItems = [
  {
    title: "Plan",
    path: "/lana8wonder",
    icon: Sparkles
  },
  {
    title: "Splits",
    path: "/lana8wonder/splits",
    icon: TrendingUp
  },
  {
    title: "Transfer",
    path: "/lana8wonder/transfer",
    icon: ArrowRightLeft
  }
];

export default function Lana8WonderLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <Outlet />
      <SubNavigation items={lana8wonderNavItems} variant="bottom" />
    </div>
  );
}
