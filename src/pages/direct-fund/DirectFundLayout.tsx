import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, Wallet } from "lucide-react";

const navItems = [
  { title: "Payments", path: "/direct-fund/payments", icon: Clock },
  { title: "Budgets", path: "/direct-fund/budgets", icon: Wallet },
];

export default function DirectFundLayout() {
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Direct Fund</h1>
        <p className="text-muted-foreground">Investment budgets and pending payments</p>
      </div>

      <Outlet />

      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
