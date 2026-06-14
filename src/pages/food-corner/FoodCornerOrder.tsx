import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, RefreshCw, Send, ShoppingBasket, Store } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import {
  FOOD_CORNER_ORDER_KIND,
  FoodCornerListing,
} from "@/types/foodCorner";
import {
  describeFoodCornerPause,
  foodCornerOrderingWindow,
  foodCornerWeekRange,
  formatFoodMoney,
  generateFoodCornerId,
  isFoodCornerNodePaused,
} from "@/lib/foodCorner";
import type { FoodCornerNode } from "@/types/foodCorner";

function firstImage(listing: FoodCornerListing): string | undefined {
  return listing.images[0] || listing.thumbs[0];
}

// Countable units that must be whole numbers (no decimals like 1.2 pieces).
const WHOLE_UNITS = new Set(["piece", "pieces", "pcs", "kos", "kom", "komad", "kpl", "unit", "units"]);
function isWholeUnit(unit?: string): boolean {
  return WHOLE_UNITS.has((unit || "").trim().toLowerCase());
}

// Localized labels for product categories (t tags) and eco labels (eco tags).
const CAT_LABELS: Record<string, { en: string; sl: string }> = {
  vegetables: { en: "Vegetables", sl: "Zelenjava" },
  fruits: { en: "Fruits", sl: "Sadje" },
  grains: { en: "Grains", sl: "Žita" },
  bread: { en: "Bread", sl: "Kruh" },
  preserved: { en: "Preserved", sl: "Vloženo" },
  seeds: { en: "Seeds", sl: "Semena" },
  superfood: { en: "Superfood", sl: "Super hrana" },
  herbs: { en: "Herbs", sl: "Zelišča" },
  drinks: { en: "Drinks", sl: "Pijače" },
  meat: { en: "Meat", sl: "Meso" },
  dairy: { en: "Dairy", sl: "Mlečno" },
  eggs: { en: "Eggs", sl: "Jajca" },
  honey: { en: "Honey", sl: "Med" },
  other: { en: "Other", sl: "Drugo" },
};
const ECO_LABELS: Record<string, { en: string; sl: string }> = {
  organic: { en: "Organic", sl: "Ekološko" },
  no_pesticides: { en: "No pesticides", sl: "Brez pesticidov" },
  wild: { en: "Wild", sl: "Divje nabrano" },
  local: { en: "Local", sl: "Lokalno" },
  locally_sourced: { en: "Local", sl: "Lokalno" },
  grass_fed: { en: "Grass-fed", sl: "Travna paša" },
  free_range: { en: "Free range", sl: "Prosta reja" },
};
function tagLabel(map: Record<string, { en: string; sl: string }>, key: string, lang: string): string {
  return map[key]?.[lang === "sl" ? "sl" : "en"] || key;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2d 4h 13m 5s" — drops leading zero units.
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export default function FoodCornerOrder() {
  const { session } = useAuth();
  const { t, lang } = useTranslation(foodCornerTranslations);
  const { nodes, orders, isLoading, error, refetch, getNodeCatalog, getNodeByRef } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();
  const storageKey = session?.nostrHexId ? `food_corner_selected_node_${session.nostrHexId}` : "food_corner_selected_node";

  const [selectedNodeRef, setSelectedNodeRef] = useState(() => localStorage.getItem(storageKey) || "");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  // Ticking clock so the order-deadline countdown updates live (every second).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const dayLabel = (day?: string) => (day ? t(`days.${day.trim().toLowerCase()}` as FoodCornerKey) : "");
  const cycleLabel = (cycle?: string) => (cycle ? t(`cycle.${cycle}` as FoodCornerKey) : "");

  // Order-deadline (cutoff) info for an Eco point — date string + live countdown.
  const deadlineInfo = (node: FoodCornerNode) => {
    const win = foodCornerOrderingWindow(node, now);
    if (!win.cutoff) return null;
    const ms = win.cutoff.getTime() - now.getTime();
    return {
      cutoffStr: win.cutoff.toLocaleString(lang === "sl" ? "sl-SI" : undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      left: ms > 0 ? formatCountdown(ms) : null,
    };
  };

  const visibleNodes = useMemo(
    () => nodes.filter((node) => node.status !== "archived"),
    [nodes],
  );
  const selectedNode = getNodeByRef(selectedNodeRef);
  const selectedNodePaused = selectedNode ? isFoodCornerNodePaused(selectedNode) : false;
  const canOrderFromSelectedNode = !!selectedNode && selectedNode.status === "active" && !selectedNodePaused;
  const catalog = useMemo(
    () => (canOrderFromSelectedNode ? getNodeCatalog(selectedNodeRef) : []),
    [canOrderFromSelectedNode, getNodeCatalog, selectedNodeRef],
  );

  // Group filters (category `t` tags + eco labels) derived from the current catalog.
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedEco, setSelectedEco] = useState<Set<string>>(new Set());
  const toggleFilter = (setter: (fn: (prev: Set<string>) => Set<string>) => void, value: string) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  const availableCats = useMemo(
    () =>
      Array.from(new Set(catalog.flatMap((l) => l.tags))).filter(Boolean).sort((a, b) =>
        tagLabel(CAT_LABELS, a, lang).localeCompare(tagLabel(CAT_LABELS, b, lang)),
      ),
    [catalog, lang],
  );
  const availableEco = useMemo(
    () =>
      Array.from(new Set(catalog.flatMap((l) => l.eco))).filter(Boolean).sort((a, b) =>
        tagLabel(ECO_LABELS, a, lang).localeCompare(tagLabel(ECO_LABELS, b, lang)),
      ),
    [catalog, lang],
  );
  const filteredCatalog = useMemo(
    () =>
      catalog.filter((l) => {
        const catOk = selectedCats.size === 0 || l.tags.some((t) => selectedCats.has(t));
        const ecoOk = selectedEco.size === 0 || l.eco.some((t) => selectedEco.has(t));
        return catOk && ecoOk;
      }),
    [catalog, selectedCats, selectedEco],
  );

  // Estimated pickup date = the pickup that follows the next order cutoff. Read-only.
  const orderWindow = selectedNode ? foodCornerOrderingWindow(selectedNode, now) : null;
  const requestedDate = orderWindow?.pickup ? toISODate(orderWindow.pickup) : "";
  const requestedDateDisplay = orderWindow?.pickup
    ? orderWindow.pickup.toLocaleDateString(lang === "sl" ? "sl-SI" : undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  useEffect(() => {
    if (!selectedNodeRef) return;
    if (!visibleNodes.some((node) => node.ref === selectedNodeRef)) {
      setSelectedNodeRef("");
      localStorage.removeItem(storageKey);
    }
  }, [visibleNodes, selectedNodeRef, storageKey]);

  const selectedItems = useMemo(
    () =>
      catalog
        .map((listing) => {
          const qty = Number.parseFloat(quantities[listing.ref] || "0");
          return { listing, qty };
        })
        .filter((item) => Number.isFinite(item.qty) && item.qty > 0),
    [catalog, quantities],
  );

  const total = selectedItems.reduce((sum, item) => sum + item.qty * item.listing.price, 0);
  const currency = selectedItems[0]?.listing.priceCurrency || "EUR";
  const myOrders = orders.filter((order) => order.buyerPubkey === session?.nostrHexId);

  // "My orders" paginated by the Točka Obilja cycle (pickup day → pickup day,
  // e.g. Thursday→Thursday — when orders are fulfilled), latest cycle first.
  // Anchor to the pickup day of the point(s) the user ordered through (NOT the
  // earlier order-cutoff day), falling back to Thursday.
  const [myOrdersWeekOffset, setMyOrdersWeekOffset] = useState(0);
  const myOrdersAnchorDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of myOrders) {
      const day = getNodeByRef(o.distributionPoint)?.pickups?.[0]?.day?.trim().toLowerCase();
      if (day) counts[day] = (counts[day] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "thursday";
  }, [myOrders, getNodeByRef]);
  const myOrdersWeek = useMemo(
    () => foodCornerWeekRange(myOrdersWeekOffset, myOrdersAnchorDay),
    [myOrdersWeekOffset, myOrdersAnchorDay],
  );
  const myOrdersInWeek = useMemo(
    () =>
      myOrders.filter((order) => {
        const ms = order.createdAt * 1000;
        return ms >= myOrdersWeek.start.getTime() && ms < myOrdersWeek.end.getTime();
      }),
    [myOrders, myOrdersWeek],
  );
  const myOrdersLocale = lang === "sl" ? "sl-SI" : undefined;
  const myOrdersWeekLabel = `${myOrdersWeek.start.toLocaleDateString(myOrdersLocale, { day: "numeric", month: "short" })} – ${new Date(
    myOrdersWeek.end.getTime() - 1,
  ).toLocaleDateString(myOrdersLocale, { day: "numeric", month: "short", year: "numeric" })}`;

  const chooseNode = (nodeRef: string) => {
    setSelectedNodeRef(nodeRef);
    localStorage.setItem(storageKey, nodeRef);
    setQuantities({});
    setSelectedCats(new Set());
    setSelectedEco(new Set());
  };

  const updateQuantity = (listingRef: string, value: string) => {
    setQuantities((current) => ({
      ...current,
      [listingRef]: value,
    }));
  };

  const placeOrder = async () => {
    if (!session?.nostrHexId) return;
    if (!selectedNode) {
      toast.error(t("order.toast.selectFirst"));
      return;
    }
    if (!canOrderFromSelectedNode) {
      toast.error(t("order.toast.notAccepting"));
      return;
    }
    if (selectedItems.length === 0) {
      toast.error(t("order.toast.addItem"));
      return;
    }

    const groups = new Map<string, typeof selectedItems>();
    for (const item of selectedItems) {
      const existing = groups.get(item.listing.unitRef) || [];
      existing.push(item);
      groups.set(item.listing.unitRef, existing);
    }

    try {
      for (const [sellerRef, items] of groups.entries()) {
        const orderId = generateFoodCornerId("o");
        const orderTotal = items.reduce((sum, item) => sum + item.qty * item.listing.price, 0);
        const pickup = selectedNode.pickups[0];
        const itemTags = items.map(({ listing, qty }) => [
          "item",
          listing.ref,
          String(qty),
          listing.unit || "piece",
          listing.price.toFixed(2),
          listing.priceCurrency || "EUR",
        ]);
        const categoryTags = Array.from(new Set(items.flatMap(({ listing }) => listing.tags))).slice(0, 6);

        await publishEvent(
          FOOD_CORNER_ORDER_KIND,
          [
            ["d", orderId],
            ["a", sellerRef],
            ["buyer_type", "individual"],
            ...itemTags,
            ["total", orderTotal.toFixed(2), items[0]?.listing.priceCurrency || "EUR"],
            ["status", "placed"],
            ["fulfillment", "distribution_point"],
            ["distribution_point", selectedNode.ref],
            ...(pickup?.id ? [["pickup_point", pickup.id]] : []),
            ...(requestedDate ? [["requested_date", requestedDate]] : []),
            ...(pickup?.window ? [["requested_window", pickup.window]] : []),
            ["payment", "lana_pay"],
            ["paid", "false"],
            ...categoryTags.map((tag) => ["t", tag]),
          ],
          note.trim(),
        );
      }

      toast.success(t("order.toast.published"));
      setQuantities({});
      setNote("");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("order.toast.failed"));
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("order.heading.select")}</h2>
          <p className="text-sm text-muted-foreground">{t("order.subtitle.select")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {visibleNodes.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("order.empty.noNodes")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleNodes.map((node) => {
            const isSelected = node.ref === selectedNodeRef;
            const nodePaused = isFoodCornerNodePaused(node);
            return (
              <Card
                key={node.ref}
                className={`cursor-pointer transition-colors overflow-hidden ${isSelected ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"} ${nodePaused ? "bg-muted/40" : ""}`}
                onClick={() => chooseNode(node.ref)}
              >
                {node.images?.[0] && (
                  <div className="aspect-[4/2] overflow-hidden bg-muted">
                    <img src={node.images[0]} alt={node.name} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                )}
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{node.name}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2">{node.content || t("order.noDescription")}</p>
                    </div>
                    {isSelected && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {nodePaused && <Badge variant="secondary">{t("order.badge.paused")}</Badge>}
                    {node.geoLabel && (
                      <Badge variant="outline" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {node.geoLabel}
                      </Badge>
                    )}
                    {node.cycle && <Badge variant="secondary">{cycleLabel(node.cycle)}</Badge>}
                    {node.fulfillment.map((item) => (
                      <Badge key={item} variant="secondary">{item}</Badge>
                    ))}
                  </div>
                  {node.pickups[0] && (
                    <p className="text-xs text-muted-foreground">
                      {t("order.pickupLine", {
                        label: node.pickups[0].label,
                        day: dayLabel(node.pickups[0].day),
                        window: node.pickups[0].window,
                      })}
                    </p>
                  )}
                  {(() => {
                    const dl = deadlineInfo(node);
                    return dl ? (
                      <p className="text-xs font-medium text-primary flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>
                          {t("order.deadline.label")}: {dl.cutoffStr}
                          {dl.left ? ` · ${t("order.deadline.left", { time: dl.left })}` : ""}
                        </span>
                      </p>
                    ) : null;
                  })()}
                  {nodePaused && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {t("order.notAcceptingShort")}{describeFoodCornerPause(node) ? ` · ${describeFoodCornerPause(node)}` : ""}.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedNode && !canOrderFromSelectedNode && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("order.notAcceptingFull", {
              name: selectedNode.name,
              pause: describeFoodCornerPause(selectedNode) ? ` (${describeFoodCornerPause(selectedNode)})` : "",
            })}
          </AlertDescription>
        </Alert>
      )}

      {selectedNode && canOrderFromSelectedNode && (
        <>
          {(() => {
            const dl = deadlineInfo(selectedNode);
            return dl ? (
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">{t("order.deadline.label")}: {dl.cutoffStr}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("order.cart.estimatedDate")}: {requestedDateDisplay || "—"}
                      </p>
                    </div>
                  </div>
                  {dl.left && (
                    <span className="text-xl font-bold tabular-nums text-primary">
                      {t("order.deadline.left", { time: dl.left })}
                    </span>
                  )}
                </CardContent>
              </Card>
            ) : null;
          })()}

          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <h2 className="text-lg font-semibold">{t("order.heading.offers", { name: selectedNode.name })}</h2>
              <p className="text-sm text-muted-foreground">{t("order.subtitle.offers")}</p>
            </div>
            <Badge variant="outline">{t("order.badge.offers", { count: filteredCatalog.length })}</Badge>
          </div>

          {/* Group filters: by category (t tags) and by eco label */}
          {(availableCats.length > 0 || availableEco.length > 0) && (
            <div className="space-y-2">
              {availableCats.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground mr-1">{t("order.filter.category")}:</span>
                  {availableCats.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleFilter(setSelectedCats, c)}
                      className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${selectedCats.has(c) ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/50"}`}
                    >
                      {tagLabel(CAT_LABELS, c, lang)}
                    </button>
                  ))}
                </div>
              )}
              {availableEco.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground mr-1">{t("order.filter.eco")}:</span>
                  {availableEco.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleFilter(setSelectedEco, c)}
                      className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${selectedEco.has(c) ? "bg-emerald-600 text-white border-emerald-600" : "hover:border-emerald-500/50"}`}
                    >
                      {tagLabel(ECO_LABELS, c, lang)}
                    </button>
                  ))}
                </div>
              )}
              {(selectedCats.size > 0 || selectedEco.size > 0) && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => {
                    setSelectedCats(new Set());
                    setSelectedEco(new Set());
                  }}
                >
                  {t("order.filter.clear")}
                </button>
              )}
            </div>
          )}

          {catalog.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                {t("order.empty.noOffers")}
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-[1fr_360px] gap-5 items-start">
              {filteredCatalog.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    {t("order.filter.noMatch")}
                  </CardContent>
                </Card>
              ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {filteredCatalog.map((listing) => {
                  const image = firstImage(listing);
                  return (
                    <Card key={listing.ref} className="overflow-hidden">
                      {image && (
                        <div className="aspect-[4/2.2] overflow-hidden bg-muted">
                          <img src={image} alt={listing.title} className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold truncate">{listing.title}</h3>
                            <p className="text-xs text-muted-foreground line-clamp-2">{listing.content}</p>
                          </div>
                          <Badge variant="secondary" className="shrink-0">{listing.type}</Badge>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold">
                            {formatFoodMoney(listing.price, listing.priceCurrency)}
                            <span className="text-xs font-normal text-muted-foreground"> / {listing.unit}</span>
                          </p>
                          <Input
                            type="number"
                            min="0"
                            step={isWholeUnit(listing.unit) ? "1" : "0.1"}
                            inputMode={isWholeUnit(listing.unit) ? "numeric" : "decimal"}
                            value={quantities[listing.ref] || ""}
                            onChange={(event) => {
                              let value = event.target.value;
                              // For piece-type units force whole numbers (strip any decimals).
                              if (isWholeUnit(listing.unit) && value) {
                                const whole = Math.floor(Number.parseFloat(value) || 0);
                                value = whole > 0 ? String(whole) : "";
                              }
                              updateQuantity(listing.ref, value);
                            }}
                            className="w-24"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {listing.eco.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tagLabel(ECO_LABELS, tag, lang)}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              )}

              <Card className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBasket className="h-4 w-4" />
                    {t("order.cart.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("order.cart.empty")}</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedItems.map(({ listing, qty }) => (
                        <div key={listing.ref} className="flex justify-between gap-3 text-sm">
                          <span className="truncate">{qty} {listing.unit} · {listing.title}</span>
                          <span className="font-medium shrink-0">{formatFoodMoney(qty * listing.price, listing.priceCurrency)}</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 flex justify-between font-bold">
                        <span>{t("order.cart.total")}</span>
                        <span>{formatFoodMoney(total, currency)}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>{t("order.cart.estimatedDate")}</Label>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                      {requestedDateDisplay || "—"}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("order.cart.estimatedHint")}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="order-note">{t("order.cart.note")}</Label>
                    <Textarea
                      id="order-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t("order.cart.notePlaceholder")}
                      rows={3}
                    />
                  </div>

                  <Button className="w-full gap-2" onClick={placeOrder} disabled={isPublishing || selectedItems.length === 0}>
                    {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("order.cart.submit")}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="pt-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" />
          {t("order.myOrders.title")}
        </h2>
        {myOrders.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              {t("order.myOrders.empty")}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Week paginator (latest week first, page back week by week) */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setMyOrdersWeekOffset((o) => o + 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("ecoPoint.orders.prevWeek")}
              </Button>
              <span className="text-sm font-medium text-center">
                {myOrdersWeekOffset === 0 ? t("ecoPoint.orders.thisWeek") : myOrdersWeekLabel}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={myOrdersWeekOffset === 0}
                onClick={() => setMyOrdersWeekOffset((o) => Math.max(0, o - 1))}
              >
                {t("ecoPoint.orders.nextWeek")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {myOrdersInWeek.length === 0 ? (
              <Card>
                <CardContent className="p-5 text-sm text-muted-foreground">{t("order.myOrders.weekEmpty")}</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {myOrdersInWeek.map((order) => {
                  const node = getNodeByRef(order.distributionPoint);
                  return (
                    <Card key={order.ref}>
                      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{formatFoodMoney(order.total, order.currency)}</span>
                            <Badge variant={order.fulfillmentStatus ? "default" : "secondary"}>
                              {order.fulfillmentStatus || order.status}
                            </Badge>
                          </div>
                          {node && (
                            <p className="text-xs font-medium text-primary mt-1 flex items-center gap-1">
                              <Store className="h-3 w-3 shrink-0" />
                              {t("order.myOrders.via", { point: node.name })}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {order.items
                              .map((item) => `${item.qty} ${item.unit} ${item.listing?.title || item.listingRef.slice(-8)}`)
                              .join(" · ")}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {new Date(order.createdAt * 1000).toLocaleString(myOrdersLocale)}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
