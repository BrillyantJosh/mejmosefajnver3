import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UserPlus, Loader2, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { SimplePool } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools';
import { encryptInvitePayload, hexToBytes } from '@/lib/encrypted-room-crypto';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import type { RoomInvitePayload } from '@/types/encryptedRooms';
import { toast } from 'sonner';

interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
}

interface InviteMemberDialogProps {
  roomEventId: string;
  roomName: string;
  groupKey: string;
  keyVersion: number;
  onInviteSent?: () => void;
}

export const InviteMemberDialog = ({
  roomEventId,
  roomName,
  groupKey,
  keyVersion,
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

    // If input looks like a hex pubkey, don't search
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
      // If input is a valid hex pubkey, select it directly
      if (/^[0-9a-fA-F]{64}$/.test(searchInput.trim()) && !selectedPubkey) {
        setSelectedPubkey(searchInput.trim());
        setSelectedName(searchInput.trim().slice(0, 12) + '...');
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

      const invitePayload: RoomInvitePayload = {
        roomId: '',
        roomEventId,
        roomName,
        groupKey,
        keyVersion,
        role: 'member',
        message: message.trim() || `You've been invited to "${roomName}"`,
      };

      const encryptedContent = encryptInvitePayload(
        invitePayload,
        session.nostrPrivateKey,
        selectedPubkey
      );

      const inviteEvent = finalizeEvent(
        {
          kind: 10102,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', roomEventId],
            ['p', selectedPubkey, 'receiver'],
            ['p', ownerPubkey, 'sender'],
          ],
          content: encryptedContent,
        },
        privKeyBytes
      );

      const res = await fetch('/api/functions/publish-dm-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: inviteEvent }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('Failed to publish invite');

      toast.success('Invite sent!');
      setOpen(false);
      onInviteSent?.();
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
        <Button size="sm" variant="outline">
          <UserPlus className="h-4 w-4 mr-1" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-violet-500" />
            Invite member to "{roomName}"
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
