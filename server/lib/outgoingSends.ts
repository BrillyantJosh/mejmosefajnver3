/**
 * What a wallet has already sent, before the chain admits it.
 *
 * A Lana transaction takes time to appear, and until it does the balance still
 * reads high. On the Lana8Wonder page that meant the red "Cash out required"
 * alert stayed up after a transfer had gone through, and people pressed it
 * again — some sent their surplus twice.
 *
 * Rows are written at the one moment nobody can fake or skip: immediately
 * after the broadcast succeeds, inside server/lib/crypto.ts, where the server
 * itself built and signed the transaction. Nothing is taken from a client.
 *
 * Reading is public, and deliberately so: a row says only "this address has an
 * outgoing transaction of this size", which the chain will say out loud within
 * minutes anyway.
 */
import { getDb } from '../db/connection.js';

/** A transaction older than this has confirmed, or it never will. */
export const SEND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface OutgoingSend {
  txid: string;
  walletId: string;
  amountLana: number;
  purpose: string | null;
  /** Unix milliseconds. */
  createdAt: number;
}

/**
 * Write one broadcast down. Never throws: a transaction that has already left
 * must not be reported as failed because a bookkeeping row could not be saved.
 */
export function recordOutgoingSend(entry: {
  txid: string;
  walletId: string;
  amountLana: number;
  purpose?: string | null;
  now?: number;
}): void {
  try {
    const txid = String(entry.txid || '').trim();
    const walletId = String(entry.walletId || '').trim();
    if (!/^[a-fA-F0-9]{64}$/.test(txid) || !walletId) return;

    const amount = Number(entry.amountLana);
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO outgoing_sends (txid, wallet_id, amount_lana, purpose, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      txid,
      walletId,
      Number.isFinite(amount) && amount > 0 ? amount : 0,
      entry.purpose ? String(entry.purpose).slice(0, 64) : null,
      entry.now ?? Date.now()
    );
  } catch (err) {
    console.error('⚠️ Could not record outgoing send (transaction itself is unaffected):', err);
  }
}

/**
 * The newest send per wallet within `windowMs`. One row per wallet: the app
 * asks "is something on its way", not "list everything that ever left".
 */
export function recentSendsByWallet(
  walletIds: string[],
  windowMs: number,
  now: number = Date.now()
): Record<string, OutgoingSend> {
  const wallets = (walletIds || []).map(w => String(w || '').trim()).filter(Boolean).slice(0, 200);
  if (wallets.length === 0) return {};

  const since = now - Math.max(0, windowMs);
  const placeholders = wallets.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT txid, wallet_id, amount_lana, purpose, created_at
         FROM outgoing_sends
        WHERE wallet_id IN (${placeholders}) AND created_at >= ?
        ORDER BY created_at ASC`
    )
    .all(...wallets, since) as Array<{
      txid: string; wallet_id: string; amount_lana: number; purpose: string | null; created_at: number;
    }>;

  // Ascending order plus plain assignment leaves the NEWEST row per wallet.
  const newest: Record<string, OutgoingSend> = {};
  for (const row of rows) {
    newest[row.wallet_id] = {
      txid: row.txid,
      walletId: row.wallet_id,
      amountLana: row.amount_lana,
      purpose: row.purpose,
      createdAt: row.created_at,
    };
  }
  return newest;
}

/** Drop rows past the retention window. A ledger nobody prunes becomes the problem. */
export function pruneOutgoingSends(now: number = Date.now()): number {
  try {
    const res = getDb()
      .prepare('DELETE FROM outgoing_sends WHERE created_at < ?')
      .run(now - SEND_RETENTION_MS);
    return res.changes || 0;
  } catch (err) {
    console.error('⚠️ Could not prune outgoing_sends:', err);
    return 0;
  }
}
