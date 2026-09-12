import { useEffect, useState, Component, ReactNode, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool } from 'nostr-tools';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, Sparkles, CheckCircle2, AlertCircle, ArrowRightLeft, Copy, X, Snowflake, Clock, RefreshCw } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n/I18nContext';
import EntrySplitCard from '@/components/lana8wonder/EntrySplitCard';
import { readFromRelays } from '@/lib/relayRead';
import { evaluateCashOut } from '@/lib/cashOutDue';
import { useRecentSends } from '@/hooks/useRecentSends';
import { choosePlanEvent } from '@/lib/planRead';
import {
  lana8wonderTransferGate,
  mayTransfer,
  transferGateExplanation,
  transferGateResolution,
} from '@/lib/lana8wonderTransferGate';

// Error boundary to catch render crashes and show error instead of white screen
class Lana8WonderErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('🔴 Lana8Wonder crash:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto p-4 pb-24 space-y-4">
          <div className="p-6 border border-destructive rounded-lg bg-destructive/10">
            <h2 className="text-lg font-bold text-destructive mb-2">Something went wrong</h2>
            <p className="text-sm text-muted-foreground mb-4">
              An error occurred loading Lana8Wonder. Please try refreshing the page.
            </p>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-32 mb-4">
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import lana8wonderTranslations from '@/i18n/modules/lana8wonder';

interface TransferSuccessState {
  transferSuccess?: boolean;
  txHash?: string;
  amount?: number;
}

interface AnnuityLevel {
  row_id: string;
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

const Lana8Wonder = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  // `resolved` says whether the registrar's list was actually read. Without it
  // an outage — which hands back an empty list — reads as "nothing is frozen".
  const { wallets, isLoading: walletsLoading, resolved: walletsResolved } = useNostrWallets();
  const { t } = useTranslation(lana8wonderTranslations);
  const [isLoading, setIsLoading] = useState(true);
  const [annuityPlan, setAnnuityPlan] = useState<AnnuityPlan | null>(null);
  const [eligibleWallets, setEligibleWallets] = useState<string[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  // The mempool half of each balance. Negative means money is leaving this
  // wallet right now — the chain's own answer to "has the cash-out been sent".
  const [accountUnconfirmed, setAccountUnconfirmed] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);
  // Bumped to ask the chain again — on returning to the tab, and while a
  // transfer is still on its way.
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [successData, setSuccessData] = useState<{ txHash: string; amount: number } | null>(null);

  // Handle transfer success state
  useEffect(() => {
    const state = location.state as TransferSuccessState | undefined;
    if (state?.transferSuccess && state?.txHash) {
      setShowSuccessBanner(true);
      setSuccessData({ txHash: state.txHash, amount: state.amount || 0 });
      // Clear the state so it doesn't show again on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const copyTxHash = () => {
    if (successData?.txHash) {
      navigator.clipboard.writeText(successData.txHash);
      toast.success(t('plan.txCopied'));
    }
  };

  // What these wallets have already sent, as the server recorded it when it
  // broadcast each transaction. Server-side on purpose: a transfer made on a
  // phone has to be known to a laptop opened straight afterwards.
  const planWalletIds = useMemo(
    () => (annuityPlan?.accounts || []).map(a => a.wallet),
    [annuityPlan]
  );
  const { sends: recentSends, refresh: refreshRecentSends } = useRecentSends(planWalletIds);

  const relays = parameters?.relays || [];
  const exchangeRates = parameters?.exchangeRates;
  const currentPrice = exchangeRates?.EUR || 0;
  // A new KIND 38888 is parsed into a NEW object on every system-parameters
  // refresh, so `parameters.relays` changes identity while naming the very same
  // relays. Depending on the array itself re-ran this whole read every time the
  // authority republished 38888 — including the republish that corrected the
  // SPLIT prices, which is the one moment a holder is looking at this page.
  // The relay LIST is what this read depends on, so that is what it watches.
  const relayKey = relays.join(',');

  useEffect(() => {
    const relayList = relayKey ? relayKey.split(',') : [];
    const cancelled = { value: false };

    const fetchAnnuityPlan = async () => {
      if (!session?.nostrHexId || relayList.length === 0) {
        setIsLoading(false);
        return;
      }

      const pool = new SimplePool();

      try {
        console.log('Fetching KIND 88888 for user:', session.nostrHexId);

        // readFromRelays, not pool.querySync: querySync counts a relay that
        // never connected as one that answered with nothing, so an outage and
        // "this holder has no plan" arrive as the same empty array. Telling
        // those apart is the whole point here — see choosePlanEvent.
        const read = await readFromRelays(
          pool,
          relayList,
          { kinds: [88888], '#p': [session.nostrHexId] },
          { budgetMs: 10000, cancelled },
        );
        if (cancelled.value) return;

        const outcome = choosePlanEvent(read);

        if (outcome.status === 'unreachable') {
          // Not one relay spoke. That says nothing about this holder, so we say
          // nothing either: whatever plan is already on screen stays on screen.
          console.warn(
            `📡 No relay answered for KIND 88888 (${read.failed.map(f => `${f.url}: ${f.reason}`).join(' | ')}) — keeping the plan already loaded`
          );
        } else if (outcome.status === 'none') {
          setAnnuityPlan(null);
          console.log('No annuity plan found');
        } else {
          const plan = JSON.parse(outcome.event.content) as AnnuityPlan;
          // Defensive: ensure accounts is a valid array with levels
          if (!plan || !Array.isArray(plan.accounts)) {
            console.error('🔴 Invalid annuity plan structure:', plan);
            setAnnuityPlan(null);
          } else {
            // Ensure all accounts have levels array
            plan.accounts = plan.accounts.map(acc => ({
              ...acc,
              levels: Array.isArray(acc.levels) ? acc.levels : []
            }));
            setAnnuityPlan(plan);
            console.log('Annuity plan found:', plan);
          }
        }
      } catch (error) {
        // A parse failure is about THIS event, not about the network, so it may
        // still clear the plan. readFromRelays itself never rejects.
        console.error('Error fetching annuity plan:', error);
        if (!cancelled.value) setAnnuityPlan(null);
      } finally {
        if (!cancelled.value) setIsLoading(false);
        try { pool.close(relayList); } catch { /* sockets already gone */ }
      }
    };

    fetchAnnuityPlan();
    return () => { cancelled.value = true; };
  }, [session?.nostrHexId, relayKey]);

  // Fetch wallet balances (for annuity plan accounts OR user wallets)
  useEffect(() => {
    const fetchBalances = async () => {
      if (!parameters?.electrumServers) return;

      // Determine which wallet addresses to fetch
      let walletAddresses: string[] = [];

      if (annuityPlan) {
        // Fetch balances for annuity plan accounts
        walletAddresses = annuityPlan.accounts.map(acc => acc.wallet);
      } else if (wallets && wallets.length > 0) {
        // Fetch balances for user's wallets when no annuity plan exists
        walletAddresses = wallets.map(w => w.walletId);
      }

      if (walletAddresses.length === 0) return;

      setLoadingBalances(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
          body: {
            wallet_addresses: walletAddresses,
            electrum_servers: parameters.electrumServers,
          },
        });

        if (error) throw error;

        if (data?.wallets) {
          const balances: Record<string, number> = {};
          const unconfirmed: Record<string, number> = {};
          data.wallets.forEach((w: any) => {
            balances[w.wallet_id] = w.balance;
            unconfirmed[w.wallet_id] = Number(w.unconfirmed_balance) || 0;
          });
          setAccountBalances(balances);
          setAccountUnconfirmed(unconfirmed);
        }
      } catch (error) {
        console.error('Error fetching wallet balances:', error);
      } finally {
        setLoadingBalances(false);
      }
    };

    fetchBalances();
  }, [annuityPlan, wallets, parameters?.electrumServers, balanceRefresh]);

  // The balance used to be read once and then left on screen for as long as
  // the page stayed open. Coming back from a transfer, that single read often
  // happened before the Electrum server had the transaction — the alert
  // re-armed, and people pressed it again. Asking once more when the tab is
  // looked at costs one request and closes most of that window.
  useEffect(() => {
    const askAgain = () => {
      if (document.visibilityState === 'visible') setBalanceRefresh(n => n + 1);
    };
    window.addEventListener('focus', askAgain);
    document.addEventListener('visibilitychange', askAgain);
    return () => {
      window.removeEventListener('focus', askAgain);
      document.removeEventListener('visibilitychange', askAgain);
    };
  }, []);

  // Check wallet eligibility (≥100 EUR/GBP/USD equivalent)
  useEffect(() => {
    if (!wallets || !exchangeRates || annuityPlan) return;

    const eligible: string[] = [];
    const threshold = 100;

    wallets.forEach(wallet => {
      // Use balance from Electrum server if available, otherwise fallback to amountUnregistered
      const balance = accountBalances[wallet.walletId] !== undefined
        ? accountBalances[wallet.walletId]
        : parseFloat(wallet.amountUnregistered || '0') / 100000000;

      // Check EUR value
      if (exchangeRates.EUR && balance * exchangeRates.EUR >= threshold) {
        eligible.push(wallet.walletId);
        return;
      }

      // Check GBP value
      if (exchangeRates.GBP && balance * exchangeRates.GBP >= threshold) {
        eligible.push(wallet.walletId);
        return;
      }

      // Check USD value
      if (exchangeRates.USD && balance * exchangeRates.USD >= threshold) {
        eligible.push(wallet.walletId);
      }
    });

    setEligibleWallets(eligible);
  }, [wallets, exchangeRates, annuityPlan, accountBalances]);

  // May this account move its money? Asked per wallet and answered in three
  // values, because two were not enough: `frozenAddresses` used to be a Set
  // built from whatever the wallet list happened to contain, and a relay
  // outage hands back an empty list that is indistinguishable from "nothing is
  // frozen". That put the green Transfer button on a wallet the registrar had
  // frozen. See src/lib/lana8wonderTransferGate — `clear` now has to be earned.
  const gateFor = (address: string) => lana8wonderTransferGate(wallets, walletsResolved, address);

  const frozenWallets = (wallets || []).filter(w => w.freezeStatus || w.status === 'frozen');
  const frozenAlert = frozenWallets.length > 0 ? (() => {
    // Reason-aware, like the /wallet page: the registrar's max-cap page asks
    // for the entire balance, so a freeze it cannot lift must not be sent there.
    const first = frozenWallets[0];
    const res = transferGateResolution(gateFor(first.walletId), first.walletId);
    return (
      <Alert variant="destructive" className="border-blue-500/50 bg-blue-500/10">
        <Snowflake className="h-4 w-4 text-blue-500" />
        <AlertTitle className="text-blue-700 dark:text-blue-400">{t('plan.frozen.title')}</AlertTitle>
        <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
          <span className="block mb-2">{t('plan.frozen.description')}</span>
          <Button
            variant="outline"
            size="sm"
            className="border-blue-500/50 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
            onClick={() => {
              if (res.external) window.open(res.href, '_blank', 'noopener,noreferrer');
              else navigate(res.href);
            }}
          >
            {res.label}
            {res.external && <ExternalLink className="h-4 w-4 ml-2" />}
          </Button>
        </AlertDescription>
      </Alert>
    );
  })() : null;

  if (isLoading || walletsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user has annuity plan, display it
  if (annuityPlan) {
    return (
      <div className="container mx-auto p-3 md:p-4 pb-24 space-y-4 md:space-y-6">
        {frozenAlert}
        {showSuccessBanner && successData && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800 dark:text-green-200">{t('plan.transferSuccess')}</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300">
              <div className="space-y-2">
                <p>{t('plan.transferredAmount', { amount: successData.amount.toFixed(4) })}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs">TX:</span>
                  <code className="font-mono text-xs bg-green-100 dark:bg-green-900 px-2 py-1 rounded break-all">
                    {successData.txHash}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={copyTxHash}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    asChild
                  >
                    <a
                      href={`https://chainz.cryptoid.info/lana/tx.dws?${successData.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
            </AlertDescription>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-6 w-6 p-0"
              onClick={() => setShowSuccessBanner(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </Alert>
        )}

        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <Sparkles className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t('plan.title')}</h1>
            <p className="text-sm md:text-base text-muted-foreground">{t('plan.subtitle')}</p>
          </div>
        </div>

        {/* When the holder entered the SPLIT and on what terms — matched by
            price, because a plan's KIND 88888 event is re-published on change
            and its created_at is not the enrolment date. */}
        <EntrySplitCard
          plan={annuityPlan}
          splitPrices={parameters?.splitPrices ?? null}
          splitHistory={parameters?.splitHistory ?? null}
          currentSplit={Number.isFinite(parseInt(parameters?.split ?? '', 10)) ? parseInt(parameters!.split, 10) : null}
          fxRate={exchangeRates?.[annuityPlan.currency?.toUpperCase() as keyof typeof exchangeRates] ?? null}
        />

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">{t('plan.planDetails')}</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              <div className="flex flex-col sm:flex-row sm:gap-2">
                <span>{t('plan.coin')}: {annuityPlan.coin}</span>
                <span className="hidden sm:inline">|</span>
                <span>{t('plan.currency')}: {annuityPlan.currency}</span>
                <span className="hidden sm:inline">|</span>
                <span>{t('plan.policy')}: {annuityPlan.policy}</span>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {annuityPlan.accounts.map(account => {
                const balance = accountBalances[account.wallet];

                // Find the last triggered level (highest level_no where price >= trigger)
                const triggeredLevels = account.levels
                  .filter(l => currentPrice >= l.trigger_price)
                  .sort((a, b) => b.level_no - a.level_no);

                const lastTriggeredLevel = triggeredLevels[0];
                const expectedRemaining = lastTriggeredLevel?.remaining_lanas || 0;

                // What is owed AFTER subtracting whatever is already on its
                // way — the chain's own unconfirmed figure, or, until the
                // mempool has it, what the server wrote down when it
                // broadcast. See src/lib/cashOutDue.ts.
                const verdict = evaluateCashOut({
                  balance,
                  unconfirmedBalance: accountUnconfirmed[account.wallet],
                  expectedRemaining,
                  inFlight: recentSends[account.wallet] || null,
                  now: Date.now(),
                });
                const needsCashOut = !!lastTriggeredLevel && verdict.state === 'due';
                const cashOutOnItsWay = !!lastTriggeredLevel && verdict.state === 'in_flight';
                const cashOutAmount = needsCashOut ? verdict.amountDue : 0;
                const cashOutFiat = cashOutAmount * currentPrice;

                return (
                  <AccordionItem key={account.account_id} value={`account-${account.account_id}`}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2 flex-wrap text-left">
                        <span className="font-semibold text-sm md:text-base">{t('plan.account', { id: account.account_id })}</span>
                        <Badge variant="outline" className="text-xs truncate max-w-[140px] md:max-w-none">{account.wallet}</Badge>
                        <Badge variant="secondary" className="text-xs">{t('plan.levels', { count: account.levels.length })}</Badge>
                        {loadingBalances ? (
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('plan.loading')}
                          </Badge>
                        ) : balance !== undefined ? (
                          <Badge variant="default">{balance.toFixed(4)} LANA</Badge>
                        ) : null}
                        {needsCashOut && !loadingBalances && (
                          <Badge
                            variant="destructive"
                            className="flex items-center gap-1 text-xs"
                          >
                            <AlertCircle className="h-3 w-3" />
                            <span className="hidden sm:inline">{t('plan.cashOutBadge')}</span>
                            {cashOutAmount.toFixed(2)} LANA
                          </Badge>
                        )}
                        {cashOutOnItsWay && !loadingBalances && (
                          <Badge
                            variant="outline"
                            className="flex items-center gap-1 text-xs border-amber-500/50 text-amber-700 dark:text-amber-300"
                          >
                            <Clock className="h-3 w-3" />
                            {t('plan.cashOutSentBadge')}
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 md:space-y-4 mt-2">
                        {/* Sent, and the chain has not finished with it yet.
                            Shown INSTEAD of the red alert — the alert staying
                            up is what got people to press a second time — and
                            saying so plainly, rather than going quiet, so
                            nobody wonders whether their transfer happened. */}
                        {cashOutOnItsWay && (
                          <Alert className="border-amber-500/40 bg-amber-500/10 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <Clock className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                              <div>
                                <AlertTitle className="text-sm md:text-base">{t('plan.cashOutSentTitle')}</AlertTitle>
                                <AlertDescription className="text-xs md:text-sm">
                                  {t('plan.cashOutSentDescription')}{' '}
                                  {verdict.inFlight?.txid && (
                                    <a
                                      href={`https://explorer.lanacoin.com/tx/${verdict.inFlight.txid}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-1 underline break-all"
                                    >
                                      {verdict.inFlight.txid.slice(0, 12)}…
                                    </a>
                                  )}
                                </AlertDescription>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap self-end md:self-auto"
                              onClick={() => {
                                setBalanceRefresh(n => n + 1);
                                refreshRecentSends();
                              }}
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              {t('plan.cashOutSentCheck')}
                            </Button>
                          </Alert>
                        )}

                        {needsCashOut && (
                          <Alert variant="destructive" className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <div>
                                <AlertTitle className="text-sm md:text-base">{t('plan.cashOutRequired')}</AlertTitle>
                                <AlertDescription className="text-xs md:text-sm">
                                  {t('plan.cashOutDescription', {
                                    amount: cashOutAmount.toFixed(4),
                                    fiat: cashOutFiat.toFixed(2),
                                    currency: annuityPlan.currency,
                                  })}
                                </AlertDescription>
                              </div>
                            </div>
                            {(() => {
                              // Only a positively clear reading offers a
                              // transfer. Frozen and unreadable both land on a
                              // link to wherever THIS freeze can be lifted,
                              // rather than a dead button or, as before, a live
                              // one.
                              const gate = gateFor(account.wallet);
                              if (mayTransfer(gate)) {
                                return (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="whitespace-nowrap bg-green-600 hover:bg-green-700 text-white self-end md:self-auto"
                                    onClick={() => navigate('/lana8wonder/transfer', {
                                      state: {
                                        sourceWalletId: account.wallet,
                                        cashOutAmount: cashOutAmount,
                                        cashOutFiat: cashOutFiat,
                                        currency: annuityPlan.currency,
                                        accountId: account.account_id,
                                      }
                                    })}
                                  >
                                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                                    {t('plan.transfer')}
                                  </Button>
                                );
                              }
                              const res = transferGateResolution(gate, account.wallet);
                              return (
                                <div className="flex flex-col gap-1.5 self-end md:self-auto md:items-end">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="whitespace-nowrap border-blue-500/50 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
                                    onClick={() => {
                                      if (res.external) window.open(res.href, '_blank', 'noopener,noreferrer');
                                      else navigate(res.href);
                                    }}
                                  >
                                    <Snowflake className="h-4 w-4 mr-2" />
                                    {res.label}
                                    {res.external && <ExternalLink className="h-3 w-3 ml-2 opacity-70" />}
                                  </Button>
                                  <p className="text-xs opacity-80 max-w-xs md:text-right">
                                    {transferGateExplanation(gate)}
                                  </p>
                                </div>
                              );
                            })()}
                          </Alert>
                        )}
                        {account.levels.map(level => {
                          const isLevelTriggered = currentPrice >= level.trigger_price;

                          const isLevelPaidOut = isLevelTriggered &&
                            balance !== undefined &&
                            balance <= level.remaining_lanas * 1.02;

                          const isLevelPendingCashOut = isLevelTriggered &&
                            balance !== undefined &&
                            balance > level.remaining_lanas * 1.02;

                          let cardClassName = 'p-3 md:p-4';
                          if (isLevelPaidOut) {
                            cardClassName += ' border-green-500 bg-green-50 dark:bg-green-950';
                          } else if (isLevelPendingCashOut) {
                            cardClassName += ' border-orange-500 bg-orange-50 dark:bg-orange-950';
                          }

                          return (
                            <Card
                              key={level.row_id}
                              className={cardClassName}
                            >
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 text-xs md:text-sm">
                                <div>
                                  <span className="text-muted-foreground">{t('plan.level')}</span>
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold">{level.level_no}</p>
                                    {isLevelPaidOut && (
                                      <Badge variant="default" className="bg-green-500 text-white text-[10px] px-1.5 py-0">
                                        <CheckCircle2 className="h-3 w-3 mr-0.5" />
                                        {t('plan.paidOut')}
                                      </Badge>
                                    )}
                                    {isLevelPendingCashOut && (
                                      <Badge variant="default" className="bg-orange-500 text-white text-[10px] px-1.5 py-0">
                                        <AlertCircle className="h-3 w-3 mr-0.5" />
                                        {t('plan.pending')}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{t('plan.triggerPrice')}</span>
                                  <p className="font-semibold">{level.trigger_price.toFixed(4)} {annuityPlan.currency}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{t('plan.coinsToGive')}</span>
                                  <p className="font-semibold">{level.coins_to_give.toFixed(4)}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{t('plan.cashOut')}</span>
                                  {/* Cash Out value uses the LIVE price (coins_to_give × current price),
                                      and is shown ONLY for levels that are triggered but not yet paid out.
                                      - Future (not-yet-triggered) levels: no number (price not reached).
                                      - Already paid-out levels: no number (actual payout price unknown). */}
                                  <p className="font-semibold">
                                    {isLevelTriggered && !isLevelPaidOut && currentPrice
                                      ? `${(level.coins_to_give * currentPrice).toFixed(2)} ${annuityPlan.currency}`
                                      : '—'}
                                  </p>
                                </div>
                                <div className="col-span-2 md:col-span-4">
                                  <span className="text-muted-foreground">{t('plan.remainingLanas')}</span>
                                  <p className="font-semibold">{level.remaining_lanas.toFixed(4)}</p>
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If no annuity plan, show eligibility check
  return (
    <div className="container mx-auto p-3 md:p-4 pb-24 space-y-4 md:space-y-6">
      <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
        <Sparkles className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{t('plan.title')}</h1>
          <p className="text-sm md:text-base text-muted-foreground">{t('plan.checkEligibility')}</p>
        </div>
      </div>

      {frozenAlert}

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl">{t('plan.yourWallets')}</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            {t('plan.walletsEligibility')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 md:space-y-4 p-4 md:p-6">
          {wallets.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('plan.noWallets')}</p>
          ) : (
            wallets.map(wallet => {
              // Use balance from Electrum server if available, otherwise fallback to amountUnregistered
              const balance = accountBalances[wallet.walletId] !== undefined
                ? accountBalances[wallet.walletId]
                : parseFloat(wallet.amountUnregistered || '0') / 100000000;
              const isEligible = eligibleWallets.includes(wallet.walletId);

              let fiatValue = 0;
              let currency = 'EUR';

              if (exchangeRates) {
                if (exchangeRates.EUR) {
                  fiatValue = balance * exchangeRates.EUR;
                  currency = 'EUR';
                } else if (exchangeRates.GBP) {
                  fiatValue = balance * exchangeRates.GBP;
                  currency = 'GBP';
                } else if (exchangeRates.USD) {
                  fiatValue = balance * exchangeRates.USD;
                  currency = 'USD';
                }
              }

              return (
                <Card key={wallet.walletId} className={isEligible ? 'border-green-500 bg-green-50 dark:bg-green-950' : ''}>
                  <CardContent className="p-4 md:pt-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono text-xs md:text-sm break-all">{wallet.walletId}</p>
                          {isEligible && (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                                {t('plan.eligible')}
                              </Badge>
                            </>
                          )}
                        </div>
                        <p className="text-xs md:text-sm text-muted-foreground">{wallet.walletType}</p>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">{balance.toFixed(8)} LANA</Badge>
                          <Badge variant="outline" className="text-xs">≈{fiatValue.toFixed(2)} {currency}</Badge>
                        </div>
                        {wallet.note && (
                          <p className="text-sm text-muted-foreground mt-2">{wallet.note}</p>
                        )}
                      </div>
                      {isEligible && (
                        <Button variant="default" size="sm" asChild className="w-full sm:w-auto">
                          <a
                            href="https://www.lana8wonder.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2"
                          >
                            {t('plan.enrollNow')}
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      {eligibleWallets.length > 0 && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950">
          <CardContent className="p-4 md:pt-6">
            <div className="flex items-start gap-2 md:gap-3">
              <CheckCircle2 className="h-5 w-5 md:h-6 md:w-6 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-base md:text-lg">{t('plan.youreEligible')}</h3>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  {eligibleWallets.length === 1
                    ? t('plan.walletHas', { count: eligibleWallets.length })
                    : t('plan.walletsHave', { count: eligibleWallets.length })
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default function Lana8WonderWithErrorBoundary() {
  return (
    <Lana8WonderErrorBoundary>
      <Lana8Wonder />
    </Lana8WonderErrorBoundary>
  );
}
