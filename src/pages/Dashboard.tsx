import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Wallet, ArrowRight, Sparkles, Grid, CheckCircle2, Calendar, CreditCard, Clock, Loader2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useNostrEvents } from "@/hooks/useNostrEvents";
import { useNostrDonationProposals } from "@/hooks/useNostrDonationProposals";
import { useNostrDonationPayments } from "@/hooks/useNostrDonationPayments";
import { useAuth } from "@/contexts/AuthContext";
import { EventCardMini } from "@/components/events/EventCardMini";
import { formatCurrency } from "@/lib/currencyConversion";

// Stage types for sequential loading
type DashboardStage = 'wallet' | 'account' | 'platform';

// Timeout per stage to prevent infinite loading
const STAGE_TIMEOUT_MS = 20000;

export default function Dashboard() {
  const { session } = useAuth();
  const { profile } = useNostrProfile();
  
  // Stage management for sequential loading
  const [stage, setStage] = useState<DashboardStage>('wallet');
  const [walletStageTimedOut, setWalletStageTimedOut] = useState(false);
  const [accountStageTimedOut, setAccountStageTimedOut] = useState(false);
  
  console.log('Dashboard render - stage:', stage);

  // SECTION 1: Wallet data - always enabled
  const { lana8Wonder, wallets } = useDashboardData({
    enableWallets: true,
    enableLana8Wonder: stage === 'account' || stage === 'platform'
  });

  // SECTION 2: Account data - enabled after wallet stage completes
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(
    session?.nostrHexId, 
    { 
      poll: false,
      enabled: stage === 'account' || stage === 'platform'
    }
  );
  
  const { payments, isLoading: paymentsLoading } = useNostrDonationPayments(
    session?.nostrHexId,
    {
      poll: false,
      enabled: stage === 'account' || stage === 'platform'
    }
  );

  // SECTION 3: Platform data - enabled after account stage completes
  const { events: onlineEvents, loading: onlineLoading } = useNostrEvents('online', {
    enabled: stage === 'platform'
  });
  
  const { events: liveEvents, loading: liveLoading } = useNostrEvents('live', {
    enabled: stage === 'platform'
  });

  // Calculate pending proposals
  const pendingProposals = useMemo(() => {
    return proposals.filter(proposal => {
      const isPaid = payments.some(p => 
        p.proposalDTag === proposal.d || p.proposalEventId === proposal.eventId
      );
      return !isPaid;
    });
  }, [proposals, payments]);

  // Stage 1 -> Stage 2 transition: when wallet loading is done
  useEffect(() => {
    if (stage !== 'wallet') return;

    const walletDone = !wallets.isLoading || walletStageTimedOut;
    
    if (walletDone) {
      console.log('Dashboard: Wallet stage complete, moving to account stage');
      // Small delay to ensure UI renders wallet data before starting account fetches
      setTimeout(() => setStage('account'), 100);
    }
  }, [stage, wallets.isLoading, walletStageTimedOut]);

  // Stage 2 -> Stage 3 transition: when account data loading is done
  useEffect(() => {
    if (stage !== 'account') return;

    const accountDone = !lana8Wonder.isLoading && !proposalsLoading && !paymentsLoading;
    
    if (accountDone || accountStageTimedOut) {
      console.log('Dashboard: Account stage complete, moving to platform stage');
      setTimeout(() => setStage('platform'), 100);
    }
  }, [stage, lana8Wonder.isLoading, proposalsLoading, paymentsLoading, accountStageTimedOut]);

  // Timeout handlers to prevent stuck stages
  useEffect(() => {
    if (stage === 'wallet' && wallets.isLoading) {
      const timer = setTimeout(() => {
        console.log('Dashboard: Wallet stage timed out');
        setWalletStageTimedOut(true);
      }, STAGE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
  }, [stage, wallets.isLoading]);

  useEffect(() => {
    if (stage === 'account') {
      const timer = setTimeout(() => {
        console.log('Dashboard: Account stage timed out');
        setAccountStageTimedOut(true);
      }, STAGE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
  }, [stage]);

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const eventsLoading = onlineLoading || liveLoading;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          👋 Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
        </h1>
        <p className="text-muted-foreground">Here's what's happening with your account</p>
      </div>

      {/* SECTION 1: Wallet Balance - Always visible */}
      <div className="mb-6">
        {wallets.isLoading ? (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-6 w-1/4" />
                  <Skeleton className="h-4 w-1/5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : wallets.walletCount > 0 ? (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg">Total Wallet Balance</h3>
                    <Badge variant="secondary" className="text-xs">
                      {wallets.walletCount} {wallets.walletCount === 1 ? 'wallet' : 'wallets'}
                    </Badge>
                  </div>
                  <div className="mb-3">
                    <p className="text-2xl font-bold text-green-600">
                      {formatNumber(wallets.totalBalanceFiat)} {wallets.currency}
                    </p>
                    <p className="text-muted-foreground">
                      ≈ {formatNumber(wallets.totalBalanceLana)} LANA
                    </p>
                  </div>
                  <Link to="/wallet">
                    <Button variant="outline" size="sm" className="gap-2">
                      View Wallets
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">No wallets registered yet.</p>
              <Link to="/wallet">
                <Button variant="outline" size="sm" className="mt-2 gap-2">
                  Register a Wallet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* SECTION 2: What's New on My Account */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">What's New on My Account</h2>
          {stage === 'wallet' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />
          )}
        </div>

        {stage === 'wallet' ? (
          // Show skeleton placeholders while waiting for wallet stage to complete
          <div className="space-y-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Lana8Wonder Cash Out Card */}
            {lana8Wonder.isLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : lana8Wonder.hasCashOut ? (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg">Lana8Wonder Cash Out Required</h3>
                        <Badge variant="destructive" className="text-xs">Action Needed</Badge>
                      </div>
                      <p className="text-muted-foreground mb-3">
                        You have <span className="font-semibold text-foreground">{formatNumber(lana8Wonder.totalCashOutAmount)} LANA</span>
                        {' '}(≈ {formatNumber(lana8Wonder.totalCashOutFiat)} {wallets.currency}) ready to cash out
                        {lana8Wonder.accountCount > 1 && ` across ${lana8Wonder.accountCount} accounts`}
                      </p>
                      <Link to="/lana8wonder">
                        <Button variant="destructive" size="sm" className="gap-2">
                          Go to Lana8Wonder
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-6 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No Lana8Wonder actions needed.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Unconditional Payments Card */}
            {proposalsLoading || paymentsLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : pendingProposals.length > 0 ? (
              <Card className="border-amber-500/50 bg-amber-500/5">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="h-6 w-6 text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg">Pending Payments</h3>
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                          {pendingProposals.length} pending
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        You have unconditional payment requests waiting
                      </p>
                    </div>
                    <Link to="/unconditional-payment">
                      <Button variant="outline" size="sm" className="gap-2 shrink-0">
                        View All
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                  
                  {/* Simple list of pending payments */}
                  <div className="space-y-2">
                    {pendingProposals.slice(0, 5).map((proposal) => (
                      <div 
                        key={proposal.eventId} 
                        className="flex items-center justify-between p-3 bg-background rounded-lg border"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                          <span className="font-medium truncate">{proposal.service || 'Payment'}</span>
                        </div>
                        <span className="text-sm font-medium text-amber-600 shrink-0">
                          {formatCurrency(parseFloat(proposal.fiatAmount), proposal.fiatCurrency)}
                        </span>
                      </div>
                    ))}
                    {pendingProposals.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        +{pendingProposals.length - 5} more pending payments
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>

      {/* SECTION 3: What's New Across Platform */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">What's New Across Platform</h2>
          {stage !== 'platform' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />
          )}
        </div>

        {stage !== 'platform' ? (
          // Show skeleton placeholders while waiting for earlier stages
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : eventsLoading ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (onlineEvents.length > 0 || liveEvents.length > 0) ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg">Upcoming Events</h3>
                    <Badge variant="secondary" className="text-xs">
                      {onlineEvents.length + liveEvents.length} events
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Don't miss these upcoming Lana community events
                  </p>
                </div>
                <Link to="/events">
                  <Button variant="outline" size="sm" className="gap-2 shrink-0">
                    View All
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
              
              {/* Events Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...onlineEvents, ...liveEvents]
                  .sort((a, b) => a.start.getTime() - b.start.getTime())
                  .slice(0, 6)
                  .map((event) => (
                    <EventCardMini key={event.id} event={event} />
                  ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <div className="flex flex-col items-center gap-2">
                <Calendar className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">No upcoming events at this time.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick Actions */}
      <div className="text-center">
        <Link to="/modules">
          <Button variant="outline" size="lg" className="gap-2">
            <Grid className="h-5 w-5" />
            Browse All Modules
          </Button>
        </Link>
      </div>
    </div>
  );
}
