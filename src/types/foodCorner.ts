import type { BusinessUnit } from "@/hooks/useNostrBusinessUnits";

export const FOOD_CORNER_NODE_KIND = 30905;
export const FOOD_CORNER_LISTING_KIND = 36500;
export const FOOD_CORNER_ORDER_KIND = 36601;
export const FOOD_CORNER_FULFILLMENT_KIND = 36602;

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

export interface FoodCornerOrderWithFulfillment extends FoodCornerOrder {
  fulfillmentEvent?: FoodCornerFulfillment;
  fulfillmentStatus?: FoodCornerFulfillmentStatus;
}
