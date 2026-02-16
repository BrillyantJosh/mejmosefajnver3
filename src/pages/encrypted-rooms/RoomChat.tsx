import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Users, Loader2, ShieldAlert, Settings, Info, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useEncryptedRoomGroupKey } from '@/hooks/useEncryptedRoomGroupKey';
import { useEncryptedRoomMessages } from '@/hooks/useEncryptedRoomMessages';
import { useEncryptedRoomMembers } from '@/hooks/useEncryptedRoomMembers';
import { useEncryptedRooms } from '@/hooks/useEncryptedRooms';
import { RoomMessageBubble } from '@/components/encrypted-rooms/RoomMessageBubble';
import { RoomChatInput } from '@/components/encrypted-rooms/RoomChatInput';
import { RoomMembersList } from '@/components/encrypted-rooms/RoomMembersList';
import { InviteMemberDialog } from '@/components/encrypted-rooms/InviteMemberDialog';
import { RoomSettingsDialog } from '@/components/encrypted-rooms/RoomSettingsDialog';
import { encryptRoomMessage, hexToBytes, getRoomKeyFromCache, setRoomKeyToCache } from '@/lib/encrypted-room-crypto';
import { finalizeEvent } from 'nostr-tools';
import type { RoomMessage, RoomMessageContent } from '@/types/encryptedRooms';
import { useNostrLash } from '@/hooks/useNostrLash';
import { useNostrDMLashes } from '@/hooks/useNostrDMLashes';
import { toast } from 'sonner';

export default function RoomChat() {
  const { roomId: roomEventId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [profileCache, setProfileCache] = useState<Record<string, { name: string; picture?: string; lana_wallet_id?: string }>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optimisticLashes, setOptimisticLashes] = useState<Set<string>>(new Set());

  const userPubkey = session?.nostrHexId || null;
  const userPrivKey = session?.nostrPrivateKey || null;

  // Find room info
  const { rooms } = useEncryptedRooms();
  const room = rooms.find((r) => r.eventId === roomEventId);

  // Get group key — checks localStorage cache first, then auto-fetches from KIND 1102 invites
  const { groupKey, isLoading: keyLoading } = useEncryptedRoomGroupKey(
    roomEventId || null,
    userPubkey,
    userPrivKey,
    room?.keyVersion || 1,
    room?.roomId || null
  );

  // Fetch messages (prefer stable d-tag over eventId for persistence across room updates)
  const { messages, isLoading: messagesLoading, addOptimisticMessage } = useEncryptedRoomMessages(
    roomEventId || null,
    groupKey,
    room?.roomId || null
  );

  // Fetch members
  const { members, refetch: refetchMembers } = useEncryptedRoomMembers(roomEventId || null);

  const isOwner = room?.ownerPubkey === userPubkey;

  // LASH system
  const { giveLash, isSending: isSendingLash } = useNostrLash();
  const messageIds = messages.map((m) => m.id);
  const {
    lashCounts,
    userLashedIds,
    lashers: messageLashers,
  } = useNostrDMLashes(messageIds, session?.nostrHexId);
  const allLashedEventIds = new Set([...userLashedIds, ...optimisticLashes]);

  // Fetch profiles for member names
  useEffect(() => {
    const fetchProfiles = async () => {
      if (members.length === 0) return;
      const pubkeys = members.map((m) => m.pubkey);
      try {
        const res = await fetch('/api/db/nostr_profiles?select=nostr_hex_id,display_name,full_name,picture,lana_wallet_id');
        const data = await res.json();
        if (Array.isArray(data)) {
          const cache: Record<string, { name: string; picture?: string; lana_wallet_id?: string }> = {};
          for (const profile of data) {
            if (pubkeys.includes(profile.nostr_hex_id)) {
              cache[profile.nostr_hex_id] = {
                name: profile.display_name || profile.full_name || profile.nostr_hex_id.slice(0, 12),
                picture: profile.picture,
                lana_wallet_id: profile.lana_wallet_id,
              };
            }
          }
          setProfileCache(cache);
        }
      } catch {
        // Profiles are optional, fail silently
      }
    };
    fetchProfiles();
  }, [members]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Send message handler
  const handleSendMessage = async (text: string) => {
    if (!groupKey || !roomEventId || !userPubkey || !userPrivKey) return;

    const messageContent: RoomMessageContent = {
      text,
      type: 'text',
    };

    // Encrypt with AES-256-GCM
    const encrypted = await encryptRoomMessage(
      JSON.stringify(messageContent),
      groupKey
    );

    const privKeyBytes = hexToBytes(userPrivKey);

    const event = finalizeEvent(
      {
        kind: 1101,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', roomEventId, '', 'root'],
          ['d', room?.roomId || ''],          // stable room identifier (persists across room updates)
          ['key_version', '1'],
        ],
        content: encrypted,
      },
      privKeyBytes
    );

    // Optimistic update
    const optimisticMsg: RoomMessage = {
      id: event.id,
      roomEventId,
      senderPubkey: userPubkey,
      text,
      type: 'text',
      keyVersion: 1,
      createdAt: event.created_at,
    };
    addOptimisticMessage(optimisticMsg);

    // Publish via server
    await fetch('/api/functions/publish-dm-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    });
  };

  // LASH handler
  const handleGiveLash = async (messageId: string, recipientPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error('You must be logged in to give LASH');
      return;
    }

    const recipientWallet = profileCache[recipientPubkey]?.lana_wallet_id;
    if (!recipientWallet) {
      toast.error('Recipient wallet not found');
      return;
    }

    // Optimistic update
    setOptimisticLashes((prev) => new Set([...prev, messageId]));

    const result = await giveLash({
      postId: messageId,
      recipientPubkey,
      recipientWallet,
      memo: 'LASH for room message',
    });

    if (!result.success) {
      // Remove optimistic update on failure
      setOptimisticLashes((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
      toast.error(result.error || 'Failed to send LASH');
    }
  };

  // Remove member handler (owner only)
  const [isRemoving, setIsRemoving] = useState(false);

  const handleRemoveMember = async (targetPubkey: string, displayName: string) => {
    if (!roomEventId || !userPrivKey || !userPubkey || !room) return;

    setIsRemoving(true);
    try {
      const privKeyBytes = hexToBytes(userPrivKey);

      // ─── Step 1: Publish KIND 1105 removal event ───
      const removeEvent = finalizeEvent(
        {
          kind: 1105,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', roomEventId],
            ['d', room.roomId],
            ['p', targetPubkey],
          ],
          content: JSON.stringify({ action: 'remove' }),
        },
        privKeyBytes
      );

      const res = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: removeEvent }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to publish removal event');

      // ─── Step 2: Republish KIND 30100 WITHOUT removed member's p-tag ───
      const roomTags: string[][] = [
        ['d', room.roomId],
        ['name', room.name],
        ['description', room.description],
        ...room.members
          .filter((m) => m.pubkey !== targetPubkey)
          .map((m) => ['p', m.pubkey, m.role]),
        ['status', room.status],
        ['key_version', String(room.keyVersion)],
      ];

      if (room.image) {
        roomTags.push(['image', room.image]);
      }

      const updatedRoomEvent = finalizeEvent(
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

      const roomRes = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: updatedRoomEvent }),
      });

      const roomData = await roomRes.json();
      if (!roomData.success) throw new Error('Failed to publish room update');

      const newEventId = updatedRoomEvent.id;

      // Copy group key cache: old eventId → new eventId
      const oldKey = getRoomKeyFromCache(room.eventId, room.keyVersion);
      if (oldKey) {
        setRoomKeyToCache(newEventId, room.keyVersion, oldKey);
      }

      console.log(`🚫 Member removed, room updated: ${room.eventId.slice(0, 16)} → ${newEventId.slice(0, 16)}`);

      toast.success(`${displayName} has been removed`);

      // Navigate to new eventId (KIND 30100 changed)
      navigate(`/encrypted-rooms/room/${newEventId}`, { replace: true });
    } catch (error: any) {
      console.error('Error removing member:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsRemoving(false);
    }
  };

  // Archive/export handler (owner only)
  const [isExporting, setIsExporting] = useState(false);

  const handleExportRoom = async () => {
    if (!room?.roomId || !roomEventId) return;

    setIsExporting(true);
    try {
      const res = await fetch('/api/functions/fetch-room-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomDTag: room.roomId,
          kinds: [30100, 1101, 1102, 1105],
          limit: 10000,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to fetch room events');

      const exportData = {
        exportedAt: new Date().toISOString(),
        roomId: room.roomId,
        roomName: room.name,
        eventCount: data.events.length,
        events: data.events,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `${room.name.replace(/[^a-zA-Z0-9]/g, '_')}_archive_${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${data.events.length} events`);
    } catch (error: any) {
      console.error('Error exporting room:', error);
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const isLoading = keyLoading || messagesLoading;
  const roomName = room?.name || 'Room';

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-3 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/encrypted-rooms')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Lock className="h-4 w-4 text-violet-500 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm truncate max-w-[200px]">{roomName}</h2>
            {room?.description && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{room.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button (owner only) */}
          {isOwner && room && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleExportRoom}
              disabled={isExporting}
              title="Archive room events"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Settings button (owner only) */}
          {isOwner && room && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}

          {/* Invite button (owner only) */}
          {isOwner && groupKey && room && (
            <InviteMemberDialog
              room={room}
              groupKey={groupKey}
              onInviteSent={(newEventId) => {
                navigate(`/encrypted-rooms/room/${newEventId}`, { replace: true });
              }}
            />
          )}

          {/* Members sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4 mr-1" />
                {members.length}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px]">
              <SheetHeader>
                <SheetTitle>Room Members</SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <RoomMembersList
                  members={members.map((m) => ({
                    ...m,
                    displayName: profileCache[m.pubkey]?.name,
                    picture: profileCache[m.pubkey]?.picture,
                  }))}
                  currentUserPubkey={userPubkey || undefined}
                  isOwner={isOwner}
                  onRemoveMember={handleRemoveMember}
                  isRemoving={isRemoving}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 px-3 py-2">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        )}

        {!isLoading && !room && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Info className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-medium">Room not found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              This room may have been deleted or you no longer have access.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/encrypted-rooms')}
              className="mt-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Rooms
            </Button>
          </div>
        )}

        {!isLoading && room && !groupKey && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="h-10 w-10 text-amber-500 mb-3" />
            <h3 className="font-medium">Unable to access room</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              No invite found for this room. Ask the room owner to send you an invite.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/encrypted-rooms')}
              className="mt-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Rooms
            </Button>
          </div>
        )}

        {!isLoading && groupKey && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Lock className="h-10 w-10 text-violet-500/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No messages yet. Send the first encrypted message!
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isOwn = msg.senderPubkey === userPubkey;
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showSender = !prevMsg || prevMsg.senderPubkey !== msg.senderPubkey;
          const profile = profileCache[msg.senderPubkey];
          const hasLashed = allLashedEventIds.has(msg.id);
          const lashCount = lashCounts.get(msg.id) || 0;
          const lashersForMsg = (messageLashers.get(msg.id) || []).map((l) => ({
            ...l,
            name: profileCache[l.pubkey]?.name,
            picture: profileCache[l.pubkey]?.picture,
          }));

          return (
            <RoomMessageBubble
              key={msg.id}
              message={msg}
              isOwn={isOwn}
              senderName={profile?.name}
              senderPicture={profile?.picture}
              showSender={showSender}
              lashCount={lashCount}
              hasLashed={hasLashed}
              lashers={lashersForMsg}
              onLash={() => handleGiveLash(msg.id, msg.senderPubkey)}
              isLashing={isSendingLash}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <RoomChatInput
        onSend={handleSendMessage}
        disabled={!groupKey}
        placeholder={groupKey ? 'Type a message...' : isLoading ? 'Loading room key...' : 'No access to this room'}
      />

      {/* Room settings dialog (owner only) */}
      {room && isOwner && (
        <RoomSettingsDialog
          room={room}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onRoomUpdated={(newEventId) => {
            navigate(`/encrypted-rooms/room/${newEventId}`, { replace: true });
          }}
          onRoomDeleted={() => {
            navigate('/encrypted-rooms');
          }}
        />
      )}
    </div>
  );
}
