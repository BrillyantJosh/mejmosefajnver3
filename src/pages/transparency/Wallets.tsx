import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Wallet as WalletIcon, TrendingUp, Copy, ExternalLink, CreditCard, FileText, Snowflake, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useNostrPaymentScore } from "@/hooks/useNostrPaymentScore";
import lana8wonderBg from "@/assets/lana8wonder-bg.png";
import knightsBg from "@/assets/knights-bg.png";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Get human-readable freeze reason */
function getFreezeReasonLabel(freezeStatus: string): string {
  switch (freezeStatus) {
    case 'frozen_l8w': return 'Late wallet registration';
    case 'frozen_max_cap': return 'Maximum balance cap exceeded';
    case 'frozen_too_wild': return 'Irregular or suspicious activity';
    case 'frozen_unreg_Lanas': return 'Received unregistered LANA exceeding threshold';
    case 'frozen': return 'All accounts frozen by registrar';
    default: return 'Account frozen';
  }
}

interface WalletWithBalance {
  walletId: string;
  walletType: string;
  note?: string;
  freezeStatus?: string;
  balance?: number;
  balanceLoading?: boolean;
}

export default function Wallets() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(selectedProfile?.pubkey || null);
  const { parameters } = useSystemParameters();
  const { profile: currentUserProfile } = useNostrProfile();
  const { score: paymentScore } = useNostrPaymentScore(selectedProfile?.pubkey);
  const [walletsWithBalances, setWalletsWithBalances] = useState<WalletWithBalance[]>([]);

  const filteredProfiles = profiles.filter(
    (profile) =>
      profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.pubkey?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (wallets.length > 0 && parameters?.electrumServers) {
      fetchBalances();
    } else {
      setWalletsWithBalances([]);
    }
  }, [wallets, parameters?.electrumServers]);

  const fetchBalances = async () => {
    if (!parameters?.electrumServers || wallets.length === 0) return;

    setWalletsWithBalances(wallets.map(w => ({
      walletId: w.walletId,
      walletType: w.walletType,
      note: w.note,
      freezeStatus: w.freezeStatus,
      balanceLoading: true
    })));

    try {
      const walletAddresses = wallets.map(w => w.walletId);

      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: {
          wallet_addresses: walletAddresses,
          electrum_servers: parameters.electrumServers,
        },
      });

      if (error) {
        console.error('Error fetching balances:', error);
        setWalletsWithBalances(wallets.map(w => ({
          walletId: w.walletId,
          walletType: w.walletType,
          note: w.note,
          freezeStatus: w.freezeStatus,
          balance: 0,
          balanceLoading: false
        })));
        return;
      }

      const updatedWallets = wallets.map(wallet => {
        const balanceData = data.wallets?.find((b: any) => b.wallet_id === wallet.walletId);
        return {
          walletId: wallet.walletId,
          walletType: wallet.walletType,
          note: wallet.note,
          freezeStatus: wallet.freezeStatus,
          balance: balanceData?.balance || 0,
          balanceLoading: false,
        };
      });

      setWalletsWithBalances(updatedWallets);
    } catch (error) {
      console.error('Error fetching balances:', error);
      setWalletsWithBalances(wallets.map(w => ({
        walletId: w.walletId,
        walletType: w.walletType,
        note: w.note,
        freezeStatus: w.freezeStatus,
        balance: 0,
        balanceLoading: false
      })));
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getFiatValue = (lanaBalance: number) => {
    // Use the SELECTED profile's currency, not the logged-in user's
    const currency = selectedProfile?.currency || currentUserProfile?.currency || 'EUR';
    const rate = parameters?.exchangeRates?.[currency as 'EUR' | 'USD' | 'GBP'] || 0;
    const fiatValue = lanaBalance * rate;
    return { value: fiatValue, currency };
  };

  const totalLana = walletsWithBalances.reduce((sum, w) => sum + (w.balance || 0), 0);
  const totalFiat = walletsWithBalances.reduce((sum, w) => {
    const fiat = getFiatValue(w.balance || 0);
    return sum + fiat.value;
  }, 0);

  // Sort wallets by type priority (same order as /wallet page)
  const walletTypeOrder: Record<string, number> = {
    "Main Wallet": 1,
    "Wallet": 2,
    "LanaPays.Us": 3,
    "Knights": 4,
    "Lana8Wonder": 5,
  };

  const sortedWallets = [...walletsWithBalances].sort((a, b) => {
    const orderA = walletTypeOrder[a.walletType] || 99;
    const orderB = walletTypeOrder[b.walletType] || 99;
    if (orderA !== orderB) return orderA - orderB;
    // Sub-sort Lana8Wonder by numeric note (1, 2, 3...)
    if (a.walletType === 'Lana8Wonder' && b.walletType === 'Lana8Wonder') {
      const numA = parseInt(a.note || '') || Infinity;
      const numB = parseInt(b.note || '') || Infinity;
      return numA - numB;
    }
    return 0;
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Wallet Transparency</h1>

      {/* Profile Search */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Profiles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, display name, or nostr hex ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {searchTerm && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {profilesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-2" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredProfiles.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No profiles found</p>
              ) : (
                filteredProfiles.map((profile) => (
                  <div
                    key={profile.pubkey}
                    onClick={() => setSelectedProfile(profile)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedProfile?.pubkey === profile.pubkey
                        ? 'bg-orange-500/10 border border-orange-500'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <UserAvatar pubkey={profile.pubkey} picture={profile.picture} name={profile.display_name || profile.name} className="h-10 w-10" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {profile.display_name || profile.name || 'Anonymous'}
                        {profile.display_name && profile.name && profile.name !== profile.display_name && (
                          <span className="text-muted-foreground font-normal ml-1">@{profile.name}</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {profile.location && `${profile.location} • `}
                        {profile.pubkey.substring(0, 16)}...
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wallets Display */}
      {selectedProfile && (
        <>
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 mb-4">
                <UserAvatar pubkey={selectedProfile.pubkey} picture={selectedProfile.picture} name={selectedProfile.display_name || selectedProfile.name} className="h-16 w-16" />
                <div>
                  <h2 className="text-2xl font-bold">
                    {selectedProfile.display_name || selectedProfile.name || 'Anonymous'}
                  </h2>
                  <p className="text-muted-foreground">{selectedProfile.location}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Score */}
          {paymentScore && (() => {
            const scoreNum = parseFloat(paymentScore.score);
            const scoreColor = scoreNum >= 7 ? 'text-green-600 dark:text-green-400' : scoreNum >= 5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
            const scoreBg = scoreNum >= 7 ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' : scoreNum >= 5 ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';

            const formatLanoshi = (l: string) => { const v = parseInt(l, 10); return isNaN(v) ? l : (v / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' LANA'; };
            const formatPeriod = (start: string, end: string) => {
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              const fmt = (ym: string) => { const [y, m] = ym.split('-'); return `${months[parseInt(m,10)-1] || m} ${y}`; };
              return `${fmt(start)} – ${fmt(end)}`;
            };

            return (
              <Card className={`mb-6 border ${scoreBg}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className={`h-5 w-5 flex-shrink-0 ${scoreColor}`} />
                      <span className="text-sm font-medium text-muted-foreground">Payment Score</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-2xl font-bold ${scoreColor}`}>{paymentScore.score}</span>
                      <span className="text-sm text-muted-foreground">/10</span>
                    </div>
                    <div className="sm:ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {paymentScore.periodStart && paymentScore.periodEnd && (
                        <span>{formatPeriod(paymentScore.periodStart, paymentScore.periodEnd)}</span>
                      )}
                      {paymentScore.paidLanoshi && paymentScore.proposedLanoshi && (
                        <span>Paid {formatLanoshi(paymentScore.paidLanoshi)} / {formatLanoshi(paymentScore.proposedLanoshi)}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Frozen Account Warning */}
          {(() => {
            const frozenWallets = walletsWithBalances.filter(w => w.freezeStatus);
            const allFrozen = walletsWithBalances.length > 0 && frozenWallets.length === walletsWithBalances.length;
            const someFrozen = frozenWallets.length > 0 && !allFrozen;

            if (allFrozen) {
              const reason = frozenWallets[0]?.freezeStatus || 'frozen';
              return (
                <Alert variant="destructive" className="mb-6 border-blue-500/50 bg-blue-500/10">
                  <Snowflake className="h-4 w-4 text-blue-500" />
                  <AlertTitle className="text-blue-700 dark:text-blue-400">All Accounts Frozen</AlertTitle>
                  <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                    All wallets for this user have been frozen.
                    <strong className="block mt-1">Reason: {getFreezeReasonLabel(reason)}</strong>
                    <span className="block mt-1">Outgoing transactions are disabled. Receiving is still allowed.</span>
                  </AlertDescription>
                </Alert>
              );
            }
            if (someFrozen) {
              return (
                <Alert variant="destructive" className="mb-6 border-blue-500/50 bg-blue-500/10">
                  <Snowflake className="h-4 w-4 text-blue-500" />
                  <AlertTitle className="text-blue-700 dark:text-blue-400">Some Wallets Frozen</AlertTitle>
                  <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                    {frozenWallets.length} of {walletsWithBalances.length} wallets {frozenWallets.length === 1 ? 'is' : 'are'} frozen.
                    See individual wallet cards below for details.
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()}

          {walletsLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : walletsWithBalances.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <WalletIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No wallets found for this profile</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Total Summary */}
              <Card className="mb-6 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 mb-2">
                      <WalletIcon className="h-6 w-6 text-primary" />
                      <p className="text-sm text-muted-foreground font-medium">Total Balance</p>
                    </div>
                    {walletsWithBalances.some(w => w.balanceLoading) ? (
                      <Skeleton className="h-12 w-48" />
                    ) : (
                      <>
                        <p className="text-4xl font-bold text-green-600">
                          {formatNumber(totalFiat)} {getFiatValue(0).currency}
                        </p>
                        <p className="text-lg text-muted-foreground">
                          ≈ {formatNumber(totalLana)} LANA
                        </p>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Wallet Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedWallets.map((wallet, index) => (
                  <Card
                    key={wallet.walletId || index}
                    className={`hover:shadow-lg transition-shadow relative overflow-hidden ${
                      wallet.freezeStatus
                        ? "border-blue-500/50 bg-blue-500/5"
                        : wallet.walletType === "Main Wallet" ? "bg-green-500/10 border-green-500/30" : ""
                    }`}
                    style={!wallet.freezeStatus && wallet.walletType === "Lana8Wonder" ? {
                      backgroundImage: `url(${lana8wonderBg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    } : !wallet.freezeStatus && wallet.walletType === "Knights" ? {
                      backgroundImage: `url(${knightsBg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    } : undefined}
                  >
                    {!wallet.freezeStatus && (wallet.walletType === "Lana8Wonder" || wallet.walletType === "Knights") && (
                      <div className="absolute inset-0 bg-background/85" />
                    )}

                    {/* Frozen overlay badge */}
                    {wallet.freezeStatus && (
                      <div className="absolute top-0 right-0 z-20 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center gap-1">
                        <Snowflake className="h-3 w-3" />
                        FROZEN
                      </div>
                    )}

                    <CardHeader className="relative z-10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                            wallet.freezeStatus ? "bg-blue-500/20" : "bg-primary/10"
                          }`}>
                            {wallet.freezeStatus
                              ? <Snowflake className="h-5 w-5 text-blue-500" />
                              : <WalletIcon className="h-5 w-5 text-primary" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base font-semibold truncate" title={wallet.walletId}>
                              {wallet.walletId}
                            </CardTitle>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              navigator.clipboard.writeText(wallet.walletId);
                              toast.success("Wallet address copied!");
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              window.open(`https://chainz.cryptoid.info/lana/address.dws?${wallet.walletId}.htm`, '_blank');
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 relative z-10">
                      {/* Freeze reason banner on card */}
                      {wallet.freezeStatus && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm">
                          <ShieldAlert className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-blue-700 dark:text-blue-400">
                              {getFreezeReasonLabel(wallet.freezeStatus)}
                            </p>
                            <p className="text-blue-600/70 dark:text-blue-300/70 text-xs mt-0.5">
                              Outgoing transactions disabled
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            <span className="text-sm text-muted-foreground">Balance:</span>
                          </div>
                          {wallet.balanceLoading ? (
                            <Skeleton className="h-8 w-32" />
                          ) : (
                            <div className="flex flex-col items-end">
                              {wallet.balance && wallet.balance > 0 && (
                                <span className={`text-2xl font-bold ${wallet.freezeStatus ? 'text-blue-600' : 'text-green-600'}`}>
                                  {formatNumber(getFiatValue(wallet.balance).value)} {getFiatValue(wallet.balance).currency}
                                </span>
                              )}
                              <span className="text-sm text-muted-foreground">
                                ≈ {formatNumber(wallet.balance || 0)} LANA
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Type:</span>
                        <span className="font-medium">{wallet.walletType}</span>
                      </div>

                      {wallet.note && (
                        <div className="flex items-start gap-2 text-sm">
                          <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1">
                            <span className="text-muted-foreground">Note:</span>
                            <p className="text-foreground mt-1">{wallet.note}</p>
                          </div>
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        asChild
                      >
                        <a
                          href={`https://chainz.cryptoid.info/lana/address.dws?${wallet.walletId}.htm`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Transaction History
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
