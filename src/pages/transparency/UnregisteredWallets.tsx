import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, WalletCards } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import WalletCard from "@/components/unregistered-wallets/WalletCard";

export default function TransparencyUnregisteredWallets() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { lists, isLoading: listsLoading } = useNostrUnregisteredWallets();

  // Find the unregistered wallet list for the selected profile
  const selectedList = useMemo(() => {
    if (!selectedProfile) return null;
    return lists.find(list => list.ownerPubkey === selectedProfile.pubkey) || null;
  }, [selectedProfile, lists]);

  // Get wallet addresses for balance fetching
  const walletAddresses = useMemo(() =>
    selectedList?.wallets.map(w => w.address) || [],
    [selectedList]
  );

  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(walletAddresses);

  const filteredProfiles = profiles.filter(
    (profile) =>
      profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.pubkey?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatBalance = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Unregistered Wallets</h1>

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

      {/* Unregistered Wallets Display */}
      {selectedProfile && (
        <>
          {/* Selected Profile Header */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <UserAvatar pubkey={selectedProfile.pubkey} picture={selectedProfile.picture} name={selectedProfile.display_name || selectedProfile.name} className="h-16 w-16" />
                <div>
                  <h2 className="text-2xl font-bold">
                    {selectedProfile.display_name || selectedProfile.name || 'Anonymous'}
                  </h2>
                  {selectedProfile.location && (
                    <p className="text-muted-foreground">{selectedProfile.location}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {listsLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !selectedList || selectedList.wallets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <WalletCards className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                <p className="text-muted-foreground">
                  This user has no unregistered wallets recorded.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Unregistered Wallets</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {selectedList.wallets.length} wallet{selectedList.wallets.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border mb-4">
                  <span className="text-sm font-medium">Total Balance:</span>
                  <div className="flex items-center gap-2">
                    {balancesLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-lg font-bold text-primary">
                        {formatBalance(totalBalance)} LANA
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {selectedList.wallets.map((wallet, idx) => (
                    <WalletCard
                      key={idx}
                      address={wallet.address}
                      note={wallet.note}
                      canDelete={false}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
