import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

interface WalletBalance {
  wallet_id: string;
  balance: number;
  status: string;
  error?: string;
}

export function useWalletBalance(walletAddress: string | null) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!walletAddress || !parameters?.electrumServers) {
      return;
    }

    const fetchBalance = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: functionError } = await supabase.functions.invoke('get-wallet-balances', {
          body: {
            wallet_addresses: [walletAddress],
            electrum_servers: parameters.electrumServers
          }
        });

        if (functionError) throw functionError;

        if (data?.success && data?.wallets?.length > 0) {
          const walletData: WalletBalance = data.wallets[0];
          setBalance(walletData.balance);
          if (walletData.error) {
            setError(walletData.error);
          }
        } else {
          setBalance(0);
        }
      } catch (err) {
        console.error('Error fetching wallet balance:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch balance');
        setBalance(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalance();
  }, [walletAddress, parameters]);

  return { balance, isLoading, error };
}
