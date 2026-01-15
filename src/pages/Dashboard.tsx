import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Wallet, ArrowRight, Sparkles, Grid, CheckCircle2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useNostrProfile } from "@/hooks/useNostrProfile";

export default function Dashboard() {
  const { lana8Wonder, wallets } = useDashboardData();
  const { profile } = useNostrProfile();

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const hasAnyItems = lana8Wonder.hasCashOut || wallets.walletCount > 0;
  const isLoading = lana8Wonder.isLoading || wallets.isLoading;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          👋 Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
        </h1>
        <p className="text-muted-foreground">Here's what's happening with your account</p>
      </div>

      {/* What's New Section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">What's New?</h2>
        </div>

        {isLoading ? (
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
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : hasAnyItems ? (
          <div className="space-y-4">
            {/* Lana8Wonder Cash Out Card */}
            {lana8Wonder.hasCashOut && (
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
            )}

            {/* Total Wallet Balance Card */}
            {wallets.walletCount > 0 && (
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
            )}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">You're all caught up!</h3>
                  <p className="text-muted-foreground mb-4">
                    No new notifications at this time.
                  </p>
                  <Link to="/modules">
                    <Button variant="outline" className="gap-2">
                      <Grid className="h-4 w-4" />
                      Browse Modules
                    </Button>
                  </Link>
                </div>
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
