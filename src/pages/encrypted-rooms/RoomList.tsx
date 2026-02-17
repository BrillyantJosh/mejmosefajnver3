import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, MessageSquareOff } from 'lucide-react';
import { useEncryptedRooms } from '@/hooks/useEncryptedRooms';
import { useAuth } from '@/contexts/AuthContext';
import { RoomCard } from '@/components/encrypted-rooms/RoomCard';
import { CreateRoomDialog } from '@/components/encrypted-rooms/CreateRoomDialog';

export default function RoomList() {
  const { rooms, isLoading, refetch } = useEncryptedRooms();
  const { session } = useAuth();
  const navigate = useNavigate();
  const userPubkey = session?.nostrHexId;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Lock className="h-5 w-5 sm:h-6 sm:w-6 text-violet-500" />
            Encrypted Rooms
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
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
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              userPubkey={userPubkey}
              onClick={() => navigate(`/encrypted-rooms/room/${room.eventId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
