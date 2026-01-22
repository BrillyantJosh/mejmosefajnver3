import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to count unpaid LASH payment records (KIND 39991) for the current user
 * Uses server-side edge function to bypass Chrome WebSocket limitations
 */
export function useNostrUnpaidLashes() {
  const { session } = useAuth();
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchUnpaidLashes = useCallback(async () => {
    if (!session?.nostrHexId) {
      setUnpaidCount(0);
      return;
    }
    
    setLoading(true);
    
    try {
      console.log('🔄 Fetching unpaid lashes via edge function');
      
      const { data, error } = await supabase.functions.invoke('fetch-unpaid-lashes', {
        body: { userPubkey: session.nostrHexId }
      });

      if (error) {
        console.error('❌ Edge function error:', error);
        setUnpaidCount(0);
        return;
      }

      if (data?.success) {
        console.log('💰 Unpaid LASHes via server:', data.unpaidCount);
        setUnpaidCount(data.unpaidCount);
      } else {
        console.log('⚠️ No unpaid lashes data:', data?.error);
        setUnpaidCount(0);
      }
    } catch (error) {
      console.error('❌ Error fetching unpaid lashes:', error);
      setUnpaidCount(0);
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId]);

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
