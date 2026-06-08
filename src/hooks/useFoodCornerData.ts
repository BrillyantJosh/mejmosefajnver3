import { useCallback, useEffect, useMemo, useState } from "react";
import { SimplePool } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import {
  FOOD_CORNER_FULFILLMENT_KIND,
  FOOD_CORNER_LISTING_KIND,
  FOOD_CORNER_NODE_KIND,
  FOOD_CORNER_ORDER_KIND,
  FoodCornerFulfillment,
  FoodCornerListing,
  FoodCornerNode,
  FoodCornerOrder,
  FoodCornerOrderWithFulfillment,
  FoodCornerProducer,
  FoodCornerRawEvent,
} from "@/types/foodCorner";
import {
  buildFoodCornerProducers,
  dedupeReplaceable,
  enrichOrders,
  parseFoodCornerFulfillment,
  parseFoodCornerListing,
  parseFoodCornerNode,
  parseFoodCornerOrder,
  resolveNodeCatalog,
} from "@/lib/foodCorner";

interface FoodCornerData {
  nodes: FoodCornerNode[];
  listings: FoodCornerListing[];
  orders: FoodCornerOrderWithFulfillment[];
  fulfillments: FoodCornerFulfillment[];
  producers: FoodCornerProducer[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getNodeCatalog: (nodeRef?: string) => FoodCornerListing[];
  getNodeByRef: (nodeRef?: string) => FoodCornerNode | undefined;
}

const fetchTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Food Corner fetch timeout")), ms)),
  ]);

export function useFoodCornerData(): FoodCornerData {
  const { parameters } = useSystemParameters();
  const { businessUnits, isLoading: businessUnitsLoading } = useNostrBusinessUnits();
  const [nodes, setNodes] = useState<FoodCornerNode[]>([]);
  const [listings, setListings] = useState<FoodCornerListing[]>([]);
  const [orders, setOrders] = useState<FoodCornerOrderWithFulfillment[]>([]);
  const [fulfillments, setFulfillments] = useState<FoodCornerFulfillment[]>([]);
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
      const rawEvents = (await fetchTimeout(
        pool.querySync(relays, {
          kinds: [
            FOOD_CORNER_NODE_KIND,
            FOOD_CORNER_LISTING_KIND,
            FOOD_CORNER_ORDER_KIND,
            FOOD_CORNER_FULFILLMENT_KIND,
          ],
          limit: 4000,
        }),
        18000,
      )) as FoodCornerRawEvent[];

      const parsedNodes = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_NODE_KIND)
          .map(parseFoodCornerNode)
          .filter(Boolean) as FoodCornerNode[],
      )
        .filter((node) => node.status !== "archived")
        .sort((a, b) => b.createdAt - a.createdAt);

      const parsedListings = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_LISTING_KIND)
          .map(parseFoodCornerListing)
          .filter(Boolean) as FoodCornerListing[],
      )
        .filter((listing) => listing.status === "active")
        .sort((a, b) => b.createdAt - a.createdAt);

      const listingMap = new Map(parsedListings.map((listing) => [listing.ref, listing]));

      const parsedOrders = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_ORDER_KIND)
          .map((event) => parseFoodCornerOrder(event, listingMap))
          .filter(Boolean) as FoodCornerOrder[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      const parsedFulfillments = dedupeReplaceable(
        rawEvents
          .filter((event) => event.kind === FOOD_CORNER_FULFILLMENT_KIND)
          .map(parseFoodCornerFulfillment)
          .filter(Boolean) as FoodCornerFulfillment[],
      ).sort((a, b) => b.createdAt - a.createdAt);

      setNodes(parsedNodes);
      setListings(parsedListings);
      setFulfillments(parsedFulfillments);
      setOrders(enrichOrders(parsedOrders, parsedFulfillments));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch Food Corner data";
      console.error("Food Corner fetch failed:", err);
      setError(message);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [relays]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const producers = useMemo(
    () => buildFoodCornerProducers(listings, businessUnits),
    [listings, businessUnits],
  );

  const getNodeByRef = useCallback(
    (nodeRef?: string) => nodes.find((node) => node.ref === nodeRef),
    [nodes],
  );

  const getNodeCatalog = useCallback(
    (nodeRef?: string) => resolveNodeCatalog(getNodeByRef(nodeRef), listings),
    [getNodeByRef, listings],
  );

  return {
    nodes,
    listings,
    orders,
    fulfillments,
    producers,
    isLoading: isLoading || businessUnitsLoading,
    error,
    refetch,
    getNodeCatalog,
    getNodeByRef,
  };
}
