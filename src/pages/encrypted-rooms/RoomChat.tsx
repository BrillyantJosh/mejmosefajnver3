import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Users, Loader2, ShieldAlert, RefreshCw } from 'lucide-react';
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
import { encryptRoomMessage, hexToBytes } from '@/lib/encrypted-room-crypto';
import { finalizeEvent } from 'nostr-tools';
import type { RoomMessage, RoomMessageContent } from '@/types/encryptedRooms';

export default function RoomChat() {
  const { roomId: roomEventId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [profileCache, setProfileCache] = useState<Record<string, { name: string; picture?: string }>>({});

  const userPubkey = session?.nostrHexId || null;
  const userPrivKey = session?.nostrPrivateKey || null;

  // Find room info
  const { rooms } = useEncryptedRooms();
  const room = rooms.find((r) => r.eventId === roomEventId);

  // Fetch group key (with retry + manual refetch)
  const { groupKey, isLoading: keyLoading, refetch: refetchKey } = useEncryptedRoomGroupKey(
    roomEventId || null,
    userPubkey,
    userPrivKey,
    room?.keyVersion || 1
  );

  // Fetch messages
  const { messages, isLoading: messagesLoading, addOptimisticMessage } = useEncryptedRoomMessages(
    roomEventId || null,
    groupKey
  );

  // Fetch members
  const { members } = useEncryptedRoomMembers(roomEventId || null);

  // Fetch profiles for member names
  useEffect(() => {
    const fetchProfiles = async () => {
      if (members.length === 0) return;
      const pubkeys = members.map((m) => m.pubkey);
      try {
        const res = await fetch('/api/db/nostr_profiles?select=nostr_hex_id,display_name,full_name,picture');
        const data = await res.json();
        if (Array.isArray(data)) {
          const cache: Record<string, { name: string; picture?: string }> = {};
          for (const profile of data) {
            if (pubkeys.includes(profile.nostr_hex_id)) {
              cache[profile.nostr_hex_id] = {
                name: profile.display_name || profile.full_name || profile.nostr_hex_id.slice(0, 12),
                picture: profile.picture,
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
        kind: 10101,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', roomEventId, '', 'root'],
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

  const isLoading = keyLoading || messagesLoading;
  const roomName = room?.name || 'Room';
  const isOwner = room?.ownerPubkey === userPubkey;

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
          <Lock className="h-4 w-4 text-violet-500" />
          <h2 className="font-semibold text-sm truncate max-w-[200px]">{roomName}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Invite button (owner only) */}
          {isOwner && groupKey && roomEventId && (
            <InviteMemberDialog
              roomEventId={roomEventId}
              roomName={roomName}
              groupKey={groupKey}
              keyVersion={room?.keyVersion || 1}
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

        {!isLoading && !groupKey && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="h-10 w-10 text-amber-500 mb-3" />
            <h3 className="font-medium">Key not available</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The encryption key hasn't arrived yet. This can take a few seconds.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={refetchKey}
              className="mt-4"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
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

          return (
            <RoomMessageBubble
              key={msg.id}
              message={msg}
              isOwn={isOwn}
              senderName={profile?.name}
              senderPicture={profile?.picture}
              showSender={showSender}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <RoomChatInput
        onSend={handleSendMessage}
        disabled={!groupKey}
        placeholder={groupKey ? 'Type a message...' : 'Waiting for key...'}
      />
    </div>
  );
}
