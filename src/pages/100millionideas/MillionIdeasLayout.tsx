import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { FolderKanban, Heart, PlusCircle, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/contexts/AdminContext";

const MillionIdeasLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { appSettings } = useAdmin();

  const navItems = [
    {
      path: "/100millionideas/projects",
      icon: FolderKanban,
      label: "Projects",
    },
    {
      path: "/100millionideas/my-projects",
      icon: FolderOpen,
      label: "My Projects",
    },
    {
      path: "/100millionideas/my-donations",
      icon: Heart,
      label: "Received Donations",
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
      
      {/* Bottom Navigation */}
      <div className="border-t bg-background sticky bottom-0">
        <div className="flex justify-around items-center h-16 max-w-screen-xl mx-auto px-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Button
                key={item.path}
                variant="ghost"
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center gap-1 h-auto py-2 px-4 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </Button>
            );
          })}
          
          {/* Create Project Button — hidden when admin disables new projects */}
          {appSettings?.new_projects_100millionideas !== false && (
            <Button
              variant="ghost"
              onClick={() => navigate('/100millionideas/create-project')}
              className="flex flex-col items-center gap-1 h-auto py-2 px-4 text-muted-foreground hover:text-primary"
            >
              <PlusCircle className="h-5 w-5" />
              <span className="text-xs">Create</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MillionIdeasLayout;
