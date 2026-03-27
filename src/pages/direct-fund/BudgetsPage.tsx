import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrInvestorBudgets } from '@/hooks/useNostrInvestorBudgets';
import { Wallet, Loader2, TrendingUp } from 'lucide-react';

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function formatFiat(amount: number, currency: string): string {
  const sym: Record<string, string> = { EUR: '\u20ac', USD: '$', GBP: '\u00a3' };
  return `${(sym[currency] || currency + ' ')}${amount.toFixed(2)}`;
}

export default function BudgetsPage() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { budgets, isLoading } = useNostrInvestorBudgets(session?.nostrHexId);

  const currentSplit = parameters?.split ? parseInt(parameters.split) : 5;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading budgets from Nostr...</span>
      </div>
    );
  }

  if (budgets.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl border">
        <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-lg font-medium text-muted-foreground">No budgets configured</p>
        <p className="text-sm text-muted-foreground/60 mt-1">
          Visit <a href="https://direct.lana.fund" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">direct.lana.fund</a> to create investment budgets
        </p>
      </div>
    );
  }

  // Group by currency
  const byCurrency = budgets.reduce((acc, b) => {
    const c = b.investmentCurrency;
    if (!acc[c]) acc[c] = { total: 0, invested: 0, available: 0, budgets: [] };
    acc[c].total += b.investmentAmount;
    acc[c].invested += b.investedAmount;
    acc[c].available += b.availableAmount;
    acc[c].budgets.push(b);
    return acc;
  }, {} as Record<string, { total: number; invested: number; available: number; budgets: typeof budgets }>);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(byCurrency).map(([cur, data]) => (
          <div key={cur} className="rounded-xl border p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase">{cur}</p>
            <p className="text-xl font-bold mt-1">{formatFiat(data.available, cur)}</p>
            <p className="text-[10px] text-muted-foreground">of {formatFiat(data.total, cur)}</p>
          </div>
        ))}
      </div>

      {/* Budget list */}
      <div className="space-y-3">
        {budgets.map(b => {
          const progress = b.investmentAmount > 0 ? (b.investedAmount / b.investmentAmount) * 100 : 0;
          const statusColor = b.status === 'active' ? 'text-emerald-500'
            : b.status === 'blocked' ? 'text-red-500'
            : b.status === 'depleted' ? 'text-amber-500'
            : 'text-muted-foreground';

          return (
            <div key={b.id} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{b.note || `Budget #${b.id}`}</p>
                    <span className={`text-[10px] font-semibold ${statusColor}`}>
                      {b.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {shortenId(b.walletId)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">
                    {formatFiat(b.availableAmount, b.investmentCurrency)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">available</p>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span className="tabular-nums">
                    {formatFiat(b.investedAmount, b.investmentCurrency)} / {formatFiat(b.investmentAmount, b.investmentCurrency)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
