import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool, Event } from 'nostr-tools';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, Sparkles, CheckCircle2, AlertCircle, ArrowRightLeft, Copy, X } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';

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
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const [isLoading, setIsLoading] = useState(true);
  const [annuityPlan, setAnnuityPlan] = useState<AnnuityPlan | null>(null);
  const [eligibleWallets, setEligibleWallets] = useState<string[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);
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
      toast.success('Transaction hash copied!');
    }
  };

  const relays = parameters?.relays || [];
  const exchangeRates = parameters?.exchangeRates;
  const currentPrice = exchangeRates?.EUR || 0;

  useEffect(() => {
    const fetchAnnuityPlan = async () => {
      if (!session?.nostrHexId || relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 88888 for user:', session.nostrHexId);
        
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
          // Get the latest event
          const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
          const plan = JSON.parse(latestEvent.content) as AnnuityPlan;
          setAnnuityPlan(plan);
          console.log('Annuity plan found:', plan);
        } else {
          setAnnuityPlan(null);
          console.log('No annuity plan found');
        }
      } catch (error) {
        console.error('Error fetching annuity plan:', error);
        setAnnuityPlan(null);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchAnnuityPlan();
  }, [session?.nostrHexId, relays]);

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
          data.wallets.forEach((w: any) => {
            balances[w.wallet_id] = w.balance;
          });
          setAccountBalances(balances);
        }
      } catch (error) {
        console.error('Error fetching wallet balances:', error);
      } finally {
        setLoadingBalances(false);
      }
    };

    fetchBalances();
  }, [annuityPlan, wallets, parameters?.electrumServers]);

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
        {showSuccessBanner && successData && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800 dark:text-green-200">Transfer Successful!</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300">
              <div className="space-y-2">
                <p>Successfully transferred <strong>{successData.amount.toFixed(4)} LANA</strong></p>
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
            <h1 className="text-2xl md:text-3xl font-bold">Lana8Wonder</h1>
            <p className="text-sm md:text-base text-muted-foreground">Your Annuity Plan</p>
          </div>
        </div>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">Plan Details</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              <div className="flex flex-col sm:flex-row sm:gap-2">
                <span>Coin: {annuityPlan.coin}</span>
                <span className="hidden sm:inline">|</span>
                <span>Currency: {annuityPlan.currency}</span>
                <span className="hidden sm:inline">|</span>
                <span>Policy: {annuityPlan.policy}</span>
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
                
                // Check if user needs to cash out (balance > remaining * 1.02)
                const needsCashOut = balance !== undefined && lastTriggeredLevel && balance > expectedRemaining * 1.02;
                const cashOutAmount = needsCashOut ? balance - expectedRemaining : 0;
                const cashOutFiat = cashOutAmount * currentPrice;
                
                return (
                  <AccordionItem key={account.account_id} value={`account-${account.account_id}`}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2 flex-wrap text-left">
                        <span className="font-semibold text-sm md:text-base">Account {account.account_id}</span>
                        <Badge variant="outline" className="text-xs truncate max-w-[140px] md:max-w-none">{account.wallet}</Badge>
                        <Badge variant="secondary" className="text-xs">{account.levels.length} levels</Badge>
                        {loadingBalances ? (
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading...
                          </Badge>
                        ) : balance !== undefined ? (
                          <Badge variant="default">{balance.toFixed(4)} LANA</Badge>
                        ) : null}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 md:space-y-4 mt-2">
                        {needsCashOut && (
                          <Alert variant="destructive" className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <div>
                                <AlertTitle className="text-sm md:text-base">Cash Out Required</AlertTitle>
                                <AlertDescription className="text-xs md:text-sm">
                                  You need to cash out <strong>{cashOutAmount.toFixed(4)} LANA</strong> (≈{cashOutFiat.toFixed(2)} {annuityPlan.currency}) from this account before the next split.
                                </AlertDescription>
                              </div>
                            </div>
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
                              Transfer
                            </Button>
                          </Alert>
                        )}
                        {account.levels.map(level => {
                          const isLevelTriggered = currentPrice >= level.trigger_price;
                          
                          // Določi status izplačila za ta nivo
                          // Nivo je izplačan če je triggered IN je balance <= remaining_lanas za ta nivo (z 2% toleranco)
                          const isLevelPaidOut = isLevelTriggered && 
                            balance !== undefined && 
                            balance <= level.remaining_lanas * 1.02;
                          
                          // Nivo čaka izplačilo če je triggered AMPAK balance > remaining_lanas
                          const isLevelPendingCashOut = isLevelTriggered && 
                            balance !== undefined && 
                            balance > level.remaining_lanas * 1.02;
                          
                          // Določi CSS razrede glede na status
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
                                  <span className="text-muted-foreground">Level:</span>
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold">{level.level_no}</p>
                                    {isLevelPaidOut && (
                                      <Badge variant="default" className="bg-green-500 text-white text-[10px] px-1.5 py-0">
                                        <CheckCircle2 className="h-3 w-3 mr-0.5" />
                                        Paid Out
                                      </Badge>
                                    )}
                                    {isLevelPendingCashOut && (
                                      <Badge variant="default" className="bg-orange-500 text-white text-[10px] px-1.5 py-0">
                                        <AlertCircle className="h-3 w-3 mr-0.5" />
                                        Pending
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Trigger Price:</span>
                                  <p className="font-semibold">{level.trigger_price.toFixed(4)} {annuityPlan.currency}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Coins to Give:</span>
                                  <p className="font-semibold">{level.coins_to_give.toFixed(4)}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Cash Out:</span>
                                  <p className="font-semibold">{level.cash_out.toFixed(2)} {annuityPlan.currency}</p>
                                </div>
                                <div className="col-span-2 md:col-span-4">
                                  <span className="text-muted-foreground">Remaining LANAs:</span>
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
          <h1 className="text-2xl md:text-3xl font-bold">Lana8Wonder</h1>
          <p className="text-sm md:text-base text-muted-foreground">Check Your Eligibility</p>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl">Your Wallets</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Wallets with ≥100 EUR/GBP/USD equivalent are eligible for Lana8Wonder enrollment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 md:space-y-4 p-4 md:p-6">
          {wallets.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No wallets found</p>
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
                                Eligible for Lana8Wonder
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
                            Enroll Now
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
                <h3 className="font-semibold text-base md:text-lg">You're Eligible!</h3>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  {eligibleWallets.length} {eligibleWallets.length === 1 ? 'wallet has' : 'wallets have'} sufficient balance for Lana8Wonder enrollment.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Lana8Wonder;
