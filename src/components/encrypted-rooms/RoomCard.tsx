import { Lock, Crown, Users, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { EncryptedRoom } from '@/types/encryptedRooms';

interface RoomCardProps {
  room: EncryptedRoom;
  unreadCount?: number;
  lastMessage?: string;
  isPending?: boolean;
  onClick: () => void;
}

export const RoomCard = ({ room, unreadCount = 0, lastMessage, isPending, onClick }: RoomCardProps) => {
  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow border-border/50 ${isPending ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Room avatar */}
          <div className="flex-shrink-0">
            {room.image ? (
              <Avatar className="h-12 w-12">
                <AvatarImage src={room.image} alt={room.name} />
                <AvatarFallback className="bg-violet-500/20 text-violet-600">
                  <Lock className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                <Lock className="h-5 w-5 text-white" />
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
              {isPending ? (
                <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20 text-[10px] px-1.5 py-0.5">
                  <Clock className="h-3 w-3 mr-0.5" />
                  Pending
                </Badge>
              ) : unreadCount > 0 ? (
                <Badge className="bg-violet-500 text-white text-xs px-1.5 py-0.5 min-w-[20px] flex justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{room.members.length} {room.members.length === 1 ? 'member' : 'members'}</span>
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
