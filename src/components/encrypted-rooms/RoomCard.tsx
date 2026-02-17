import { Lock, Crown, Shield, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { EncryptedRoom } from '@/types/encryptedRooms';

interface RoomCardProps {
  room: EncryptedRoom;
  userPubkey?: string;
  unreadCount?: number;
  lastMessage?: string;
  onClick: () => void;
}

export const RoomCard = ({ room, userPubkey, unreadCount = 0, lastMessage, onClick }: RoomCardProps) => {
  // Find current user's role in this room
  const myMember = userPubkey ? room.members.find((m) => m.pubkey === userPubkey) : undefined;
  const myRole = myMember?.role;
  return (
    <Card
      className="cursor-pointer hover:shadow-md active:scale-[0.98] transition-all border-border/50"
      onClick={onClick}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-2.5 sm:gap-3">
          {/* Room avatar */}
          <div className="flex-shrink-0">
            {room.image ? (
              <Avatar className="h-10 w-10 sm:h-12 sm:w-12">
                <AvatarImage src={room.image} alt={room.name} />
                <AvatarFallback className="bg-violet-500/20 text-violet-600">
                  <Lock className="h-4 w-4 sm:h-5 sm:w-5" />
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
            )}
          </div>

          {/* Room info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm truncate flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                {room.name}
              </h3>
              {unreadCount > 0 && (
                <Badge className="bg-violet-500 text-white text-xs px-1.5 py-0.5 min-w-[20px] flex justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{room.members.length} {room.members.length === 1 ? 'member' : 'members'}</span>
              {myRole === 'owner' && (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 text-[10px] px-1.5 py-0 ml-1">
                  <Crown className="h-3 w-3 mr-0.5" />
                  Owner
                </Badge>
              )}
              {myRole === 'admin' && (
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 text-[10px] px-1.5 py-0 ml-1">
                  <Shield className="h-3 w-3 mr-0.5" />
                  Admin
                </Badge>
              )}
            </div>

            {lastMessage ? (
              <p className="text-xs text-muted-foreground mt-1.5 truncate">
                {lastMessage}
              </p>
            ) : room.description ? (
              <p className="text-xs text-muted-foreground mt-1.5 truncate">
                {room.description}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
