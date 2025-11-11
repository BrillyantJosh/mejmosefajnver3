import { Link, useLocation } from "react-router-dom";
import { LucideIcon } from "lucide-react";

interface SubNavItem {
  title: string;
  path: string;
  icon?: LucideIcon;
}

interface SubNavigationProps {
  items: SubNavItem[];
  variant?: "top" | "bottom";
}

export default function SubNavigation({ items, variant = "top" }: SubNavigationProps) {
  const location = useLocation();

  if (variant === "bottom") {
    return (
      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t z-50 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-7xl mx-auto">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center gap-1 px-3 py-2 flex-1 transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {Icon && <Icon className="h-5 w-5" />}
                <span className="text-xs font-medium">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="border-b bg-card mb-6">
      <div className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
              }`}
            >
              {Icon && <Icon className="h-4 w-4" />}
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
