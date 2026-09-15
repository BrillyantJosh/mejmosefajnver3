import { Clock, Loader2, Send, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/I18nContext";
import befCircleText from "@/i18n/modules/befCircle";
import { shortCardId } from "@/lib/bef/vendor/src/lib/cardList.ts";

/**
 * The changes waiting to be published — hex ids only, kept in this browser
 * tab — each with Undo, and the one button that signs and publishes them all
 * as one new list.
 */
export function PendingCardsView({
  adds,
  removes,
  nameOf,
  publishing,
  canPublish,
  onUndoAdd,
  onUndoRemove,
  onPublish,
}: {
  adds: readonly string[];
  removes: readonly string[];
  nameOf: (hex: string) => string | null;
  publishing: boolean;
  canPublish: boolean;
  onUndoAdd: (hex: string) => void;
  onUndoRemove: (hex: string) => void;
  onPublish: () => void;
}) {
  const { t } = useTranslation(befCircleText);
  const count = adds.length + removes.length;

  const row = (hex: string, change: "add" | "remove") => {
    const name = nameOf(hex);
    return (
      <li key={`${change}-${hex}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
        <div className="min-w-0 flex-1">
          {name && <p className="truncate text-sm font-medium">{name}</p>}
          <code className="font-mono text-xs text-muted-foreground" title={hex}>
            {shortCardId(hex)}
          </code>
        </div>
        <Badge
          variant="outline"
          className={
            change === "add"
              ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
              : "border-destructive/50 text-destructive"
          }
        >
          {t(change === "add" ? "cards.pending.add" : "cards.pending.remove")}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => (change === "add" ? onUndoAdd(hex) : onUndoRemove(hex))}
          disabled={publishing}
        >
          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
          {t("cards.pending.undo")}
        </Button>
      </li>
    );
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-5 w-5 text-primary" />
          {t("cards.pending.title")}
        </CardTitle>
        <p className="text-sm font-medium">{t("circle.pending.count", { count })}</p>
        <p className="text-xs text-muted-foreground">{t("cards.pending.note")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border">
          {adds.map((hex) => row(hex, "add"))}
          {removes.map((hex) => row(hex, "remove"))}
        </ul>
        <Button type="button" className="w-full sm:w-auto" onClick={onPublish} disabled={!canPublish || publishing}>
          {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {publishing ? t("cards.publishing") : t("cards.publish", { count })}
        </Button>
      </CardContent>
    </Card>
  );
}
