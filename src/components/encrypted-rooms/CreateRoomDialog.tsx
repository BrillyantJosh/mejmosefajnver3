import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Loader2, Lock, X, UserPlus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { SimplePool } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';
import {
  generateGroupKey,
  encryptInvitePayload,
  setRoomKeyToCache,
  hexToBytes,
} from '@/lib/encrypted-room-crypto';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import type { RoomInvitePayload } from '@/types/encryptedRooms';
import { toast } from 'sonner';

interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
}

interface SelectedMember {
  pubkey: string;
  name?: string;
  picture?: string;
}

interface CreateRoomDialogProps {
  onRoomCreated?: () => void;
}

export const CreateRoomDialog = ({ onRoomCreated }: CreateRoomDialogProps) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // KIND 0 profile search
  const [searchProfiles, setSearchProfiles] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const relays = parameters?.relays || [];

  // Reset on close
  useEffect(() => {
    if (!open) {
      setMemberInput('');
      setSearchProfiles([]);
    }
  }, [open]);

  // KIND 0 profile search with debounce
  useEffect(() => {
    if (memberInput.length < 2 || relays.length === 0) {
      setSearchProfiles([]);
      return;
    }

    // If input is a valid 64-char hex pubkey, look up profile by authors filter
    if (/^[0-9a-fA-F]{64}$/.test(memberInput.trim())) {
      const existingPubkeys = new Set(selectedMembers.map((m) => m.pubkey));
      const hexLookupFn = async () => {
        setIsSearching(true);
        const pool = new SimplePool();
        try {
          const hexPubkey = memberInput.trim();
          if (hexPubkey === session?.nostrHexId || existingPubkeys.has(hexPubkey)) {
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
          setSearchProfiles([{ pubkey: memberInput.trim() }]);
        } finally {
          setIsSearching(false);
          pool.close(relays);
        }
      };
      const timeoutId = setTimeout(hexLookupFn, 300);
      return () => clearTimeout(timeoutId);
    }

    // Partial hex (20+ chars but not yet 64) — suppress search, show hint
    if (/^[0-9a-fA-F]{20,}$/.test(memberInput.trim())) {
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
        const query = memberInput.toLowerCase();
        const existingPubkeys = new Set(selectedMembers.map((m) => m.pubkey));

        events.forEach((event) => {
          try {
            // Skip self and already added members
            if (event.pubkey === session?.nostrHexId) return;
            if (existingPubkeys.has(event.pubkey)) return;

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
  }, [memberInput, relays, selectedMembers, session?.nostrHexId]);

  const addMemberFromSearch = (profile: Profile) => {
    const displayName = profile.display_name || profile.name || profile.pubkey.slice(0, 12);
    setSelectedMembers((prev) => [
      ...prev,
      { pubkey: profile.pubkey, name: displayName, picture: profile.picture },
    ]);
    setMemberInput('');
    setSearchProfiles([]);
  };

  const addMemberByHex = () => {
    const pubkey = memberInput.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      toast.error('Invalid hex pubkey (must be 64 characters)');
      return;
    }
    if (pubkey === session?.nostrHexId) {
      toast.error("You can't add yourself");
      return;
    }
    if (selectedMembers.some((m) => m.pubkey === pubkey)) {
      toast.error('User already added');
      return;
    }
    setSelectedMembers((prev) => [...prev, { pubkey }]);
    setMemberInput('');
    setSearchProfiles([]);
  };

  const removeMember = (pubkey: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.pubkey !== pubkey));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If a profile result is showing, add it; otherwise add raw hex
      if (/^[0-9a-fA-F]{64}$/.test(memberInput.trim())) {
        if (searchProfiles.length > 0) {
          addMemberFromSearch(searchProfiles[0]);
        } else {
          addMemberByHex();
        }
      }
    }
  };

  const getInitials = (member: SelectedMember) => {
    if (member.name) return member.name.slice(0, 2).toUpperCase();
    return member.pubkey.slice(0, 2).toUpperCase();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Room name is required');
      return;
    }
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error('Login is required');
      return;
    }

    setIsCreating(true);

    try {
      const roomUuid = uuidv4();
      const roomDTag = `room:${roomUuid}`;
      const ownerPubkey = session.nostrHexId;
      const privKeyBytes = hexToBytes(session.nostrPrivateKey);
      const memberPubkeys = selectedMembers.map((m) => m.pubkey);

      // 1. Generate group key
      const groupKey = generateGroupKey();
      console.log('🔑 Generated group key:', groupKey.slice(0, 16) + '...');

      // 2. Invite targets (owner doesn't need invite — key is cached at creation)
      const inviteTargets = memberPubkeys;

      // 3. Create KIND 30100 room event (parameterized replaceable)
      const roomTags: string[][] = [
        ['d', roomDTag],
        ['name', name.trim()],
        ['description', description.trim()],
        ['p', ownerPubkey, 'owner'],
        ...memberPubkeys.map((pk) => ['p', pk, 'member']),
        ['status', 'active'],
        ['key_version', '1'],
      ];

      const roomEvent = finalizeEvent(
        {
          kind: 30100,
          created_at: Math.floor(Date.now() / 1000),
          tags: roomTags,
          content: JSON.stringify({
            maxMembers: 50,
            created: Math.floor(Date.now() / 1000),
          }),
        },
        privKeyBytes
      );

      console.log('📝 Room event created:', roomEvent.id.slice(0, 16));

      // 4. Publish room event
      const publishRes = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: roomEvent }),
      });

      const publishData = await publishRes.json();
      if (!publishData.success) {
        throw new Error('Failed to publish room event');
      }

      console.log(`✅ Room published to ${publishData.publishedTo} relays`);

      // 5. Create and publish invite events for each invited member
      // KIND 1102 (regular, non-replaceable) — NOT 10102 which is replaceable!
      for (let i = 0; i < inviteTargets.length; i++) {
        const memberPubkey = inviteTargets[i];

        const invitePayload: RoomInvitePayload = {
          roomId: roomDTag,
          roomEventId: roomEvent.id,
          roomName: name.trim(),
          groupKey,
          keyVersion: 1,
          role: 'member',
          message: `You've been invited to "${name.trim()}"`,
        };

        const encryptedContent = encryptInvitePayload(
          invitePayload,
          session.nostrPrivateKey,
          memberPubkey
        );

        const inviteEvent = finalizeEvent(
          {
            kind: 1102,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['e', roomEvent.id],
              ['p', memberPubkey, 'receiver'],
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
        if (!inviteData.success) {
          console.warn(`⚠️ Failed to publish invite to ${memberPubkey.slice(0, 16)}`);
        }

        console.log(`📨 Invite sent to ${memberPubkey.slice(0, 16)} (${inviteData.publishedTo || 0} relays)`);

        // Delay between invites to avoid relay rate limiting
        if (i < inviteTargets.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // 6. Cache group key locally for owner
      setRoomKeyToCache(roomEvent.id, 1, groupKey);

      toast.success(`Room "${name.trim()}" created!`);
      setOpen(false);
      setName('');
      setDescription('');
      setSelectedMembers([]);
      onRoomCreated?.();
    } catch (error: any) {
      console.error('Error creating room:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-violet-500 hover:bg-violet-600 text-white">
          <Plus className="h-4 w-4 mr-1" />
          Create Room
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-violet-500" />
            New Encrypted Room
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Room name */}
          <div className="space-y-2">
            <Label htmlFor="room-name">Room name *</Label>
            <Input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dev Team"
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="room-desc">Description (optional)</Label>
            <Textarea
              id="room-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short room description..."
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Add members - search by name or hex pubkey */}
          <div className="space-y-2">
            <Label>Members</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={memberInput}
                onChange={(e) => setMemberInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by name or paste hex pubkey..."
                className="pl-9"
              />
            </div>

            {/* Search results dropdown */}
            {(isSearching || searchProfiles.length > 0) && memberInput.length >= 2 && (
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
                        onClick={() => addMemberFromSearch(profile)}
                      >
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarImage
                            src={getProxiedImageUrl(profile.picture, Date.now())}
                            alt={profile.display_name || profile.name}
                          />
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
                            {(profile.display_name || profile.name || profile.pubkey).slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
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
            {memberInput.length > 0 && /^[0-9a-fA-F]+$/.test(memberInput.trim()) && memberInput.trim().length < 64 && (
              <p className="text-[10px] text-muted-foreground">
                Enter full 64-character hex pubkey and press Enter
              </p>
            )}

            {/* Selected members list */}
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedMembers.map((member) => (
                  <Badge
                    key={member.pubkey}
                    variant="secondary"
                    className="text-xs pl-1 pr-1 py-1 flex items-center gap-1"
                  >
                    <Avatar className="h-4 w-4">
                      {member.picture ? (
                        <AvatarImage src={getProxiedImageUrl(member.picture, Date.now())} />
                      ) : null}
                      <AvatarFallback className="text-[8px]">{getInitials(member)}</AvatarFallback>
                    </Avatar>
                    <span className="max-w-[80px] truncate">
                      {member.name || `${member.pubkey.slice(0, 8)}...`}
                    </span>
                    <button
                      onClick={() => removeMember(member.pubkey)}
                      className="hover:bg-muted rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Create button */}
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className="w-full bg-violet-500 hover:bg-violet-600 text-white"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                Create Encrypted Room
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
