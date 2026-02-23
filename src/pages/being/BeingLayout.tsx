import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { MessageSquare, Globe, Mic } from "lucide-react";

export default function BeingLayout() {
  const navItems = [
    { title: "Chat", path: "/being/chat", icon: MessageSquare },
    { title: "Voice", path: "/being/voice", icon: Mic },
    { title: "World", path: "/being/world", icon: Globe },
  ];

  return (
    <div className="min-h-screen pb-20">
      <Outlet />
      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
