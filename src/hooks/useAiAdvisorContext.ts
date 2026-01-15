import { useMemo } from 'react';
import { useDashboardData } from './useDashboardData';
import { useNostrDonationProposals } from './useNostrDonationProposals';
import { useNostrUnpaidLashes } from './useNostrUnpaidLashes';
import { useAuth } from '@/contexts/AuthContext';

export interface AiAdvisorContext {
  wallets: {
    count: number;
    totalBalance: number;
    totalBalanceFiat: number | null;
    currency: string;
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
}

export function useAiAdvisorContext(): AiAdvisorContext {
  const { session } = useAuth();
  
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

  const context = useMemo<AiAdvisorContext>(() => {
    // Wallets context
    const walletsContext = dashboardData.wallets.walletCount > 0 ? {
      count: dashboardData.wallets.walletCount,
      totalBalance: dashboardData.wallets.totalBalanceLana,
      totalBalanceFiat: dashboardData.wallets.totalBalanceFiat,
      currency: dashboardData.wallets.currency,
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

    return {
      wallets: walletsContext,
      lana8Wonder: lana8WonderContext,
      pendingPayments: pendingPaymentsContext,
      unpaidLashes: unpaidLashesContext,
      isLoading: dashboardData.wallets.isLoading || dashboardData.lana8Wonder.isLoading || proposalsLoading || unpaidLashesLoading,
    };
  }, [dashboardData, proposals, proposalsLoading, unpaidCount, unpaidLashesLoading]);

  return context;
}
