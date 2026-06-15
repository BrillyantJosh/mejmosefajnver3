import type { BusinessUnit } from "@/hooks/useNostrBusinessUnits";

export const FOOD_CORNER_NODE_KIND = 30905;
export const FOOD_CORNER_LISTING_KIND = 36500;
export const FOOD_CORNER_ORDER_KIND = 36601;
export const FOOD_CORNER_FULFILLMENT_KIND = 36602;
export const FOOD_CORNER_ALLOCATION_KIND = 36603;
export const FOOD_CORNER_DELIVERY_KIND = 36604;

export type FoodCornerBuyerType = "shop" | "restaurant" | "eco_point" | "distributor" | "individual";
export type FoodCornerNodeStatus = "active" | "paused" | "archived";
export type FoodCornerFulfillmentMode = "pickup" | "delivery" | "distribution_point";
export type FoodCornerCycle = "weekly" | "biweekly" | "monthly";
export type FoodCornerOrderStatus = "placed" | "updated" | "cancelled";
export type FoodCornerFulfillmentStatus =
  | "received"
  | "confirmed"
  | "rejected"
  | "packed"
  | "in_transit"
  | "delivered"
  | "completed";

export interface FoodCornerARef {
  kind: string;
  pubkey: string;
  d: string;
}

export interface FoodCornerRawEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface FoodCornerPickup {
  id: string;
  label: string;
  lat: string;
  lon: string;
  day: string;
  window: string;
}

export interface FoodCornerDelivery {
  day: string;
  window: string;
  radiusKm: string;
}

export interface FoodCornerPause {
  from: string;
  until: string;
  note: string;
}

export interface FoodCornerNode {
  eventId: string;
  pubkey: string;
  createdAt: number;
  dTag: string;
  ref: string;
  name: string;
  status: FoodCornerNodeStatus;
  fulfillment: string[];
  sellers: string[];
  listings: string[];
  excludes: string[];
  cycle: FoodCornerCycle | "";
  orderCutoffDay: string;
  orderCutoffTime: string;
  pickups: FoodCornerPickup[];
  deliveries: FoodCornerDelivery[];
  geoLat: string;
  geoLon: string;
  geoLabel: string;
  areas: string[];
  lud16: string;
  pause: FoodCornerPause;
  images: string[];
  websiteUrl: string;
  tags: string[];
  content: string;
  rawEvent: FoodCornerRawEvent;
}

export interface FoodCornerListing {
  eventId: string;
  pubkey: string;
  createdAt: number;
  listingId: string;
  dTag: string; // addressable d-tag — required for correct replaceable-event dedup
  ref: string;
  unitRef: string;
  title: string;
  type: string;
  price: number;
  priceText: string;
  priceCurrency: string;
  unit: string;
  status: string;
  stock: string;
  minOrder: string;
  maxOrder: string;
  availableFrom: string;
  availableUntil: string;
  eco: string[];
  cert: string[];
  tags: string[];
  delivery: string[];
  marketDays: string[];
  images: string[];
  thumbs: string[];
  content: string;
  rawEvent: FoodCornerRawEvent;
}

export interface FoodCornerProducer {
  unitRef: string;
  pubkey: string;
  unitId: string;
  businessUnit?: BusinessUnit;
  name: string;
  city: string;
  country: string;
  listings: FoodCornerListing[];
}

export interface FoodCornerOrderItem {
  listingRef: string;
  qty: number;
  unit: string;
  unitPrice: number;
  currency: string;
  listing?: FoodCornerListing;
}

export interface FoodCornerOrder {
  eventId: string;
  pubkey: string;
  buyerPubkey: string;
  createdAt: number;
  dTag: string;
  ref: string;
  sellerRef: string;
  sellerPubkey: string;
  sellerUnitId: string;
  buyerType: FoodCornerBuyerType;
  items: FoodCornerOrderItem[];
  total: number;
  currency: string;
  status: FoodCornerOrderStatus;
  fulfillment: FoodCornerFulfillmentMode;
  distributionPoint: string;
  nodePubkey: string;
  nodeDTag: string;
  pickupPoint: string;
  requestedDate: string;
  requestedWindow: string;
  payment: string[];
  paid: string;
  recurring: string;
  recurringUntil: string;
  tags: string[];
  content: string;
  rawEvent: FoodCornerRawEvent;
}

export interface FoodCornerFulfillment {
  eventId: string;
  pubkey: string;
  sellerPubkey: string;
  createdAt: number;
  dTag: string;
  orderRef: string;
  buyerPubkey: string;
  status: FoodCornerFulfillmentStatus;
  eta: string;
  deliveredAt: string;
  adjustTotal: number | null;
  adjustCurrency: string;
  settledLanAmount: number | null;
  settledRate: number | null;
  settledAt: string;
  note: string;
  content: string;
  rawEvent: FoodCornerRawEvent;
}

// KIND 36604 — supplier-authored aggregate delivery to a Točka Obilja for one cycle:
// the actual total quantity the supplier brought per product (reduced if short). NOT
// per buyer. The Točka reads this to detect shortages. Replaceable per (supplier,
// node, cycle); address 36604:<supplier_hex>:<nodeDTag>__<cycleStartEpoch>.
export interface FoodCornerDeliveredItem {
  listingRef: string;
  qty: number;
  unit: string;
}

export interface FoodCornerSupplierDelivery {
  eventId: string;
  pubkey: string; // supplier pubkey (author)
  createdAt: number;
  dTag: string;
  nodeRef: string; // a-tag → 30905:<node>:<dTag>
  cycleStart: number; // epoch seconds of the cycle start (pickup-day week start)
  items: FoodCornerDeliveredItem[];
  content: string;
  rawEvent: FoodCornerRawEvent;
}

// KIND 36603 — Točka Obilja (distribution node) authored per-buyer allocation for
// a 36601 order: the quantities the buyer actually receives. Basis for payment +
// what the buyer is shown. Replaceable by the order's d-tag, author = node owner.
export interface FoodCornerAllocationItem {
  listingRef: string;
  qty: number;
  unit: string;
  unitPrice: number;
  currency: string;
}

export interface FoodCornerAllocation {
  eventId: string;
  pubkey: string; // node/Točka pubkey (author)
  createdAt: number;
  dTag: string; // = order d-tag
  ref: string;
  orderRef: string; // a-tag → 36601:<buyer>:<orderDTag>
  buyerPubkey: string; // p-tag
  nodeRef: string; // distribution_point → 30905:<node>:<dTag>
  items: FoodCornerAllocationItem[];
  total: number;
  currency: string;
  content: string;
  rawEvent: FoodCornerRawEvent;
}

export interface FoodCornerOrderWithFulfillment extends FoodCornerOrder {
  fulfillmentEvent?: FoodCornerFulfillment;
  fulfillmentStatus?: FoodCornerFulfillmentStatus;
  allocation?: FoodCornerAllocation;
}
