/**
 * Shop offers (KIND 36502) in Točka obilja (Brilly, 20. 11. 2026).
 *
 * A Točka may now carry offers of a shop such as Živa Center, which alone has
 * about 1 750 offers on the relays (1 074 of them active) — more than every
 * produce and beauty offer together. Reading all of them for every buyer who
 * opens the page would be megabytes for nothing, so the buyer's page reads
 * only what the Točke actually name:
 *   - each `listing` tag of kind 36502, by author and `d`;
 *   - with FOOD_CORNER_SELLER_BRINGS_SHOP_OFFERS on, each `seller` unit, by
 *     its `a` tag (every offer that unit has, of every status).
 * Only a Točka operator choosing offers reads every shop offer there is.
 *
 * Every read is paged (src/lib/relayReadViaServer.ts: 500 per answer, `until`
 * inclusive, deduplicated by id). A read that failed or stopped at the page
 * cap is reported, never passed off as the whole list: no offer may go
 * missing without the page saying so.
 *
 * The relay read is passed in, so the same code runs in the tests, in the
 * browser (readShopOffersViaServer) and in the read-only live check
 * (scripts/checkShopOffersLive.ts).
 *   npm run test:shop-offers
 */
import { FOOD_CORNER_SELLER_BRINGS_SHOP_OFFERS, FOOD_CORNER_SHOP_LISTING_KIND } from "@/types/foodCorner";
import type { FoodCornerNode, FoodCornerRawEvent } from "@/types/foodCorner";
import { readRelayEventsViaServer } from "@/lib/relayReadViaServer";

/** `#a` values per request: a handful of units, each possibly with a thousand offers. */
export const SHOP_UNITS_PER_READ = 20;
/** `#d` values per request: one event per address, so this many fit in one answer of 500. */
export const SHOP_ADDRESSES_PER_READ = 300;
/** Pages one read may take (500 each): far above the largest shop today, and the cap is reported. */
export const SHOP_READ_MAX_PAGES = 20;

const HEX64 = /^[0-9a-f]{64}$/;
const UNIT_REF = /^30901:([0-9a-f]{64}):(.+)$/;

export type ShopOfferFilter = Record<string, unknown> & { kinds: number[] };

/**
 * The reads that bring exactly the shop offers these Točke name. Archived
 * Točke take no orders and are left out. Nothing is asked twice.
 */
export function shopOfferFilters(
  nodes: Pick<FoodCornerNode, "sellers" | "listings" | "status">[],
  { sellerBringsShopOffers = FOOD_CORNER_SELLER_BRINGS_SHOP_OFFERS }: { sellerBringsShopOffers?: boolean } = {},
): ShopOfferFilter[] {
  const units = new Set<string>();
  const dsByAuthor = new Map<string, Set<string>>();

  for (const node of nodes) {
    if (node.status === "archived") continue;
    if (sellerBringsShopOffers) {
      for (const seller of node.sellers) if (UNIT_REF.test(seller)) units.add(seller);
    }
    for (const listing of node.listings) {
      const first = listing.indexOf(":");
      const second = listing.indexOf(":", first + 1);
      if (first < 0 || second < 0) continue;
      if (listing.slice(0, first) !== String(FOOD_CORNER_SHOP_LISTING_KIND)) continue;
      const author = listing.slice(first + 1, second);
      const d = listing.slice(second + 1);
      if (!HEX64.test(author) || !d) continue;
      const ds = dsByAuthor.get(author) || new Set<string>();
      ds.add(d);
      dsByAuthor.set(author, ds);
    }
  }

  const filters: ShopOfferFilter[] = [];
  const unitList = [...units].sort();
  for (let i = 0; i < unitList.length; i += SHOP_UNITS_PER_READ) {
    filters.push({ kinds: [FOOD_CORNER_SHOP_LISTING_KIND], "#a": unitList.slice(i, i + SHOP_UNITS_PER_READ) });
  }
  for (const [author, ds] of [...dsByAuthor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dList = [...ds].sort();
    for (let i = 0; i < dList.length; i += SHOP_ADDRESSES_PER_READ) {
      filters.push({ kinds: [FOOD_CORNER_SHOP_LISTING_KIND], authors: [author], "#d": dList.slice(i, i + SHOP_ADDRESSES_PER_READ) });
    }
  }
  return filters;
}

/** The read for a Točka operator choosing offers: every shop offer on the relays. */
export const ALL_SHOP_OFFERS_FILTER: ShopOfferFilter = { kinds: [FOOD_CORNER_SHOP_LISTING_KIND] };

/** One paged relay read: everything the filter matched, and whether that is all of it. */
export type ShopOfferReader = (filter: ShopOfferFilter) => Promise<{ events: FoodCornerRawEvent[]; complete: boolean }>;

/** The app's reader: through this app's server, paged, signatures checked. */
export const readShopOffersViaServer: ShopOfferReader = async (filter) => {
  const read = await readRelayEventsViaServer<FoodCornerRawEvent>(filter, { timeout: 15000, maxPages: SHOP_READ_MAX_PAGES });
  return { events: read.events, complete: read.complete };
};

export interface ShopOfferRead {
  events: FoodCornerRawEvent[];
  /** False when any read failed or stopped at its page cap: some offers may be missing. */
  complete: boolean;
  /** Reads that threw (the others are still used). */
  failed: number;
}

/**
 * Run the reads, a few at a time, and put the answers together (one event per
 * id). A failed read does not throw the others away; it makes the result
 * incomplete, which the page says out loud.
 */
export async function readShopOffers(
  filters: ShopOfferFilter[],
  read: ShopOfferReader,
  { concurrency = 3 }: { concurrency?: number } = {},
): Promise<ShopOfferRead> {
  const byId = new Map<string, FoodCornerRawEvent>();
  let complete = true;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < filters.length) {
      const filter = filters[next++];
      try {
        const result = await read(filter);
        if (!result.complete) complete = false;
        for (const event of result.events) {
          if (event && event.kind === FOOD_CORNER_SHOP_LISTING_KIND && typeof event.id === "string" && !byId.has(event.id)) {
            byId.set(event.id, event);
          }
        }
      } catch {
        failed++;
        complete = false;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, filters.length)) }, worker));
  return { events: [...byId.values()], complete, failed };
}
