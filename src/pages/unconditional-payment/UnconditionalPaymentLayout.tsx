import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, CheckCircle, RefreshCw } from "lucide-react";

const unconditionalPaymentNavItems = [
  { title: "Pending", path: "/unconditional-payment", icon: Clock },
  { title: "Completed", path: "/unconditional-payment/completed", icon: CheckCircle },
  { title: "Relay Retry", path: "/unconditional-payment/retry", icon: RefreshCw }
];

export default function UnconditionalPaymentLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20 px-4 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Unconditional Payment</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Send payments to projects and initiatives in the Lana ecosystem</p>
      </div>

      <Outlet />

      <SubNavigation items={unconditionalPaymentNavItems} variant="bottom" />
    </div>
  );
}
