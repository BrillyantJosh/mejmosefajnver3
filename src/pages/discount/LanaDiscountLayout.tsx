import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Receipt, CreditCard } from "lucide-react";

const discountNavItems = [
  { title: "Transactions", path: "/discount/transactions", icon: Receipt },
  { title: "Sell LANA", path: "/discount/sell", icon: CreditCard },
];

export default function LanaDiscountLayout() {
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-3 sm:mb-6" />
      <Outlet />
      <SubNavigation items={discountNavItems} variant="bottom" />
    </div>
  );
}
