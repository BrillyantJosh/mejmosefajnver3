import { Outlet } from "react-router-dom";
import MainLayout from "@/components/layout/MainLayout";
import SubNavigation from "@/components/layout/SubNavigation";
import { Users, Wallet } from "lucide-react";

export default function LanaTransparencyLayout() {
  const navItems = [
    { title: "Profiles", path: "/transparency/profiles", icon: Users },
    { title: "Wallets", path: "/transparency/wallets", icon: Wallet },
  ];

  return (
    <div className="min-h-screen pb-20">
      <Outlet />
      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
