import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Send, Inbox } from "lucide-react";

const rockNavItems = [
  { title: "Grant", path: "/rock", icon: Send },
  { title: "Received", path: "/rock/received", icon: Inbox },
];

export default function RockLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">ROCK</h1>
        <p className="text-muted-foreground">I know this person - Build a web of trust</p>
      </div>
      
      <Outlet />
      
      <SubNavigation items={rockNavItems} variant="bottom" />
    </div>
  );
}
