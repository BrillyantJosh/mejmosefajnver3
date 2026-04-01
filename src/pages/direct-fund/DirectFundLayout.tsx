import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, Wallet } from "lucide-react";

const navItems = [
  { title: "Payments", path: "/direct-fund/payments", icon: Clock },
  { title: "Budgets", path: "/direct-fund/budgets", icon: Wallet },
];

export default function DirectFundLayout() {
  return (
    <div className="max-w-4xl mx-auto pb-20 px-4 sm:px-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Direct Fund</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Investment budgets and pending payments</p>
      </div>

      <Outlet />

      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
