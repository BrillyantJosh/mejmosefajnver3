import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Printer, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import {
  FOOD_CORNER_DELIVERY_KIND,
  FoodCornerOrderWithFulfillment,
  type FoodCornerNode,
} from "@/types/foodCorner";
import { foodCornerItemKey, foodCornerOrderingWindow, foodCornerWeekRange, formatFoodMoney } from "@/lib/foodCorner";

// Countable units that must be whole numbers (mirrors the buyer order form).
const WHOLE_UNITS = new Set(["piece", "pieces", "pcs", "kos", "kom", "komad", "kpl", "unit", "units"]);
const isWholeUnit = (unit?: string): boolean => WHOLE_UNITS.has((unit || "").trim().toLowerCase());

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
  listingRef: string;
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
  orders: FoodCornerOrderWithFulfillment[];
}

export default function FoodCornerSupplier() {
  const { session } = useAuth();
  const { t, lang } = useTranslation(foodCornerTranslations);
  const { nodes, listings, orders, isLoading, refetch, deliveries } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();
  const locale = lang === "sl" ? "sl-SI" : undefined;

  // Per-product delivered TOTAL the supplier brings to a point (aggregate, not per
  // buyer): nodeRef → productKey → qty string. The supplier delivers the whole
  // amount to the Točka Obilja, reduced if short.
  const [deliveredTotals, setDeliveredTotals] = useState<Record<string, Record<string, string>>>({});

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
  // Cycle start for a node = start of the current cycle anchored to THAT node's
  // pickup day (so it matches the Točka's per-node cycle key for 36604).
  const nodeCycleStart = (node?: FoodCornerNode) =>
    Math.floor(foodCornerWeekRange(weekOffset, node?.pickups?.[0]?.day || anchorDay).start.getTime() / 1000);

  const ordersInWeek = useMemo(
    () =>
      supplierOrders.filter((order) => {
        const ms = order.createdAt * 1000;
        return ms >= week.start.getTime() && ms < week.end.getTime();
      }),
    [supplierOrders, week],
  );

  // Group by Točka Obilja, then aggregate quantities per product (the supplier
  // needs the totals to bring); keep the orders so a status can be published per
  // order from the point card.
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
          orders: [],
        };
        map.set(ref, group);
      }
      group.orderCount += 1;
      group.total += order.total;
      group.orders.push(order);
      if (order.currency) group.currency = order.currency;
      for (const item of order.items) {
        const key = `${item.listingRef}__${item.unit}`;
        let product = group.products.find((p) => p.key === key);
        if (!product) {
          const title = item.listing?.title || `${t("supplier.unknownProduct")} (${item.listingRef.slice(-6)})`;
          product = { key, listingRef: item.listingRef, title, unit: item.unit, qty: 0 };
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

  // This supplier's already-published delivered totals for a node this cycle.
  const publishedDeliveredFor = (group: NodeGroup) => {
    const cs = nodeCycleStart(group.node);
    const map = new Map<string, number>();
    for (const d of deliveries) {
      if (d.pubkey !== session?.nostrHexId || d.nodeRef !== group.nodeRef || d.cycleStart !== cs) continue;
      for (const it of d.items) map.set(foodCornerItemKey(it.listingRef, it.unit), it.qty);
    }
    return map;
  };

  // Delivered value shown for a product: local edit → last published (this cycle) →
  // default = ordered total.
  const deliveredValue = (nodeRef: string, product: ProductAgg, publishedMap: Map<string, number>): string => {
    const local = deliveredTotals[nodeRef]?.[product.key];
    if (local !== undefined) return local;
    const published = publishedMap.get(product.key);
    return String(published ?? product.qty);
  };

  const setDelivered = (nodeRef: string, key: string, qty: string) =>
    setDeliveredTotals((cur) => ({ ...cur, [nodeRef]: { ...(cur[nodeRef] || {}), [key]: qty } }));

  // Publish the supplier's aggregate delivery for a point (KIND 36604) — one event
  // per (supplier, node, cycle), re-emitting ALL products (replaceable, latest-wins).
  const publishDelivery = async (group: NodeGroup) => {
    const node = group.node;
    if (!node) {
      toast.error(t("supplier.toast.failed"));
      return;
    }
    const cs = nodeCycleStart(node);
    const publishedMap = publishedDeliveredFor(group);
    try {
      await publishEvent(
        FOOD_CORNER_DELIVERY_KIND,
        [
          ["d", `${node.dTag}__${cs}`],
          ["a", group.nodeRef],
          ["cycle_start", String(cs)],
          ...group.products.map((p) => [
            "delivered",
            p.listingRef,
            String(Number.parseFloat(deliveredValue(group.nodeRef, p, publishedMap)) || 0),
            p.unit,
          ]),
        ],
        "",
      );
      toast.success(t("supplier.toast.deliveredPublished"));
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("supplier.toast.failed"));
    }
  };

  const escapeHtml = (value: string) =>
    value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

  // Printable delivery list: per Točka Obilja, the cutoff + delivery deadline and
  // the aggregated product totals to bring.
  const buildPrintHtml = (groups: NodeGroup[]) => {
    const cycle = weekOffset === 0 ? t("ecoPoint.orders.thisWeek") : weekLabel;
    const sections = groups
      .map((g) => {
        const wi = windowInfo(g.node);
        const rows = g.products
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.title)}</td><td class="num">${escapeHtml(`${p.qty} ${p.unit}`)}</td></tr>`,
          )
          .join("");
        const meta: string[] = [];
        if (wi?.cutoffStr) meta.push(`${escapeHtml(t("order.deadline.label"))}: ${escapeHtml(wi.cutoffStr)}`);
        if (wi?.pickupStr)
          meta.push(
            `${escapeHtml(t("supplier.deliverBy"))}: ${escapeHtml(wi.pickupStr)}${wi.pickupWindow ? " · " + escapeHtml(wi.pickupWindow) : ""}`,
          );
        return (
          `<section><h2>${escapeHtml(g.name)}</h2>` +
          (meta.length ? `<p class="meta">${meta.join(" &nbsp;·&nbsp; ")}</p>` : "") +
          `<table><thead><tr><th>${escapeHtml(t("ecoPoint.print.product"))}</th>` +
          `<th class="num">${escapeHtml(t("ecoPoint.print.qty"))}</th></tr></thead><tbody>${rows}</tbody></table>` +
          `<p class="total">${escapeHtml(t("ecoPoint.print.total"))}: ${escapeHtml(formatFoodMoney(g.total, g.currency))} · ` +
          `${escapeHtml(t("supplier.ordersCount", { count: g.orderCount }))}</p></section>`
        );
      })
      .join("");
    return (
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t("supplier.print.title"))}</title><style>` +
      `*{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif}body{margin:24px;color:#111}` +
      `h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:13px;margin:0 0 12px}` +
      `section{margin:0 0 18px}` +
      `h2{font-size:16px;margin:14px 0 6px;border-bottom:2px solid #111;padding-bottom:4px;page-break-after:avoid}` +
      `table{width:100%;border-collapse:collapse;font-size:13px}thead{display:table-header-group}tr{page-break-inside:avoid}` +
      `th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd}th{background:#f4f4f4}` +
      `.num{text-align:right;white-space:nowrap}.total{text-align:right;font-weight:700;margin-top:8px;font-size:14px}` +
      `@media print{body{margin:12mm}}</style></head><body>` +
      `<h1>${escapeHtml(t("supplier.print.title"))}</h1>` +
      `<p class="meta">${escapeHtml(cycle)}</p>` +
      (sections || `<p>${escapeHtml(t("supplier.weekEmpty"))}</p>`) +
      `</body></html>`
    );
  };

  const printGroups = (groups: NodeGroup[]) => {
    if (groups.length === 0) {
      toast.error(t("ecoPoint.print.empty"));
      return;
    }
    const win = window.open("", "_blank");
    if (!win) {
      toast.error(t("ecoPoint.print.popupBlocked"));
      return;
    }
    win.document.write(buildPrintHtml(groups));
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 300);
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
          <h2 className="text-xl font-semibold">{t("supplier.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("supplier.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {nodeGroups.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => printGroups(nodeGroups)}>
              <Printer className="h-4 w-4" />
              {t("ecoPoint.print.all")}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={refetch}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
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
                <CardContent className="p-4 sm:p-5 space-y-4">
                  {/* Point header */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-bold text-xl flex items-center gap-2 min-w-0">
                        <MapPin className="h-5 w-5 shrink-0 text-primary" />
                        <span className="truncate">{group.name}</span>
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-lg font-semibold">{formatFoodMoney(group.total, group.currency)}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title={t("supplier.print.one")}
                          onClick={() => printGroups([group])}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {wi?.cutoffStr && (
                      <p className="text-sm font-medium flex items-center gap-1.5 text-primary">
                        <Clock className="h-4 w-4 shrink-0" />
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
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Truck className="h-4 w-4 shrink-0" />
                        <span>
                          {t("supplier.deliverBy")}: {wi.pickupStr}
                          {wi.pickupWindow ? ` · ${wi.pickupWindow}` : ""}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Delivered totals to the point — the supplier brings the whole
                      amount per product (reduced if short), NOT per buyer. */}
                  {(() => {
                    const publishedMap = publishedDeliveredFor(group);
                    return (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("supplier.delivered.title")}</p>
                        <div className="rounded-md border divide-y">
                          {group.products.map((product) => {
                            const val = deliveredValue(group.nodeRef, product, publishedMap);
                            const short = (Number.parseFloat(val) || 0) < product.qty;
                            return (
                              <div key={product.key} className="flex items-center gap-2 p-3 flex-wrap">
                                <span className="flex-1 min-w-0">
                                  <span className="text-base font-medium">{product.title}</span>
                                  <span className="text-sm text-muted-foreground">
                                    {" · "}
                                    {t("supplier.delivered.ordered")} {product.qty} {product.unit}
                                  </span>
                                </span>
                                <Input
                                  type="number"
                                  min="0"
                                  step={isWholeUnit(product.unit) ? "1" : "0.1"}
                                  inputMode={isWholeUnit(product.unit) ? "numeric" : "decimal"}
                                  value={val}
                                  onChange={(e) => {
                                    let v = e.target.value;
                                    if (isWholeUnit(product.unit) && v) v = String(Math.floor(Number.parseFloat(v) || 0));
                                    setDelivered(group.nodeRef, product.key, v);
                                  }}
                                  className={`h-10 w-24 shrink-0 text-lg font-bold tabular-nums ${short ? "border-amber-500" : ""}`}
                                />
                                <span className="text-sm text-muted-foreground w-10 shrink-0">{product.unit}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Button type="button" size="sm" className="gap-2" disabled={isPublishing} onClick={() => publishDelivery(group)}>
                            <Truck className="h-4 w-4" />
                            {t("supplier.delivered.publish")}
                          </Button>
                          <p className="text-sm text-muted-foreground">{t("supplier.ordersCount", { count: group.orderCount })}</p>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
