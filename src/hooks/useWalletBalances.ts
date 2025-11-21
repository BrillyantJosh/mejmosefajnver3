import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

interface WalletBalance {
  wallet_id: string;
  balance: number;
  status: string;
  error?: string;
}

interface WalletBalancesResult {
  balances: Map<string, number>;
  isLoading: boolean;
  error: string | null;
}

export const useWalletBalances = (walletAddresses: string[]): WalletBalancesResult => {
  const { parameters } = useSystemParameters();
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBalances = async () => {
      if (walletAddresses.length === 0) {
        setBalances(new Map());
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const electrumServers = (parameters?.electrumServers || []).map((server: any) => ({
          host: server.host,
          port: server.port.toString()
        }));

        if (electrumServers.length === 0) {
          electrumServers.push({ host: 'electrum1.lanacoin.com', port: '5097' });
        }

        const { data, error: functionError } = await supabase.functions.invoke('get-wallet-balances', {
          body: {
            wallet_addresses: walletAddresses,
            electrum_servers: electrumServers
          }
        });

        if (functionError) throw functionError;

        if (data?.wallets) {
          const balanceMap = new Map<string, number>();
          data.wallets.forEach((wallet: WalletBalance) => {
            balanceMap.set(wallet.wallet_id, wallet.balance);
          });
          setBalances(balanceMap);
        }
      } catch (err) {
        console.error('Error fetching wallet balances:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch balances');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
  }, [walletAddresses.join(','), parameters?.electrumServers]);

  return { balances, isLoading, error };
};
