import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, MessageSquareOff } from 'lucide-react';
import { useEncryptedRooms } from '@/hooks/useEncryptedRooms';
import { RoomCard } from '@/components/encrypted-rooms/RoomCard';
import { CreateRoomDialog } from '@/components/encrypted-rooms/CreateRoomDialog';
import { getRoomKeyFromCache } from '@/lib/encrypted-room-crypto';
import type { EncryptedRoom } from '@/types/encryptedRooms';
import { toast } from 'sonner';

export default function RoomList() {
  const { rooms, isLoading, refetch } = useEncryptedRooms();
  const navigate = useNavigate();

  const handleRoomClick = (room: EncryptedRoom) => {
    const cachedKey = getRoomKeyFromCache(room.eventId, room.keyVersion);
    if (!cachedKey) {
      toast.info('Accept the invite first', {
        description: `Go to Invites to accept "${room.name}"`,
      });
      navigate('/encrypted-rooms/invites');
      return;
    }
    navigate(`/encrypted-rooms/room/${room.eventId}`);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-violet-500" />
            Encrypted Rooms
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            End-to-end encrypted group conversations
          </p>
        </div>
        <CreateRoomDialog onRoomCreated={refetch} />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && rooms.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
            <MessageSquareOff className="h-8 w-8 text-violet-500" />
          </div>
          <h3 className="text-lg font-medium">No rooms yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Create your first encrypted room or wait for an invite from another user.
          </p>
        </div>
      )}

      {/* Room grid */}
      {!isLoading && rooms.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rooms.map((room) => {
            const isPending = !getRoomKeyFromCache(room.eventId, room.keyVersion);
            return (
              <RoomCard
                key={room.id}
                room={room}
                isPending={isPending}
                onClick={() => handleRoomClick(room)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
