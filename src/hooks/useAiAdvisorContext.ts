import { useMemo, useState, useEffect } from 'react';
import { useDashboardData } from './useDashboardData';
import { useNostrDonationProposals } from './useNostrDonationProposals';
import { useNostrUnpaidLashes } from './useNostrUnpaidLashes';
import { useNostrWallets } from './useNostrWallets';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrProfile } from '@/hooks/useNostrProfile';
import { useNostrUserProjects, UserProjectData, UserProjectDonation } from '@/hooks/useNostrUserProjects';
import { supabase } from '@/integrations/supabase/client';

interface WalletDetail {
  walletId: string;
  walletType: string;
  note?: string;
  balance: number;
  balanceFiat: number;
  currency: string;
}

// 100 Million Ideas context types
export interface ProjectSummary {
  id: string;
  title: string;
  status: 'draft' | 'active';
  fiatGoal: number;
  currency: string;
  totalRaised: number;
  percentFunded: number;
  amountRemaining: number;
  isFullyFunded: boolean;
  donationCount: number;
  wallet: string;
}

export interface ProjectDonationDetail {
  eventId: string;
  supporterName: string;
  supporterPubkey: string;
  amountFiat: number;
  amountLana: number;
  currency: string;
  txid: string;
  date: string;
  message: string;
}

export interface UserProjectsContext {
  projectCount: number;
  totalRaised: number;
  totalGoal: number;
  overallPercentFunded: number;
  totalDonations: number;
  fullyFundedCount: number;
  activeCount: number;
  draftCount: number;
  projects: ProjectSummary[];
  // Function to get detailed donations for a project
  getProjectDonations: (projectId: string) => ProjectDonationDetail[];
  // Search function
  searchProjects: (query: string) => ProjectSummary[];
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
  // 100 Million Ideas context
  userProjects: UserProjectsContext | null;
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

  // 100 Million Ideas - user projects
  const { 
    projects: userProjects, 
    allProjects, 
    stats: projectStats, 
    isLoading: projectsLoading,
    searchProjects: searchProjectsFn,
    getProfileName,
    profiles
  } = useNostrUserProjects();

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

  // Helper to get donations for a specific project
  const getProjectDonations = (projectId: string): ProjectDonationDetail[] => {
    const project = userProjects.find(p => p.id === projectId);
    if (!project) return [];
    
    return project.donations.map(d => ({
      eventId: d.eventId,
      supporterName: d.supporterName || `${d.supporterPubkey.slice(0, 12)}...`,
      supporterPubkey: d.supporterPubkey,
      amountFiat: d.amountFiat,
      amountLana: parseFloat(d.amountLanoshis) / 100000000,
      currency: d.currency,
      txid: d.txid,
      date: new Date(d.timestampPaid * 1000).toISOString(),
      message: d.message,
    }));
  };

  // Search projects with profile name matching
  const searchProjects = (query: string): ProjectSummary[] => {
    const results = searchProjectsFn(query);
    return results.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      fiatGoal: p.fiatGoal,
      currency: p.currency,
      totalRaised: p.totalRaised,
      percentFunded: p.percentFunded,
      amountRemaining: p.amountRemaining,
      isFullyFunded: p.isFullyFunded,
      donationCount: p.donationCount,
      wallet: p.wallet,
    }));
  };

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

    // 100 Million Ideas - user projects context
    const userProjectsContext: UserProjectsContext | null = userProjects.length > 0 || projectStats.projectCount > 0 ? {
      projectCount: projectStats.projectCount,
      totalRaised: projectStats.totalRaised,
      totalGoal: projectStats.totalGoal,
      overallPercentFunded: projectStats.overallPercentFunded,
      totalDonations: projectStats.totalDonations,
      fullyFundedCount: projectStats.fullyFundedCount,
      activeCount: projectStats.activeCount,
      draftCount: projectStats.draftCount,
      projects: userProjects.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        fiatGoal: p.fiatGoal,
        currency: p.currency,
        totalRaised: p.totalRaised,
        percentFunded: p.percentFunded,
        amountRemaining: p.amountRemaining,
        isFullyFunded: p.isFullyFunded,
        donationCount: p.donationCount,
        wallet: p.wallet,
      })),
      getProjectDonations,
      searchProjects,
    } : null;

    const isLoading = walletsListLoading || balancesLoading || 
      dashboardData.lana8Wonder.isLoading || proposalsLoading || unpaidLashesLoading || projectsLoading;

    return {
      wallets: walletsContext,
      lana8Wonder: lana8WonderContext,
      pendingPayments: pendingPaymentsContext,
      unpaidLashes: unpaidLashesContext,
      userProjects: userProjectsContext,
      isLoading,
      refetchWalletBalances: fetchWalletBalances,
    };
  }, [nostrWallets, walletBalances, dashboardData, proposals, proposalsLoading, unpaidCount, unpaidLashesLoading, walletsListLoading, balancesLoading, exchangeRate, currency, userProjects, projectStats, projectsLoading]);

  return context;
}
