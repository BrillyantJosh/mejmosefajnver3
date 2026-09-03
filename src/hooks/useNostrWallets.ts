import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { singleFlight } from '@/lib/singleFlight';

export interface NostrWallet {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
  freezeStatus?: string;  // per-wallet freeze: '' | 'frozen_l8w' | 'frozen_max_cap' | 'frozen_too_wild'
}

export const useNostrWallets = () => {
  const { session } = useAuth();
  const [wallets, setWallets] = useState<NostrWallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // True only after the registrar's list was actually read. An outage hands
  // back an empty array that looks exactly like "this person has no wallets",
  // and callers that gate on a freeze must not read that silence as "clean".
  const [resolved, setResolved] = useState(false);

  const fetchWallets = useCallback(async () => {
    if (!session?.nostrHexId) {
      setIsLoading(false);
      return;
    }

    try {
      console.log('🔄 Fetching wallets via edge function for:', session.nostrHexId);
      
      // MainLayout mounts this hook three times (directly, and through
      // useUnregisteredLana and useWarningBeforeSplit), and each mount used to
      // fire its own POST — a route that runs three relay filters against
      // every relay. Concurrent callers now share one round trip.
      const { data, error } = await singleFlight(
        `user-wallets:${session.nostrHexId}`,
        () => supabase.functions.invoke('fetch-user-wallets', { body: { userPubkey: session.nostrHexId } })
      );

      if (error) {
        console.error('❌ Edge function error:', error);
        setWallets([]);
        setResolved(false);
        return;
      }

      if (data?.success && data?.wallets) {
        console.log('✅ Wallets loaded via server:', data.wallets.length);
        setWallets(data.wallets);
        setResolved(true);
      } else {
        console.log('⚠️ No wallets returned:', data?.error);
        setWallets([]);
        setResolved(false);
      }
    } catch (error) {
      console.error('❌ Error fetching wallets:', error);
      setWallets([]);
      setResolved(false);
    } finally {
      setIsLoading(false);
    }
  }, [session?.nostrHexId]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  return {
    wallets,
    isLoading,
    resolved,
    refetch: fetchWallets
  };
};
