import { Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/I18nContext";
import befCircleText from "@/i18n/modules/befCircle";
import type { CardListView as PublishedList } from "@/lib/bef/api";
import { MAX_CARDS } from "@/lib/bef/vendor/server/lib/cardListEvent.ts";
import { shortCardId } from "@/lib/bef/vendor/src/lib/cardList.ts";
import { fmtDateTime } from "@/lib/bef/vendor/src/lib/format.ts";

/**
 * The list as BEF Explorer holds it: every card with its short id, the name
 * its public profile gives (plain text — a name is whatever its owner wrote),
 * and when it was added. A card is removed by marking it; the removal waits
 * with the other changes until the list is published.
 */
export function CardListView({
  list,
  removing,
  locked,
  onRemove,
}: {
  list: PublishedList | null;
  removing: readonly string[];
  /** A publish is on its way: nothing changes meanwhile. */
  locked: boolean;
  onRemove: (hex: string) => void;
}) {
  const { t } = useTranslation(befCircleText);
  const cards = list?.cards ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            {t("cards.list.title")}
          </CardTitle>
          <Badge variant="secondary">{t("cards.list.count", { count: cards.length, max: MAX_CARDS })}</Badge>
        </div>
        {list && (
          <p className="text-xs text-muted-foreground">
            {t("cards.list.published", { date: fmtDateTime(list.receivedAt), accepted: list.relaysAccepted, total: list.relaysTotal })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("cards.list.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {cards.map((card) => {
              const isRemoving = removing.includes(card.hex);
              return (
                <li key={card.hex} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${isRemoving ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${isRemoving ? "line-through" : ""}`}>
                      {card.name ?? <span className="font-normal text-muted-foreground">{t("cards.list.unnamed")}</span>}
                    </p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <code className="font-mono" title={card.hex}>
                        {shortCardId(card.hex)}
                      </code>
                      <span>{t("cards.list.addedAt", { date: fmtDateTime(card.addedAt) })}</span>
                    </p>
                  </div>
                  {isRemoving ? (
                    <Badge variant="outline" className="border-destructive/50 text-destructive">
                      {t("cards.pending.remove")}
                    </Badge>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => onRemove(card.hex)} disabled={locked}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("cards.list.remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
