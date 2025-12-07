import { useState, useMemo } from "react";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Search } from "lucide-react";
import { getProxiedImageUrl } from "@/lib/imageProxy";

export default function Profiles() {
  const { profiles, isLoading } = useNostrKind0Profiles();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    
    const query = searchQuery.toLowerCase();
    return profiles.filter(profile => 
      profile.name?.toLowerCase().includes(query) ||
      profile.display_name?.toLowerCase().includes(query) ||
      profile.location?.toLowerCase().includes(query) ||
      profile.about?.toLowerCase().includes(query) ||
      profile.pubkey?.toLowerCase().includes(query)
    );
  }, [profiles, searchQuery]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Profiles</h1>
      
      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, location, or nostr hex ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
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
            <Card key={profile.pubkey} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <Avatar className="h-16 w-16 flex-shrink-0">
                    <AvatarImage src={getProxiedImageUrl(profile.picture)} />
                    <AvatarFallback>
                      {(profile.display_name || profile.name || 'U').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  
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
