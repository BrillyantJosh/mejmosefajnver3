import { useState, useEffect, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface BuybackTransaction {
  id: string;
  txHash: string;
  userHex: string;
  senderWallet: string;
  buybackWallet: string;
  lanaAmount: number;
  lanaDisplay: number;
  currency: string;
  exchangeRate: number;
  grossFiat: number;
  commissionPercent: number;
  commissionFiat: number;
  netFiat: number;
  split: number;
  source: string;
  status: string;
  paidFiat: number;
  rpcVerified: boolean;
  rpcConfirmations: number;
  createdAt: number;
}

export interface FiatPayout {
  id: string;
  txRef: string;
  userHex: string;
  amount: number;
  currency: string;
  paidToAccount: string;
  reference: string;
  paidAt: string;
  remaining: number;
  status: string;
  createdAt: number;
}

function getTagValue(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key)?.[1];
}

function parseBuybackEvent(event: any): BuybackTransaction | null {
  try {
    const tags: string[][] = event.tags || [];
    const id = getTagValue(tags, 'd');
    const txHash = getTagValue(tags, 'tx_hash');
    const userHex = getTagValue(tags, 'user_hex');

    if (!id || !txHash) return null;

    return {
      id,
      txHash,
      userHex: userHex || '',
      senderWallet: getTagValue(tags, 'sender_wallet') || '',
      buybackWallet: getTagValue(tags, 'buyback_wallet') || '',
      lanaAmount: parseFloat(getTagValue(tags, 'lana_amount') || '0'),
      lanaDisplay: parseFloat(getTagValue(tags, 'lana_display') || '0'),
      currency: getTagValue(tags, 'currency') || 'EUR',
      exchangeRate: parseFloat(getTagValue(tags, 'exchange_rate') || '0'),
      grossFiat: parseFloat(getTagValue(tags, 'gross_fiat') || '0'),
      commissionPercent: parseFloat(getTagValue(tags, 'commission_percent') || '0'),
      commissionFiat: parseFloat(getTagValue(tags, 'commission_fiat') || '0'),
      netFiat: parseFloat(getTagValue(tags, 'net_fiat') || '0'),
      split: parseFloat(getTagValue(tags, 'split') || '0'),
      source: getTagValue(tags, 'source') || 'external',
      status: getTagValue(tags, 'status') || 'completed',
      paidFiat: parseFloat(getTagValue(tags, 'paid_fiat') || '0'),
      rpcVerified: getTagValue(tags, 'rpc_verified') === '1' || getTagValue(tags, 'rpc_verified') === 'true',
      rpcConfirmations: parseInt(getTagValue(tags, 'rpc_confirmations') || '0', 10),
      createdAt: event.created_at,
    };
  } catch {
    return null;
  }
}

function parsePayoutEvent(event: any): FiatPayout | null {
  try {
    const tags: string[][] = event.tags || [];
    const id = getTagValue(tags, 'd');
    const txRef = getTagValue(tags, 'tx_ref');

    if (!id) return null;

    return {
      id,
      txRef: txRef || '',
      userHex: getTagValue(tags, 'user_hex') || '',
      amount: parseFloat(getTagValue(tags, 'amount') || '0'),
      currency: getTagValue(tags, 'currency') || 'EUR',
      paidToAccount: getTagValue(tags, 'paid_to_account') || '',
      reference: getTagValue(tags, 'reference') || '',
      paidAt: getTagValue(tags, 'paid_at') || '',
      remaining: parseFloat(getTagValue(tags, 'remaining') || '0'),
      status: getTagValue(tags, 'status') || 'partial',
      createdAt: event.created_at,
    };
  } catch {
    return null;
  }
}

export const useDiscountTransactions = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [transactions, setTransactions] = useState<BuybackTransaction[]>([]);
  const [payouts, setPayouts] = useState<FiatPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session?.nostrHexId || !parameters?.relays) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const pool = new SimplePool();

    try {
      // Fetch ALL KIND 30936 and 30937 events, then filter client-side by user_hex tag
      // (Nostr relays don't index multi-char tag names like "user_hex")
      const [buybackEvents, payoutEvents] = await Promise.all([
        pool.querySync(parameters.relays, { kinds: [30936 as number], limit: 500 }),
        pool.querySync(parameters.relays, { kinds: [30937 as number], limit: 500 }),
      ]);

      console.log(`[discount] Fetched ${buybackEvents.length} KIND 30936 events, ${payoutEvents.length} KIND 30937 events`);

      // Parse buyback transactions — show all, newest first by transaction ID
      const parsedTransactions = buybackEvents
        .map(parseBuybackEvent)
        .filter((t): t is BuybackTransaction => t !== null)
        .sort((a, b) => {
          // Sort by numeric ID descending (newest transaction = highest ID)
          const idA = parseInt(a.id) || 0;
          const idB = parseInt(b.id) || 0;
          if (idA !== idB) return idB - idA;
          return b.createdAt - a.createdAt;
        });

      // Parse payouts
      const parsedPayouts = payoutEvents
        .map(parsePayoutEvent)
        .filter((p): p is FiatPayout => p !== null)
        .sort((a, b) => b.createdAt - a.createdAt);

      setTransactions(parsedTransactions);
      setPayouts(parsedPayouts);
    } catch (err) {
      console.error('Error fetching discount transactions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
    } finally {
      setLoading(false);
      pool.close(parameters.relays);
    }
  }, [session?.nostrHexId, parameters?.relays]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { transactions, payouts, loading, error, refetch: fetchData };
};
