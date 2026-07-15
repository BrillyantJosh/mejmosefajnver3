import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Receipt, CreditCard } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import discountTranslations from "@/i18n/modules/discount";

export default function LanaDiscountLayout() {
  const { t } = useTranslation(discountTranslations);

  const discountNavItems = [
    { title: t("layout.nav.transactions"), path: "/discount/transactions", icon: Receipt },
    { title: t("layout.nav.sell"), path: "/discount/sell", icon: CreditCard },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4 sm:px-6">
      <div className="mb-3 sm:mb-6" />
      <Outlet />
      <SubNavigation items={discountNavItems} variant="bottom" />
    </div>
  );
}
