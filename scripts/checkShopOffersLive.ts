/**
 * Live, READ-ONLY check (Brilly, 20. 11. 2026): does a Točka over a shop unit
 * carry every one of that unit's active shop offers (KIND 36502)?
 *
 * It runs the app's own code (src/lib/foodCornerShopOffers.ts + foodCorner.ts)
 * against the live relays through the live app server's read endpoint, and
 * compares with the shop's own public list. Nothing is signed or published:
 * the Točka is built in memory only.
 *
 *   npx tsx scripts/checkShopOffersLive.ts [unitRef] [appOrigin] [shopOrigin]
 *
 * Defaults: Živa Center – eko veganska trgovina, app.mejmosefajn.org, lanaeco.shop.
 * Exit 0 only when every count agrees and the offers are the same ones.
 */
import { ALL_SHOP_OFFERS_FILTER, readShopOffers, readShopOffersViaServer, shopOfferFilters } from '../src/lib/foodCornerShopOffers.js';
import { parseFoodCornerListing, parseFoodCornerNode, resolveNodeCatalog } from '../src/lib/foodCorner.js';
import type { FoodCornerListing, FoodCornerRawEvent } from '../src/types/foodCorner.js';

const UNIT = process.argv[2] || '30901:f2dcd8fa18fe07986243207fcbe60448739e93104837f2d7ac9d2f88158feb0b:d41e2097fa3942ee9538fe5ded81bf86';
const APP = process.argv[3] || 'https://app.mejmosefajn.org';
const SHOP = process.argv[4] || 'https://lanaeco.shop';

// The browser module calls its own origin ("/api/…"); here that is the live app.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  realFetch(typeof input === 'string' && input.startsWith('/api/') ? `${APP}${input}` : input, init)) as typeof fetch;

const point = (tags: string[][]): FoodCornerRawEvent => ({
  id: '0'.repeat(64),
  pubkey: '1'.repeat(64),
  created_at: Math.floor(Date.now() / 1000),
  kind: 30905,
  tags: [['d', 'live-check-not-published'], ['name', 'Live check'], ['status', 'active'], ...tags],
  content: '',
});
const parse = (events: FoodCornerRawEvent[]) => events.map(parseFoodCornerListing).filter((l): l is FoodCornerListing => l !== null);
const refsOf = (list: { ref: string }[]) => new Set(list.map((l) => l.ref));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log(`unit ${UNIT}\napp  ${APP}\nshop ${SHOP}\n`);

// 1. The operator choosing offers: every shop offer on the relays.
let t = Date.now();
const every = await readShopOffers([ALL_SHOP_OFFERS_FILTER], readShopOffersViaServer);
const unitActive = parse(every.events).filter((l) => l.unitRef === UNIT && l.status === 'active');
console.log(`operator's list: ${every.events.length} shop offers read (complete: ${every.complete}), ${unitActive.length} active of this unit — ${Date.now() - t} ms`);

// 2. A Točka that picked every one of them, one by one (`listing` tags).
t = Date.now();
const picked = parseFoodCornerNode(point(unitActive.map((l) => ['listing', l.ref])))!;
const pickedFilters = shopOfferFilters([picked]);
const pickedRead = await readShopOffers(pickedFilters, readShopOffersViaServer);
const pickedCatalog = resolveNodeCatalog(picked, parse(pickedRead.events));
console.log(`Točka, offers picked one by one: ${pickedFilters.length} reads, ${pickedRead.events.length} events (complete: ${pickedRead.complete}), catalogue ${pickedCatalog.length} — ${Date.now() - t} ms`);

// 3. A Točka that names the whole unit as a seller, with the switch on.
t = Date.now();
const whole = parseFoodCornerNode(point([['seller', UNIT]]))!;
const wholeRead = await readShopOffers(shopOfferFilters([whole], { sellerBringsShopOffers: true }), readShopOffersViaServer);
const wholeCatalog = resolveNodeCatalog(whole, parse(wholeRead.events), { sellerBringsShopOffers: true });
console.log(`Točka, whole seller (switch on): ${wholeRead.events.length} events (complete: ${wholeRead.complete}), catalogue ${wholeCatalog.length} — ${Date.now() - t} ms`);

// 4. The shop's own public list.
const res = await realFetch(`${SHOP}/api/listings`);
const shopList = (await res.json()) as { kind: number; pubkey: string; listingId: string; unitRef: string }[];
const shopRefs = new Set(shopList.filter((l) => l.unitRef === UNIT).map((l) => `${l.kind}:${l.pubkey}:${l.listingId}`));
console.log(`${SHOP} public list: ${shopList.length} offers, ${shopRefs.size} of this unit\n`);

check('every read was complete', every.complete && pickedRead.complete && wholeRead.complete);
check('picked one by one: the Točka carries every active offer of the unit', pickedCatalog.length === unitActive.length, `${pickedCatalog.length}/${unitActive.length}`);
check('whole seller: the Točka carries every active offer of the unit', wholeCatalog.length === unitActive.length, `${wholeCatalog.length}/${unitActive.length}`);
check('the count is the shop’s own public count', pickedCatalog.length === shopRefs.size, `${pickedCatalog.length} vs ${shopRefs.size}`);
check('…and they are the same offers', sameSet(refsOf(pickedCatalog), shopRefs) && sameSet(refsOf(wholeCatalog), shopRefs));

console.log(failures === 0 ? '\n✅ all agree' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
