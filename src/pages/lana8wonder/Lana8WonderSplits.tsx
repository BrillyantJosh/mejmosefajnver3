import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool, Event } from 'nostr-tools';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, AlertCircle, Euro, Coins } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

interface SplitForecast {
  splitNumber: number;
  price: number;
  // Per-account data
  accountForecasts: AccountForecast[];
  totalCashOut: number;
}

interface AccountForecast {
  accountId: number;
  wallet: string;
  triggeredLevels: AnnuityLevel[];
  newlyTriggered: AnnuityLevel[];
  cashOutThisSplit: number;
  cumulativeCashOut: number;
  remainingLanas: number;
}

const Lana8WonderSplits = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [isLoading, setIsLoading] = useState(true);
  const [annuityPlan, setAnnuityPlan] = useState<AnnuityPlan | null>(null);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const relays = parameters?.relays || [];
  const exchangeRates = parameters?.exchangeRates;
  const currentPrice = exchangeRates?.EUR || 0;
  const currentSplit = parameters?.split ? parseInt(parameters.split) : 0;

  // Fetch annuity plan (KIND 88888)
  useEffect(() => {
    const fetchAnnuityPlan = async () => {
      if (!session?.nostrHexId || relays.length === 0) {
        setIsLoading(false);
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
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchAnnuityPlan();
  }, [session?.nostrHexId, relays]);

  // Fetch balances
  useEffect(() => {
    const fetchBalances = async () => {
      if (!parameters?.electrumServers || !annuityPlan) return;
      const walletAddresses = annuityPlan.accounts.map(acc => acc.wallet);
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
  }, [annuityPlan, parameters?.electrumServers]);

  // Generate 15-split forecast
  const generateForecast = (): SplitForecast[] => {
    if (!annuityPlan || currentPrice <= 0) return [];

    const forecasts: SplitForecast[] = [];
    // Track cumulative cash-out per account
    const cumulativeCashOuts: Record<number, number> = {};
    annuityPlan.accounts.forEach(acc => {
      cumulativeCashOuts[acc.account_id] = 0;
    });

    // Track which levels were already triggered at previous price
    let previousPrice = 0;

    for (let i = 0; i <= 15; i++) {
      // Split 0 = current, splits 1-15 = future
      // Each split doubles the price
      const price = i === 0 ? currentPrice : currentPrice * Math.pow(2, i);

      const accountForecasts: AccountForecast[] = annuityPlan.accounts.map(account => {
        const balance = accountBalances[account.wallet] || 0;

        // All levels triggered at this price
        const triggeredLevels = account.levels
          .filter(l => price >= l.trigger_price)
          .sort((a, b) => a.level_no - b.level_no);

        // Newly triggered at this split (not triggered at previous price)
        const newlyTriggered = account.levels
          .filter(l => price >= l.trigger_price && previousPrice < l.trigger_price)
          .sort((a, b) => a.level_no - b.level_no);

        // Cash out for newly triggered levels
        const cashOutThisSplit = newlyTriggered.reduce((sum, l) => sum + l.cash_out, 0);
        cumulativeCashOuts[account.account_id] += cashOutThisSplit;

        // Remaining LANAs after highest triggered level
        const highestTriggered = triggeredLevels[triggeredLevels.length - 1];
        const remainingLanas = highestTriggered
          ? highestTriggered.remaining_lanas
          : (i === 0 ? balance : account.levels[0]?.remaining_lanas || 0);

        return {
          accountId: account.account_id,
          wallet: account.wallet,
          triggeredLevels,
          newlyTriggered,
          cashOutThisSplit,
          cumulativeCashOut: cumulativeCashOuts[account.account_id],
          remainingLanas,
        };
      });

      const totalCashOut = accountForecasts.reduce((sum, af) => sum + af.cashOutThisSplit, 0);

      forecasts.push({
        splitNumber: currentSplit + i,
        price,
        accountForecasts,
        totalCashOut,
      });

      previousPrice = price;
    }

    return forecasts;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No annuity plan
  if (!annuityPlan) {
    return (
      <div className="container mx-auto p-3 md:p-4 space-y-4">
        <div className="flex items-center gap-2 md:gap-3 mb-4">
          <TrendingUp className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Split Prognoza</h1>
            <p className="text-sm md:text-base text-muted-foreground">Napoved za naslednjih 15 splitov</p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Nimate anuitetnega načrta. Za prikaz prognoze izplačil potrebujete aktiven anuitetni načrt na{' '}
            <a
              href="https://www.lana8wonder.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline"
            >
              lana8wonder.com
            </a>.
          </AlertDescription>
        </Alert>

        {/* Still show price forecast without annuity */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Prognoza cene LANA
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Trenutna cena: <strong>{currentPrice.toFixed(6)} EUR</strong> • Split: <strong>{currentSplit}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="space-y-2">
              {Array.from({ length: 16 }, (_, i) => {
                const price = i === 0 ? currentPrice : currentPrice * Math.pow(2, i);
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      i === 0
                        ? 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700'
                        : 'bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={i === 0 ? 'default' : 'secondary'} className="text-xs min-w-[70px] justify-center">
                        Split {currentSplit + i}
                      </Badge>
                      {i === 0 && (
                        <Badge variant="outline" className="text-xs bg-orange-100 dark:bg-orange-900 border-orange-300">
                          Trenutni
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono font-semibold text-sm">
                      {price < 1 ? price.toFixed(6) : price < 100 ? price.toFixed(4) : price.toFixed(2)} EUR
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Has annuity plan — full forecast
  const forecasts = generateForecast();
  const totalAllSplitsCashOut = forecasts.reduce((sum, f) => sum + f.totalCashOut, 0);

  return (
    <div className="container mx-auto p-3 md:p-4 space-y-4">
      <div className="flex items-center gap-2 md:gap-3 mb-4">
        <TrendingUp className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Split Prognoza</h1>
          <p className="text-sm md:text-base text-muted-foreground">Napoved za naslednjih 15 splitov</p>
        </div>
      </div>

      {/* Summary card */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Trenutna cena</p>
              <p className="font-bold text-lg">{currentPrice.toFixed(6)} <span className="text-sm font-normal">EUR</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Trenutni split</p>
              <p className="font-bold text-lg">{currentSplit}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cena po 15 splitih</p>
              <p className="font-bold text-lg">
                {(currentPrice * Math.pow(2, 15)).toFixed(2)} <span className="text-sm font-normal">EUR</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Skupno izplačilo</p>
              <p className="font-bold text-lg text-green-600">
                {totalAllSplitsCashOut.toFixed(2)} <span className="text-sm font-normal">{annuityPlan.currency}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-account summary */}
      {annuityPlan.accounts.map(account => {
        const balance = accountBalances[account.wallet];
        const accountTotalCashOut = forecasts.reduce((sum, f) => {
          const af = f.accountForecasts.find(a => a.accountId === account.account_id);
          return sum + (af?.cashOutThisSplit || 0);
        }, 0);

        return (
          <Card key={account.account_id}>
            <CardHeader className="p-4 md:p-6 pb-2 md:pb-3">
              <CardTitle className="text-base md:text-lg flex items-center gap-2 flex-wrap">
                <Coins className="h-4 w-4" />
                Account {account.account_id}
                <Badge variant="outline" className="font-mono text-xs truncate max-w-[140px] md:max-w-none">
                  {account.wallet}
                </Badge>
                {loadingBalances ? (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </Badge>
                ) : balance !== undefined ? (
                  <Badge variant="default">{balance.toFixed(4)} LANA</Badge>
                ) : null}
              </CardTitle>
              <CardDescription className="text-xs">
                Skupno izplačilo skozi 15 splitov:{' '}
                <strong className="text-green-600">{accountTotalCashOut.toFixed(2)} {annuityPlan.currency}</strong>
                {' • '}{account.levels.length} nivojev
              </CardDescription>
            </CardHeader>
          </Card>
        );
      })}

      {/* Split-by-split forecast */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Euro className="h-5 w-5" />
            Prognoza po splitih
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Vsak split podvoji ceno LANA • Izplačila po anuitetnem načrtu
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 space-y-2">
          {forecasts.map((forecast, i) => {
            const hasNewTriggers = forecast.accountForecasts.some(af => af.newlyTriggered.length > 0);
            const isCurrent = i === 0;

            return (
              <div
                key={forecast.splitNumber}
                className={`rounded-lg border p-3 md:p-4 ${
                  isCurrent
                    ? 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700'
                    : hasNewTriggers
                      ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700'
                      : 'bg-muted/30'
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={isCurrent ? 'default' : hasNewTriggers ? 'default' : 'secondary'}
                      className={`text-xs min-w-[70px] justify-center ${
                        hasNewTriggers && !isCurrent ? 'bg-green-600 hover:bg-green-700' : ''
                      }`}
                    >
                      Split {forecast.splitNumber}
                    </Badge>
                    {isCurrent && (
                      <Badge variant="outline" className="text-xs bg-orange-100 dark:bg-orange-900 border-orange-300">
                        Trenutni
                      </Badge>
                    )}
                  </div>
                  <span className="font-mono font-semibold text-sm">
                    {forecast.price < 1
                      ? forecast.price.toFixed(6)
                      : forecast.price < 100
                        ? forecast.price.toFixed(4)
                        : forecast.price.toFixed(2)}{' '}
                    EUR
                  </span>
                </div>

                {/* Cash out info */}
                {forecast.totalCashOut > 0 && (
                  <div className="mt-2 space-y-1">
                    {forecast.accountForecasts
                      .filter(af => af.newlyTriggered.length > 0)
                      .map(af => (
                        <div key={af.accountId} className="flex items-center justify-between text-xs md:text-sm">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-muted-foreground">Account {af.accountId}:</span>
                            {af.newlyTriggered.map(l => (
                              <Badge key={l.row_id} variant="outline" className="text-[10px] px-1.5 py-0 bg-green-100 dark:bg-green-900 border-green-400">
                                Nivo {l.level_no}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-green-600">
                              +{af.cashOutThisSplit.toFixed(2)} {annuityPlan.currency}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              (Σ {af.cumulativeCashOut.toFixed(2)})
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Cumulative totals for splits with no new triggers */}
                {forecast.totalCashOut === 0 && i > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Brez novih izplačil na tem splitu
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Total summary at the bottom */}
      <Card className="border-green-500 bg-green-50 dark:bg-green-950">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">Skupno izplačilo (15 splitov)</p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Od splita {currentSplit} do splita {currentSplit + 15}
              </p>
            </div>
            <p className="text-2xl md:text-3xl font-bold text-green-700 dark:text-green-300">
              {totalAllSplitsCashOut.toFixed(2)} {annuityPlan.currency}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Lana8WonderSplits;
