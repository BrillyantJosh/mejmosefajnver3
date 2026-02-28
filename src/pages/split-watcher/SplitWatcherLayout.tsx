import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { BarChart3, Eye, Wallet, CreditCard, Tag, FastForward } from "lucide-react";

const splitWatcherNavItems = [
  { title: "General", path: "/split-watcher", icon: BarChart3 },
  { title: "Lana8Wonder", path: "/split-watcher/lana8wonder", icon: Eye, href: "https://watch.lana8wonder.com" },
  { title: "All Wallets", path: "/split-watcher/all-wallets", icon: Wallet, href: "https://www.lanawatch.us/all-wallets" },
  { title: "LanaPays.Us", path: "/split-watcher/lanapays", icon: CreditCard, href: "https://www.lanawatch.us/lanapays" },
  { title: "Lana.Discount", path: "/split-watcher/lana-discount", icon: Tag, href: "https://www.lanawatch.us/lana-discount" },
  { title: "Next Split", path: "/split-watcher/next-split", icon: FastForward, href: "https://watch.lana8wonder.com/next-split" },
];

export default function SplitWatcherLayout() {
  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container px-3 md:px-4 py-2 md:py-4">
          <h1 className="text-2xl md:text-3xl font-bold">SPLIT Watcher</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-0.5 md:mt-1">
            Monitor SPLIT parameters and accounts
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="container px-3 md:px-4 py-3 md:py-6">
        <Outlet />
      </div>

      {/* Bottom Navigation */}
      <SubNavigation items={splitWatcherNavItems} variant="bottom" />
    </div>
  );
}
