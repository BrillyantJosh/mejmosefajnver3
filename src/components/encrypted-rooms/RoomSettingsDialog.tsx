import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2, Settings, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { finalizeEvent } from 'nostr-tools';
import {
  hexToBytes,
  getRoomKeyFromCache,
  setRoomKeyToCache,
  removeRoomKeyFromCache,
} from '@/lib/encrypted-room-crypto';
import type { EncryptedRoom } from '@/types/encryptedRooms';
import { toast } from 'sonner';

interface RoomSettingsDialogProps {
  room: EncryptedRoom;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoomUpdated: (newEventId: string) => void;
  onRoomDeleted: () => void;
}

export const RoomSettingsDialog = ({
  room,
  open,
  onOpenChange,
  onRoomUpdated,
  onRoomDeleted,
}: RoomSettingsDialogProps) => {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { session } = useAuth();

  // Reset form when room changes or dialog opens
  useEffect(() => {
    if (open) {
      setName(room.name);
      setDescription(room.description);
    }
  }, [open, room.name, room.description]);

  const hasChanges = name.trim() !== room.name || description.trim() !== room.description;

  const handleUpdate = async () => {
    if (!name.trim()) {
      toast.error('Room name is required');
      return;
    }
    if (!session?.nostrHexId || !session?.nostrPrivateKey) return;

    setIsUpdating(true);
    try {
      const privKeyBytes = hexToBytes(session.nostrPrivateKey);

      // Rebuild KIND 30100 event with same d-tag + all original data
      const roomTags: string[][] = [
        ['d', room.roomId],
        ['name', name.trim()],
        ['description', description.trim()],
        ...room.members.map((m) => ['p', m.pubkey, m.role]),
        ['status', room.status],
        ['key_version', String(room.keyVersion)],
      ];

      if (room.image) {
        roomTags.push(['image', room.image]);
      }

      const updatedEvent = finalizeEvent(
        {
          kind: 30100,
          created_at: Math.floor(Date.now() / 1000),
          tags: roomTags,
          content: JSON.stringify({
            maxMembers: 50,
            created: room.createdAt,
          }),
        },
        privKeyBytes
      );

      const res = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: updatedEvent }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to publish room update');

      // Copy group key cache from old eventId to new eventId
      const oldKey = getRoomKeyFromCache(room.eventId, room.keyVersion);
      if (oldKey) {
        setRoomKeyToCache(updatedEvent.id, room.keyVersion, oldKey);
      }

      console.log(`✅ Room updated: ${room.eventId.slice(0, 16)} → ${updatedEvent.id.slice(0, 16)}`);

      toast.success('Room updated!');
      onOpenChange(false);
      onRoomUpdated(updatedEvent.id);
    } catch (error: any) {
      console.error('Error updating room:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) return;

    setIsUpdating(true);
    try {
      const privKeyBytes = hexToBytes(session.nostrPrivateKey);

      // Republish KIND 30100 with status 'deleted'
      const roomTags: string[][] = [
        ['d', room.roomId],
        ['name', room.name],
        ['description', room.description],
        ...room.members.map((m) => ['p', m.pubkey, m.role]),
        ['status', 'deleted'],
        ['key_version', String(room.keyVersion)],
      ];

      if (room.image) {
        roomTags.push(['image', room.image]);
      }

      const deletedEvent = finalizeEvent(
        {
          kind: 30100,
          created_at: Math.floor(Date.now() / 1000),
          tags: roomTags,
          content: JSON.stringify({
            maxMembers: 50,
            created: room.createdAt,
          }),
        },
        privKeyBytes
      );

      const res = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: deletedEvent }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to delete room');

      // Clean up cached key
      removeRoomKeyFromCache(room.eventId);

      console.log(`🗑️ Room deleted: ${room.eventId.slice(0, 16)}`);

      toast.success('Room deleted');
      onOpenChange(false);
      onRoomDeleted();
    } catch (error: any) {
      console.error('Error deleting room:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-violet-500" />
              Room Settings
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Room name */}
            <div className="space-y-2">
              <Label htmlFor="settings-name">Room name *</Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dev Team"
                maxLength={100}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="settings-desc">Description</Label>
              <Textarea
                id="settings-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short room description..."
                rows={3}
                maxLength={500}
              />
            </div>

            {/* Save button */}
            <Button
              onClick={handleUpdate}
              disabled={!name.trim() || !hasChanges || isUpdating}
              className="w-full bg-violet-500 hover:bg-violet-600 text-white"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>

            <Separator />

            {/* Danger zone */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-destructive">Danger Zone</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isUpdating}
                className="w-full"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Room
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete room?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>"{room.name}"</strong>?
              This will permanently remove the room for all members. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDeleteConfirm(false);
                handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
