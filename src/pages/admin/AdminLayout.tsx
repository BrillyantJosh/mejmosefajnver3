import { Outlet, NavLink, useLocation } from "react-router-dom";
import { Brain, Bug, Database, HelpCircle, Newspaper, Settings, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const adminNavItems = [
  { title: "Train AI", path: "/admin/train-ai", icon: Brain },
  { title: "Bug Reports", path: "/admin/bug-reports", icon: Bug },
  { title: "Database", path: "/admin/database", icon: Database },
  { title: "What's Up", path: "/admin/whats-up", icon: Newspaper },
  { title: "FAQ", path: "/admin/faq", icon: HelpCircle },
  { title: "Settings", path: "/admin/settings", icon: Settings },
];

export default function AdminLayout() {
  const location = useLocation();

  return (
    <div className="container max-w-6xl mx-auto py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Shield className="h-8 w-8 text-destructive" />
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage application settings and AI training</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b mb-6">
        <nav className="flex gap-1">
          {adminNavItems.map((item) => {
            const isActive = location.pathname === item.path || 
              (item.path === "/admin/train-ai" && location.pathname === "/admin");
            
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  isActive
                    ? "border-orange-500 text-orange-600 dark:text-orange-400"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <Outlet />
    </div>
  );
}
