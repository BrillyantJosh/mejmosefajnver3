import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, CheckCircle } from "lucide-react";

const unconditionalPaymentNavItems = [
  { title: "Pending", path: "/unconditional-payment", icon: Clock },
  { title: "Completed", path: "/unconditional-payment/completed", icon: CheckCircle }
];

export default function UnconditionalPaymentLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Unconditional Payment</h1>
        <p className="text-muted-foreground">Send payments to projects and initiatives in the Lana ecosystem</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={unconditionalPaymentNavItems} variant="bottom" />
    </div>
  );
}
