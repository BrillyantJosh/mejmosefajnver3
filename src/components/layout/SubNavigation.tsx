import { Link, useLocation } from "react-router-dom";
import { LucideIcon, Plus, ExternalLink } from "lucide-react";

interface SubNavItem {
  title: string;
  path: string;
  icon?: LucideIcon;
  href?: string; // External URL — opens in new tab instead of routing
}

interface SubNavigationProps {
  items: SubNavItem[];
  variant?: "top" | "bottom";
  onActionClick?: () => void;
  actionLabel?: string;
}

export default function SubNavigation({ items, variant = "top", onActionClick, actionLabel }: SubNavigationProps) {
  const location = useLocation();

  if (variant === "bottom") {
    return (
      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t z-50 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-7xl mx-auto">
          {items.map((item, index) => {
            const isActive = !item.href && location.pathname === item.path;
            const Icon = item.icon;

            // Insert action button in the middle
            const middleIndex = Math.floor(items.length / 2);
            const showActionBefore = onActionClick && index === middleIndex;

            // External link — opens in new tab
            if (item.href) {
              return (
                <div key={item.path} className="contents">
                  {showActionBefore && (
                    <button
                      onClick={onActionClick}
                      className="flex flex-col items-center justify-center gap-1 px-3 py-2 flex-1 transition-colors text-primary"
                      aria-label={actionLabel || "Create"}
                    >
                      <div className="bg-primary rounded-full p-2">
                        <Plus className="h-5 w-5 text-primary-foreground" />
                      </div>
                    </button>
                  )}
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2 flex-1 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {Icon && <Icon className="h-5 w-5" />}
                    <span className="text-xs font-medium">{item.title}</span>
                  </a>
                </div>
              );
            }

            return (
              <div key={item.path} className="contents">
                {showActionBefore && (
                  <button
                    onClick={onActionClick}
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2 flex-1 transition-colors text-primary"
                    aria-label={actionLabel || "Create"}
                  >
                    <div className="bg-primary rounded-full p-2">
                      <Plus className="h-5 w-5 text-primary-foreground" />
                    </div>
                  </button>
                )}
                <Link
                  to={item.path}
                  className={`flex flex-col items-center justify-center gap-1 px-3 py-2 flex-1 transition-colors ${
                    isActive
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {Icon && <Icon className="h-5 w-5" />}
                  <span className="text-xs font-medium">{item.title}</span>
                </Link>
              </div>
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
          const isActive = !item.href && location.pathname === item.path;
          const Icon = item.icon;

          // External link — opens in new tab
          if (item.href) {
            return (
              <a
                key={item.path}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
              >
                {Icon && <Icon className="h-4 w-4" />}
                <span>{item.title}</span>
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            );
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                isActive
                  ? "border-orange-500 text-orange-600 dark:text-orange-400"
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
