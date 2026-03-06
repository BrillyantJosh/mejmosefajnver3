import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Search, Calendar, Wallet, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { sl } from "date-fns/locale";

export default function Profiles() {
  const navigate = useNavigate();
  const { profiles, isLoading, isRefreshing, lastRefreshed, triggerFullRefresh } = useNostrKind0Profiles();
  const [searchQuery, setSearchQuery] = useState("");
  const [walletOnly, setWalletOnly] = useState(true);

  const walletCount = useMemo(() => profiles.filter(p => !!p.lanaWalletID).length, [profiles]);

  const filteredProfiles = useMemo(() => {
    let result = profiles;
    if (walletOnly) {
      result = result.filter(p => !!p.lanaWalletID);
    }
    if (searchQuery.trim()) {
      const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(profile => {
        const searchable = [
          profile.name, profile.display_name, profile.location,
          profile.about, profile.pubkey,
        ].filter(Boolean).join(' ').toLowerCase();
        return words.every(word => searchable.includes(word));
      });
    }
    return result;
  }, [profiles, searchQuery, walletOnly]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Profiles</h1>
        <div className="flex items-center gap-2">
          {lastRefreshed && (
            <span className="text-xs text-muted-foreground">
              {format(lastRefreshed, "HH:mm:ss")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={triggerFullRefresh}
            disabled={isRefreshing}
            className="gap-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Syncing...' : 'Sync Relays'}
          </Button>
        </div>
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, location, or nostr hex ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Button
          variant={walletOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setWalletOnly(true)}
          className="gap-2"
        >
          <Wallet className="h-4 w-4" />
          With Lana Wallet
          <span className="ml-1 bg-white/20 text-xs px-1.5 py-0.5 rounded-full">{walletCount}</span>
        </Button>
        <Button
          variant={!walletOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setWalletOnly(false)}
        >
          Show All
          <span className="ml-1 text-xs opacity-70">({profiles.length})</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading profiles...</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No profiles found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProfiles.map((profile) => (
            <Card key={profile.pubkey} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/transparency/profiles/${profile.pubkey}`)}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <UserAvatar
                    pubkey={profile.pubkey}
                    picture={profile.picture}
                    name={profile.display_name || profile.name || 'Anonymous'}
                    className="h-16 w-16 flex-shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg truncate">
                        {profile.display_name || profile.name || 'Anonymous'}
                      </h3>
                      {profile.name && profile.display_name && (
                        <span className="text-sm text-muted-foreground">@{profile.name}</span>
                      )}
                    </div>

                    {profile.location && (
                      <p className="text-sm text-muted-foreground mb-2">
                        📍 {profile.location}
                      </p>
                    )}

                    {profile.about && (
                      <p className="text-sm line-clamp-2 mb-2">
                        {profile.about}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      {profile.country && <span>Country: {profile.country}</span>}
                      {profile.currency && <span>Currency: {profile.currency}</span>}
                      {profile.lanaWalletID && <span>💼 Wallet</span>}
                      {profile.created_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(profile.created_at * 1000), "d. MMM yyyy", { locale: sl })}
                        </span>
                      )}
                    </div>

                    {profile.pubkey && (
                      <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                        Nostr ID: {profile.pubkey}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
