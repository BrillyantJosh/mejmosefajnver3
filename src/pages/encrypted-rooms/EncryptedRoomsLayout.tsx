import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Lock, Mail } from "lucide-react";
import { useEncryptedRoomInvites } from "@/hooks/useEncryptedRoomInvites";

export default function EncryptedRoomsLayout() {
  const { invites } = useEncryptedRoomInvites();
  const pendingCount = invites.length;

  const navItems = [
    { title: "Rooms", path: "/encrypted-rooms", icon: Lock },
    {
      title: pendingCount > 0 ? `Invites (${pendingCount})` : "Invites",
      path: "/encrypted-rooms/invites",
      icon: Mail,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <Outlet />
      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
