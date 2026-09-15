import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useExplorerText } from "./useExplorerText";

/**
 * ⓘ next to a figure or a choice, opening its explanation — BEF Explorer's
 * Info tooltip (bef-explorer src/components/Bits.tsx). Every material number
 * gets one. It opens on a tap rather than on hover, so it reads the same on a
 * phone; the button is larger than the dot, so a finger finds it.
 */
export function ExplorerInfo({ text, align = "center" }: { text: string; align?: "start" | "center" | "end" }) {
  const { t } = useExplorerText();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("explorer.infoLabel")}
          className="group -my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-semibold not-italic leading-none text-muted-foreground group-hover:border-primary group-hover:text-primary">
            i
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 max-w-[calc(100vw-2rem)] p-3 text-xs font-normal leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  );
}
