import { Outlet } from "react-router-dom";
import { ShoppingBasket, Store, Truck } from "lucide-react";
import SubNavigation from "@/components/layout/SubNavigation";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations from "@/i18n/modules/foodCorner";

export default function FoodCornerLayout() {
  const { t } = useTranslation(foodCornerTranslations);

  const foodCornerNavItems = [
    { title: t("nav.order"), path: "/food-corner", icon: ShoppingBasket },
    { title: t("nav.ecoPoint"), path: "/food-corner/eco-point", icon: Store },
    { title: t("nav.supplier"), path: "/food-corner/supplier", icon: Truck },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-4 px-4 sm:px-0">
        <h1 className="text-2xl sm:text-3xl font-bold">Eco Point</h1>
        <p className="text-sm text-muted-foreground">{t("common.subtitle")}</p>
      </div>
      <Outlet />
      <SubNavigation items={foodCornerNavItems} variant="bottom" />
    </div>
  );
}
