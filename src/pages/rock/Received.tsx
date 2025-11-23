import { useNostrRockReceived } from "@/hooks/useNostrRockReceived";
import { useNostrSellerProfiles } from "@/hooks/useNostrSellerProfiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RockCheck } from "@/components/rock/RockCheck";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

const familiarityLabels = {
  real_life: 'Real Life',
  virtual: 'Virtual',
  limited: 'Limited'
};

const relationLabels: Record<string, string> = {
  friend: 'Friend',
  family: 'Family',
  colleague: 'Colleague',
  business_partner: 'Business Partner',
  community: 'Community',
  mentor: 'Mentor',
  student: 'Student',
  neighbor: 'Neighbor',
  acquaintance: 'Acquaintance',
  romantic: 'Romantic',
  trust: 'Trust',
  other: 'Other'
};

export default function Received() {
  const { references, isLoading } = useNostrRockReceived();
  
  const giverPubkeys = useMemo(
    () => references.map(ref => ref.pubkey),
    [references]
  );
  
  const { profiles, isLoading: profilesLoading } = useNostrSellerProfiles(giverPubkeys);

  if (isLoading || profilesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (references.length === 0) {
    return (
      <div className="text-center py-12">
        <RockCheck size={64} showText={false} className="mx-auto mb-4 opacity-50" />
        <p className="text-muted-foreground">You haven't received any endorsements yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {references.map((reference) => {
        const profile = profiles.get(reference.pubkey);
        const displayName = profile?.display_name || profile?.name || `${reference.pubkey.slice(0, 8)}...`;
        
        return (
          <Card key={reference.id}>
            <CardHeader>
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={profile?.picture} alt={displayName} />
                  <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <CardTitle className="text-lg">{displayName}</CardTitle>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {familiarityLabels[reference.familiarity]}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {relationLabels[reference.relation] || reference.relation}
                    </Badge>
                  </div>
                </div>
                <RockCheck size={24} showText={false} className="text-green-600" />
              </div>
            </CardHeader>
            {reference.content && (
              <CardContent>
                <p className="text-sm text-muted-foreground">{reference.content}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(reference.createdAt * 1000).toLocaleDateString()}
                </p>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
