import type { BusinessUnit } from "@/hooks/useNostrBusinessUnits";
import {
  FOOD_CORNER_FULFILLMENT_KIND,
  FOOD_CORNER_LISTING_KIND,
  FOOD_CORNER_NODE_KIND,
  FOOD_CORNER_ORDER_KIND,
  FoodCornerARef,
  FoodCornerFulfillment,
  FoodCornerListing,
  FoodCornerNode,
  FoodCornerOrder,
  FoodCornerOrderWithFulfillment,
  FoodCornerProducer,
  FoodCornerRawEvent,
} from "@/types/foodCorner";

const SHOP_BASE_URL = "https://shop.lanapays.us";

export function parseARef(ref?: string | null): FoodCornerARef | null {
  if (!ref) return null;
  const first = ref.indexOf(":");
  if (first === -1) return null;
  const kind = ref.slice(0, first);
  const rest = ref.slice(first + 1);
  const second = rest.indexOf(":");
  if (second === -1) return null;
  return {
    kind,
    pubkey: rest.slice(0, second),
    d: rest.slice(second + 1),
  };
}

export function makeARef(kind: number | string, pubkey: string, dTag: string): string {
  return `${kind}:${pubkey}:${dTag}`;
}

export function shortPubkey(pubkey?: string | null): string {
  if (!pubkey) return "unknown";
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}` : pubkey;
}

export function formatFoodMoney(amount: number, currency = "EUR"): string {
  if (!Number.isFinite(amount)) return `0.00 ${currency}`;
  return `${amount.toFixed(2)} ${currency}`;
}

export function generateFoodCornerId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${new Date().toISOString().slice(0, 10)}-${random}`;
}

export function slugifyFoodCorner(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[šś]/g, "s")
    .replace(/[žź]/g, "z")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function getTag(event: FoodCornerRawEvent, name: string): string {
  return event.tags?.find((tag: string[]) => tag[0] === name)?.[1] || "";
}

function getTagFull(event: FoodCornerRawEvent, name: string): string[] | undefined {
  return event.tags?.find((tag: string[]) => tag[0] === name);
}

function getTags(event: FoodCornerRawEvent, name: string): string[] {
  return (event.tags || [])
    .filter((tag: string[]) => tag[0] === name)
    .map((tag: string[]) => tag[1])
    .filter(Boolean);
}

function getTagsFull(event: FoodCornerRawEvent, name: string): string[][] {
  return (event.tags || []).filter((tag: string[]) => tag[0] === name);
}

function fixImageUrl(url: string): string {
  if (!url) return "";
  return url.startsWith("/api/uploads/") ? `${SHOP_BASE_URL}${url}` : url;
}

export function parseFoodCornerNode(event: FoodCornerRawEvent): FoodCornerNode | null {
  const dTag = getTag(event, "d");
  if (!dTag) return null;
  const cutoff = getTagFull(event, "order_cutoff");
  const geo = getTagFull(event, "geo");
  const pause = getTagFull(event, "pause");

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    dTag,
    ref: makeARef(FOOD_CORNER_NODE_KIND, event.pubkey, dTag),
    name: getTag(event, "name") || "Eko točka",
    status: (getTag(event, "status") || "active") as FoodCornerNode["status"],
    fulfillment: getTags(event, "fulfillment"),
    sellers: getTags(event, "seller"),
    listings: getTags(event, "listing"),
    excludes: getTags(event, "exclude"),
    cycle: (getTag(event, "cycle") || "") as FoodCornerNode["cycle"],
    orderCutoffDay: cutoff?.[1] || "",
    orderCutoffTime: cutoff?.[2] || "",
    pickups: getTagsFull(event, "pickup").map((tag) => ({
      id: tag[1] || "",
      label: tag[2] || "",
      lat: tag[3] || "",
      lon: tag[4] || "",
      day: tag[5] || "",
      window: tag[6] || "",
    })),
    deliveries: getTagsFull(event, "delivery").map((tag) => ({
      day: tag[1] || "",
      window: tag[2] || "",
      radiusKm: tag[3] || "",
    })),
    geoLat: geo?.[1] || "",
    geoLon: geo?.[2] || "",
    geoLabel: geo?.[3] || "",
    areas: getTags(event, "area"),
    lud16: getTag(event, "lud16"),
    pause: {
      from: pause?.[1] || getTag(event, "pause_from"),
      until: pause?.[2] || getTag(event, "pause_until"),
      note: pause?.[3] || getTag(event, "pause_note"),
    },
    images: getTags(event, "image").map(fixImageUrl),
    websiteUrl: getTag(event, "website_url"),
    tags: getTags(event, "t"),
    content: event.content || "",
    rawEvent: event,
  };
}

export function parseFoodCornerListing(event: FoodCornerRawEvent): FoodCornerListing | null {
  const dTag = getTag(event, "d");
  const unitRef = getTag(event, "a");
  const title = getTag(event, "title");
  if (!dTag || !unitRef || !title) return null;

  const price = getTagFull(event, "price");
  const priceValue = Number.parseFloat(price?.[1] || "0");

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    listingId: dTag,
    dTag,
    ref: makeARef(FOOD_CORNER_LISTING_KIND, event.pubkey, dTag),
    unitRef,
    title,
    type: getTag(event, "type") || "product",
    price: Number.isFinite(priceValue) ? priceValue : 0,
    priceText: price?.[1] || "",
    priceCurrency: price?.[2] || "EUR",
    unit: getTag(event, "unit") || "piece",
    status: getTag(event, "status") || "active",
    stock: getTag(event, "stock"),
    minOrder: getTag(event, "min_order"),
    maxOrder: getTag(event, "max_order"),
    availableFrom: getTag(event, "available_from"),
    availableUntil: getTag(event, "available_until"),
    eco: getTags(event, "eco"),
    cert: getTags(event, "cert"),
    tags: getTags(event, "t"),
    delivery: getTags(event, "delivery"),
    marketDays: getTags(event, "market_day"),
    images: getTags(event, "image").map(fixImageUrl),
    thumbs: getTags(event, "thumb").map(fixImageUrl),
    content: event.content || "",
    rawEvent: event,
  };
}

export function parseFoodCornerOrder(event: FoodCornerRawEvent, listingMap: Map<string, FoodCornerListing>): FoodCornerOrder | null {
  const dTag = getTag(event, "d");
  const sellerRef = getTag(event, "a");
  if (!dTag || !sellerRef) return null;

  const seller = parseARef(sellerRef);
  const node = parseARef(getTag(event, "distribution_point"));
  const total = getTagFull(event, "total");

  const items = getTagsFull(event, "item").map((tag) => {
    const listingRef = tag[1] || "";
    const qty = Number.parseFloat(tag[2] || "0");
    const unitPrice = Number.parseFloat(tag[4] || "0");
    return {
      listingRef,
      qty: Number.isFinite(qty) ? qty : 0,
      unit: tag[3] || "",
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      currency: tag[5] || "EUR",
      listing: listingMap.get(listingRef),
    };
  });

  const totalValue = Number.parseFloat(total?.[1] || "0");

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    buyerPubkey: event.pubkey,
    createdAt: event.created_at,
    dTag,
    ref: makeARef(FOOD_CORNER_ORDER_KIND, event.pubkey, dTag),
    sellerRef,
    sellerPubkey: seller?.pubkey || "",
    sellerUnitId: seller?.d || "",
    buyerType: (getTag(event, "buyer_type") || "individual") as FoodCornerOrder["buyerType"],
    items,
    total: Number.isFinite(totalValue) ? totalValue : 0,
    currency: total?.[2] || items[0]?.currency || "EUR",
    status: (getTag(event, "status") || "placed") as FoodCornerOrder["status"],
    fulfillment: (getTag(event, "fulfillment") || "pickup") as FoodCornerOrder["fulfillment"],
    distributionPoint: getTag(event, "distribution_point"),
    nodePubkey: node?.pubkey || "",
    nodeDTag: node?.d || "",
    pickupPoint: getTag(event, "pickup_point"),
    requestedDate: getTag(event, "requested_date"),
    requestedWindow: getTag(event, "requested_window"),
    payment: getTags(event, "payment"),
    paid: getTag(event, "paid"),
    recurring: getTag(event, "recurring"),
    recurringUntil: getTag(event, "recurring_until"),
    tags: getTags(event, "t"),
    content: event.content || "",
    rawEvent: event,
  };
}

export function parseFoodCornerFulfillment(event: FoodCornerRawEvent): FoodCornerFulfillment | null {
  const dTag = getTag(event, "d");
  const orderRef = getTag(event, "a");
  if (!dTag || !orderRef) return null;

  const adjustTotal = getTagFull(event, "adjust_total");
  const settled = getTagFull(event, "settled");
  const adjustValue = Number.parseFloat(adjustTotal?.[1] || "");
  const settledAmount = Number.parseFloat(settled?.[1] || "");
  const settledRate = Number.parseFloat(settled?.[3] || "");

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    sellerPubkey: event.pubkey,
    createdAt: event.created_at,
    dTag,
    orderRef,
    buyerPubkey: getTag(event, "p"),
    status: (getTag(event, "status") || "received") as FoodCornerFulfillment["status"],
    eta: getTag(event, "eta"),
    deliveredAt: getTag(event, "delivered_at"),
    adjustTotal: Number.isFinite(adjustValue) ? adjustValue : null,
    adjustCurrency: adjustTotal?.[2] || "EUR",
    settledLanAmount: Number.isFinite(settledAmount) ? settledAmount : null,
    settledRate: Number.isFinite(settledRate) ? settledRate : null,
    settledAt: settled?.[4] || "",
    note: getTag(event, "note"),
    content: event.content || "",
    rawEvent: event,
  };
}

export function dedupeReplaceable<T extends { pubkey: string; dTag: string; createdAt: number; rawEvent?: { kind: number } }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = `${item.rawEvent?.kind || "replaceable"}:${item.pubkey}:${item.dTag}`;
    const existing = byKey.get(key);
    if (!existing || item.createdAt > existing.createdAt) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

export function latestFulfillmentForOrder(
  orderRef: string,
  fulfillments: FoodCornerFulfillment[],
): FoodCornerFulfillment | undefined {
  return fulfillments
    .filter((fulfillment) => fulfillment.orderRef === orderRef)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function enrichOrders(
  orders: FoodCornerOrder[],
  fulfillments: FoodCornerFulfillment[],
): FoodCornerOrderWithFulfillment[] {
  return orders.map((order) => {
    const fulfillmentEvent = latestFulfillmentForOrder(order.ref, fulfillments);
    return {
      ...order,
      fulfillmentEvent,
      fulfillmentStatus: fulfillmentEvent?.status,
    };
  });
}

export function resolveNodeCatalog(node: FoodCornerNode | undefined, listings: FoodCornerListing[]): FoodCornerListing[] {
  if (!node) return [];
  const sellers = new Set(node.sellers);
  const includedListings = new Set(node.listings);
  const excludes = new Set(node.excludes);

  return listings
    .filter((listing) => listing.status === "active")
    .filter((listing) => sellers.has(listing.unitRef) || includedListings.has(listing.ref))
    .filter((listing) => !excludes.has(listing.ref))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function isFoodCornerNodePaused(node: FoodCornerNode, now = new Date()): boolean {
  if (node.status === "paused") return true;
  const from = node.pause.from;
  const until = node.pause.until;
  if (!from && !until) return false;

  const today = now.toISOString().slice(0, 10);
  const startsBeforeOrToday = !from || from <= today;
  const endsAfterOrToday = !until || until >= today;
  return startsBeforeOrToday && endsAfterOrToday;
}

// Lowercase English weekday names, indexed by Date.getDay() (0 = Sunday).
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Estimated pickup date for an Eco point: the pickup weekday in NEXT week
 * (the week starting the upcoming Monday). Returns an ISO yyyy-mm-dd string,
 * or "" if the weekday is unknown.
 */
export function nextWeekPickupDate(dayName: string, from: Date = new Date()): string {
  const target = WEEKDAY_NAMES.indexOf((dayName || "").trim().toLowerCase());
  if (target < 0) return "";

  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // Jump to next week's Monday (always at least 1 day, up to 7 — never this week's Monday).
  const daysUntilNextMonday = ((8 - base.getDay()) % 7) || 7;
  const nextMonday = new Date(base);
  nextMonday.setDate(base.getDate() + daysUntilNextMonday);

  // Offset from Monday (getDay 1) to the target weekday; Sunday wraps to +6.
  let offset = target - 1;
  if (offset < 0) offset += 7;
  const result = new Date(nextMonday);
  result.setDate(nextMonday.getDate() + offset);

  const y = result.getFullYear();
  const m = String(result.getMonth() + 1).padStart(2, "0");
  const d = String(result.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Next future occurrence of an English weekday at HH:MM, strictly after `from`.
 * Returns null if the weekday is unknown.
 */
export function nextWeekdayOccurrence(dayName: string, hhmm: string, from: Date = new Date()): Date | null {
  const target = WEEKDAY_NAMES.indexOf((dayName || "").trim().toLowerCase());
  if (target < 0) return null;
  const [h, m] = (hhmm || "00:00").split(":").map((x) => Number.parseInt(x, 10));
  const result = new Date(from);
  result.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  // Advance to the target weekday (0–6 days), then ensure it is strictly in the future.
  let delta = (target - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + delta);
  if (result.getTime() <= from.getTime()) result.setDate(result.getDate() + 7);
  return result;
}

export interface FoodCornerOrderingWindow {
  cutoff: Date | null; // order-by deadline
  pickup: Date | null; // pickup date that the cutoff feeds into
  pickupWindow: string;
}

/**
 * The current ordering window for an Eco point: the next order cutoff (deadline),
 * and the pickup that follows it. Used to show "order until …" with a countdown.
 */
export function foodCornerOrderingWindow(node: FoodCornerNode, from: Date = new Date()): FoodCornerOrderingWindow {
  const pickup = node.pickups[0];
  const cutoff = node.orderCutoffDay
    ? nextWeekdayOccurrence(node.orderCutoffDay, node.orderCutoffTime || "00:00", from)
    : null;
  // Pickup = first pickup-day occurrence after the cutoff (or after now if no cutoff).
  const pickupDate = pickup?.day
    ? nextWeekdayOccurrence(pickup.day, "00:00", cutoff ?? from)
    : null;
  return { cutoff, pickup: pickupDate, pickupWindow: pickup?.window || "" };
}

/** Monday-start week range for a given offset (0 = current week, 1 = previous week, …). */
export function foodCornerWeekRange(offset: number, from: Date = new Date()): { start: Date; end: Date } {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayDelta - offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export function describeFoodCornerPause(node: FoodCornerNode): string {
  const parts: string[] = [];
  if (node.pause.from) parts.push(`od ${node.pause.from}`);
  if (node.pause.until) parts.push(`do ${node.pause.until}`);
  const period = parts.join(" ");
  return [period, node.pause.note].filter(Boolean).join(" · ");
}

export function buildFoodCornerProducers(
  listings: FoodCornerListing[],
  businessUnits: BusinessUnit[],
): FoodCornerProducer[] {
  const unitMap = new Map(businessUnits.map((unit) => [makeARef(30901, unit.owner, unit.unit_id), unit]));
  const activeUnitRefs = new Set(unitMap.keys());
  const byUnit = new Map<string, FoodCornerListing[]>();

  listings
    .filter((listing) => listing.status === "active")
    .filter((listing) => activeUnitRefs.has(listing.unitRef))
    .forEach((listing) => {
      const current = byUnit.get(listing.unitRef) || [];
      current.push(listing);
      byUnit.set(listing.unitRef, current);
    });

  return Array.from(byUnit.entries())
    .map(([unitRef, unitListings]) => {
      const parsed = parseARef(unitRef);
      const businessUnit = unitMap.get(unitRef);
      return {
        unitRef,
        pubkey: parsed?.pubkey || unitListings[0]?.pubkey || "",
        unitId: parsed?.d || "",
        businessUnit,
        name: businessUnit?.name || unitListings[0]?.title || shortPubkey(parsed?.pubkey),
        city: businessUnit?.receiver_city || "",
        country: businessUnit?.country || businessUnit?.receiver_country || "",
        listings: unitListings.sort((a, b) => a.title.localeCompare(b.title)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupOrdersByNode(orders: FoodCornerOrderWithFulfillment[]) {
  const groups = new Map<string, FoodCornerOrderWithFulfillment[]>();
  for (const order of orders) {
    const key = order.distributionPoint || "direct";
    groups.set(key, [...(groups.get(key) || []), order]);
  }
  return Array.from(groups.entries()).map(([nodeRef, nodeOrders]) => ({
    nodeRef,
    orders: nodeOrders,
    total: nodeOrders.reduce((sum, order) => sum + order.total, 0),
    currency: nodeOrders[0]?.currency || "EUR",
  }));
}
