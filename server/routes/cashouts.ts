/**
 * What a wallet has already sent — the fact the Lana8Wonder page needs before
 * it asks anyone to cash out again.
 *
 * Read-only, and it answers with facts rather than a decision: the newest
 * broadcast per wallet, with its txid, amount and time. Whether that is recent
 * enough to silence a prompt is the caller's rule (src/lib/cashOutDue.ts), so
 * the two never drift into disagreeing about the same moment.
 *
 * Kept out of /api/functions on purpose: that router is one 3000-line file
 * another session is working in, and this needed to be addable without
 * touching it.
 */
import { Router, Request, Response } from 'express';
import { recentSendsByWallet, pruneOutgoingSends } from '../lib/outgoingSends.js';

const router = Router();

/** Anything older than this cannot silence a prompt, so it is not worth sending. */
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Wallets per request. The plan with the most accounts holds far fewer. */
const MAX_WALLETS = 100;

let lastPrune = 0;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

router.get('/recent', (req: Request, res: Response) => {
  try {
    const raw = String(req.query.wallets || '');
    const wallets = raw
      .split(',')
      .map(w => w.trim())
      .filter(Boolean)
      .slice(0, MAX_WALLETS);

    if (wallets.length === 0) {
      return res.status(400).json({ success: false, error: 'wallets query parameter is required' });
    }

    const now = Date.now();
    if (now - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = now;
      pruneOutgoingSends(now);
    }

    const sends = recentSendsByWallet(wallets, LOOKBACK_MS, now);
    return res.json({ success: true, sends, serverTime: now });
  } catch (error: any) {
    console.error('❌ /api/cashouts/recent error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
