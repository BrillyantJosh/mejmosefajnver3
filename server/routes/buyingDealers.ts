/**
 * GET /api/buying-dealers — the firms that buy LANA now, for the Sell pages of
 * the Lana Discount and BEF modules (src/components/discount/SellingMovedNotice.tsx).
 *
 * Selling LANA on lana.discount closed on 8 Oct 2026, and this app sent its
 * sellers there. Brilly the same day: "naredi ta isti popravek za prodajo tudi
 * na strani https://app.mejmosefajn.org/discount/sell preko katere uporabniki
 * isto jih preusmer na ta podjetja" (Brilly, 8. 10. 2026). The firms are read
 * by ../lib/buyingDealers.ts — BEF dealers whose own signed KIND 30972 says
 * they buy, admitted by BEF Explorer's rule, from the relays of the verified
 * stored KIND 38888 — the same reader lana.discount answers its own
 * /api/buying-dealers with, so both apps name the same firms.
 *
 * Public and read-only, as lana.discount's is: no session, no write, nothing
 * a visitor sends is read. The answer has lana.discount's shape exactly —
 * {status, readAt, staleSince, directoryUrl, buyers: [{slug, name, host,
 * website, registerUrl, sellUrl, eventId, signedAt}]} — and is projected onto
 * those fields here, so a field the reader might one day carry (an admin key,
 * a bank account, an owner) can never ride along. No npub anywhere: a firm is
 * named by its own name and host.
 *
 * `Cache-Control: no-cache`: the answer changes when a firm's profile does,
 * and the reader already keeps it ten minutes in memory.
 */
import { Router, type Request, type Response } from 'express';
import type { BuyingDealer, BuyingDealersAnswer } from '../lib/buyingDealers.js';
import { buyingDealers } from '../lib/buyingDealersShared.js';

/** What the route needs of a reader — the shared one in production, a stand-in in the tests. */
export interface BuyingDealersSource {
  get(): Promise<BuyingDealersAnswer>;
}

/** The answer with exactly the public fields, in lana.discount's order. */
export function publicAnswer(answer: BuyingDealersAnswer): BuyingDealersAnswer {
  return {
    status: answer.status,
    readAt: answer.readAt,
    staleSince: answer.staleSince,
    directoryUrl: answer.directoryUrl,
    buyers: (answer.buyers ?? []).map((b: BuyingDealer): BuyingDealer => ({
      slug: b.slug,
      name: b.name,
      host: b.host,
      website: b.website,
      registerUrl: b.registerUrl,
      sellUrl: b.sellUrl,
      eventId: b.eventId,
      signedAt: b.signedAt,
    })),
  };
}

export function buyingDealersRouter(reader: BuyingDealersSource): Router {
  const router = Router();
  router.get('/', async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache');
    try {
      return res.json(publicAnswer(await reader.get()));
    } catch (err: any) {
      console.error('[buying-dealers] answer failed:', err?.message || err);
      return res.status(500).json({ error: 'The companies could not be read right now.' });
    }
  });
  return router;
}

export default buyingDealersRouter(buyingDealers);
