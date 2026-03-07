import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

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

  const fetchWallets = useCallback(async () => {
    if (!session?.nostrHexId) {
      setIsLoading(false);
      return;
    }

    try {
      console.log('🔄 Fetching wallets via edge function for:', session.nostrHexId);
      
      const { data, error } = await supabase.functions.invoke('fetch-user-wallets', {
        body: { userPubkey: session.nostrHexId }
      });

      if (error) {
        console.error('❌ Edge function error:', error);
        setWallets([]);
        return;
      }

      if (data?.success && data?.wallets) {
        console.log('✅ Wallets loaded via server:', data.wallets.length);
        setWallets(data.wallets);
      } else {
        console.log('⚠️ No wallets returned:', data?.error);
        setWallets([]);
      }
    } catch (error) {
      console.error('❌ Error fetching wallets:', error);
      setWallets([]);
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
    refetch: fetchWallets
  };
};
