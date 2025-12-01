import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2, Check, MessageSquare, Lock, FileText } from "lucide-react";
import { useNostrRooms } from "@/hooks/useNostrRooms";
import { useNostrUserRoomSubscriptions } from "@/hooks/useNostrUserRoomSubscriptions";
import { useNostrRoomPostCounts } from "@/hooks/useNostrRoomPostCounts";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Rooms() {
  const { rooms, loading } = useNostrRooms();
  const { session } = useAuth();
  
  const { 
    isSubscribed, 
    subscribe, 
    unsubscribe, 
    updating 
  } = useNostrUserRoomSubscriptions({
    userPubkey: session?.nostrHexId,
    userPrivateKey: session?.nostrPrivateKey
  });

  const roomSlugs = rooms.map(r => r.slug);
  const { postCounts, loading: loadingCounts } = useNostrRoomPostCounts(roomSlugs);

  // Get all unique publisher pubkeys from all rooms
  const allPublisherPubkeys = Array.from(
    new Set(
      rooms.flatMap(room => room.publishers || [])
    )
  );

  // Fetch profiles for all publishers
  const { profiles } = useNostrProfilesCacheBulk(allPublisherPubkeys);

  const handleSubscriptionToggle = async (roomSlug: string) => {
    if (!session) {
      toast.error("Please log in to subscribe to rooms");
      return;
    }

    const subscribed = isSubscribed(roomSlug);
    const success = subscribed 
      ? await unsubscribe(roomSlug)
      : await subscribe(roomSlug);

    if (success) {
      toast.success(subscribed ? "Unsubscribed from room" : "Subscribed to room");
    } else {
      toast.error("Failed to update subscription");
    }
  };

  return (
    <div className="max-w-4xl mx-auto">

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No rooms available at the moment.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rooms.map((room) => (
            <Card key={room.slug} className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {room.icon ? (
                    <span className="text-2xl">{room.icon}</span>
                  ) : (
                    <Users className="h-5 w-5 text-primary" />
                  )}
                  {room.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {room.description || `Join the ${room.title} community`}
                </p>
                
                {/* Show if room is restricted */}
                {room.publishers && room.publishers.length > 0 && (
                  <div className="mb-4 p-3 bg-muted/50 rounded-md">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Restricted Room</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">Only authorized publishers can post:</p>
                    <div className="flex flex-wrap gap-1">
                      {room.publishers.map(pubkey => {
                        const profile = profiles.get(pubkey);
                        const displayName = profile?.display_name || profile?.full_name || `${pubkey.slice(0, 8)}...`;
                        return (
                          <Badge key={pubkey} variant="secondary" className="text-xs">
                            {displayName}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Show room rules */}
                {room.rules && room.rules.length > 0 && (
                  <div className="mb-4 p-3 bg-muted/50 rounded-md">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Room Rules</span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      {room.rules.map((rule, idx) => (
                        <li key={idx}>{rule}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <MessageSquare className="h-4 w-4" />
                    {loadingCounts ? '...' : postCounts[room.slug] || 0} posts (30d)
                  </span>
                  {session ? (
                    <Button 
                      variant={isSubscribed(room.slug) ? "default" : "outline"} 
                      size="sm"
                      onClick={() => handleSubscriptionToggle(room.slug)}
                      disabled={updating}
                    >
                      {isSubscribed(room.slug) ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Subscribed
                        </>
                      ) : (
                        "Join"
                      )}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Login to Join
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
