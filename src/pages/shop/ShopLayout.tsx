import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { CreditCard, Receipt, ShoppingCart } from "lucide-react";

const shopNavItems = [
  { title: "Sell", path: "/shop/sell", icon: CreditCard },
  { title: "Paid", path: "/shop/paid", icon: Receipt },
  { title: "Pay", path: "/shop/pay", icon: ShoppingCart },
];

export default function ShopLayout() {
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-3 sm:mb-6" />
      <Outlet />
      <SubNavigation items={shopNavItems} variant="bottom" />
    </div>
  );
}
