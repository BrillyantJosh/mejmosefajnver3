import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { HandCoins, Heart, Info, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/i18n/I18nContext";

/**
 * Unconditional Financing module layout — bottom sub-navigation.
 * Tabs: Financings (list) · My · About (the intro article) · New request.
 */
const UFLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const sl = useLang() === "sl";

  const navItems = [
    {
      path: "/unconditional-financing",
      icon: HandCoins,
      label: sl ? "Financiranja" : "Financings",
    },
    {
      path: "/unconditional-financing/my",
      icon: Heart,
      label: sl ? "Moje" : "My",
    },
    {
      path: "/unconditional-financing/about",
      icon: Info,
      label: sl ? "O modulu" : "About",
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
                className={`flex flex-col items-center gap-1 h-auto py-2 px-3 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </Button>
            );
          })}

          <Button
            variant="ghost"
            onClick={() => navigate("/unconditional-financing/create")}
            className="flex flex-col items-center gap-1 h-auto py-2 px-3 text-muted-foreground hover:text-primary"
          >
            <PlusCircle className="h-5 w-5" />
            <span className="text-xs">{sl ? "Nov zahtevek" : "New request"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UFLayout;
