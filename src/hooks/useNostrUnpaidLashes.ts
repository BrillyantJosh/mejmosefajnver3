import { useState, useEffect, useMemo, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { isLashExpired } from '@/lib/lashExpiration';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

/**
 * Hook to count unpaid LASH payment records (KIND 39991) for the current user
 * Returns the count of payment records with state != "paid"
 */
export function useNostrUnpaidLashes() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const pool = useMemo(() => new SimplePool(), []);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  const fetchUnpaidLashes = useCallback(async () => {
    if (!session?.nostrHexId) {
      setUnpaidCount(0);
      return;
    }
    
    setLoading(true);
    
    try {
      // Fetch all payment records (KIND 39991) by this user
      const paymentRecords = await pool.querySync(relays, {
        kinds: [39991],
        authors: [session.nostrHexId],
        limit: 1000
      });

      // Filter out expired and paid records
      const unpaidRecords = paymentRecords.filter(event => {
        if (isLashExpired(event)) return false;
        const stateTag = event.tags.find(tag => tag[0] === 'state');
        return stateTag?.[1] !== 'paid';
      });

      console.log(`📤 Found payment records: ${paymentRecords.length} total, ${unpaidRecords.length} unpaid (non-expired, state != paid)`);

      // Extract UNIQUE lash IDs using Set for deduplication
      const lashIdsSet = new Set(
        unpaidRecords
          .map(event => event.tags.find(tag => tag[0] === 'd')?.[1])
          .filter(Boolean)
      );
      const unpaidCount = lashIdsSet.size;

      console.log('💰 Unpaid LASHes:', unpaidCount);

      setUnpaidCount(unpaidCount);
      } catch (error) {
        console.error('❌ Error fetching unpaid lashes:', error);
        setUnpaidCount(0);
      } finally {
        setLoading(false);
      }
  }, [session?.nostrHexId, relays, pool]);

  // Function to manually increment the unpaid count (optimistic update)
  const incrementUnpaidCount = useCallback(() => {
    setUnpaidCount(prev => prev + 1);
    
    // Reset to real value after 5 seconds
    setTimeout(() => {
      fetchUnpaidLashes();
    }, 5000);
  }, [fetchUnpaidLashes]);

  useEffect(() => {
    if (!session?.nostrHexId) {
      setUnpaidCount(0);
      return;
    }

    fetchUnpaidLashes();

    // Refresh every 15 seconds
    const interval = setInterval(fetchUnpaidLashes, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [session?.nostrHexId, fetchUnpaidLashes]);

  return { 
    unpaidCount, 
    loading, 
    incrementUnpaidCount,
    refetch: fetchUnpaidLashes 
  };
}
