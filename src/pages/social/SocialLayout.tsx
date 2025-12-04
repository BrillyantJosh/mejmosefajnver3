import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Home, Users, MessageSquare, DoorOpen } from "lucide-react";
const socialNavItems = [{
  title: "Feed",
  path: "/social",
  icon: Home
}, {
  title: "Rooms",
  path: "/social/rooms",
  icon: Users
}, {
  title: "Tiny Rooms",
  path: "/social/tiny-rooms",
  icon: DoorOpen
}, {
  title: "Comments",
  path: "/social/notifications",
  icon: MessageSquare
}];
export default function SocialLayout() {
  return <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        
        
      </div>
      
      <Outlet />
      
      <SubNavigation items={socialNavItems} variant="bottom" />
    </div>;
}