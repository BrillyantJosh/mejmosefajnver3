import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { useNostrProfile } from '@/hooks/useNostrProfile';
import { supabase } from '@/integrations/supabase/client';

interface AnnuityLevel {
  level_no: number;
  trigger_price: number;
  coins_to_give: number;
  cash_out: number;
  remaining_lanas: number;
}

interface AnnuityAccount {
  account_id: number;
  wallet: string;
  levels: AnnuityLevel[];
}

interface AnnuityPlan {
  subject_hex: string;
  plan_id: string;
  coin: string;
  currency: string;
  policy: string;
  accounts: AnnuityAccount[];
}

export interface DashboardData {
  lana8Wonder: {
    isLoading: boolean;
    hasCashOut: boolean;
    totalCashOutAmount: number;
    totalCashOutFiat: number;
    accountCount: number;
  };
  wallets: {
    isLoading: boolean;
    totalBalanceLana: number;
    totalBalanceFiat: number;
    walletCount: number;
    currency: string;
  };
}

export const useDashboardData = (): DashboardData => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { profile } = useNostrProfile();

  // Lana8Wonder state
  const [lana8WonderLoading, setLana8WonderLoading] = useState(true);
  const [annuityPlan, setAnnuityPlan] = useState<AnnuityPlan | null>(null);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Wallet state
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [walletBalancesLoading, setWalletBalancesLoading] = useState(false);

  const relays = parameters?.relays || [];
  const exchangeRates = parameters?.exchangeRates;
  const currentPrice = exchangeRates?.EUR || 0;
  const userCurrency = profile?.currency || 'EUR';

  // Fetch Lana8Wonder annuity plan
  useEffect(() => {
    const fetchAnnuityPlan = async () => {
      if (!session?.nostrHexId || relays.length === 0) {
        setLana8WonderLoading(false);
        return;
      }

      const pool = new SimplePool();
      
      try {
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [88888],
            '#p': [session.nostrHexId],
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]) as Event[];

        if (events && events.length > 0) {
          const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
          const plan = JSON.parse(latestEvent.content) as AnnuityPlan;
          setAnnuityPlan(plan);
        } else {
          setAnnuityPlan(null);
        }
      } catch (error) {
        console.error('Error fetching annuity plan:', error);
        setAnnuityPlan(null);
      } finally {
        setLana8WonderLoading(false);
        pool.close(relays);
      }
    };

    fetchAnnuityPlan();
  }, [session?.nostrHexId, relays]);

  // Fetch Lana8Wonder account balances
  useEffect(() => {
    const fetchBalances = async () => {
      if (!annuityPlan || !parameters?.electrumServers) return;

      const walletAddresses = annuityPlan.accounts.map(acc => acc.wallet);
      if (walletAddresses.length === 0) return;

      setBalancesLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
          body: {
            wallet_addresses: walletAddresses,
            electrum_servers: parameters.electrumServers,
          },
        });

        if (error) {
          console.error('Error fetching Lana8Wonder balances:', error);
          return;
        }

        const balances: Record<string, number> = {};
        if (data?.wallets) {
          data.wallets.forEach((w: { wallet_id: string; balance: number }) => {
            balances[w.wallet_id] = w.balance || 0;
          });
        }
        setAccountBalances(balances);
      } catch (error) {
        console.error('Error fetching Lana8Wonder balances:', error);
      } finally {
        setBalancesLoading(false);
      }
    };

    if (annuityPlan) {
      fetchBalances();
    }
  }, [annuityPlan, parameters?.electrumServers]);

  // Fetch wallet balances
  useEffect(() => {
    const fetchWalletBalances = async () => {
      if (walletsLoading || wallets.length === 0 || !parameters?.electrumServers) {
        if (!walletsLoading && wallets.length === 0) {
          setWalletBalancesLoading(false);
        }
        return;
      }

      setWalletBalancesLoading(true);
      try {
        const walletAddresses = wallets.map(w => w.walletId);
        
        const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
          body: {
            wallet_addresses: walletAddresses,
            electrum_servers: parameters.electrumServers,
          },
        });

        if (error) {
          console.error('Error fetching wallet balances:', error);
          setWalletBalancesLoading(false);
          return;
        }

        const balances: Record<string, number> = {};
        if (data?.wallets) {
          data.wallets.forEach((w: { wallet_id: string; balance: number }) => {
            balances[w.wallet_id] = w.balance || 0;
          });
        }
        setWalletBalances(balances);
      } catch (error) {
        console.error('Error fetching wallet balances:', error);
      } finally {
        setWalletBalancesLoading(false);
      }
    };

    fetchWalletBalances();
  }, [wallets, walletsLoading, parameters?.electrumServers]);

  // Calculate Lana8Wonder cash out totals
  const calculateLana8WonderCashOut = () => {
    if (!annuityPlan || balancesLoading) {
      return { totalAmount: 0, accountCount: 0 };
    }

    let totalCashOut = 0;
    let accountsNeedingCashOut = 0;

    annuityPlan.accounts.forEach(account => {
      const balance = accountBalances[account.wallet] || 0;
      
      // Find the last triggered level (highest level_no where price >= trigger)
      // This matches the logic in Lana8Wonder.tsx
      const triggeredLevels = account.levels
        .filter(l => currentPrice >= l.trigger_price)
        .sort((a, b) => b.level_no - a.level_no);
      
      const lastTriggeredLevel = triggeredLevels[0];
      const expectedRemaining = lastTriggeredLevel?.remaining_lanas || 0;
      
      // Check if cash out is needed (balance > expected * 1.02)
      const needsCashOut = balance !== undefined && 
        lastTriggeredLevel && 
        balance > expectedRemaining * 1.02;
        
      if (needsCashOut) {
        const cashOutAmount = balance - expectedRemaining;
        totalCashOut += cashOutAmount;
        accountsNeedingCashOut++;
      }
    });

    return { totalAmount: totalCashOut, accountCount: accountsNeedingCashOut };
  };

  // Calculate total wallet balance
  const calculateWalletTotals = () => {
    if (walletBalancesLoading || wallets.length === 0) {
      return { totalLana: 0, walletCount: 0 };
    }

    let totalLana = 0;
    wallets.forEach(wallet => {
      totalLana += walletBalances[wallet.walletId] || 0;
    });

    return { totalLana, walletCount: wallets.length };
  };

  const lana8WonderData = calculateLana8WonderCashOut();
  const walletData = calculateWalletTotals();
  
  const getFiatRate = () => {
    return exchangeRates?.[userCurrency as 'EUR' | 'USD' | 'GBP'] || exchangeRates?.EUR || 0;
  };

  return {
    lana8Wonder: {
      isLoading: lana8WonderLoading || balancesLoading,
      hasCashOut: lana8WonderData.totalAmount > 0,
      totalCashOutAmount: lana8WonderData.totalAmount,
      totalCashOutFiat: lana8WonderData.totalAmount * getFiatRate(),
      accountCount: lana8WonderData.accountCount,
    },
    wallets: {
      isLoading: walletsLoading || walletBalancesLoading,
      totalBalanceLana: walletData.totalLana,
      totalBalanceFiat: walletData.totalLana * getFiatRate(),
      walletCount: walletData.walletCount,
      currency: userCurrency,
    },
  };
};
