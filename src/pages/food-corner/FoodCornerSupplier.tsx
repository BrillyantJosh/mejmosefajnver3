import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, MapPin, RefreshCw, Truck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import type { FoodCornerNode } from "@/types/foodCorner";
import { foodCornerOrderingWindow, foodCornerWeekRange, formatFoodMoney } from "@/lib/foodCorner";

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

interface ProductAgg {
  key: string;
  title: string;
  unit: string;
  qty: number;
}
interface NodeGroup {
  nodeRef: string;
  node?: FoodCornerNode;
  name: string;
  orderCount: number;
  total: number;
  currency: string;
  products: ProductAgg[];
}

export default function FoodCornerSupplier() {
  const { session } = useAuth();
  const { t, lang } = useTranslation(foodCornerTranslations);
  const { nodes, listings, orders, isLoading, refetch } = useFoodCornerData();
  const locale = lang === "sl" ? "sl-SI" : undefined;

  // Live clock so the order-cutoff countdown updates every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const dayLabel = (day?: string) => (day ? t(`days.${day.trim().toLowerCase()}` as FoodCornerKey) : "");

  const supplierListings = listings.filter((listing) => listing.pubkey === session?.nostrHexId);
  const supplierOrders = useMemo(
    () => orders.filter((order) => order.sellerPubkey === session?.nostrHexId),
    [orders, session?.nostrHexId],
  );
  const nodeByRef = useMemo(() => new Map(nodes.map((node) => [node.ref, node])), [nodes]);

  // Orders are shown per Točka Obilja cycle (pickup day → pickup day, e.g.
  // Thursday→Thursday — the delivery/pickup day). Anchor to the pickup day of
  // the point(s) this supplier serves (fall back to Thursday).
  const [weekOffset, setWeekOffset] = useState(0);
  const anchorDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of supplierOrders) {
      const day = nodeByRef.get(o.distributionPoint)?.pickups?.[0]?.day?.trim().toLowerCase();
      if (day) counts[day] = (counts[day] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "thursday";
  }, [supplierOrders, nodeByRef]);
  const week = useMemo(() => foodCornerWeekRange(weekOffset, anchorDay), [weekOffset, anchorDay]);
  const weekLabel = `${week.start.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${new Date(
    week.end.getTime() - 1,
  ).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;

  const ordersInWeek = useMemo(
    () =>
      supplierOrders.filter((order) => {
        const ms = order.createdAt * 1000;
        return ms >= week.start.getTime() && ms < week.end.getTime();
      }),
    [supplierOrders, week],
  );

  // Group by Točka Obilja, then aggregate quantities per product (the supplier
  // only needs the totals to bring — not individual orders).
  const nodeGroups = useMemo<NodeGroup[]>(() => {
    const map = new Map<string, NodeGroup>();
    for (const order of ordersInWeek) {
      const ref = order.distributionPoint;
      let group = map.get(ref);
      if (!group) {
        const node = nodeByRef.get(ref);
        group = {
          nodeRef: ref,
          node,
          name: node?.name || t("supplier.directNode"),
          orderCount: 0,
          total: 0,
          currency: order.currency || "EUR",
          products: [],
        };
        map.set(ref, group);
      }
      group.orderCount += 1;
      group.total += order.total;
      if (order.currency) group.currency = order.currency;
      for (const item of order.items) {
        const key = `${item.listingRef}__${item.unit}`;
        let product = group.products.find((p) => p.key === key);
        if (!product) {
          product = { key, title: item.listing?.title || item.listingRef.slice(-8), unit: item.unit, qty: 0 };
          group.products.push(product);
        }
        product.qty += item.qty;
      }
    }
    const arr = [...map.values()];
    arr.forEach((g) => g.products.sort((a, b) => a.title.localeCompare(b.title)));
    arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [ordersInWeek, nodeByRef, t]);

  // Order-cutoff + delivery/pickup info for a point's current cycle.
  const windowInfo = (node?: FoodCornerNode) => {
    if (!node) return null;
    const win = foodCornerOrderingWindow(node, now);
    const cutoffMs = win.cutoff ? win.cutoff.getTime() - now.getTime() : null;
    return {
      cutoffStr: win.cutoff
        ? win.cutoff.toLocaleString(locale, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null,
      left: cutoffMs != null && cutoffMs > 0 ? formatCountdown(cutoffMs) : null,
      closed: cutoffMs != null && cutoffMs <= 0,
      pickupStr: win.pickup
        ? win.pickup.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })
        : node.pickups?.[0]?.day
          ? dayLabel(node.pickups[0].day)
          : null,
      pickupWindow: win.pickupWindow || node.pickups?.[0]?.window || "",
    };
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (supplierListings.length === 0) {
    return (
      <div className="px-4 sm:px-0 space-y-4">
        <Alert>
          <Truck className="h-4 w-4" />
          <AlertDescription>{t("supplier.empty.alert")}</AlertDescription>
        </Alert>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">{t("supplier.empty.none")}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("supplier.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("supplier.subtitle")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Cycle paginator (latest cycle first, page back cycle by cycle). */}
      <div className="flex items-center justify-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setWeekOffset((o) => o + 1)}>
          <ChevronLeft className="h-4 w-4" />
          {t("ecoPoint.orders.prevWeek")}
        </Button>
        <span className="text-sm font-medium min-w-[9rem] text-center">
          {weekOffset === 0 ? t("ecoPoint.orders.thisWeek") : weekLabel}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={weekOffset === 0}
          onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
        >
          {t("ecoPoint.orders.nextWeek")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {nodeGroups.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">{t("supplier.weekEmpty")}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {nodeGroups.map((group) => {
            const wi = windowInfo(group.node);
            return (
              <Card key={group.nodeRef}>
                <CardContent className="p-4 space-y-3">
                  {/* Point header */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold text-base flex items-center gap-2 min-w-0">
                        <MapPin className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{group.name}</span>
                      </h3>
                      <span className="text-sm font-medium shrink-0">{formatFoodMoney(group.total, group.currency)}</span>
                    </div>
                    {wi?.cutoffStr && (
                      <p className="text-xs font-medium flex items-center gap-1 text-primary">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>
                          {t("order.deadline.label")}: {wi.cutoffStr}
                          {wi.left
                            ? ` · ${t("order.deadline.left", { time: wi.left })}`
                            : wi.closed
                              ? ` · ${t("supplier.orderingClosed")}`
                              : ""}
                        </span>
                      </p>
                    )}
                    {wi?.pickupStr && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Truck className="h-3 w-3 shrink-0" />
                        <span>
                          {t("supplier.deliverBy")}: {wi.pickupStr}
                          {wi.pickupWindow ? ` · ${wi.pickupWindow}` : ""}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Aggregated product totals to bring */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{t("supplier.toBring")}</p>
                    <div className="rounded-md border divide-y">
                      {group.products.map((product) => (
                        <div key={product.key} className="flex items-center justify-between gap-3 p-3 text-sm">
                          <span className="font-medium truncate">{product.title}</span>
                          <span className="font-semibold shrink-0 tabular-nums">
                            {product.qty} {product.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">{t("supplier.ordersCount", { count: group.orderCount })}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
