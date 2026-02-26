// VERSION: 2.2 - PWA Cache Fix + Version Display - 2026-01-22
import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, User, Settings, LogOut, Shield, Heart, Download, Grid, Bot, ExternalLink, PlayCircle, Bug, Home as HomeIcon } from "lucide-react";
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
import type { ModuleType } from "@/types/modules";

const UNREGISTERED_MODULE_IDS: Set<ModuleType> = new Set([
  'lanaknights', 'unregisteredwallets', 'lanamusic', 'tax',
  'lanapay', 'offlinelana', 'lanaevents', 'encryptedrooms',
  'chat', 'social', 'lanaexchange', 'being'
]);

const UNR_MODULE_IDS: Set<ModuleType> = new Set(['lanaknights', 'unregisteredwallets', 'lanaexchange']);
import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useAutoLashSender } from "@/hooks/useAutoLashSender";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "sonner";
import InstallPromptBanner from "./InstallPromptBanner";
import InstallAppDialog from "./InstallAppDialog";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const fixedMenuItems = [
  { title: "Home", icon: HomeIcon, path: "/" },
  { title: "Enlightened AI", icon: Bot, path: "/ai-advisor" },
  { title: "Modules", icon: Grid, path: "/modules" },
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
  const { parameters } = useSystemParameters();
  const lastRefreshRef = useRef<number>(Date.now());

  const dynamicModules = getEnabledModules();
  const appVersion = import.meta.env.VITE_APP_VERSION || 'dev';

  // Version check - clear caches on version mismatch
  useEffect(() => {
    const storedVersion = localStorage.getItem('app_version');
    
    if (storedVersion !== appVersion) {
      console.log(`[Version] Mismatch detected: ${storedVersion} -> ${appVersion}`);
      localStorage.setItem('app_version', appVersion);
      
      // Clear service worker caches on version change
      if (storedVersion && 'caches' in window) {
        console.log('[Version] Clearing old caches...');
        caches.keys().then(names => {
          names.forEach(name => {
            caches.delete(name);
          });
        });
      }
    }
  }, [appVersion]);

  // --- PWA install prompt state (shared for banner + header) ---
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    const isDismissed = localStorage.getItem("pwa-install-dismissed");
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

    if (isDismissed || isStandalone) return;

    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua);
    setIsIOS(iOS);

    // Detect common iOS in-app browsers (where Add to Home Screen is often missing)
    const inApp = iOS && /(FBAN|FBAV|Instagram|Line|Twitter|WhatsApp|GSA)/i.test(ua);
    setIsInAppBrowser(inApp);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // iOS has no beforeinstallprompt — show banner as instructions
    if (iOS) setShowInstallBanner(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setInstallHelpOpen(true);
      return;
    }

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstallBanner(false);
      toast.success("Installation started");
    }
    setDeferredPrompt(null);
  };

  const handleDismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem("pwa-install-dismissed", "true");
  };

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
      if (document.visibilityState === "visible") {
        checkAndRefresh();
      }
    };

    // Also set up interval for background refresh
    const intervalId = setInterval(checkAndRefresh, REFRESH_INTERVAL);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshSession]);

  // Auto-send lashes in background when NOT on /lash/pay page
  const isOnPayLashesPage = location.pathname === "/lash/pay";
  useAutoLashSender({ enabled: !isOnPayLashesPage });

  const handleLogout = () => {
    authLogout();
    toast.success("Successfully logged out");
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <InstallPromptBanner
        show={showInstallBanner}
        isIOS={isIOS}
        canInstall={!!deferredPrompt}
        onInstall={handleInstall}
        onDismiss={handleDismissInstallBanner}
        onOpenHelp={() => setInstallHelpOpen(true)}
      />

      <InstallAppDialog
        open={installHelpOpen}
        onOpenChange={setInstallHelpOpen}
        isIOS={isIOS}
        isInAppBrowser={isInAppBrowser}
        canInstall={!!deferredPrompt}
        onInstall={handleInstall}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[env(safe-area-inset-top)]">
        <div className="container relative flex h-16 items-center justify-between px-4">
          <Link to="/" className="flex items-center space-x-2 min-w-0 flex-1 mr-4">
            <img
              src={logoImage}
              alt="Logo"
              className="h-8 w-8 object-contain flex-shrink-0"
            />
            <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-lana-blue-deep via-lana-mid to-lana-orange-vibrant bg-clip-text text-transparent truncate">
              {appSettings?.app_name || "Nostr App"}
            </span>
          </Link>

          {/* Split Badge — centered */}
          {parameters?.split && (
            <a
              href="https://lana.fund/split-simulation"
              target="_blank"
              rel="noopener noreferrer"
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20 hover:from-violet-500/20 hover:to-indigo-500/20 transition-colors"
            >
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">
                Split
              </span>
              <span className="text-lg font-black bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent leading-none">
                {parameters.split}
              </span>
            </a>
          )}

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
                  <p className="text-sm font-medium truncate max-w-[150px]">
                    {profile.display_name}
                  </p>
                )}
                {profile.name && (
                  <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                    @{profile.name}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setInstallHelpOpen(true)}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Install
            </Button>

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
                    <Link to={item.path} className="flex items-center gap-2 cursor-pointer">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/admin/settings"
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Shield className="h-4 w-4" />
                      <span className="font-semibold text-destructive">Admin</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>Logout</span>
                </DropdownMenuItem>

                {/* Info & Help Links */}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="https://www.whatislana.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 cursor-pointer">
                    <ExternalLink className="h-4 w-4" />
                    <span>What Is Lana?</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/video-instructions" className="flex items-center gap-2 cursor-pointer">
                    <PlayCircle className="h-4 w-4" />
                    <span>Video Instructions</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/report-bug" className="flex items-center gap-2 cursor-pointer">
                    <Bug className="h-4 w-4" />
                    <span>Report Bug</span>
                  </Link>
                </DropdownMenuItem>

                {/* Separator */}
                {dynamicModules.length > 0 && <DropdownMenuSeparator />}

                {/* Dynamic Module Items */}
                {dynamicModules.map((module) => (
                  <DropdownMenuItem key={module.path} asChild>
                    {module.externalUrl ? (
                      <a href={module.externalUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 cursor-pointer">
                        <module.icon className="h-4 w-4" />
                        <span>{module.title}</span>
                        {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                            Reg
                          </Badge>
                        )}
                        {UNR_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                            UNR
                          </Badge>
                        )}
                      </a>
                    ) : (
                      <Link to={module.path} className="flex items-center gap-2 cursor-pointer">
                        <module.icon className="h-4 w-4" />
                        <span>{module.title}</span>
                        {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                            Reg
                          </Badge>
                        )}
                        {UNR_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                            UNR
                          </Badge>
                        )}
                      </Link>
                    )}
                  </DropdownMenuItem>
                ))}

              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile Buttons */}
          <div className="md:hidden flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setInstallHelpOpen(true)}
              aria-label="Install app"
            >
              <Download className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Meni"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
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

              {isAdmin && (
                <Link
                  to="/admin/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname.startsWith("/admin")
                      ? "bg-secondary text-primary font-medium"
                      : "hover:bg-secondary/50"
                  }`}
                >
                  <Shield className="h-5 w-5" />
                  <span className="font-semibold text-destructive">Admin</span>
                </Link>
              )}

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

              {/* Info & Help Links */}
              <div className="border-t my-2" />
              <a
                href="https://www.whatislana.com"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors hover:bg-secondary/50"
              >
                <ExternalLink className="h-5 w-5" />
                <span>What Is Lana?</span>
              </a>
              <Link
                to="/video-instructions"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  location.pathname === "/video-instructions"
                    ? "bg-secondary text-primary font-medium"
                    : "hover:bg-secondary/50"
                }`}
              >
                <PlayCircle className="h-5 w-5" />
                <span>Video Instructions</span>
              </Link>
              <Link
                to="/report-bug"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  location.pathname === "/report-bug"
                    ? "bg-secondary text-primary font-medium"
                    : "hover:bg-secondary/50"
                }`}
              >
                <Bug className="h-5 w-5" />
                <span>Report Bug</span>
              </Link>

              {/* Separator */}
              {dynamicModules.length > 0 && <div className="border-t my-2" />}

              {/* Dynamic Module Items */}
              {dynamicModules.map((module) => (
                module.externalUrl ? (
                  <a
                    key={module.path}
                    href={module.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors hover:bg-secondary/50"
                  >
                    <module.icon className="h-5 w-5" />
                    <span>{module.title}</span>
                    {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                        Reg
                      </Badge>
                    )}
                    {UNR_MODULE_IDS.has(module.id) && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                        UNR
                      </Badge>
                    )}
                  </a>
                ) : (
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
                    {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                        Reg
                      </Badge>
                    )}
                    {UNR_MODULE_IDS.has(module.id) && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                        UNR
                      </Badge>
                    )}
                  </Link>
                )
              ))}

            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="container px-4 py-6">
        <Outlet />
      </main>

      {/* Version indicator for debugging */}
      <div className="fixed bottom-2 right-2 text-[10px] text-muted-foreground/50 pointer-events-none z-50">
        v{appVersion}
      </div>
    </div>
  );
}
