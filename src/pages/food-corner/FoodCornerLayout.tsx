import { Outlet } from "react-router-dom";
import { ShoppingBasket, Store, Truck } from "lucide-react";
import SubNavigation from "@/components/layout/SubNavigation";

const foodCornerNavItems = [
  { title: "Naroči", path: "/food-corner", icon: ShoppingBasket },
  { title: "Eko točka", path: "/food-corner/eco-point", icon: Store },
  { title: "Dobavitelj", path: "/food-corner/supplier", icon: Truck },
];

export default function FoodCornerLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-4 px-4 sm:px-0">
        <h1 className="text-2xl sm:text-3xl font-bold">Food Corner</h1>
        <p className="text-sm text-muted-foreground">
          Eko naročila, prevzemne točke in dobavitelji na Lana relayjih.
        </p>
      </div>
      <Outlet />
      <SubNavigation items={foodCornerNavItems} variant="bottom" />
    </div>
  );
}
