import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Loader2, Check, MessageSquare } from "lucide-react";
import { useNostrRooms } from "@/hooks/useNostrRooms";
import { useNostrUserRoomSubscriptions } from "@/hooks/useNostrUserRoomSubscriptions";
import { useNostrRoomPostCounts } from "@/hooks/useNostrRoomPostCounts";
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
