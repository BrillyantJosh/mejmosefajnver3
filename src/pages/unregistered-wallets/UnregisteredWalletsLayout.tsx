import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Wallet, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

const UnregisteredWalletsLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    {
      path: "/unregistered-wallets/generate",
      icon: Wallet,
      label: "Generate Wallet",
    },
    {
      path: "/unregistered-wallets/offline",
      icon: Globe,
      label: "Offline Wallets",
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
        </div>
      </div>
    </div>
  );
};

export default UnregisteredWalletsLayout;
