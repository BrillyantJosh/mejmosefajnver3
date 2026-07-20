import { useCallback, useEffect, useMemo, useState } from "react";
import { SimplePool } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import {
  FOOD_CORNER_ALLOCATION_KIND,
  FOOD_CORNER_DELIVERY_KIND,
  FOOD_CORNER_FULFILLMENT_KIND,
  FOOD_CORNER_BEAUTY_LISTING_KIND,
  FOOD_CORNER_LISTING_KIND,
  FOOD_CORNER_LISTING_KINDS,
  FOOD_CORNER_NODE_KIND,
  FOOD_CORNER_ORDER_KIND,
  FoodCornerAllocation,
  FoodCornerFulfillment,
  FoodCornerListing,
  FoodCornerNode,
  FoodCornerOrder,
  FoodCornerOrderWithFulfillment,
  FoodCornerProducer,
  FoodCornerRawEvent,
  FoodCornerSupplierDelivery,
  FoodCornerARef,
} from "@/types/foodCorner";
import {
  buildFoodCornerProducers,
  dedupeReplaceable,
  enrichOrders,
  makeARef,
  parseFoodCornerAllocation,
  parseFoodCornerFulfillment,
  parseARef,
  parseFoodCornerListing,
  parseFoodCornerNode,
  parseFoodCornerOrder,
  parseFoodCornerSupplierDelivery,
  resolveNodeCatalog,
} from "@/lib/foodCorner";

interface FoodCornerData {
  nodes: FoodCornerNode[];
  listings: FoodCornerListing[];
  orders: FoodCornerOrderWithFulfillment[];
  fulfillments: FoodCornerFulfillment[];
  allocations: FoodCornerAllocation[];
  deliveries: FoodCornerSupplierDelivery[];
  producers: FoodCornerProducer[];
  isLoading: boolean;
  businessUnitsLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getNodeCatalog: (nodeRef?: string) => FoodCornerListing[];
  getNodeByRef: (nodeRef?: string) => FoodCornerNode | undefined;
}

const fetchTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Eco Point fetch timeout")), ms)),
  ]);

export function useFoodCornerData(): FoodCornerData {
  const { parameters } = useSystemParameters();
  const { businessUnits, isLoading: businessUnitsLoading } = useNostrBusinessUnits();
  const [nodes, setNodes] = useState<FoodCornerNode[]>([]);
  const [allListings, setAllListings] = useState<FoodCornerListing[]>([]);
  const [orders, setOrders] = useState<FoodCornerOrderWithFulfillment[]>([]);
  const [fulfillments, setFulfillments] = useState<FoodCornerFulfillment[]>([]);
  const [allocations, setAllocations] = useState<FoodCornerAllocation[]>([]);
  const [deliveries, setDeliveries] = useState<FoodCornerSupplierDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const relays = useMemo(() => parameters?.relays || [], [parameters?.relays]);

  const refetch = useCallback(async () => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    const pool = new SimplePool();

    try {
      // Primary query — ALL kinds in one pass. This is the load-bearing fetch:
      // orders, nodes and everything else must come from here.
      const baseEvents = (await fetchTimeout(
        pool.querySync(relays, {
          kinds: [
            FOOD_CORNER_NODE_KIND,
            FOOD_CORNER_LISTING_KIND,
            FOOD_CORNER_BEAUTY_LISTING_KIND,
            FOOD_CORNER_ORDER_KIND,
            FOOD_CORNER_FULFILLMENT_KIND,
            FOOD_CORNER_ALLOCATION_KIND,
            FOOD_CORNER_DELIVERY_KIND,
          ],
          limit: 4000,
        }),
        18000,
      )) as FoodCornerRawEvent[];

      const rawEvents = baseEvents;

      const parsedNodes = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_NODE_KIND)
          .map(parseFoodCornerNode)
          .filter(Boolean) as FoodCornerNode[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      const allParsedListings = dedupeReplaceable(
        rawEvents
          .filter((event) => FOOD_CORNER_LISTING_KINDS.includes(event.kind))
          .map(parseFoodCornerListing)
          .filter(Boolean) as FoodCornerListing[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      // The title-resolution map holds ALL listings (not just active ones) so a
      // historical order referencing a now-inactive listing still shows its name.
      const listingMap = new Map(allParsedListings.map((listing) => [listing.ref, listing]));

      const orderEvents = rawEvents.filter((event) => event.kind === FOOD_CORNER_ORDER_KIND);

      // TARGETED top-up. Relays return newest-first, so as activity accumulates the
      // older listing events referenced by past orders fall outside the shared limit
      // above; their refs then don't resolve and order lines render as "product name
      // unavailable". Re-fetching thousands of listings to find a handful of names
      // was too slow on mobile connections — it timed out there and silently left
      // the names blank while desktop looked fine. Instead ask the relays for
      // EXACTLY the refs we're missing (kind + author + d), which stays tiny and
      // fast. Sequential + best-effort: any failure leaves the primary result intact.
      const missingRefs = new Set<string>();
      for (const event of orderEvents) {
        const order = parseFoodCornerOrder(event, listingMap);
        if (!order) continue;
        for (const item of order.items) {
          if (item.listingRef && !listingMap.has(item.listingRef)) missingRefs.add(item.listingRef);
        }
      }
      if (missingRefs.size > 0) {
        const refs = [...missingRefs]
          .map(parseARef)
          .filter((r): r is FoodCornerARef => r !== null);
        const kinds = [...new Set(refs.map((r) => Number.parseInt(r.kind, 10)))].filter((k) =>
          Number.isFinite(k),
        );
        const authors = [...new Set(refs.map((r) => r.pubkey).filter(Boolean))];
        const dTags = [...new Set(refs.map((r) => r.d).filter(Boolean))];
        if (kinds.length > 0 && authors.length > 0 && dTags.length > 0) {
          try {
            const recovered = (await fetchTimeout(
              pool.querySync(relays, { kinds, authors, "#d": dTags, limit: 1000 }),
              10000,
            )) as FoodCornerRawEvent[];
            for (const event of recovered) {
              const listing = parseFoodCornerListing(event);
              if (listing && !listingMap.has(listing.ref)) {
                listingMap.set(listing.ref, listing);
                allParsedListings.push(listing);
              }
            }
          } catch {
            // Non-fatal: the name then falls back to the title snapshotted on the
            // order itself, and only failing that to a neutral label.
          }
        }
      }

      // Active listings drive the orderable catalog — computed AFTER the top-up so a
      // recovered listing that is still active is orderable too.
      const parsedListings = allParsedListings.filter((listing) => listing.status === "active");

      const parsedOrders = dedupeReplaceable(
        orderEvents
          .map((event) => parseFoodCornerOrder(event, listingMap))
          .filter(Boolean) as FoodCornerOrder[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      const parsedFulfillments = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_FULFILLMENT_KIND)
          .map(parseFoodCornerFulfillment)
          .filter(Boolean) as FoodCornerFulfillment[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      const parsedAllocations = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_ALLOCATION_KIND)
          .map(parseFoodCornerAllocation)
          .filter(Boolean) as FoodCornerAllocation[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      const parsedDeliveries = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_DELIVERY_KIND)
          .map(parseFoodCornerSupplierDelivery)
          .filter(Boolean) as FoodCornerSupplierDelivery[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      setNodes(parsedNodes);
      setAllListings(parsedListings);
      setFulfillments(parsedFulfillments);
      setAllocations(parsedAllocations);
      setDeliveries(parsedDeliveries);
      setOrders(enrichOrders(parsedOrders, parsedFulfillments, parsedAllocations));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch Eco Point data";
      console.error("Eco Point fetch failed:", err);
      setError(message);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [relays]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const eligibleListings = useMemo(() => {
    const activeUnitRefs = new Set(businessUnits.map((unit) => makeARef(30901, unit.owner, unit.unit_id)));
    return allListings.filter((listing) => activeUnitRefs.has(listing.unitRef));
  }, [allListings, businessUnits]);

  const producers = useMemo(
    () => buildFoodCornerProducers(eligibleListings, businessUnits),
    [eligibleListings, businessUnits],
  );

  const getNodeByRef = useCallback(
    (nodeRef?: string) => nodes.find((node) => node.ref === nodeRef),
    [nodes],
  );

  // The orderable catalog resolves against ALL active listings — NOT eligibleListings.
  // eligibleListings depends on a separate, heavy useNostrBusinessUnits fetch (KIND
  // 30901/30902/30903); when that is slow/empty/times out, every offer would vanish
  // ("0 ponudb"). The eco point already curates its sellers/listings, so that curation
  // is the authoritative filter — we don't also gate on the business-units fetch.
  const getNodeCatalog = useCallback(
    (nodeRef?: string) => resolveNodeCatalog(getNodeByRef(nodeRef), allListings),
    [getNodeByRef, allListings],
  );

  return {
    nodes,
    listings: eligibleListings,
    orders,
    fulfillments,
    allocations,
    deliveries,
    producers,
    // Don't block the whole module on the heavy business-units fetch — the orderable
    // catalog no longer needs it. Producer enrichment (names) fills in progressively
    // once businessUnits arrives. Only expose businessUnitsLoading separately.
    isLoading,
    businessUnitsLoading,
    error,
    refetch,
    getNodeCatalog,
    getNodeByRef,
  };
}
