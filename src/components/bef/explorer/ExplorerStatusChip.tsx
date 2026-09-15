import { statusLabel } from "@/lib/bef/vendor/src/lib/format.ts";
import { cn } from "@/lib/utils";
import { hasExplorerText } from "./explorerText";
import { useExplorerText } from "./useExplorerText";

/** BEF Explorer's chip colours (bef-explorer src/styles.css .chip), in this app's palette. */
const TONES: Record<string, string> = {
  CURRENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  NEXT: "border border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  INDICATIVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  CONDITIONAL: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  HISTORICAL: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  NOT_ACTIVE: "bg-muted text-muted-foreground",
  UNAVAILABLE: "bg-muted text-muted-foreground",
};

/**
 * A published status (CURRENT, INDICATIVE, …) as BEF Explorer shows it
 * (bef-explorer src/components/Bits.tsx StatusChip). A status BEF's texts do
 * not know still reads sensibly: the code with its underscores spaced out.
 */
export function ExplorerStatusChip({ status, className }: { status: string; className?: string }) {
  const { t } = useExplorerText();
  const key = `status.${status}`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        TONES[status] ?? "bg-secondary text-secondary-foreground",
        className,
      )}
    >
      {hasExplorerText(key) ? t(key) : statusLabel(status)}
    </span>
  );
}
