import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, ImagePlus, Loader2, MapPin, Plus, Printer, RefreshCw, Save, Scale, Sparkles, Store, X } from "lucide-react";
import { toast } from "sonner";
import { AddressSearch } from "@/components/AddressSearch";
import LocationPicker from "@/components/LocationPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import { FOOD_CORNER_ALLOCATION_KIND, FOOD_CORNER_NODE_KIND, FoodCornerNodeStatus, FoodCornerOrderWithFulfillment } from "@/types/foodCorner";
import {
  describeFoodCornerPause,
  foodCornerItemKey,
  foodCornerWeekRange,
  formatFoodMoney,
  generateFoodCornerId,
  groupOrdersByNode,
  reconcileOrderItems,
  slugifyFoodCorner,
} from "@/lib/foodCorner";
import { uploadToLanaMedia } from "@/lib/lanaMediaUpload";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function splitAreas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FoodCornerEcoPoint() {
  const { session } = useAuth();
  const { t, lang } = useTranslation(foodCornerTranslations);
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();
  const { nodes, producers, orders, isLoading, refetch } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();

  const dayLabel = (day?: string) => (day ? t(`days.${day.trim().toLowerCase()}` as FoodCornerKey) : "");
  const cycleLabel = (cycle?: string) => (cycle ? t(`cycle.${cycle}` as FoodCornerKey) : "");
  const statusLabel = (status?: string) =>
    status ? t(`ecoPoint.status.${status === "archived" ? "archived" : status}` as FoodCornerKey) : "";

  const myNodes = useMemo(
    () => nodes.filter((node) => node.pubkey === session?.nostrHexId),
    [nodes, session?.nostrHexId],
  );
  const [editingNodeRef, setEditingNodeRef] = useState<string>("");
  const editingNode = myNodes.find((node) => node.ref === editingNodeRef);

  const [showForm, setShowForm] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodeStatus, setNodeStatus] = useState<FoodCornerNodeStatus>("active");
  const [cycle, setCycle] = useState("weekly");
  const [cutoffDay, setCutoffDay] = useState("tuesday");
  const [cutoffTime, setCutoffTime] = useState("18:00");
  const [pickupLabel, setPickupLabel] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLon, setPickupLon] = useState("");
  const [pickupDay, setPickupDay] = useState("thursday");
  const [pickupWindow, setPickupWindow] = useState("16:00-19:00");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryDay, setDeliveryDay] = useState("thursday");
  const [deliveryWindow, setDeliveryWindow] = useState("16:00-20:00");
  const [deliveryRadius, setDeliveryRadius] = useState("20");
  const [areas, setAreas] = useState("");
  const [lud16, setLud16] = useState("");
  const [pauseFrom, setPauseFrom] = useState("");
  const [pauseUntil, setPauseUntil] = useState("");
  const [pauseNote, setPauseNote] = useState("");
  const [selectedSellers, setSelectedSellers] = useState<string[]>([]);
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [excludedListings, setExcludedListings] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error(t("ecoPoint.toast.loginRequired"));
      return;
    }
    setUploadingImage(true);
    try {
      const result = await uploadToLanaMedia(file, session.nostrPrivateKey, session.nostrHexId);
      setImageUrl(result.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ecoPoint.toast.imageFailed"));
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    if (!editingNodeRef && myNodes.length > 0) {
      setEditingNodeRef(myNodes[0].ref);
    }
  }, [editingNodeRef, myNodes]);

  useEffect(() => {
    if (!editingNode || !showForm) return;
    setName(editingNode.name);
    setDescription(editingNode.content);
    setNodeStatus(editingNode.status);
    setCycle(editingNode.cycle || "weekly");
    setCutoffDay(editingNode.orderCutoffDay || "tuesday");
    setCutoffTime(editingNode.orderCutoffTime || "18:00");
    setPickupLabel(editingNode.pickups[0]?.label || "");
    setPickupLat(editingNode.pickups[0]?.lat || editingNode.geoLat || "");
    setPickupLon(editingNode.pickups[0]?.lon || editingNode.geoLon || "");
    setPickupDay(editingNode.pickups[0]?.day || "thursday");
    setPickupWindow(editingNode.pickups[0]?.window || "16:00-19:00");
    setDeliveryEnabled(editingNode.fulfillment.includes("delivery"));
    setDeliveryDay(editingNode.deliveries[0]?.day || "thursday");
    setDeliveryWindow(editingNode.deliveries[0]?.window || "16:00-20:00");
    setDeliveryRadius(editingNode.deliveries[0]?.radiusKm || "20");
    setAreas(editingNode.areas.join(", "));
    setLud16(editingNode.lud16);
    setPauseFrom(editingNode.pause.from);
    setPauseUntil(editingNode.pause.until);
    setPauseNote(editingNode.pause.note);
    setSelectedSellers(editingNode.sellers);
    setSelectedListings(editingNode.listings);
    setExcludedListings(editingNode.excludes);
    setImageUrl(editingNode.images[0] || "");
  }, [editingNode, showForm]);

  const startNew = () => {
    setEditingNodeRef("");
    setShowForm(true);
    setName("");
    setDescription("");
    setNodeStatus("active");
    setCycle("weekly");
    setCutoffDay("tuesday");
    setCutoffTime("18:00");
    setPickupLabel("");
    setPickupLat("");
    setPickupLon("");
    setPickupDay("thursday");
    setPickupWindow("16:00-19:00");
    setDeliveryEnabled(false);
    setDeliveryDay("thursday");
    setDeliveryWindow("16:00-20:00");
    setDeliveryRadius("20");
    setAreas("");
    setLud16("");
    setPauseFrom("");
    setPauseUntil("");
    setPauseNote("");
    setSelectedSellers([]);
    setSelectedListings([]);
    setExcludedListings([]);
    setImageUrl("");
  };

  const toggleSeller = (sellerRef: string, checked: boolean) => {
    setSelectedSellers((current) =>
      checked ? Array.from(new Set([...current, sellerRef])) : current.filter((item) => item !== sellerRef),
    );
    if (!checked) {
      setExcludedListings((current) => current.filter((listingRef) => {
        const producer = producers.find((item) => item.unitRef === sellerRef);
        return !producer?.listings.some((listing) => listing.ref === listingRef);
      }));
    }
  };

  const toggleListing = (sellerRef: string, listingRef: string, checked: boolean) => {
    const sellerSelected = selectedSellers.includes(sellerRef);
    if (sellerSelected) {
      setExcludedListings((current) =>
        checked ? current.filter((item) => item !== listingRef) : Array.from(new Set([...current, listingRef])),
      );
      return;
    }

    setSelectedListings((current) =>
      checked ? Array.from(new Set([...current, listingRef])) : current.filter((item) => item !== listingRef),
    );
  };

  const saveNode = async () => {
    if (!lana8WonderStatus.exists) {
      toast.error(t("ecoPoint.toast.needLana8Wonder"));
      return;
    }
    if (!name.trim()) {
      toast.error(t("ecoPoint.toast.enterName"));
      return;
    }
    if (!pickupLabel.trim()) {
      toast.error(t("ecoPoint.toast.enterPickup"));
      return;
    }
    if (!pickupLat.trim() || !pickupLon.trim()) {
      toast.error(t("ecoPoint.toast.pickLocation"));
      return;
    }
    if (!Number.isFinite(Number.parseFloat(pickupLat)) || !Number.isFinite(Number.parseFloat(pickupLon))) {
      toast.error(t("ecoPoint.toast.invalidCoords"));
      return;
    }
    if (pauseFrom && pauseUntil && pauseFrom > pauseUntil) {
      toast.error(t("ecoPoint.toast.pauseOrder"));
      return;
    }
    if (selectedSellers.length + selectedListings.length === 0) {
      toast.error(t("ecoPoint.toast.pickSupplier"));
      return;
    }

    const dTag = editingNode?.dTag || slugifyFoodCorner(name) || generateFoodCornerId("dp");
    const areaTags = splitAreas(areas);
    const tags: string[][] = [
      ["d", dTag],
      ["name", name.trim()],
      ["status", nodeStatus],
      ["fulfillment", "pickup"],
      ...(deliveryEnabled ? [["fulfillment", "delivery"]] : []),
      ...selectedSellers.map((sellerRef) => ["seller", sellerRef]),
      ...selectedListings.map((listingRef) => ["listing", listingRef]),
      ...excludedListings.map((listingRef) => ["exclude", listingRef]),
      ["cycle", cycle],
      ["order_cutoff", cutoffDay, cutoffTime],
      ["pickup", "p1", pickupLabel.trim(), pickupLat.trim(), pickupLon.trim(), pickupDay, pickupWindow.trim()],
      ...(deliveryEnabled ? [["delivery", deliveryDay, deliveryWindow.trim(), deliveryRadius.trim()]] : []),
      ...(pickupLat.trim() && pickupLon.trim() ? [["geo", pickupLat.trim(), pickupLon.trim(), pickupLabel.trim()]] : []),
      ...areaTags.map((area) => ["area", area]),
      ...(lud16.trim() ? [["lud16", lud16.trim()]] : []),
      ...(imageUrl.trim() ? [["image", imageUrl.trim()]] : []),
      ...(nodeStatus === "paused" || pauseFrom.trim() || pauseUntil.trim() || pauseNote.trim()
        ? [["pause", pauseFrom.trim(), pauseUntil.trim(), pauseNote.trim()]]
        : []),
      ["t", "eco_point"],
    ];

    try {
      await publishEvent(FOOD_CORNER_NODE_KIND, tags, description.trim());
      toast.success(t("ecoPoint.toast.published"));
      setShowForm(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ecoPoint.toast.failed"));
    }
  };

  const myNodeRefs = new Set(myNodes.map((node) => node.ref));
  const myNodeOrders = orders.filter((order) => myNodeRefs.has(order.distributionPoint));

  // Orders view: group by buyer or supplier, paginated by the Točka Obilja cycle
  // (pickup day → pickup day, e.g. Thursday→Thursday — when orders are fulfilled),
  // latest cycle first. Anchor to the pickup day (NOT the earlier cutoff day).
  const [ordersGroupBy, setOrdersGroupBy] = useState<"buyer" | "seller">("buyer");
  const [ordersWeekOffset, setOrdersWeekOffset] = useState(0);
  const ordersAnchorDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of myNodes) {
      const day = n.pickups?.[0]?.day?.trim().toLowerCase();
      if (day) counts[day] = (counts[day] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "thursday";
  }, [myNodes]);
  const ordersWeek = useMemo(
    () => foodCornerWeekRange(ordersWeekOffset, ordersAnchorDay),
    [ordersWeekOffset, ordersAnchorDay],
  );

  // Resolve KIND 0 names for every buyer that ordered through my Eco points.
  const buyerPubkeys = useMemo(
    () => Array.from(new Set(myNodeOrders.map((o) => o.buyerPubkey))),
    [myNodeOrders],
  );
  const { profiles: buyerProfiles } = useNostrProfilesCacheBulk(buyerPubkeys);
  const buyerName = (pk: string) =>
    buyerProfiles.get(pk)?.display_name || buyerProfiles.get(pk)?.full_name || `${pk.slice(0, 12)}…`;

  const weekOrders = useMemo(
    () =>
      myNodeOrders.filter((order) => {
        const ms = order.createdAt * 1000;
        return ms >= ordersWeek.start.getTime() && ms < ordersWeek.end.getTime();
      }),
    [myNodeOrders, ordersWeek],
  );

  // Per-node summary cards (count + total) reflect the SELECTED cycle, so they
  // stay consistent with the week paginator and detailed list below.
  const groupedOrders = useMemo(() => groupOrdersByNode(weekOrders), [weekOrders]);

  // Shortage summary: per product across ALL buyers in the cycle — total ordered
  // vs total delivered (from supplier 36602). Flags where delivered < ordered.
  interface ShortageRow {
    key: string;
    title: string;
    unit: string;
    ordered: number;
    delivered: number;
    hasDelivered: boolean;
  }
  const shortageRows = useMemo<ShortageRow[]>(() => {
    const map = new Map<string, ShortageRow>();
    for (const order of weekOrders) {
      for (const r of reconcileOrderItems(order)) {
        const key = foodCornerItemKey(r.listingRef, r.unit);
        let row = map.get(key);
        if (!row) {
          row = { key, title: r.title || r.listingRef.slice(-6), unit: r.unit, ordered: 0, delivered: 0, hasDelivered: false };
          map.set(key, row);
        }
        row.ordered += r.orderedQty;
        if (r.deliveredQty != null) {
          row.delivered += r.deliveredQty;
          row.hasDelivered = true;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [weekOrders]);

  // Per-buyer allocation editor state: orderDTag → itemKey → qty string.
  const [allocState, setAllocState] = useState<Record<string, Record<string, string>>>({});
  const [allocOpen, setAllocOpen] = useState<Record<string, boolean>>({});

  // Current allocation rows for an order: local edits override the published
  // allocation, which defaults to delivered ?? ordered.
  const allocRowsFor = (order: FoodCornerOrderWithFulfillment) => {
    const local = allocState[order.dTag] || {};
    return reconcileOrderItems(order).map((r) => {
      const key = foodCornerItemKey(r.listingRef, r.unit);
      const stored = local[key];
      const defaultQty = r.allocatedQty ?? r.deliveredQty ?? r.orderedQty;
      return { recon: r, key, qty: stored ?? String(defaultQty) };
    });
  };

  const setAllocQty = (orderDTag: string, key: string, qty: string) =>
    setAllocState((cur) => ({ ...cur, [orderDTag]: { ...(cur[orderDTag] || {}), [key]: qty } }));

  // Publish KIND 36603 allocation for one order (full per-item set, latest-wins).
  const publishAllocation = async (order: FoodCornerOrderWithFulfillment) => {
    if (!myNodeRefs.has(order.distributionPoint)) return;
    const rows = allocRowsFor(order);
    const total = rows.reduce((sum, { recon, qty }) => sum + (Number.parseFloat(qty) || 0) * recon.unitPrice, 0);
    const currency = rows[0]?.recon.currency || order.currency || "EUR";
    try {
      await publishEvent(
        FOOD_CORNER_ALLOCATION_KIND,
        [
          ["d", order.dTag],
          ["a", order.ref],
          ["p", order.buyerPubkey],
          ["distribution_point", order.distributionPoint],
          ...rows.map(({ recon, qty }) => [
            "alloc",
            recon.listingRef,
            String(Number.parseFloat(qty) || 0),
            recon.unit,
            recon.unitPrice.toFixed(2),
            recon.currency,
          ]),
          ["total", total.toFixed(2), currency],
        ],
        "",
      );
      toast.success(t("ecoPoint.toast.allocPublished"));
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ecoPoint.toast.allocFailed"));
    }
  };

  interface BuyerSub {
    pubkey: string;
    name: string;
    orders: FoodCornerOrderWithFulfillment[];
    total: number;
  }
  interface OrderGroup {
    key: string;
    label: string;
    orders: FoodCornerOrderWithFulfillment[];
    total: number;
    currency: string;
    buyers: BuyerSub[] | null; // buyer breakdown (only in "by supplier" mode)
  }

  const orderGroups = useMemo<OrderGroup[]>(() => {
    const map = new Map<string, OrderGroup>();
    const buyerSubs = new Map<string, Map<string, BuyerSub>>(); // groupKey -> buyerPk -> sub
    for (const order of weekOrders) {
      const bySeller = ordersGroupBy === "seller";
      const key = bySeller ? order.sellerRef : order.buyerPubkey;
      const label = bySeller
        ? producers.find((p) => p.unitRef === order.sellerRef)?.name || `${order.sellerPubkey.slice(0, 12)}…`
        : buyerName(order.buyerPubkey);
      const group =
        map.get(key) || { key, label, orders: [], total: 0, currency: order.currency, buyers: bySeller ? [] : null };
      group.orders.push(order);
      group.total += order.total;
      map.set(key, group);

      if (bySeller) {
        const subs = buyerSubs.get(key) || new Map<string, BuyerSub>();
        const sub =
          subs.get(order.buyerPubkey) || { pubkey: order.buyerPubkey, name: buyerName(order.buyerPubkey), orders: [], total: 0 };
        sub.orders.push(order);
        sub.total += order.total;
        subs.set(order.buyerPubkey, sub);
        buyerSubs.set(key, subs);
      }
    }
    const groups = Array.from(map.values());
    for (const group of groups) {
      const subs = buyerSubs.get(group.key);
      if (subs) group.buyers = Array.from(subs.values()).sort((a, b) => b.total - a.total);
    }
    return groups.sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOrders, ordersGroupBy, producers, buyerProfiles]);
  const ordersLocale = lang === "sl" ? "sl-SI" : undefined;
  const weekLabel = `${ordersWeek.start.toLocaleDateString(ordersLocale, { day: "numeric", month: "short" })} – ${new Date(
    ordersWeek.end.getTime() - 1,
  ).toLocaleDateString(ordersLocale, { day: "numeric", month: "short", year: "numeric" })}`;

  // Supplier (business unit) name for an order — the point needs to see who
  // supplies each product.
  const producerName = (order: FoodCornerOrderWithFulfillment) =>
    producers.find((p) => p.unitRef === order.sellerRef)?.name || `${order.sellerPubkey.slice(0, 12)}…`;
  const nodeName = (ref: string) => nodes.find((n) => n.ref === ref)?.name || t("ecoPoint.orders.direct");
  // Product name; deleted listings (gone from relays) fall back to a clear label
  // instead of a bare ref hash.
  const itemLabel = (item: { listing?: { title?: string }; listingRef: string }) =>
    item.listing?.title || `${t("supplier.unknownProduct")} (${item.listingRef.slice(-6)})`;

  // Buyers in the selected cycle (independent of the buyer/seller toggle), used
  // for the printable per-buyer and all-buyers lists.
  interface PrintBuyer {
    name: string;
    orders: FoodCornerOrderWithFulfillment[];
    total: number;
    currency: string;
  }
  const buyersInWeek = useMemo<PrintBuyer[]>(() => {
    const map = new Map<string, PrintBuyer>();
    for (const o of weekOrders) {
      let b = map.get(o.buyerPubkey);
      if (!b) {
        b = { name: buyerName(o.buyerPubkey), orders: [], total: 0, currency: o.currency || "EUR" };
        map.set(o.buyerPubkey, b);
      }
      b.orders.push(o);
      b.total += o.total;
      if (o.currency) b.currency = o.currency;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOrders, buyerProfiles]);

  const escapeHtml = (value: string) =>
    value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

  const buildPrintHtml = (buyers: PrintBuyer[]) => {
    const cycle = ordersWeekOffset === 0 ? t("ecoPoint.orders.thisWeek") : weekLabel;
    const pointNames = Array.from(
      new Set(buyers.flatMap((b) => b.orders.map((o) => nodeName(o.distributionPoint)))),
    ).join(", ");
    const sections = buyers
      .map((b) => {
        const rows = b.orders
          .flatMap((o) =>
            o.items.map(
              (it) =>
                `<tr><td>${escapeHtml(itemLabel(it))}</td>` +
                `<td class="num">${escapeHtml(`${it.qty} ${it.unit}`)}</td>` +
                `<td>${escapeHtml(producerName(o))}</td>` +
                `<td class="num">${escapeHtml(formatFoodMoney(it.qty * it.unitPrice, it.currency))}</td></tr>`,
            ),
          )
          .join("");
        return (
          `<section><h2>${escapeHtml(b.name)}</h2><table><thead><tr>` +
          `<th>${escapeHtml(t("ecoPoint.print.product"))}</th>` +
          `<th class="num">${escapeHtml(t("ecoPoint.print.qty"))}</th>` +
          `<th>${escapeHtml(t("ecoPoint.orders.supplier"))}</th>` +
          `<th class="num">${escapeHtml(t("ecoPoint.print.price"))}</th>` +
          `</tr></thead><tbody>${rows}</tbody></table>` +
          `<p class="total">${escapeHtml(t("ecoPoint.print.total"))}: ${escapeHtml(formatFoodMoney(b.total, b.currency))}</p></section>`
        );
      })
      .join("");
    return (
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t("ecoPoint.print.title"))}</title><style>` +
      `*{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif}body{margin:24px;color:#111}` +
      `h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:13px;margin:0 0 18px}` +
      `section{margin:0 0 22px;page-break-inside:avoid}section+section{page-break-before:always}` +
      `h2{font-size:16px;margin:0 0 8px;border-bottom:2px solid #111;padding-bottom:4px}` +
      `table{width:100%;border-collapse:collapse;font-size:13px}` +
      `th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}th{background:#f4f4f4}` +
      `.num{text-align:right;white-space:nowrap}.total{text-align:right;font-weight:700;margin-top:8px;font-size:14px}` +
      `@media print{body{margin:12mm}}</style></head><body>` +
      `<h1>${escapeHtml(t("ecoPoint.print.title"))}</h1>` +
      `<p class="meta">${escapeHtml(pointNames)} · ${escapeHtml(cycle)}</p>` +
      (sections || `<p>${escapeHtml(t("ecoPoint.orders.weekEmpty"))}</p>`) +
      `</body></html>`
    );
  };

  const printBuyers = (buyers: PrintBuyer[]) => {
    if (buyers.length === 0) {
      toast.error(t("ecoPoint.print.empty"));
      return;
    }
    const win = window.open("", "_blank");
    if (!win) {
      toast.error(t("ecoPoint.print.popupBlocked"));
      return;
    }
    win.document.write(buildPrintHtml(buyers));
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 300);
  };

  const renderOrderRow = (order: FoodCornerOrderWithFulfillment) => {
    const open = allocOpen[order.dTag] ?? false;
    const rows = allocRowsFor(order);
    return (
      <div key={order.ref} className="text-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1">
          <div className="flex items-start gap-2 min-w-0">
            <Badge variant={order.fulfillmentStatus ? "default" : "secondary"} className="shrink-0">
              {order.fulfillmentStatus || order.status}
            </Badge>
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary flex items-center gap-1">
                <Store className="h-3 w-3 shrink-0" />
                {producerName(order)}
              </p>
              <span className="text-muted-foreground">
                {order.items.map((item) => `${item.qty} ${item.unit} ${itemLabel(item)}`).join(" · ")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {order.allocation && <Check className="h-4 w-4 text-green-600" />}
            <span className="font-medium">{formatFoodMoney(order.allocation?.total ?? order.total, order.currency)}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1"
              onClick={() => setAllocOpen((c) => ({ ...c, [order.dTag]: !open }))}
            >
              <Scale className="h-3.5 w-3.5" />
              {t("ecoPoint.alloc.allocate")}
            </Button>
          </div>
        </div>
        {open && (
          <div className="mt-2 rounded-md border p-3 space-y-2 bg-muted/30">
            {rows.map(({ recon, key, qty }) => (
              <div key={key} className="flex items-center gap-2 flex-wrap">
                <span className="flex-1 min-w-0 truncate">
                  {recon.title || recon.listingRef.slice(-6)}
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("ecoPoint.alloc.ordered")} {recon.orderedQty}
                    {recon.deliveredQty != null ? ` · ${t("ecoPoint.alloc.delivered")} ${recon.deliveredQty}` : ""} {recon.unit}
                  </span>
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={qty}
                  onChange={(e) => setAllocQty(order.dTag, key, e.target.value)}
                  className="h-9 w-20 shrink-0 tabular-nums"
                />
                <span className="text-muted-foreground w-10 shrink-0">{recon.unit}</span>
              </div>
            ))}
            <Button type="button" size="sm" className="gap-2" disabled={isPublishing} onClick={() => publishAllocation(order)}>
              <Check className="h-4 w-4" />
              {t("ecoPoint.alloc.publish")}
            </Button>
          </div>
        )}
      </div>
    );
  };
  const pickupLatNumber = Number.parseFloat(pickupLat);
  const pickupLonNumber = Number.parseFloat(pickupLon);
  const hasPickupCoordinates = Number.isFinite(pickupLatNumber) && Number.isFinite(pickupLonNumber);

  if (isLoading || lana8WonderLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("ecoPoint.heading.manage")}</h2>
          <p className="text-sm text-muted-foreground">{t("ecoPoint.subtitle.manage")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!lana8WonderStatus.exists && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>{t("ecoPoint.alert.lana8WonderOnly")}</AlertDescription>
        </Alert>
      )}

      {myNodes.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {myNodes.map((node) => (
            <Card
              key={node.ref}
              className={`cursor-pointer ${editingNodeRef === node.ref ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"} ${node.status === "archived" ? "opacity-70" : ""}`}
              onClick={() => setEditingNodeRef(node.ref)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{node.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{node.content}</p>
                  </div>
                  <Badge>{statusLabel(node.status)}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{t("ecoPoint.badge.suppliers", { count: node.sellers.length })}</Badge>
                  <Badge variant="secondary">{t("ecoPoint.badge.offers", { count: node.listings.length })}</Badge>
                  <Badge variant="outline">{cycleLabel(node.cycle) || node.cycle || "cycle"}</Badge>
                </div>
                {(node.status === "paused" || describeFoodCornerPause(node)) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("ecoPoint.label.pause")}{describeFoodCornerPause(node) ? ` · ${describeFoodCornerPause(node)}` : ""}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingNodeRef(node.ref);
                    setShowForm(true);
                  }}
                >
                  {t("ecoPoint.button.edit")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create button only when the owner has no Eco point yet — once they have one,
          editing happens via the per-card "Uredi" button (no duplicate create/edit). */}
      {myNodes.length === 0 && (
        <div className="flex">
          <Button onClick={startNew} disabled={!lana8WonderStatus.exists} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("ecoPoint.button.create")}
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingNode ? t("ecoPoint.form.titleEdit") : t("ecoPoint.form.titleNew")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.name")}</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("ecoPoint.form.namePlaceholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.paymentAddress")}</Label>
                <Input value={lud16} onChange={(event) => setLud16(event.target.value)} placeholder="center@lanapays.us" />
                <p className="text-xs text-muted-foreground">{t("ecoPoint.form.paymentHint")}</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t("ecoPoint.form.description")}</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("ecoPoint.form.image")}</Label>
              {imageUrl ? (
                <div className="relative w-full max-w-xs">
                  <img src={imageUrl} alt="" className="rounded-lg border w-full aspect-video object-cover" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2 gap-1"
                    onClick={() => setImageUrl("")}
                  >
                    <X className="h-3 w-3" />
                    {t("ecoPoint.form.imageRemove")}
                  </Button>
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:border-primary/50 w-full max-w-xs">
                  {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {uploadingImage ? t("ecoPoint.form.imageUploading") : t("ecoPoint.form.imageUpload")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(event) => handleImageUpload(event.target.files?.[0])}
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">{t("ecoPoint.form.imageHint")}</p>
            </div>

            <div className="grid md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.status")}</Label>
                <Select value={nodeStatus} onValueChange={(value) => setNodeStatus(value as FoodCornerNodeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("ecoPoint.status.active")}</SelectItem>
                    <SelectItem value="paused">{t("ecoPoint.status.paused")}</SelectItem>
                    <SelectItem value="archived">{t("ecoPoint.status.archived")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cycle")}</Label>
                <Select value={cycle} onValueChange={setCycle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">{t("cycle.weekly")}</SelectItem>
                    <SelectItem value="biweekly">{t("cycle.biweekly")}</SelectItem>
                    <SelectItem value="monthly">{t("cycle.monthly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cutoffDay")}</Label>
                <Select value={cutoffDay} onValueChange={setCutoffDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{dayLabel(day)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cutoffTime")}</Label>
                <Input value={cutoffTime} onChange={(event) => setCutoffTime(event.target.value)} placeholder="18:00" />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.areas")}</Label>
                <Input value={areas} onChange={(event) => setAreas(event.target.value)} placeholder="1000 Ljubljana, 1295 ..." />
              </div>
            </div>

            {(nodeStatus === "paused" || pauseFrom || pauseUntil || pauseNote) && (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseFrom")}</Label>
                  <Input type="date" value={pauseFrom} onChange={(event) => setPauseFrom(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseUntil")}</Label>
                  <Input type="date" value={pauseUntil} onChange={(event) => setPauseUntil(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseReason")}</Label>
                  <Input value={pauseNote} onChange={(event) => setPauseNote(event.target.value)} placeholder={t("ecoPoint.form.pauseReasonPlaceholder")} />
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupLocation")}</Label>
                <Input value={pickupLabel} onChange={(event) => setPickupLabel(event.target.value)} placeholder={t("ecoPoint.form.pickupLocationPlaceholder")} />
              </div>
              <AddressSearch
                onLocationChange={(lat, lng, displayName) => {
                  setPickupLat(lat);
                  setPickupLon(lng);
                  if (displayName) setPickupLabel(displayName);
                }}
                labels={{
                  autoDetect: t("ecoPoint.addr.autoDetect"),
                  placeholder: t("ecoPoint.addr.placeholder"),
                  noResults: t("ecoPoint.addr.noResults"),
                  selectLocation: t("ecoPoint.addr.selectLocation"),
                  searchFailed: t("ecoPoint.addr.searchFailed"),
                  permissionDenied: t("ecoPoint.addr.permissionDenied"),
                  geoUnavailable: t("ecoPoint.addr.geoUnavailable"),
                }}
              />
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setShowLocationPicker(true)} className="gap-2">
                  <MapPin className="h-4 w-4" />
                  {t("ecoPoint.form.pickOnMap")}
                </Button>
                {hasPickupCoordinates && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {pickupLatNumber.toFixed(6)}, {pickupLonNumber.toFixed(6)}
                  </span>
                )}
              </div>
              {hasPickupCoordinates && (
                <div className="overflow-hidden rounded-lg border">
                  <iframe
                    title={t("ecoPoint.iframe.title")}
                    width="100%"
                    height="220"
                    className="block"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${pickupLonNumber - 0.01},${pickupLatNumber - 0.007},${pickupLonNumber + 0.01},${pickupLatNumber + 0.007}&layer=mapnik&marker=${pickupLat},${pickupLon}`}
                  />
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${pickupLat}&mlon=${pickupLon}#map=16/${pickupLat}/${pickupLon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2 text-center text-xs text-primary hover:underline"
                  >
                    {t("ecoPoint.form.openInOSM")}
                  </a>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupWindow")}</Label>
                <Input value={pickupWindow} onChange={(event) => setPickupWindow(event.target.value)} placeholder="16:00-19:00" />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupDay")}</Label>
                <Select value={pickupDay} onValueChange={setPickupDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{dayLabel(day)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4 items-end">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={deliveryEnabled} onCheckedChange={(checked) => setDeliveryEnabled(checked === true)} />
                {t("ecoPoint.form.enableDelivery")}
              </label>
              {deliveryEnabled && (
                <>
                  <Input value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)} placeholder="16:00-20:00" />
                  <Input value={deliveryRadius} onChange={(event) => setDeliveryRadius(event.target.value)} placeholder="20 km" />
                </>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">{t("ecoPoint.suppliers.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("ecoPoint.suppliers.subtitle")}</p>
              </div>
              {producers.length === 0 ? (
                <Card>
                  <CardContent className="p-5 text-sm text-muted-foreground">
                    {t("ecoPoint.suppliers.empty")}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {producers.map((producer) => {
                    const sellerSelected = selectedSellers.includes(producer.unitRef);
                    return (
                      <Card key={producer.unitRef}>
                        <CardContent className="p-4 space-y-3">
                          <label className="flex items-start gap-3">
                            <Checkbox
                              checked={sellerSelected}
                              onCheckedChange={(checked) => toggleSeller(producer.unitRef, checked === true)}
                              className="mt-1"
                            />
                            <span className="flex-1">
                              <span className="font-medium block">{producer.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {t("ecoPoint.suppliers.producerLine", {
                                  place: producer.city || producer.country || producer.pubkey.slice(0, 10),
                                  count: producer.listings.length,
                                })}
                              </span>
                            </span>
                          </label>

                          <div className="grid md:grid-cols-2 gap-2 pl-7">
                            {producer.listings.map((listing) => {
                              const checked = sellerSelected
                                ? !excludedListings.includes(listing.ref)
                                : selectedListings.includes(listing.ref);
                              return (
                                <label key={listing.ref} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) => toggleListing(producer.unitRef, listing.ref, value === true)}
                                  />
                                  <span className="flex-1 truncate">{listing.title}</span>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {formatFoodMoney(listing.price, listing.priceCurrency)}/{listing.unit}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={saveNode} disabled={isPublishing} className="gap-2">
                {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("ecoPoint.button.publish")}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>{t("ecoPoint.button.close")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showLocationPicker && (
        <LocationPicker
          initialLat={hasPickupCoordinates ? pickupLatNumber : undefined}
          initialLng={hasPickupCoordinates ? pickupLonNumber : undefined}
          onLocationSelect={(lat, lng) => {
            setPickupLat(lat.toFixed(6));
            setPickupLon(lng.toFixed(6));
          }}
          onClose={() => setShowLocationPicker(false)}
          labels={{
            title: t("ecoPoint.picker.title"),
            hint: t("ecoPoint.picker.hint"),
            selected: t("ecoPoint.picker.selected"),
            cancel: t("ecoPoint.picker.cancel"),
            confirm: t("ecoPoint.picker.confirm"),
            myLocation: t("ecoPoint.picker.myLocation"),
            locating: t("ecoPoint.picker.locating"),
          }}
        />
      )}

      <div className="space-y-3 pt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">{t("ecoPoint.orders.title")}</h2>
          {buyersInWeek.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => printBuyers(buyersInWeek)}>
              <Printer className="h-4 w-4" />
              {t("ecoPoint.print.all")}
            </Button>
          )}
        </div>
        {myNodeOrders.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              {t("ecoPoint.orders.empty")}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-3 gap-3">
              {groupedOrders.map((group) => {
                const node = myNodes.find((item) => item.ref === group.nodeRef);
                return (
                  <Card key={group.nodeRef}>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">{node?.name || t("ecoPoint.orders.direct")}</p>
                      <p className="text-2xl font-bold">{group.orders.length}</p>
                      <p className="text-sm font-medium">{formatFoodMoney(group.total, group.currency)}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Shortage summary: ordered vs delivered per product across all buyers */}
            {shortageRows.some((r) => r.hasDelivered) && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {t("ecoPoint.shortage.title")}
                  </p>
                  <div className="rounded-md border divide-y">
                    {shortageRows
                      .filter((r) => r.hasDelivered)
                      .map((r) => {
                        const short = r.delivered < r.ordered;
                        return (
                          <div key={r.key} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                            <span className="font-medium truncate">{r.title}</span>
                            <span className="shrink-0 tabular-nums flex items-center gap-3">
                              <span className="text-muted-foreground">
                                {t("ecoPoint.shortage.ordered")} {r.ordered} · {t("ecoPoint.shortage.delivered")} {r.delivered} {r.unit}
                              </span>
                              {short && (
                                <Badge variant="destructive">
                                  −{Number((r.ordered - r.delivered).toFixed(2))} {r.unit}
                                </Badge>
                              )}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Group-by toggle + week paginator (latest week first, page back week by week) */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={ordersGroupBy === "buyer" ? "default" : "ghost"}
                  onClick={() => setOrdersGroupBy("buyer")}
                >
                  {t("ecoPoint.orders.groupBuyer")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={ordersGroupBy === "seller" ? "default" : "ghost"}
                  onClick={() => setOrdersGroupBy("seller")}
                >
                  {t("ecoPoint.orders.groupSeller")}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setOrdersWeekOffset((o) => o + 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("ecoPoint.orders.prevWeek")}
                </Button>
                <span className="text-sm font-medium min-w-[9rem] text-center">
                  {ordersWeekOffset === 0 ? t("ecoPoint.orders.thisWeek") : weekLabel}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={ordersWeekOffset === 0}
                  onClick={() => setOrdersWeekOffset((o) => Math.max(0, o - 1))}
                >
                  {t("ecoPoint.orders.nextWeek")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {orderGroups.length === 0 ? (
              <Card>
                <CardContent className="p-5 text-sm text-muted-foreground">{t("ecoPoint.orders.weekEmpty")}</CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {orderGroups.map((group) => (
                  <Card key={group.key}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {ordersGroupBy === "buyer" ? t("ecoPoint.orders.buyer") : t("ecoPoint.orders.supplier")}
                          </p>
                          <p className="font-semibold truncate">{group.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("ecoPoint.orders.count", { count: group.orders.length })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-lg font-bold">{formatFoodMoney(group.total, group.currency)}</span>
                          {ordersGroupBy === "buyer" && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title={t("ecoPoint.print.one")}
                              onClick={() =>
                                printBuyers([
                                  { name: group.label, orders: group.orders, total: group.total, currency: group.currency },
                                ])
                              }
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="border-t pt-2">
                        {group.buyers ? (
                          <div className="space-y-3">
                            {group.buyers.map((sub) => (
                              <div key={sub.pubkey} className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium truncate">
                                    <span className="font-normal text-muted-foreground">{t("ecoPoint.orders.buyer")}: </span>
                                    {sub.name}
                                    <span className="font-normal text-xs text-muted-foreground">
                                      {" · "}
                                      {t("ecoPoint.orders.count", { count: sub.orders.length })}
                                    </span>
                                  </p>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-sm font-semibold">{formatFoodMoney(sub.total, group.currency)}</span>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      title={t("ecoPoint.print.one")}
                                      onClick={() =>
                                        printBuyers([
                                          { name: sub.name, orders: sub.orders, total: sub.total, currency: group.currency },
                                        ])
                                      }
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="space-y-1 pl-3 border-l">{sub.orders.map(renderOrderRow)}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">{group.orders.map(renderOrderRow)}</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
