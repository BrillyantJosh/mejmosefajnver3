import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Wallet, ArrowRight, Sparkles, Grid, CheckCircle2, Loader2, Calendar, Lightbulb } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useNostrEvents } from "@/hooks/useNostrEvents";
import { useNostrProjects } from "@/hooks/useNostrProjects";
import { EventCardMini } from "@/components/events/EventCardMini";
import ProjectCardMini from "@/components/100millionideas/ProjectCardMini";

export default function Dashboard() {
  const { lana8Wonder, wallets } = useDashboardData();
  const { profile } = useNostrProfile();
  const { events: onlineEvents, loading: onlineLoading } = useNostrEvents('online');
  const { events: liveEvents, loading: liveLoading } = useNostrEvents('live');
  const { projects, isLoading: projectsLoading } = useNostrProjects();

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Show full-page loading spinner while data is loading
  const isInitialLoading = wallets.isLoading || lana8Wonder.isLoading || onlineLoading || liveLoading || projectsLoading;

  if (isInitialLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          👋 Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
        </h1>
        <p className="text-muted-foreground">Here's what's happening with your account</p>
      </div>

      {/* Wallet Balance Section - Always on top */}
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

      {/* What's New Section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">What's New?</h2>
        </div>

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
                  <p className="text-muted-foreground">No new notifications at this time.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Lana Events Card */}
          {(onlineEvents.length > 0 || liveEvents.length > 0) && (
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
          )}

          {/* 100 Million Fund Projects Card */}
          {projects.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start gap-4 mb-4">
                  <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                    <Lightbulb className="h-6 w-6 text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg">100 Million Fund</h3>
                      <Badge variant="secondary" className="text-xs">
                        {projects.length} projects
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Latest crowdfunding projects from the community
                    </p>
                  </div>
                  <Link to="/100millionideas">
                    <Button variant="outline" size="sm" className="gap-2 shrink-0">
                      View All
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
                
                {/* Projects Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {projects
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 3)
                    .map((project) => (
                      <ProjectCardMini key={project.eventId} project={project} />
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
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
