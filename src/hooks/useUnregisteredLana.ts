import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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
 */
export function useUnregisteredLana() {
  const { session } = useAuth();
  const [records, setRecords] = useState<UnregisteredLanaRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL ?? '';

  const fetchRecords = useCallback(async () => {
    if (!session?.nostrHexId) {
      setRecords([]);
      setCount(0);
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
        setRecords([]);
        setCount(0);
        return;
      }

      const data = await res.json();

      if (data?.success) {
        setRecords(data.records || []);
        setCount(data.count || 0);
      } else {
        setRecords([]);
        setCount(0);
      }
    } catch (error) {
      console.error('Error fetching unregistered LANA:', error);
      setRecords([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId, API_URL]);

  useEffect(() => {
    if (!session?.nostrHexId) {
      setRecords([]);
      setCount(0);
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
