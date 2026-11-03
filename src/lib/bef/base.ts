/**
 * Where the BEF module talks to, and what it may ask there.
 *
 * The browser calls BEF Explorer directly — nothing goes through this app's
 * server, so every person's requests come from their own address and BEF's
 * per-address limits keep meaning one person. BEF lets exactly this app's
 * origins in, on exactly the routes in its server/lib/crossOrigin.ts
 * CROSS_ORIGIN_ROUTES; BEF_ROUTES is that list without its interest routes
 * (BEF_INTEREST_ROUTES_LEFT_OUT), and scripts/testBef.ts fails when the two
 * differ otherwise.
 *
 * Pure: no import.meta, so the test scripts can import it (./config.ts is the
 * Vite side).
 */

export const BEF_PUBLIC_URL = 'https://befexplorer.com';

/**
 * Where an interest is expressed now: the BEF page of LetsBalance.world —
 * support, sell, or sell and buy, for at most 30 days (KIND 30975, a firm
 * takes it up with KIND 40971). The KIND 30970 BEF Explorer took is
 * replaced, and this module sends none (Brilly, 3. 11. 2026).
 */
export const LETSBALANCE_BEF_URL = 'https://letsbalance.world/pays-us?view=bef';

/** BEF's local harness (fake Registrar, fake relays) — never production data. */
export const BEF_DEV_URL = 'http://127.0.0.1:3127';

/** A production build can only ever talk to befexplorer.com: there is no
 * variable to point it anywhere else. */
export function resolveBefBase({ dev }: { dev: boolean }): string {
  return dev ? BEF_DEV_URL : BEF_PUBLIC_URL;
}

/** Every route the module may call, in BEF's order. */
export const BEF_ROUTES = [
  // The person door, registration included.
  ['GET', '/api/person/challenge'],
  ['POST', '/api/person/session'],
  ['POST', '/api/person/register'],
  ['GET', '/api/person/me'],
  ['POST', '/api/person/logout'],
  ['GET', '/api/cards/mine'],
  ['POST', '/api/cards/status'],
  ['POST', '/api/cards'],
  // What the calculator reads — public figures, no token.
  ['GET', '/api/bootstrap'],
  ['GET', '/api/splits'],
  ['GET', '/api/interests'],
  ['GET', '/api/companies'],
  ['GET', '/api/scenario'],
] as const;

/** BEF still lets these in; this module no longer reads or sends an interest
 * (KIND 30970), so a request to them is refused here before anything is sent. */
export const BEF_INTEREST_ROUTES_LEFT_OUT = [
  ['GET', '/api/interest/windows'],
  ['GET', '/api/interest/mine'],
  ['POST', '/api/interest'],
] as const;

export type BefMethod = 'GET' | 'POST';
export type BefRoutePath = (typeof BEF_ROUTES)[number][1];

/** Exact and case-sensitive, like BEF's own check: a path BEF would refuse is
 * refused here before anything is sent. */
export function isBefRoute(method: string, pathname: string): boolean {
  return BEF_ROUTES.some(([m, p]) => m === method && p === pathname);
}
