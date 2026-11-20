/**
 * Shop offers (KIND 36502) in Točka obilja (Brilly, 20. 11. 2026): which
 * offers a Točka carries, what is read for them, and that a shop with more
 * offers than one relay answer holds loses none of them on the way.
 * Pure, no React, no network.
 *   npm run test:shop-offers
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SHOP_OFFERS_FILTER,
  SHOP_ADDRESSES_PER_READ,
  SHOP_READ_MAX_PAGES,
  SHOP_UNITS_PER_READ,
  readShopOffers,
  shopOfferFilters,
  type ShopOfferFilter,
  type ShopOfferReader,
} from './foodCornerShopOffers';
import { listingCategory, parseFoodCornerListing, parseFoodCornerNode, resolveNodeCatalog, sellerCoversListing } from './foodCorner';
import { readAllPages, RELAY_PAGE_SIZE } from './relayReadViaServer';
import { FOOD_CORNER_LISTING_KINDS, FOOD_CORNER_SELLER_BRINGS_SHOP_OFFERS, type FoodCornerRawEvent } from '../types/foodCorner';

const SHOP = 'f2dcd8fa18fe07986243207fcbe60448739e93104837f2d7ac9d2f88158feb0b';
const FARM = 'ba93d8b5950c1d2ef8716488348b32a00d0b0a0ba6f7727dbb36baa0583c3ca6';
const POINT = '94c894d0606d5c913dbdfa3562f4accbdfd29bbe0704670d36ec659fffd32fcd';
const SHOP_UNIT = `30901:${SHOP}:d41e2097fa3942ee9538fe5ded81bf86`;
const FARM_UNIT = `30901:${FARM}:73bfeb7e99701e757eb481d72e4cdeec`;

let ids = 0;
const hexId = () => (++ids).toString(16).padStart(64, '0');

/** An offer as the shop signs it; `extra` tags replace the default tags of the same name. */
function offer(kind: number, pubkey: string, unit: string, d: string, extra: string[][] = [], created_at = 1_794_390_239): FoodCornerRawEvent {
  const base = [['d', d], ['a', unit], ['title', `Offer ${d}`], ['price', '3.50', 'EUR'], ['unit', 'kos'], ['status', 'active']];
  const replaced = new Set(extra.map((t) => t[0]));
  return {
    id: hexId(),
    pubkey,
    created_at,
    kind,
    tags: [...base.filter((t) => !replaced.has(t[0])), ...extra],
    content: '',
  };
}

function point(tags: string[][]): FoodCornerRawEvent {
  return { id: hexId(), pubkey: POINT, created_at: 1_794_400_000, kind: 30905, tags: [['d', 'tocka'], ['name', 'Točka'], ...tags], content: '' };
}

const listings = (events: FoodCornerRawEvent[]) => events.map(parseFoodCornerListing).filter((l) => l !== null);

describe('a shop offer is read like any other offer', () => {
  it('keeps its own kind in its address, so a `listing` tag and an order line find it', () => {
    const event = offer(36502, SHOP, SHOP_UNIT, 'abc', [['unit', 'kos'], ['stock', '10'], ['t', 'sveza-zelenjava'], ['eco', 'organic'], ['image', 'https://media.lanaloves.us/x.jpg']]);
    const listing = parseFoodCornerListing(event)!;
    assert.equal(listing.ref, `36502:${SHOP}:abc`);
    assert.equal(listing.listingKind, 36502);
    assert.equal(listing.unitRef, SHOP_UNIT);
    assert.equal(listing.price, 3.5);
    assert.equal(listing.priceText, '3.50');
    assert.equal(listing.unit, 'kos');
    assert.deepEqual(listing.tags, ['sveza-zelenjava']);
    assert.equal(listingCategory(listing), 'shop');
    assert.ok(FOOD_CORNER_LISTING_KINDS.includes(36502));
  });

  it('leaves produce and beauty where they were', () => {
    assert.equal(listingCategory(parseFoodCornerListing(offer(36500, FARM, FARM_UNIT, 'p'))!), 'produce');
    assert.equal(listingCategory(parseFoodCornerListing(offer(36509, FARM, FARM_UNIT, 'b'))!), 'beauty');
  });
});

describe('which offers a Točka carries', () => {
  const events = [
    offer(36500, FARM, FARM_UNIT, 'beans'),
    offer(36509, FARM, FARM_UNIT, 'soap'),
    offer(36502, FARM, FARM_UNIT, 'old-beans'), // the farm's old shop copy of the same beans
    offer(36502, SHOP, SHOP_UNIT, 'sirek'),
    offer(36502, SHOP, SHOP_UNIT, 'redkev'),
    offer(36502, SHOP, SHOP_UNIT, 'kamilica', [['status', 'sold_out']]),
    offer(36502, SHOP, SHOP_UNIT, 'not-picked'),
  ];
  const all = listings(events);
  const refs = (list: { ref: string }[]) => list.map((l) => l.ref.split(':').slice(0, 1).concat(l.ref.split(':')[2]).join(':')).sort();

  it('a shop offer picked one by one is in, its unpicked neighbours are not', () => {
    const node = parseFoodCornerNode(point([['listing', `36502:${SHOP}:sirek`], ['listing', `36502:${SHOP}:redkev`]]))!;
    assert.deepEqual(refs(resolveNodeCatalog(node, all)), ['36502:redkev', '36502:sirek']);
  });

  it('a picked offer that is sold out or excluded is not orderable', () => {
    const node = parseFoodCornerNode(
      point([['listing', `36502:${SHOP}:sirek`], ['listing', `36502:${SHOP}:kamilica`], ['listing', `36502:${SHOP}:redkev`], ['exclude', `36502:${SHOP}:redkev`]]),
    )!;
    assert.deepEqual(refs(resolveNodeCatalog(node, all)), ['36502:sirek']);
  });

  it('a whole seller brings its produce and beauty as before — and, while the switch is off, not its shop offers', () => {
    const node = parseFoodCornerNode(point([['seller', FARM_UNIT]]))!;
    assert.equal(FOOD_CORNER_SELLER_BRINGS_SHOP_OFFERS, false);
    assert.deepEqual(refs(resolveNodeCatalog(node, all)), ['36500:beans', '36509:soap']);
    assert.equal(sellerCoversListing({ listingKind: 36502 }), false);
    assert.equal(sellerCoversListing({ listingKind: 36500 }), true);
  });

  it('with the switch on, a whole seller brings every active offer of the unit, of every kind', () => {
    const node = parseFoodCornerNode(point([['seller', FARM_UNIT], ['seller', SHOP_UNIT], ['exclude', `36502:${SHOP}:redkev`]]))!;
    assert.deepEqual(refs(resolveNodeCatalog(node, all, { sellerBringsShopOffers: true })), [
      '36500:beans',
      '36502:not-picked',
      '36502:old-beans',
      '36502:sirek',
      '36509:soap',
    ]);
  });
});

describe('what is read for the Točke', () => {
  const pk = (n: number) => n.toString(16).padStart(64, 'a');

  it('only the shop offers the Točke name — by author and d — nothing for other kinds or archived Točke', () => {
    const filters = shopOfferFilters([
      { status: 'active', sellers: [SHOP_UNIT, FARM_UNIT], listings: [`36502:${SHOP}:b`, `36502:${SHOP}:a`, `36500:${FARM}:beans`, `36502:${FARM}:x`, `36502:${SHOP}:a`] },
      { status: 'paused', sellers: [], listings: [`36502:${SHOP}:c`] },
      { status: 'archived', sellers: [], listings: [`36502:${SHOP}:archived`] },
      { status: 'active', sellers: ['nonsense'], listings: ['36502:notahex:x', '36502::x', `36502:${SHOP}:`, 'garbage'] },
    ]);
    assert.deepEqual(filters, [
      { kinds: [36502], authors: [FARM], '#d': ['x'] },
      { kinds: [36502], authors: [SHOP], '#d': ['a', 'b', 'c'] },
    ]);
  });

  it('a thousand picked offers are asked for in pieces that each fit one answer', () => {
    const ds = Array.from({ length: 1074 }, (_, i) => `d${String(i).padStart(4, '0')}`);
    const filters = shopOfferFilters([{ status: 'active', sellers: [], listings: ds.map((d) => `36502:${SHOP}:${d}`) }]);
    assert.equal(filters.length, Math.ceil(1074 / SHOP_ADDRESSES_PER_READ));
    assert.ok(filters.every((f) => (f['#d'] as string[]).length <= SHOP_ADDRESSES_PER_READ && SHOP_ADDRESSES_PER_READ <= RELAY_PAGE_SIZE));
    assert.deepEqual(filters.flatMap((f) => f['#d'] as string[]), ds);
  });

  it('with the switch on, whole sellers are read by their unit', () => {
    const units = Array.from({ length: 45 }, (_, i) => `30901:${pk(i)}:u`);
    const filters = shopOfferFilters([{ status: 'active', sellers: units, listings: [] }], { sellerBringsShopOffers: true });
    assert.equal(filters.length, Math.ceil(45 / SHOP_UNITS_PER_READ));
    assert.deepEqual(filters.flatMap((f) => f['#a'] as string[]), [...units].sort());
    assert.ok(filters.every((f) => (f.kinds as number[])[0] === 36502));
  });
});

// ── A shop bigger than one relay answer, read the way the app reads it ──────
// The relays answer at most 500 per request; a batch import signs up to 200
// offers in the same second. The app's server puts the relays' answers
// together, and the browser pages through that (readAllPages).

type Relay = FoodCornerRawEvent[];

function matches(e: FoodCornerRawEvent, f: Record<string, unknown>): boolean {
  if (Array.isArray(f.kinds) && !(f.kinds as number[]).includes(e.kind)) return false;
  if (Array.isArray(f.authors) && !(f.authors as string[]).includes(e.pubkey)) return false;
  if (typeof f.until === 'number' && e.created_at > f.until) return false;
  for (const name of ['a', 'd']) {
    const wanted = f[`#${name}`] as string[] | undefined;
    if (wanted && !e.tags.some((t) => t[0] === name && wanted.includes(t[1]))) return false;
  }
  return true;
}

/** One relay: its newest `limit` matches (strfry order: newest first, then id). */
const relayAnswer = (relay: Relay, f: Record<string, unknown>) =>
  relay
    .filter((e) => matches(e, f))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    .slice(0, Math.min(Number(f.limit) || RELAY_PAGE_SIZE, RELAY_PAGE_SIZE));

/** The app's server: every relay asked, answers put together, one per id. */
function server(relays: Relay[]) {
  const calls: Record<string, unknown>[] = [];
  const page = (f: Record<string, unknown>) => {
    calls.push(f);
    const byId = new Map<string, FoodCornerRawEvent>();
    for (const relay of relays) for (const e of relayAnswer(relay, f)) byId.set(e.id, e);
    return [...byId.values()];
  };
  const reader: ShopOfferReader = async (filter: ShopOfferFilter) => {
    const read = await readAllPages<FoodCornerRawEvent>(
      async (until) => page({ ...filter, limit: RELAY_PAGE_SIZE, ...(until === undefined ? {} : { until }) }),
      { maxPages: SHOP_READ_MAX_PAGES },
    );
    return { events: read.events, complete: read.complete };
  };
  return { reader, calls, page };
}

/** A shop like Živa Center: 1 756 offers, 1 074 active, imported in batches of 200 per second. */
function bigShop(): FoodCornerRawEvent[] {
  const out: FoodCornerRawEvent[] = [];
  for (let i = 0; i < 1756; i++) {
    const status = i < 1074 ? 'active' : i < 1712 ? 'sold_out' : 'archived';
    out.push(offer(36502, SHOP, SHOP_UNIT, `z${String(i).padStart(4, '0')}`, [['status', status]], 1_794_000_000 + Math.floor(i / 200)));
  }
  return out;
}

const activeOf = (events: FoodCornerRawEvent[]) => listings(events).filter((l) => l.status === 'active');

describe('a shop with more offers than one answer holds', () => {
  const shop = bigShop();

  it('the operator choosing offers gets all 1 756, and so all 1 074 active ones', async () => {
    const s = server([shop, shop, shop, shop]);
    const read = await readShopOffers([ALL_SHOP_OFFERS_FILTER], s.reader);
    assert.equal(read.complete, true);
    assert.equal(read.events.length, 1756);
    assert.equal(activeOf(read.events).length, 1074);
    assert.ok(s.calls.length >= 4, `paged: ${s.calls.length} pages`);
  });

  it('a Točka that picked all 1 074 one by one shows all 1 074', async () => {
    const node = parseFoodCornerNode(point(activeOf(shop).map((l) => ['listing', l.ref])))!;
    const s = server([shop, shop, shop, shop]);
    const read = await readShopOffers(shopOfferFilters([node]), s.reader);
    assert.equal(read.complete, true);
    assert.equal(resolveNodeCatalog(node, listings(read.events)).length, 1074);
    // …and it asked for those addresses only, never the whole relay.
    assert.ok(s.calls.every((f) => Array.isArray(f['#d']) && (f.authors as string[])[0] === SHOP));
  });

  it('with the switch on, the whole seller shows all 1 074', async () => {
    const node = parseFoodCornerNode(point([['seller', SHOP_UNIT]]))!;
    const s = server([shop, shop, shop, shop]);
    const read = await readShopOffers(shopOfferFilters([node], { sellerBringsShopOffers: true }), s.reader);
    assert.equal(read.complete, true);
    assert.equal(resolveNodeCatalog(node, listings(read.events), { sellerBringsShopOffers: true }).length, 1074);
  });

  it('relays that do not hold the same offers still give every offer', async () => {
    // One relay is missing every third offer; another has them all. The
    // fuller relay's offers between the two relays' page ends must not be
    // stepped over.
    const thin = shop.filter((_, i) => i % 3 !== 0);
    const s = server([thin, shop, thin]);
    const read = await readShopOffers([ALL_SHOP_OFFERS_FILTER], s.reader);
    assert.equal(read.complete, true);
    assert.equal(read.events.length, 1756);

    // The old cursor (the oldest event of a page) loses offers in exactly this case.
    const naive = new Map<string, FoodCornerRawEvent>();
    let until: number | undefined;
    for (let pages = 0; pages < SHOP_READ_MAX_PAGES; pages++) {
      const page = s.page({ kinds: [36502], limit: RELAY_PAGE_SIZE, ...(until === undefined ? {} : { until }) });
      for (const e of page) naive.set(e.id, e);
      if (page.length < RELAY_PAGE_SIZE) break;
      until = Math.min(...page.map((e) => e.created_at));
    }
    assert.ok(naive.size < 1756, `the old way would have read ${naive.size} of 1756`);
  });

  it('a read that fails is said, the rest kept', async () => {
    const s = server([shop]);
    const flaky: ShopOfferReader = async (filter) => {
      if ((filter['#d'] as string[] | undefined)?.includes('z0000')) throw new Error('relay read failed (502)');
      return s.reader(filter);
    };
    const node = parseFoodCornerNode(point(activeOf(shop).map((l) => ['listing', l.ref])))!;
    const read = await readShopOffers(shopOfferFilters([node]), flaky);
    assert.equal(read.complete, false);
    assert.equal(read.failed, 1);
    assert.equal(read.events.length, 1074 - SHOP_ADDRESSES_PER_READ);
  });

  it('a read cut at its page cap is said, not passed off as everything', async () => {
    const capped: ShopOfferReader = async () => ({ events: shop.slice(0, 500), complete: false });
    const read = await readShopOffers([ALL_SHOP_OFFERS_FILTER], capped);
    assert.equal(read.complete, false);
    assert.equal(read.failed, 0);
  });

  it('nothing named, nothing read', async () => {
    let called = 0;
    const read = await readShopOffers([], async () => {
      called++;
      return { events: [], complete: true };
    });
    assert.deepEqual([read.events.length, read.complete, called], [0, true, 0]);
  });
});
