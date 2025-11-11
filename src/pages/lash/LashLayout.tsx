import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Send, Heart } from "lucide-react";

const lashNavItems = [
  { title: "PAY LASHES", path: "/lash/pay", icon: Send },
  { title: "Received", path: "/lash/received", icon: Heart },
];

export default function LashLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">LASH</h1>
        <p className="text-muted-foreground">Send and receive LANA payments</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={lashNavItems} variant="bottom" />
    </div>
  );
}
