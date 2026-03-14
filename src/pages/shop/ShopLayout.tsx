import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { ShoppingCart, CreditCard } from "lucide-react";

const shopNavItems = [
  {
    title: "Sell",
    path: "/shop/sell",
    icon: CreditCard
  },
  {
    title: "Pay",
    path: "/shop/pay",
    icon: ShoppingCart
  }
];

export default function ShopLayout() {
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-6"></div>
      <Outlet />
      <SubNavigation items={shopNavItems} variant="bottom" />
    </div>
  );
}
