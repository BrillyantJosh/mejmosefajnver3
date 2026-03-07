import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Calendar, RefreshCw, Wallet, Radio } from "lucide-react";
import { format } from "date-fns";
import { sl } from "date-fns/locale";

interface LanaProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  location?: string;
  country?: string;
  currency?: string;
  lanaWalletID?: string;
  created_at: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

export default function Last30() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<LanaProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchFromRelays = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch last 30 Lana profiles directly from relays via server
      const res = await fetch(`${API_URL}/api/functions/last-lana-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 30 }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProfiles(data.profiles || []);
      setLastFetched(new Date());
      console.log(`📋 Last 30: loaded ${data.profiles?.length || 0} profiles from relays`);
    } catch (error) {
      console.error('Error fetching last 30 profiles:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFromRelays();
  }, [fetchFromRelays]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Last 30 Lana Profiles</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <Radio className="h-3.5 w-3.5" />
            Live from Nostr relays
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-muted-foreground">
              {format(lastFetched, "HH:mm:ss")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchFromRelays}
            disabled={isLoading}
            className="gap-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">Querying Nostr relays...</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No profiles found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {profiles.map((profile, idx) => (
            <Card
              key={profile.pubkey}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/transparency/profiles/${profile.pubkey}`)}
            >
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                    <UserAvatar
                      pubkey={profile.pubkey}
                      picture={profile.picture || undefined}
                      name={profile.display_name || profile.name || 'Anonymous'}
                      className="h-14 w-14 flex-shrink-0"
                    />
                  </div>

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
                      <p className="text-sm text-muted-foreground mb-1">
                        📍 {profile.location}
                      </p>
                    )}

                    {profile.about && (
                      <p className="text-sm line-clamp-2 mb-2">
                        {profile.about}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {profile.lanaWalletID && (
                        <span className="flex items-center gap-1">
                          <Wallet className="h-3 w-3" />
                          {profile.lanaWalletID.slice(0, 8)}...{profile.lanaWalletID.slice(-4)}
                        </span>
                      )}
                      {profile.country && <span>{profile.country}</span>}
                      {profile.currency && <span>{profile.currency}</span>}
                      {profile.created_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(profile.created_at * 1000), "d. MMM yyyy HH:mm", { locale: sl })}
                        </span>
                      )}
                    </div>
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
