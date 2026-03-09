import { Outlet } from "react-router-dom";
import MainLayout from "@/components/layout/MainLayout";
import SubNavigation from "@/components/layout/SubNavigation";
import { Users, Wallet, WalletCards, Clock, Search } from "lucide-react";

export default function LanaTransparencyLayout() {
  const navItems = [
    { title: "Last 30", path: "/transparency/last-30", icon: Clock },
    { title: "Profiles", path: "/transparency/profiles", icon: Users },
    { title: "Search", path: "/transparency/search-wallet", icon: Search },
    { title: "Wallets", path: "/transparency/wallets", icon: Wallet },
    { title: "Unregistered", path: "/transparency/unregistered-wallets", icon: WalletCards },
  ];

  return (
    <div className="min-h-screen pb-20">
      <Outlet />
      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
