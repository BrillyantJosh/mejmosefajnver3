import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Check, X, Loader2, Lock, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuth } from '@/contexts/AuthContext';
import { useEncryptedRoomInvites } from '@/hooks/useEncryptedRoomInvites';
import { setRoomKeyToCache, hexToBytes } from '@/lib/encrypted-room-crypto';
import { finalizeEvent } from 'nostr-tools';
import type { RoomInvite } from '@/types/encryptedRooms';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

export default function Invites() {
  const { invites, isLoading, refetch } = useEncryptedRoomInvites();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [responding, setResponding] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<RoomInvite | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleRespond = async (invite: RoomInvite, accept: boolean) => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) return;

    setResponding(invite.id);

    try {
      const privKeyBytes = hexToBytes(session.nostrPrivateKey);

      // Create KIND 10103 response event
      const responseEvent = finalizeEvent(
        {
          kind: 10103,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', invite.id],
            ['e', invite.roomEventId],
            ['p', invite.inviterPubkey],
            ['response', accept ? 'accept' : 'reject'],
          ],
          content: '',
        },
        privKeyBytes
      );

      // Publish response
      const res = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: responseEvent }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to publish response');

      if (accept) {
        // Cache the group key
        setRoomKeyToCache(invite.roomEventId, invite.keyVersion, invite.groupKey);
        toast.success(`You joined room "${invite.roomName}"`);
        // Navigate to room
        navigate(`/encrypted-rooms/room/${invite.roomEventId}`);
      } else {
        toast.info('Invite declined');
      }

      refetch();
    } catch (error: any) {
      console.error('Error responding to invite:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setResponding(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-violet-500" />
            Invites
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pending invites to encrypted rooms
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && invites.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
            <Inbox className="h-8 w-8 text-violet-500" />
          </div>
          <h3 className="text-lg font-medium">No pending invites</h3>
          <p className="text-sm text-muted-foreground mt-1">
            When someone invites you to a room, the invite will appear here.
          </p>
        </div>
      )}

      {/* Invite list */}
      <div className="space-y-3">
        {invites.map((invite) => {
          const isResponding = responding === invite.id;
          const timeStr = formatDistanceToNow(new Date(invite.createdAt * 1000), {
            addSuffix: true,
          });

          return (
            <Card key={invite.id} className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
                    <Lock className="h-4 w-4 text-white" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm">{invite.roomName}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Invited by: {invite.inviterPubkey.slice(0, 12)}... &bull; {timeStr}
                    </p>
                    {invite.message && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        "{invite.message}"
                      </p>
                    )}

                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => handleRespond(invite, true)}
                        disabled={isResponding}
                        className="bg-violet-500 hover:bg-violet-600 text-white"
                      >
                        {isResponding ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Check className="h-3.5 w-3.5 mr-1" />
                        )}
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeclineTarget(invite)}
                        disabled={isResponding}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Decline
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Decline confirmation dialog */}
      <AlertDialog open={!!declineTarget} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline invite?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to decline the invite to <strong>"{declineTarget?.roomName}"</strong>?
              This action cannot be undone — you will need a new invite to join this room.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (declineTarget) {
                  handleRespond(declineTarget, false);
                  setDeclineTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Decline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
