import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, MessageSquare, Crown, Image as ImageIcon } from "lucide-react";
import { useNostrTinyRooms } from "@/hooks/useNostrTinyRooms";
import { useNostrTinyRoomPostCounts } from "@/hooks/useNostrTinyRoomPostCounts";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useAuth } from "@/contexts/AuthContext";
import { CreateTinyRoomDialog } from "@/components/social/CreateTinyRoomDialog";

export default function TinyRooms() {
  const { session } = useAuth();
  const { rooms, loading } = useNostrTinyRooms(session?.nostrHexId);
  
  const roomEventIds = rooms.map(r => r.eventId);
  const { postCounts, loading: loadingCounts } = useNostrTinyRoomPostCounts(roomEventIds);

  // Get all unique member pubkeys
  const allMemberPubkeys = Array.from(
    new Set(rooms.flatMap(room => room.members))
  );
  
  const { profiles } = useNostrProfilesCacheBulk(allMemberPubkeys);

  const isOwner = (room: typeof rooms[0]) => {
    return session?.nostrHexId === room.admin;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Tiny Rooms</h2>
          <p className="text-muted-foreground text-sm">Private rooms you're a member of</p>
        </div>
        {session && <CreateTinyRoomDialog />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !session ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Please log in to view your tiny rooms.</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">You're not a member of any tiny rooms yet.</p>
          <p className="text-sm text-muted-foreground mt-2">Create your first room to get started!</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rooms.map((room) => (
            <Card key={room.eventId} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {room.image && <ImageIcon className="h-5 w-5 text-primary" />}
                  <span className="flex-1">{room.name}</span>
                  {isOwner(room) && (
                    <Badge variant="secondary" className="gap-1">
                      <Crown className="h-3 w-3" />
                      Owner
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {room.description && (
                  <p className="text-sm text-muted-foreground">
                    {room.description}
                  </p>
                )}

                {room.topic && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Topic:</span>
                    <p className="text-sm">{room.topic}</p>
                  </div>
                )}

                {room.rules && (
                  <div className="p-3 bg-muted/50 rounded-md">
                    <span className="text-xs font-medium text-muted-foreground">Rules:</span>
                    <p className="text-sm mt-1">{room.rules}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{room.members.length} members</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {room.members.slice(0, 5).map(pubkey => {
                      const profile = profiles.get(pubkey);
                      const displayName = profile?.display_name || profile?.full_name || `${pubkey.slice(0, 8)}...`;
                      const isAdmin = pubkey === room.admin;
                      
                      return (
                        <Badge key={pubkey} variant="outline" className="text-xs">
                          {isAdmin && <Crown className="h-3 w-3 mr-1" />}
                          {displayName}
                        </Badge>
                      );
                    })}
                    {room.members.length > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{room.members.length - 5} more
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 text-sm text-muted-foreground pt-2 border-t">
                  <MessageSquare className="h-4 w-4" />
                  <span>
                    {loadingCounts ? '...' : postCounts[room.eventId] || 0} posts (30d)
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
