import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Wallet as WalletIcon, TrendingUp, User, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";

interface WalletWithBalance {
  walletId: string;
  walletType: string;
  note?: string;
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
        balance: 0, 
        balanceLoading: false 
      })));
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getFiatValue = (lanaBalance: number) => {
    const currency = currentUserProfile?.currency || 'USD';
    const rate = parameters?.exchangeRates?.[currency as 'EUR' | 'USD' | 'GBP'] || 0;
    const fiatValue = lanaBalance * rate;
    return { value: fiatValue, currency };
  };

  const totalLana = walletsWithBalances.reduce((sum, w) => sum + (w.balance || 0), 0);
  const totalFiat = walletsWithBalances.reduce((sum, w) => {
    const fiat = getFiatValue(w.balance || 0);
    return sum + fiat.value;
  }, 0);

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
              placeholder="Search by name, display name, or pubkey..."
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
                        ? 'bg-primary/10 border border-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={profile.picture} alt={profile.name || profile.display_name} />
                      <AvatarFallback>
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {profile.display_name || profile.name || 'Anonymous'}
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
                <Avatar className="h-16 w-16">
                  <AvatarImage src={selectedProfile.picture} alt={selectedProfile.name} />
                  <AvatarFallback>
                    <User className="h-8 w-8" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-2xl font-bold">
                    {selectedProfile.display_name || selectedProfile.name || 'Anonymous'}
                  </h2>
                  <p className="text-muted-foreground">{selectedProfile.location}</p>
                </div>
              </div>
            </CardContent>
          </Card>

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
                {walletsWithBalances.map((wallet, index) => (
                  <Card key={wallet.walletId || index} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <WalletIcon className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-sm font-mono truncate flex-1" title={wallet.walletId}>
                          {wallet.walletId}
                        </CardTitle>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              navigator.clipboard.writeText(wallet.walletId);
                              toast.success("Wallet address copied!");
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              window.open(`https://chainz.cryptoid.info/lana/address.dws?${wallet.walletId}.htm`, '_blank');
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
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
                                <span className="text-xl font-bold text-green-600">
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

                      <div className="text-sm">
                        <span className="text-muted-foreground">Type: </span>
                        <span className="font-medium">{wallet.walletType}</span>
                      </div>
                      
                      {wallet.note && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Note: </span>
                          <p className="text-foreground mt-1">{wallet.note}</p>
                        </div>
                      )}
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
