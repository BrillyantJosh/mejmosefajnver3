import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Radio, ListOrdered, ActivitySquare } from "lucide-react";

const relaysNavItems = [
  { title: "Relays List", path: "/relays", icon: Radio },
  { title: "My Events", path: "/relays/my-events", icon: ListOrdered },
  { title: "Kinds", path: "/relays/kinds", icon: ActivitySquare },
];

export default function RelaysLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Relays</h1>
        <p className="text-muted-foreground">Manage Nostr relays and view your events</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={relaysNavItems} variant="bottom" />
    </div>
  );
}
