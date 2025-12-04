import { Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import SubNavigation from "@/components/layout/SubNavigation";
import { Home, Users, MessageSquare, DoorOpen } from "lucide-react";
import { CreatePostDialog } from "@/components/social/CreatePostDialog";

const socialNavItems = [
  {
    title: "Feed",
    path: "/social",
    icon: Home
  },
  {
    title: "Rooms",
    path: "/social/rooms",
    icon: Users
  },
  {
    title: "Tiny Rooms",
    path: "/social/tiny-rooms",
    icon: DoorOpen
  },
  {
    title: "Comments",
    path: "/social/notifications",
    icon: MessageSquare
  }
];

export default function SocialLayout() {
  const [showCreatePost, setShowCreatePost] = useState(false);

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6"></div>
      
      <Outlet />
      
      <SubNavigation 
        items={socialNavItems} 
        variant="bottom" 
        onActionClick={() => setShowCreatePost(true)}
        actionLabel="Create Post"
      />
      
      <CreatePostDialog 
        open={showCreatePost} 
        onOpenChange={setShowCreatePost}
        triggerButton={false}
      />
    </div>
  );
}
