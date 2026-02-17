import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UserPlus, Loader2, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { SimplePool, finalizeEvent, nip04 } from 'nostr-tools';
import {
  encryptInvitePayload,
  hexToBytes,
  getRoomKeyFromCache,
  setRoomKeyToCache,
} from '@/lib/encrypted-room-crypto';
import type { RoomInvitePayload, EncryptedRoom } from '@/types/encryptedRooms';
import { toast } from 'sonner';

interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
}

interface InviteMemberDialogProps {
  room: EncryptedRoom;
  groupKey: string;
  onInviteSent?: (newEventId: string) => void;
}

export const InviteMemberDialog = ({
  room,
  groupKey,
  onInviteSent,
}: InviteMemberDialogProps) => {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [selectedPubkey, setSelectedPubkey] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // KIND 0 profile search
  const [searchProfiles, setSearchProfiles] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const relays = parameters?.relays || [];

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setSelectedPubkey('');
      setSelectedName('');
      setMessage('');
      setSearchProfiles([]);
    }
  }, [open]);

  // KIND 0 profile search with debounce
  useEffect(() => {
    if (searchInput.length < 2 || relays.length === 0 || selectedPubkey) {
      setSearchProfiles([]);
      return;
    }

    // If input is a valid 64-char hex pubkey, look up profile by authors filter
    if (/^[0-9a-fA-F]{64}$/.test(searchInput.trim())) {
      const hexLookupFn = async () => {
        setIsSearching(true);
        const pool = new SimplePool();
        try {
          const hexPubkey = searchInput.trim();
          if (hexPubkey === session?.nostrHexId) {
            setSearchProfiles([]);
            return;
          }
          const events = await Promise.race([
            pool.querySync(relays, { kinds: [0], authors: [hexPubkey] }),
            new Promise<any[]>((_, reject) =>
              setTimeout(() => reject(new Error('Lookup timeout')), 8000)
            ),
          ]);
          if (events.length > 0) {
            const content = JSON.parse(events[0].content);
            setSearchProfiles([{
              pubkey: events[0].pubkey,
              name: content.name,
              display_name: content.display_name,
              picture: content.picture,
            }]);
          } else {
            // No profile found — show hex-only entry so user can still select
            setSearchProfiles([{ pubkey: hexPubkey }]);
          }
        } catch (error) {
          console.error('Error looking up hex profile:', error);
          setSearchProfiles([{ pubkey: searchInput.trim() }]);
        } finally {
          setIsSearching(false);
          pool.close(relays);
        }
      };
      const timeoutId = setTimeout(hexLookupFn, 300);
      return () => clearTimeout(timeoutId);
    }

    // Partial hex (20+ chars but not yet 64) — suppress search, show hint
    if (/^[0-9a-fA-F]{20,}$/.test(searchInput.trim())) {
      setSearchProfiles([]);
      return;
    }

    const searchFn = async () => {
      setIsSearching(true);
      const pool = new SimplePool();

      try {
        const events = await Promise.race([
          pool.querySync(relays, { kinds: [0], limit: 1000 }),
          new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Search timeout')), 10000)
          ),
        ]);

        const found: Profile[] = [];
        const query = searchInput.toLowerCase();

        events.forEach((event) => {
          try {
            if (event.pubkey === session?.nostrHexId) return;

            const content = JSON.parse(event.content);
            const nameStr = content.name?.toLowerCase() || '';
            const displayName = content.display_name?.toLowerCase() || '';

            if (nameStr.includes(query) || displayName.includes(query)) {
              found.push({
                pubkey: event.pubkey,
                name: content.name,
                display_name: content.display_name,
                picture: content.picture,
              });
            }
          } catch {
            // Skip malformed events
          }
        });

        setSearchProfiles(found.slice(0, 20));
      } catch (error) {
        console.error('Error searching profiles:', error);
      } finally {
        setIsSearching(false);
        pool.close(relays);
      }
    };

    const timeoutId = setTimeout(searchFn, 400);
    return () => clearTimeout(timeoutId);
  }, [searchInput, relays, selectedPubkey, session?.nostrHexId]);

  const selectProfile = (profile: Profile) => {
    setSelectedPubkey(profile.pubkey);
    setSelectedName(profile.display_name || profile.name || profile.pubkey.slice(0, 12));
    setSearchInput(profile.display_name || profile.name || profile.pubkey.slice(0, 12));
    setSearchProfiles([]);
  };

  const clearSelection = () => {
    setSelectedPubkey('');
    setSelectedName('');
    setSearchInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If a profile result is showing, select it; otherwise accept raw hex
      if (/^[0-9a-fA-F]{64}$/.test(searchInput.trim()) && !selectedPubkey) {
        if (searchProfiles.length > 0) {
          selectProfile(searchProfiles[0]);
        } else {
          setSelectedPubkey(searchInput.trim());
          setSelectedName(searchInput.trim().slice(0, 12) + '...');
        }
      }
    }
  };

  const handleInvite = async () => {
    if (!selectedPubkey || !/^[0-9a-fA-F]{64}$/.test(selectedPubkey)) {
      toast.error('Invalid hex pubkey (must be 64 characters)');
      return;
    }
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error('Login is required');
      return;
    }
    if (selectedPubkey === session.nostrHexId) {
      toast.error("You can't invite yourself");
      return;
    }

    setIsSending(true);

    try {
      const ownerPubkey = session.nostrHexId;
      const privKeyBytes = hexToBytes(session.nostrPrivateKey);

      // ─── Step 1: Republish KIND 30100 with new member's p-tag ───
      // Same pattern as RoomSettingsDialog.handleUpdate()
      const roomTags: string[][] = [
        ['d', room.roomId],
        ['name', room.name],
        ['description', room.description],
        ...room.members.map((m) => ['p', m.pubkey, m.role]),
        ['p', selectedPubkey, 'member'], // Add new member
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
      if (!roomData.success) throw new Error('Failed to publish room update with new member');

      const newEventId = updatedRoomEvent.id;

      // Copy group key cache: old eventId → new eventId
      const oldKey = getRoomKeyFromCache(room.eventId, room.keyVersion);
      if (oldKey) {
        setRoomKeyToCache(newEventId, room.keyVersion, oldKey);
      }

      console.log(`✅ Room updated with new member: ${room.eventId.slice(0, 16)} → ${newEventId.slice(0, 16)}`);

      // ─── Step 2: Create invite referencing the NEW eventId ───
      const invitePayload: RoomInvitePayload = {
        roomId: room.roomId,
        roomEventId: newEventId,
        roomName: room.name,
        groupKey,
        keyVersion: room.keyVersion,
        role: 'member',
        message: message.trim() || `You've been invited to "${room.name}"`,
      };

      const encryptedContent = encryptInvitePayload(
        invitePayload,
        session.nostrPrivateKey,
        selectedPubkey
      );

      const inviteEvent = finalizeEvent(
        {
          kind: 1102,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', newEventId],
            ['p', selectedPubkey, 'receiver'],
            ['p', ownerPubkey, 'sender'],
          ],
          content: encryptedContent,
        },
        privKeyBytes
      );

      const inviteRes = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: inviteEvent }),
      });

      const inviteData = await inviteRes.json();
      if (!inviteData.success) throw new Error('Failed to publish invite');

      // ─── Step 3: Send NIP-04 DM notification ───
      try {
        const dmText = message.trim()
          || `You've been invited to join encrypted room "${room.name}"`;

        console.log('📩 Encrypting DM for invite notification...');
        const encrypted = await nip04.encrypt(
          session.nostrPrivateKey,
          selectedPubkey,
          dmText
        );

        const dmEvent = finalizeEvent(
          {
            kind: 4,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', selectedPubkey]],
            content: encrypted,
          },
          privKeyBytes
        );

        console.log('📤 Publishing KIND 4 DM via server...');
        const dmRes = await fetch('/api/functions/publish-dm-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: dmEvent }),
        });

        const dmData = await dmRes.json();
        console.log(`✅ DM published to ${dmData.publishedTo}/${dmData.totalRelays} relays`);
      } catch (dmError) {
        console.warn('⚠️ DM notification failed (non-blocking):', dmError);
      }

      toast.success('Invite sent!');
      setOpen(false);
      onInviteSent?.(newEventId);
    } catch (error: any) {
      console.error('Error sending invite:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="px-2 sm:px-3">
          <UserPlus className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Invite</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-violet-500" />
            Invite member to "{room.name}"
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* User search / hex pubkey input */}
          <div className="space-y-2">
            <Label>User *</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  // Clear selection if user edits the input
                  if (selectedPubkey) {
                    setSelectedPubkey('');
                    setSelectedName('');
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search by name or paste hex pubkey..."
                className="pl-9"
              />
              {selectedPubkey && (
                <button
                  onClick={clearSelection}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 hover:bg-muted rounded-full p-0.5"
                >
                  <span className="text-[10px] text-muted-foreground mr-1">✓ Selected</span>
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            {(isSearching || searchProfiles.length > 0) && searchInput.length >= 2 && !selectedPubkey && (
              <ScrollArea className="max-h-[200px] border rounded-md">
                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="p-1">
                    {searchProfiles.map((profile) => (
                      <div
                        key={profile.pubkey}
                        className="flex items-center gap-2.5 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => selectProfile(profile)}
                      >
                        <UserAvatar
                          pubkey={profile.pubkey}
                          picture={profile.picture}
                          name={profile.display_name || profile.name}
                          className="h-8 w-8 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {profile.display_name || profile.name || profile.pubkey.slice(0, 12)}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {profile.pubkey.slice(0, 16)}...
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}

            {/* Hex pubkey hint */}
            {searchInput.length > 0 && /^[0-9a-fA-F]+$/.test(searchInput.trim()) && searchInput.trim().length < 64 && !selectedPubkey && (
              <p className="text-[10px] text-muted-foreground">
                Enter full 64-character hex pubkey and press Enter
              </p>
            )}
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="invite-msg">Message (optional)</Label>
            <Textarea
              id="invite-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a personal message..."
              rows={2}
              maxLength={200}
            />
          </div>

          <Button
            onClick={handleInvite}
            disabled={!selectedPubkey || isSending}
            className="w-full bg-violet-500 hover:bg-violet-600 text-white"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Send Invite
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
