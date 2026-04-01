import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Loader2,
  CheckCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Inbox,
  ExternalLink,
  ArrowDown,
  Banknote,
  ShieldCheck,
} from "lucide-react";
import {
  useDiscountTransactions,
  BuybackTransaction,
  FiatPayout,
} from "@/hooks/useDiscountTransactions";
import { formatLana } from "@/lib/currencyConversion";

const EXPLORER_URL = "https://chainz.cryptoid.info/lana/tx.dws?";

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFiat(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Sub-component for a single transaction card
function TransactionCard({
  tx,
  payouts,
}: {
  tx: BuybackTransaction;
  payouts: FiatPayout[];
}) {
  const [expanded, setExpanded] = useState(false);

  const isPaid = tx.status === "paid";
  const txPayouts = payouts.filter((p) => p.txRef === tx.id);

  return (
    <Card
      className={`transition-shadow ${
        isPaid
          ? "border-green-200 dark:border-green-800/50"
          : "border-yellow-200 dark:border-yellow-800/50"
      }`}
    >
      <CardContent className="p-3 sm:p-4">
        {/* Main row */}
        <button
          className="w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {/* Status icon */}
            <div className="shrink-0">
              {isPaid ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <Clock className="h-5 w-5 text-yellow-500" />
              )}
            </div>

            {/* Amount + date + progress */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-bold">
                  {formatLana(tx.lanaDisplay)}
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground">
                  {formatFiat(tx.netFiat, tx.currency)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDate(tx.createdAt)}
              </p>
              {/* Payment progress bar */}
              {tx.netFiat > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${tx.paidFiat >= tx.netFiat ? 'bg-green-500' : tx.paidFiat > 0 ? 'bg-yellow-500' : 'bg-muted-foreground/20'}`}
                      style={{ width: `${Math.min(100, (tx.paidFiat / tx.netFiat) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {formatFiat(tx.paidFiat, tx.currency)} / {formatFiat(tx.netFiat, tx.currency)}
                  </span>
                </div>
              )}
            </div>

            {/* Badges + expand */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isPaid ? (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                  Paid
                </Badge>
              ) : (
                <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">
                  Completed
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {tx.source}
              </Badge>
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-3 text-sm overflow-hidden">
            {/* FIAT breakdown */}
            <div className="p-2 sm:p-3 bg-muted rounded-lg space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gross</span>
                <span>{formatFiat(tx.grossFiat, tx.currency)}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>Commission ({tx.commissionPercent}%)</span>
                <span>-{formatFiat(tx.commissionFiat, tx.currency)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-1">
                <span>Net Payout</span>
                <span>{formatFiat(tx.netFiat, tx.currency)}</span>
              </div>
              {tx.paidFiat > 0 && tx.paidFiat < tx.netFiat && (
                <div className="flex justify-between text-green-600">
                  <span>Paid so far</span>
                  <span>{formatFiat(tx.paidFiat, tx.currency)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Exchange Rate</span>
              <span>
                1 LANA = {formatFiat(tx.exchangeRate, tx.currency)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">LANA (lanoshis)</span>
              <span className="font-mono text-xs">
                {tx.lanaAmount.toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Split</span>
              <span>{tx.split}</span>
            </div>

            {/* TX Hash */}
            <div>
              <span className="text-muted-foreground">TX Hash</span>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-xs break-all bg-muted p-2 rounded flex-1">
                  {tx.txHash}
                </p>
                <a
                  href={`${EXPLORER_URL}${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <ExternalLink className="h-4 w-4 text-blue-500 hover:text-blue-600" />
                </a>
              </div>
            </div>

            {/* Wallet addresses */}
            <div className="space-y-1">
              <span className="text-muted-foreground">Sender</span>
              <p className="font-mono text-xs break-all bg-muted p-1.5 rounded">
                {tx.senderWallet}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">Buyback Wallet</span>
              <p className="font-mono text-xs break-all bg-muted p-1.5 rounded">
                {tx.buybackWallet}
              </p>
            </div>

            {/* RPC verification */}
            {tx.rpcVerified && (
              <div className="flex items-center gap-2 text-green-600">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs">
                  RPC Verified ({tx.rpcConfirmations} confirmations)
                </span>
              </div>
            )}

            {/* Payouts section */}
            {txPayouts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Banknote className="h-4 w-4" />
                  <span className="font-medium">
                    Payouts ({txPayouts.length})
                  </span>
                </div>
                {txPayouts.map((payout) => (
                  <div
                    key={payout.id}
                    className="p-2 bg-green-50 dark:bg-green-950/20 rounded-lg space-y-1 text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-bold">
                        {formatFiat(payout.amount, payout.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Paid At</span>
                      <span>{payout.paidAt || "N/A"}</span>
                    </div>
                    {payout.paidToAccount && (
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-muted-foreground flex-shrink-0">Account</span>
                        <span className="font-mono truncate">{payout.paidToAccount}</span>
                      </div>
                    )}
                    {payout.reference && (
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-muted-foreground flex-shrink-0">Reference</span>
                        <span className="truncate">{payout.reference}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining</span>
                      <span>
                        {formatFiat(payout.remaining, payout.currency)}
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          payout.status === "full"
                            ? "text-green-600 border-green-300"
                            : "text-yellow-600 border-yellow-300"
                        }`}
                      >
                        {payout.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-muted-foreground">Transaction ID</span>
              <span className="font-mono text-xs">
                {tx.id.length > 16 ? tx.id.slice(0, 8) + "..." : tx.id}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DiscountTransactions() {
  const { transactions, payouts, loading, error, refetch } =
    useDiscountTransactions();

  // Summary stats
  const stats = useMemo(() => {
    const totalLana = transactions.reduce((sum, t) => sum + t.lanaDisplay, 0);
    const totalNetFiat = transactions.reduce((sum, t) => sum + t.netFiat, 0);
    const pending = transactions.filter((t) => t.status !== "paid").length;
    // Use first transaction's currency or default to EUR
    const currency = transactions.length > 0 ? transactions[0].currency : "EUR";
    const totalPaid = transactions.reduce((sum, t) => sum + t.paidFiat, 0);
    const remaining = Math.round((totalNetFiat - totalPaid) * 100) / 100;
    return {
      count: transactions.length,
      totalLana,
      totalNetFiat,
      totalPaid,
      remaining,
      pending,
      currency,
    };
  }, [transactions]);

  return (
    <div className="px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
            Transactions
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Lana.Discount buyback history & payouts
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Summary cards */}
      {!loading && transactions.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 sm:p-3 bg-muted rounded-lg text-center">
              <p className="text-lg sm:text-xl font-bold">
                {stats.count}
              </p>
              <p className="text-[0.65rem] sm:text-xs text-muted-foreground">
                Transactions
              </p>
            </div>
            <div className="p-2 sm:p-3 bg-muted rounded-lg text-center">
              <p className="text-lg sm:text-xl font-bold">
                {formatLana(stats.totalLana)}
              </p>
              <p className="text-[0.65rem] sm:text-xs text-muted-foreground">
                LANA Sold
              </p>
            </div>
            <div className="p-2 sm:p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
              <p className="text-lg sm:text-xl font-bold text-green-600">
                {formatFiat(stats.totalPaid, stats.currency)}
              </p>
              <p className="text-[0.65rem] sm:text-xs text-muted-foreground">
                Paid Out
              </p>
            </div>
            <div className="p-2 sm:p-3 bg-muted rounded-lg text-center">
              <p className={`text-lg sm:text-xl font-bold ${stats.remaining > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                {formatFiat(stats.remaining, stats.currency)}
              </p>
              <p className="text-[0.65rem] sm:text-xs text-muted-foreground">
                Remaining
              </p>
            </div>
          </div>
        </>
      )}

      {/* Error state */}
      {error && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-destructive">{error}</p>
            <Button variant="link" className="mt-2" onClick={refetch}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Transaction list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Loading transactions...
          </span>
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No buyback transactions yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sell LANA through Lana.Discount to see transactions here
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <TransactionCard key={tx.id} tx={tx} payouts={payouts} />
          ))}
        </div>
      )}
    </div>
  );
}
