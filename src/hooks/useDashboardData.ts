import { useState, useEffect, useRef } from 'react';
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

export interface DashboardDataOptions {
  enableWallets?: boolean;
  enableLana8Wonder?: boolean;
}

export const useDashboardData = (options: DashboardDataOptions = {}): DashboardData => {
  const { enableWallets = true, enableLana8Wonder = true } = options;
  
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { profile } = useNostrProfile();

  // Lana8Wonder state
  const [lana8WonderLoading, setLana8WonderLoading] = useState(false);
  const [annuityPlan, setAnnuityPlan] = useState<AnnuityPlan | null>(null);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const lana8WonderFetchedRef = useRef(false);

  // Wallet state
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [walletBalancesLoading, setWalletBalancesLoading] = useState(false);
  const walletBalancesFetchedRef = useRef(false);

  const relays = parameters?.relays || [];
  const exchangeRates = parameters?.exchangeRates;
  const currentPrice = exchangeRates?.EUR || 0;
  const userCurrency = profile?.currency || 'EUR';

  // Fetch Lana8Wonder annuity plan - only when enabled
  useEffect(() => {
    if (!enableLana8Wonder) {
      return;
    }

    // Don't re-fetch if already fetched
    if (lana8WonderFetchedRef.current) {
      return;
    }

    const fetchAnnuityPlan = async () => {
      if (!session?.nostrHexId || relays.length === 0) {
        setLana8WonderLoading(false);
        return;
      }

      setLana8WonderLoading(true);
      lana8WonderFetchedRef.current = true;

      const pool = new SimplePool();
      
      try {
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [88888],
            '#p': [session.nostrHexId],
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 15000)
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
  }, [enableLana8Wonder, session?.nostrHexId, relays.join(',')]);

  // Fetch Lana8Wonder account balances - only when enabled and we have a plan
  useEffect(() => {
    if (!enableLana8Wonder || !annuityPlan || !parameters?.electrumServers) {
      return;
    }

    const walletAddresses = annuityPlan.accounts.map(acc => acc.wallet);
    if (walletAddresses.length === 0) return;

    const fetchBalances = async () => {
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

    fetchBalances();
  }, [enableLana8Wonder, annuityPlan, parameters?.electrumServers]);

  // Fetch wallet balances - only when enabled
  useEffect(() => {
    if (!enableWallets) {
      return;
    }

    // Don't re-fetch if already fetched for these wallets
    if (walletBalancesFetchedRef.current && wallets.length > 0) {
      return;
    }

    const fetchWalletBalances = async () => {
      if (walletsLoading) {
        return;
      }

      if (wallets.length === 0 || !parameters?.electrumServers) {
        setWalletBalancesLoading(false);
        return;
      }

      setWalletBalancesLoading(true);
      walletBalancesFetchedRef.current = true;

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
  }, [enableWallets, wallets, walletsLoading, parameters?.electrumServers]);

  // Reset refs when enabled changes to false
  useEffect(() => {
    if (!enableLana8Wonder) {
      lana8WonderFetchedRef.current = false;
    }
  }, [enableLana8Wonder]);

  useEffect(() => {
    if (!enableWallets) {
      walletBalancesFetchedRef.current = false;
    }
  }, [enableWallets]);

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

  // Lana8Wonder is loading only if enabled and actually loading
  const lana8WonderStillLoading = enableLana8Wonder && (lana8WonderLoading || balancesLoading);

  // Wallets loading only if enabled and actually loading
  const walletsStillLoading = enableWallets && (walletsLoading || walletBalancesLoading);

  return {
    lana8Wonder: {
      isLoading: lana8WonderStillLoading,
      hasCashOut: lana8WonderData.totalAmount > 0,
      totalCashOutAmount: lana8WonderData.totalAmount,
      totalCashOutFiat: lana8WonderData.totalAmount * getFiatRate(),
      accountCount: lana8WonderData.accountCount,
    },
    wallets: {
      isLoading: walletsStillLoading,
      totalBalanceLana: walletData.totalLana,
      totalBalanceFiat: walletData.totalLana * getFiatRate(),
      walletCount: walletData.walletCount,
      currency: userCurrency,
    },
  };
};
