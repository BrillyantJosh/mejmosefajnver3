import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Clock, CheckCircle, TrendingUp, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrPaymentScore } from "@/hooks/useNostrPaymentScore";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const unconditionalPaymentNavItems = [
  { title: "Pending", path: "/unconditional-payment", icon: Clock },
  { title: "Completed", path: "/unconditional-payment/completed", icon: CheckCircle },
  { title: "Relay Retry", path: "/unconditional-payment/retry", icon: RefreshCw }
];

function formatPeriod(start: string, end: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatMonth = (ym: string) => {
    const [year, month] = ym.split('-');
    const idx = parseInt(month, 10) - 1;
    return `${months[idx] || month} ${year}`;
  };
  return `${formatMonth(start)} – ${formatMonth(end)}`;
}

function getScoreColor(score: number): string {
  if (score >= 7) return 'text-green-600 dark:text-green-400';
  if (score >= 5) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getScoreBg(score: number): string {
  if (score >= 7) return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800';
  if (score >= 5) return 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800';
  return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';
}

function formatLanoshi(lanoshi: string): string {
  const value = parseInt(lanoshi, 10);
  if (isNaN(value)) return lanoshi;
  // Convert lanoshi to LANA (1 LANA = 100,000,000 lanoshi)
  const lana = value / 100_000_000;
  return lana.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' LANA';
}

export default function UnconditionalPaymentLayout() {
  const { session } = useAuth();
  const { score, isLoading: scoreLoading } = useNostrPaymentScore(session?.nostrHexId);

  const scoreNum = score ? parseFloat(score.score) : 0;

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Unconditional Payment</h1>
        <p className="text-muted-foreground">Send payments to projects and initiatives in the Lana ecosystem</p>
      </div>

      {/* Payment Score */}
      {scoreLoading && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      )}

      {!scoreLoading && score && (
        <Card className={`mb-6 border ${getScoreBg(scoreNum)}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <TrendingUp className={`h-5 w-5 ${getScoreColor(scoreNum)}`} />
                <span className="text-sm font-medium text-muted-foreground">Payment Score</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${getScoreColor(scoreNum)}`}>
                  {score.score}
                </span>
                <span className="text-sm text-muted-foreground">/10</span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {score.periodStart && score.periodEnd && (
                  <span>{formatPeriod(score.periodStart, score.periodEnd)}</span>
                )}
                {score.paidLanoshi && score.proposedLanoshi && (
                  <span>
                    Paid {formatLanoshi(score.paidLanoshi)} / {formatLanoshi(score.proposedLanoshi)}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Outlet />

      <SubNavigation items={unconditionalPaymentNavItems} variant="bottom" />
    </div>
  );
}
