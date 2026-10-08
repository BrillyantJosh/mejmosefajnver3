/**
 * The one dealer reader this process keeps (./buyingDealers.ts), behind GET
 * /api/buying-dealers (../routes/buyingDealers.ts). Separate from
 * buyingDealers.ts only so that module's tests, and the route's, never open
 * the production database: getDb() opens data/mejmosefajn.db on first call,
 * not at import, and nothing here calls it until the first read.
 *
 * `keepFresh`: from the first time it is asked, it reads again every ten
 * minutes by itself, as BEF Explorer does on its heartbeat — so the first
 * visitor after a quiet night is not shown the firms of the evening before.
 * The timer starts on first use, not at import, and never keeps the process
 * alive. (lana.discount server/lib/buyingDealersShared.ts, 1996af0; there the
 * handle is getDbHandle from ../db/index.js, here getDb from
 * ../db/connection.js.)
 */
import { getDb } from '../db/connection.js';
import { createBuyingDealersReader } from './buyingDealers.js';

export const buyingDealers = createBuyingDealersReader({ db: getDb, keepFresh: true });
