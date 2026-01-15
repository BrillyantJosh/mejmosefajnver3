import { useMemo, useState, useEffect } from 'react';
import { useDashboardData } from './useDashboardData';
import { useNostrDonationProposals } from './useNostrDonationProposals';
import { useNostrUnpaidLashes } from './useNostrUnpaidLashes';
import { useNostrWallets } from './useNostrWallets';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrProfile } from '@/hooks/useNostrProfile';
import { supabase } from '@/integrations/supabase/client';

interface WalletDetail {
  walletId: string;
  walletType: string;
  note?: string;
  balance: number;
  balanceFiat: number;
  currency: string;
}

export interface AiAdvisorContext {
  wallets: {
    count: number;
    totalBalance: number;
    totalBalanceFiat: number | null;
    currency: string;
    details: WalletDetail[];
  } | null;
  lana8Wonder: {
    hasAnnuityPlan: boolean;
    cashOutNeeded: boolean;
    cashOutAmount: number;
    cashOutCount: number;
    cashOutAmountFiat: number | null;
  } | null;
  pendingPayments: {
    count: number;
    proposals: Array<{
      id: string;
      fiatAmount: string;
      fiatCurrency: string;
      lanaAmount: string;
    }>;
  } | null;
  unpaidLashes: {
    count: number;
  } | null;
  isLoading: boolean;
  refetchWalletBalances: () => void;
}

export function useAiAdvisorContext(): AiAdvisorContext {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { profile } = useNostrProfile();
  
  // Fetch wallets list
  const { wallets: nostrWallets, isLoading: walletsListLoading } = useNostrWallets();
  
  // State for wallet balances
  const [walletBalances, setWalletBalances] = useState<Map<string, number>>(new Map());
  const [balancesLoading, setBalancesLoading] = useState(false);
  
  // Fetch all data needed for context
  const dashboardData = useDashboardData({
    enableWallets: true,
    enableLana8Wonder: true,
  });

  // Pass userPubkey as first argument, options as second
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(
    session?.nostrHexId,
    { poll: false, enabled: true }
  );

  const { unpaidCount, loading: unpaidLashesLoading } = useNostrUnpaidLashes();

  // Get currency and exchange rate
  const currency = profile?.currency || 'USD';
  const exchangeRate = parameters?.exchangeRates?.[currency as 'EUR' | 'USD' | 'GBP'] || 0;

  // Fetch wallet balances
  const fetchWalletBalances = async () => {
    if (nostrWallets.length === 0 || !parameters?.electrumServers) {
      setWalletBalances(new Map());
      return;
    }

    setBalancesLoading(true);
    try {
      const walletAddresses = nostrWallets.map(w => w.walletId);
      
      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: {
          wallet_addresses: walletAddresses,
          electrum_servers: parameters.electrumServers,
        },
      });

      if (error) {
        console.error('Error fetching wallet balances for AI:', error);
        setWalletBalances(new Map());
        return;
      }

      const balanceMap = new Map<string, number>();
      data.wallets?.forEach((w: { wallet_id: string; balance: number }) => {
        balanceMap.set(w.wallet_id, w.balance);
      });
      setWalletBalances(balanceMap);
    } catch (error) {
      console.error('Error fetching wallet balances for AI:', error);
      setWalletBalances(new Map());
    } finally {
      setBalancesLoading(false);
    }
  };

  // Fetch balances when wallets or electrum servers change
  useEffect(() => {
    if (nostrWallets.length > 0 && parameters?.electrumServers) {
      fetchWalletBalances();
    }
  }, [nostrWallets.length, parameters?.electrumServers]);

  const context = useMemo<AiAdvisorContext>(() => {
    // Build detailed wallet list
    const walletDetails: WalletDetail[] = nostrWallets.map(wallet => {
      const balance = walletBalances.get(wallet.walletId) || 0;
      return {
        walletId: wallet.walletId,
        walletType: wallet.walletType,
        note: wallet.note,
        balance,
        balanceFiat: balance * exchangeRate,
        currency,
      };
    });

    // Calculate totals
    const totalBalance = walletDetails.reduce((sum, w) => sum + w.balance, 0);
    const totalBalanceFiat = totalBalance * exchangeRate;

    // Wallets context with details
    const walletsContext = nostrWallets.length > 0 ? {
      count: nostrWallets.length,
      totalBalance,
      totalBalanceFiat,
      currency,
      details: walletDetails,
    } : null;

    // Lana8Wonder context
    const lana8WonderContext = {
      hasAnnuityPlan: dashboardData.lana8Wonder.accountCount > 0 || dashboardData.lana8Wonder.hasCashOut,
      cashOutNeeded: dashboardData.lana8Wonder.hasCashOut,
      cashOutAmount: dashboardData.lana8Wonder.totalCashOutAmount,
      cashOutCount: dashboardData.lana8Wonder.accountCount,
      cashOutAmountFiat: dashboardData.lana8Wonder.totalCashOutFiat,
    };

    // Pending payments context
    const pendingPaymentsContext = proposals.length > 0 ? {
      count: proposals.length,
      proposals: proposals.map(p => ({
        id: p.id,
        fiatAmount: p.fiatAmount,
        fiatCurrency: p.fiatCurrency,
        lanaAmount: p.lanaAmount,
      })),
    } : null;

    // Unpaid lashes context
    const unpaidLashesContext = unpaidCount > 0 ? {
      count: unpaidCount,
    } : null;

    const isLoading = walletsListLoading || balancesLoading || 
      dashboardData.lana8Wonder.isLoading || proposalsLoading || unpaidLashesLoading;

    return {
      wallets: walletsContext,
      lana8Wonder: lana8WonderContext,
      pendingPayments: pendingPaymentsContext,
      unpaidLashes: unpaidLashesContext,
      isLoading,
      refetchWalletBalances: fetchWalletBalances,
    };
  }, [nostrWallets, walletBalances, dashboardData, proposals, proposalsLoading, unpaidCount, unpaidLashesLoading, walletsListLoading, balancesLoading, exchangeRate, currency]);

  return context;
}
