import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, User, Home, Settings, LogOut, Shield, Heart } from "lucide-react";
import logoImage from "@/assets/lana-logo.png";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModules } from "@/contexts/ModulesContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useAutoLashSender } from "@/hooks/useAutoLashSender";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { toast } from "sonner";
import InstallPromptBanner from "./InstallPromptBanner";

const fixedMenuItems = [
  { title: "Home", icon: Home, path: "/" },
  { title: "Profile", icon: User, path: "/profile" },
  { title: "Settings", icon: Settings, path: "/settings" },
];

export default function MainLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { getEnabledModules } = useModules();
  const { isAdmin, appSettings } = useAdmin();
  const { logout: authLogout, refreshSession } = useAuth();
  const { profile } = useNostrProfile();
  const { unpaidCount } = useNostrUnpaidLashes();
  const lastRefreshRef = useRef<number>(Date.now());
  
  const dynamicModules = getEnabledModules();
  
  // Periodic session refresh every 15 minutes to keep session alive
  useEffect(() => {
    const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
    
    const checkAndRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshRef.current >= REFRESH_INTERVAL) {
        refreshSession();
        lastRefreshRef.current = now;
      }
    };

    // Check on visibility change (when user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndRefresh();
      }
    };

    // Also set up interval for background refresh
    const intervalId = setInterval(checkAndRefresh, REFRESH_INTERVAL);
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession]);
  
  // Auto-send lashes in background when NOT on /lash/pay page
  const isOnPayLashesPage = location.pathname === '/lash/pay';
  useAutoLashSender({ enabled: !isOnPayLashesPage });

  const handleLogout = () => {
    authLogout();
    toast.success("Successfully logged out");
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Install Prompt Banner */}
      <InstallPromptBanner />
      
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4">
          <Link to="/" className="flex items-center space-x-2 min-w-0 flex-1 mr-4">
            <img 
              src={logoImage} 
              alt="Logo" 
              className="h-8 w-8 object-contain flex-shrink-0"
            />
            <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-purple-400 via-purple-500 to-pink-500 bg-clip-text text-transparent truncate">
              {appSettings?.app_name || "Nostr App"}
            </span>
          </Link>

          {/* User Profile Display */}
          {profile && (
            <div className="hidden md:flex items-center gap-2 mr-4 min-w-0">
              <Link to="/lash/pay" className="relative">
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex items-center gap-1 h-7 px-2"
                >
                  <Heart className="h-3 w-3 fill-current" />
                  <span className="text-xs font-bold">LASH</span>
                </Button>
                {unpaidCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-2 -right-2 h-5 min-w-5 flex items-center justify-center px-1 text-xs font-bold"
                  >
                    {unpaidCount}
                  </Badge>
                )}
              </Link>
              <div className="flex flex-col items-end">
                {profile.display_name && (
                  <p className="text-sm font-medium truncate max-w-[150px]">{profile.display_name}</p>
                )}
                {profile.name && (
                  <p className="text-xs text-muted-foreground truncate max-w-[150px]">@{profile.name}</p>
                )}
              </div>
            </div>
          )}

          {/* Desktop Menu */}
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover z-50">
                {/* Fixed Menu Items */}
                {fixedMenuItems.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link
                      to={item.path}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>Logout</span>
                </DropdownMenuItem>
                
                {/* Separator */}
                {dynamicModules.length > 0 && <DropdownMenuSeparator />}
                
                {/* Dynamic Module Items */}
                {dynamicModules.map((module) => (
                  <DropdownMenuItem key={module.path} asChild>
                    <Link
                      to={module.path}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <module.icon className="h-4 w-4" />
                      <span>{module.title}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                
                {/* Admin Section */}
                {isAdmin && <DropdownMenuSeparator />}
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/admin/settings"
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Shield className="h-4 w-4" />
                      <span className="font-semibold text-destructive">Admin Settings</span>
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-background">
            <nav className="container px-4 py-4 space-y-2">
              {/* Fixed Menu Items */}
              {fixedMenuItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname === item.path
                      ? "bg-secondary text-primary font-medium"
                      : "hover:bg-secondary/50"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.title}</span>
                </Link>
              ))}
              
              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors hover:bg-secondary/50 w-full text-left"
              >
                <LogOut className="h-5 w-5" />
                <span>Logout</span>
              </button>
              
              {/* Separator */}
              {dynamicModules.length > 0 && (
                <div className="border-t my-2" />
              )}
              
              {/* Dynamic Module Items */}
              {dynamicModules.map((module) => (
                <Link
                  key={module.path}
                  to={module.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname.startsWith(module.path)
                      ? "bg-secondary text-primary font-medium"
                      : "hover:bg-secondary/50"
                  }`}
                >
                  <module.icon className="h-5 w-5" />
                  <span>{module.title}</span>
                </Link>
              ))}
              
              {/* Admin Section */}
              {isAdmin && <div className="border-t my-2" />}
              {isAdmin && (
                <Link
                  to="/admin/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname === "/admin/settings"
                      ? "bg-secondary text-primary font-medium"
                      : "hover:bg-secondary/50"
                  }`}
                >
                  <Shield className="h-5 w-5" />
                  <span className="font-semibold text-destructive">Admin Settings</span>
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="container px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
