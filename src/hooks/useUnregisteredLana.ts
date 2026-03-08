import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';

export interface UnregisteredLanaRecord {
  id: string;
  event_id_87003: string;
  pubkey: string;
  wallet_id: string;
  tx_id: string;
  amount_lanoshis: number;
  registrar_pubkey: string;
  created_at: number;
  fetched_at: string;
}

/**
 * Hook to fetch unregistered LANA records (KIND 87003) for the current user.
 * Polls the server every 60 seconds.
 * Filters out records whose wallet_id is no longer in the user's KIND 30889 wallet list.
 */
export function useUnregisteredLana() {
  const { session } = useAuth();
  const { wallets } = useNostrWallets();
  const [rawRecords, setRawRecords] = useState<UnregisteredLanaRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL ?? '';

  // Set of current wallet addresses from KIND 30889
  const activeWalletIds = useMemo(
    () => new Set(wallets.map(w => w.walletId)),
    [wallets]
  );

  // Only keep records whose wallet still exists in the user's wallet list
  const records = useMemo(() => {
    if (activeWalletIds.size === 0) return rawRecords;
    return rawRecords.filter(r => activeWalletIds.has(r.wallet_id));
  }, [rawRecords, activeWalletIds]);

  const count = records.length;

  const fetchRecords = useCallback(async () => {
    if (!session?.nostrHexId) {
      setRawRecords([]);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/functions/unregistered-lana`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPubkey: session.nostrHexId }),
      });

      if (!res.ok) {
        setRawRecords([]);
        return;
      }

      const data = await res.json();

      if (data?.success) {
        setRawRecords(data.records || []);
      } else {
        setRawRecords([]);
      }
    } catch (error) {
      console.error('Error fetching unregistered LANA:', error);
      setRawRecords([]);
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId, API_URL]);

  useEffect(() => {
    if (!session?.nostrHexId) {
      setRawRecords([]);
      return;
    }

    fetchRecords();

    // Refresh every 60 seconds
    const interval = setInterval(fetchRecords, 60000);

    return () => {
      clearInterval(interval);
    };
  }, [session?.nostrHexId, fetchRecords]);

  return { records, count, loading, refetch: fetchRecords };
}
