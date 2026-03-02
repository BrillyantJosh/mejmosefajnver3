import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool, Event } from 'nostr-tools';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, AlertCircle, Euro, Wallet } from 'lucide-react';
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

// Format number with thousands separators
const fmt = (n: number, decimals = 2): string => {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtPrice = (price: number): string => {
  if (price < 1) return price.toFixed(6);
  if (price < 100) return fmt(price, 4);
  return fmt(price, 2);
};

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

  // Generate forecast for accounts 1-5 (reads from plan levels)
  const generateForecast = (): SplitForecast[] => {
    if (!annuityPlan || currentPrice <= 0) return [];

    const includedAccounts = annuityPlan.accounts.filter(acc => acc.account_id <= 5);
    if (includedAccounts.length === 0) return [];

    let maxTriggerPrice = 0;
    includedAccounts.forEach(acc => {
      acc.levels.forEach(l => {
        if (l.trigger_price > maxTriggerPrice) maxTriggerPrice = l.trigger_price;
      });
    });

    const splitsNeeded = maxTriggerPrice > currentPrice
      ? Math.ceil(Math.log2(maxTriggerPrice / currentPrice))
      : 0;

    const forecasts: SplitForecast[] = [];
    const cumulativeCashOuts: Record<number, number> = {};
    includedAccounts.forEach(acc => {
      cumulativeCashOuts[acc.account_id] = 0;
    });

    let previousPrice = 0;

    for (let i = 0; i <= splitsNeeded; i++) {
      const price = i === 0 ? currentPrice : currentPrice * Math.pow(2, i);

      const accountForecasts: AccountForecast[] = includedAccounts.map(account => {
        const balance = accountBalances[account.wallet] || 0;

        const triggeredLevels = account.levels
          .filter(l => price >= l.trigger_price)
          .sort((a, b) => a.level_no - b.level_no);

        const newlyTriggered = account.levels
          .filter(l => price >= l.trigger_price && previousPrice < l.trigger_price)
          .sort((a, b) => a.level_no - b.level_no);

        const cashOutThisSplit = newlyTriggered.reduce((sum, l) => sum + l.cash_out, 0);
        cumulativeCashOuts[account.account_id] += cashOutThisSplit;

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
            <h1 className="text-2xl md:text-3xl font-bold">Split Forecast</h1>
            <p className="text-sm md:text-base text-muted-foreground">Price projection per split</p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You don't have an annuity plan. To view payout projections you need an active annuity plan at{' '}
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

        {/* Price-only forecast */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              LANA Price Forecast
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Current price: <strong>{currentPrice.toFixed(6)} EUR</strong> • Split: <strong>{currentSplit}</strong>
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
                          Up to
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono font-semibold text-sm">
                      {fmtPrice(price)} EUR
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
  const lastSplit = forecasts.length > 0 ? forecasts[forecasts.length - 1].splitNumber : currentSplit;
  const lastPrice = forecasts.length > 0 ? forecasts[forecasts.length - 1].price : currentPrice;

  return (
    <div className="container mx-auto p-3 md:p-4 space-y-4">
      <div className="flex items-center gap-2 md:gap-3 mb-4">
        <TrendingUp className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Split Forecast</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Payout projection for accounts 1–5 ({forecasts.length} splits)
          </p>
        </div>
      </div>

      {/* Summary card */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Current Price</p>
              <p className="font-bold text-lg">{currentPrice.toFixed(6)} <span className="text-sm font-normal">EUR</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current Split</p>
              <p className="font-bold text-lg">{currentSplit}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Final Price (Split {lastSplit})</p>
              <p className="font-bold text-lg">
                {fmtPrice(lastPrice)} <span className="text-sm font-normal">EUR</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Payout</p>
              <p className="font-bold text-lg text-green-600">
                {fmt(totalAllSplitsCashOut)} <span className="text-sm font-normal">{annuityPlan.currency}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Split-by-split forecast (Accounts 1-5) */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Euro className="h-5 w-5" />
            Forecast by Split
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Each split doubles the LANA price • Payouts per annuity plan
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 space-y-2">
          {forecasts.map((forecast, i) => {
            const hasNewTriggers = forecast.accountForecasts.some(af => af.newlyTriggered.length > 0);
            const isCurrent = i === 0;
            const accountsWithPayouts = forecast.accountForecasts.filter(af => af.newlyTriggered.length > 0);
            const multipleAccountsPay = accountsWithPayouts.length > 1;

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
                        Up to
                      </Badge>
                    )}
                  </div>
                  <span className="font-mono font-semibold text-sm">
                    {fmtPrice(forecast.price)} EUR
                  </span>
                </div>

                {/* Cash out info */}
                {forecast.totalCashOut > 0 && (
                  <div className="mt-2 space-y-1">
                    {accountsWithPayouts.map(af => (
                      <div key={af.accountId} className="flex items-center justify-between text-xs md:text-sm">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-muted-foreground">Account {af.accountId}:</span>
                          {af.newlyTriggered.map(l => (
                            <Badge key={l.row_id} variant="outline" className="text-[10px] px-1.5 py-0 bg-green-100 dark:bg-green-900 border-green-400">
                              Level {l.level_no}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-green-600">
                            +{fmt(af.cashOutThisSplit)} {annuityPlan.currency}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            (Σ {fmt(af.cumulativeCashOut)})
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Split total when multiple accounts pay out */}
                    {multipleAccountsPay && (
                      <div className="flex items-center justify-between text-xs md:text-sm pt-1 mt-1 border-t border-green-300 dark:border-green-700">
                        <span className="font-semibold">Split total:</span>
                        <span className="font-bold text-green-700 dark:text-green-300">
                          +{fmt(forecast.totalCashOut)} {annuityPlan.currency}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* No payouts on this split */}
                {forecast.totalCashOut === 0 && i > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    No new payouts on this split
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Total summary for accounts 1-5 */}
      <Card className="border-green-500 bg-green-50 dark:bg-green-950">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">Total Payout (Accounts 1–5)</p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Split {currentSplit} → Split {lastSplit}
              </p>
            </div>
            <p className="text-2xl md:text-3xl font-bold text-green-700 dark:text-green-300">
              {fmt(totalAllSplitsCashOut)} {annuityPlan.currency}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Passive Income — Accounts 6-8 */}
      {annuityPlan.accounts.some(acc => acc.account_id >= 6 && acc.account_id <= 8) && (
        <Card className="border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950 mt-6">
          <CardContent className="p-5 md:p-8">
            <div className="flex items-start gap-3 mb-4">
              <Wallet className="h-6 w-6 text-violet-600 flex-shrink-0 mt-0.5" />
              <h2 className="text-xl md:text-2xl font-bold text-violet-800 dark:text-violet-200">
                Passive Income
              </h2>
            </div>
            <div className="space-y-4 text-sm md:text-base text-violet-900/80 dark:text-violet-200/80 leading-relaxed">
              <p>
                Accounts 6, 7 and 8 follow the logic of passive income, where your principal is preserved.
                The amounts generated are beyond ordinary — and that is by design.
              </p>
              <p>
                From this point forward, the most important thing is that you stop thinking about money.
                Money, from here on, becomes like air. It simply is — and you use it just as naturally
                as you breathe.
              </p>
              <p className="font-medium text-violet-800 dark:text-violet-200">
                This is true Abundance. Not defined by what you can buy, but by living in the feeling
                that you are taken care of — completely, effortlessly, and forever.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Lana8WonderSplits;
