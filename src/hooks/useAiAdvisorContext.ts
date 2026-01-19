import { useMemo, useState, useEffect } from 'react';
import { useDashboardData } from './useDashboardData';
import { useNostrUnpaidLashes } from './useNostrUnpaidLashes';
import { useNostrWallets } from './useNostrWallets';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrProfile } from '@/hooks/useNostrProfile';
import { useNostrUserProjects, UserProjectData, UserProjectDonation } from '@/hooks/useNostrUserProjects';
import { useAiAdvisorUnconditionalPayments, UnconditionalPaymentsContext } from './useAiAdvisorUnconditionalPayments';
import { useAiAdvisorRecentChats, RecentChatsContext } from './useAiAdvisorRecentChats';
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
  coverImage?: string;
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

export interface AllProjectSummary {
  id: string;
  title: string;
  shortDesc: string;
  ownerName?: string;
  ownerPubkey: string;
  fiatGoal: number;
  currency: string;
  totalRaised: number;
  percentFunded: number;
  isFullyFunded: boolean;
  donationCount: number;
  // Explicitly mark if this is user's own project
  isMyProject: boolean;
  coverImage?: string;
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
  // ALL active projects for searching
  allActiveProjects: AllProjectSummary[];
  // Function to get detailed donations for a project
  getProjectDonations: (projectId: string) => ProjectDonationDetail[];
  // Search function
  searchProjects: (query: string) => ProjectSummary[];
}

// Recent activity for "Kaj je novega pri meni?"
export interface RecentDonation {
  projectTitle: string;
  supporterName: string;
  amountFiat: number;
  currency: string;
  date: string;
}

export interface RecentActivityContext {
  recentDonationsReceived: RecentDonation[];
  recentDonationsCount: number;
  recentDonationsTotalFiat: number;
  recentDonationsCurrency: string;
}

// New projects for "Kaj je novega v Lana Svetu?"
export interface NewProjectSummary {
  id: string;
  title: string;
  shortDesc: string;
  ownerName?: string;
  createdAt: string;
  coverImage?: string;
}

export interface NewProjectsContext {
  newProjects: NewProjectSummary[];
  newProjectsCount: number;
}

// User profile context for personalization
export interface UserProfileContext {
  name: string | null;
  displayName: string | null;
  currency: string;
  language: string | null;
}

export interface AiAdvisorContext {
  // User profile for personalization
  userProfile: UserProfileContext | null;
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
  unconditionalPayments: UnconditionalPaymentsContext | null;
  unpaidLashes: {
    count: number;
  } | null;
  // 100 Million Ideas context
  userProjects: UserProjectsContext | null;
  // Recent activity (last 7 days)
  recentActivity: RecentActivityContext | null;
  // New projects in ecosystem (last 7 days)
  newProjects: NewProjectsContext | null;
  // Recent chat messages (last 7 days)
  recentChats: RecentChatsContext | null;
  isLoading: boolean;
  // Connection state - distinguishes "no data" from "can't connect"
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  refetchWalletBalances: () => void;
}

export function useAiAdvisorContext(): AiAdvisorContext {
  const { session } = useAuth();
  const { parameters, connectionState } = useSystemParameters();
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

  // Unconditional payments context
  const { unconditionalPayments, isLoading: unconditionalPaymentsLoading } = useAiAdvisorUnconditionalPayments();

  // Recent chats context (last 7 days)
  const { recentChatsContext, isLoading: recentChatsLoading } = useAiAdvisorRecentChats();

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

    // Unconditional payments context is now directly from the hook

    // Unpaid lashes context
    const unpaidLashesContext = unpaidCount > 0 ? {
      count: unpaidCount,
    } : null;

    // 100 Million Ideas - user projects context
    // Map all active projects with owner names for AI search
    // CRITICAL: Mark which projects belong to the current user based on event.pubkey ONLY
    const userPubkey = session?.nostrHexId || '';
    
    const allActiveProjectsSummary: AllProjectSummary[] = allProjects.map(p => ({
      id: p.id,
      title: p.title,
      shortDesc: p.shortDesc,
      ownerName: getProfileName(p.ownerPubkey),
      ownerPubkey: p.ownerPubkey,
      fiatGoal: p.fiatGoal,
      currency: p.currency,
      totalRaised: p.totalRaised,
      percentFunded: p.percentFunded,
      isFullyFunded: p.isFullyFunded,
      donationCount: p.donationCount,
      // STRICT: Mark as user's project ONLY if event.pubkey matches current user
      isMyProject: p.pubkey === userPubkey,
      coverImage: p.coverImage,
    }));

    const userProjectsContext: UserProjectsContext | null = (userProjects.length > 0 || allProjects.length > 0) ? {
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
        coverImage: p.coverImage,
      })),
      allActiveProjects: allActiveProjectsSummary,
      getProjectDonations,
      searchProjects,
    } : null;

    // Calculate recent activity (last 7 days) for "Kaj je novega pri meni?"
    const oneWeekAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
    
    const recentDonations: RecentDonation[] = [];
    let recentDonationsTotalFiat = 0;
    const recentDonationsCurrency = currency;
    
    userProjects.forEach(project => {
      project.donations.forEach(donation => {
        if (donation.timestampPaid >= oneWeekAgo) {
          recentDonations.push({
            projectTitle: project.title,
            supporterName: donation.supporterName || `${donation.supporterPubkey.slice(0, 8)}...`,
            amountFiat: donation.amountFiat,
            currency: donation.currency,
            date: new Date(donation.timestampPaid * 1000).toLocaleDateString('sl-SI'),
          });
          recentDonationsTotalFiat += donation.amountFiat;
        }
      });
    });

    const recentActivityContext: RecentActivityContext | null = recentDonations.length > 0 ? {
      recentDonationsReceived: recentDonations,
      recentDonationsCount: recentDonations.length,
      recentDonationsTotalFiat,
      recentDonationsCurrency,
    } : null;

    // Calculate new projects (last 7 days) for "Kaj je novega v Lana Svetu?"
    const newProjectsThisWeek = allProjects
      .filter(p => p.createdAt >= oneWeekAgo && !p.isBlocked && p.status !== 'draft')
      .map(p => ({
        id: p.id,
        title: p.title,
        shortDesc: p.shortDesc,
        ownerName: getProfileName(p.ownerPubkey),
        createdAt: new Date(p.createdAt * 1000).toLocaleDateString('sl-SI'),
        coverImage: p.coverImage,
      }));

    const newProjectsContext: NewProjectsContext | null = {
      newProjects: newProjectsThisWeek,
      newProjectsCount: newProjectsThisWeek.length,
    };

    const isLoading = walletsListLoading || balancesLoading || 
      dashboardData.lana8Wonder.isLoading || unconditionalPaymentsLoading || unpaidLashesLoading || projectsLoading || recentChatsLoading;

    // User profile context for personalization
    // Use session values as fallback when live profile fetch fails
    const userProfileContext: UserProfileContext | null = {
      name: profile?.name || session?.profileName || null,
      displayName: profile?.display_name || session?.profileDisplayName || null,
      currency: profile?.currency || session?.profileCurrency || 'EUR',
      language: profile?.language || profile?.lang || session?.profileLang || null,
    };

    return {
      userProfile: userProfileContext,
      wallets: walletsContext,
      lana8Wonder: lana8WonderContext,
      unconditionalPayments: unconditionalPayments, // Always send context, even if empty
      unpaidLashes: unpaidLashesContext,
      userProjects: userProjectsContext,
      recentActivity: recentActivityContext,
      newProjects: newProjectsContext,
      recentChats: recentChatsContext,
      isLoading,
      connectionState,
      refetchWalletBalances: fetchWalletBalances,
    };
  }, [nostrWallets, walletBalances, dashboardData, unconditionalPayments, unconditionalPaymentsLoading, unpaidCount, unpaidLashesLoading, walletsListLoading, balancesLoading, exchangeRate, currency, userProjects, allProjects, projectStats, projectsLoading, getProfileName, recentChatsContext, recentChatsLoading, connectionState]);

  return context;
}
