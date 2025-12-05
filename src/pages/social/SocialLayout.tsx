import { Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import SubNavigation from "@/components/layout/SubNavigation";
import { Home, Newspaper, Users, MessageSquare, DoorOpen } from "lucide-react";
import { CreatePostDialog } from "@/components/social/CreatePostDialog";

const socialNavItems = [
  {
    title: "Home",
    path: "/social/home",
    icon: Newspaper
  },
  {
    title: "Feed",
    path: "/social/feed",
    icon: Home
  },
  {
    title: "Comments",
    path: "/social/notifications",
    icon: MessageSquare
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
