import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { MessageSquarePlus, Search, Loader2, X } from "lucide-react";
import { SimplePool } from 'nostr-tools/pool';
import { useAuth } from '@/contexts/AuthContext';
import { getProxiedImageUrl } from "@/lib/imageProxy";

interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

interface NewChatDrawerProps {
  onSelectUser: (pubkey: string) => void;
}

export default function NewChatDrawer({ onSelectUser }: NewChatDrawerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const { session } = useAuth();

  const relays = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
  ];

  // Reset when drawer closes
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setProfiles([]);
    }
  }, [open]);

  // Search profiles
  useEffect(() => {
    if (!searchQuery || !open) {
      setProfiles([]);
      return;
    }

    const searchProfiles = async () => {
      setSearching(true);
      try {
        const pool = new SimplePool();
        const query = searchQuery.toLowerCase();
        
        const events = await pool.querySync(relays, {
          kinds: [0],
          limit: 20
        });

        const foundProfiles = events
          .map(event => {
            try {
              const content = JSON.parse(event.content);
              return {
                pubkey: event.pubkey,
                ...content
              };
            } catch {
              return null;
            }
          })
          .filter((p): p is Profile => {
            if (!p || p.pubkey === session?.nostrHexId) return false;
            const name = p.name?.toLowerCase() || '';
            const displayName = p.display_name?.toLowerCase() || '';
            const about = p.about?.toLowerCase() || '';
            return name.includes(query) || displayName.includes(query) || about.includes(query);
          });

        setProfiles(foundProfiles);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setSearching(false);
      }
    };

    const debounce = setTimeout(searchProfiles, 500);
    return () => clearTimeout(debounce);
  }, [searchQuery, open, session?.nostrHexId]);

  const handleSelectUser = (pubkey: string) => {
    onSelectUser(pubkey);
    setOpen(false);
  };

  const getInitials = (profile: Profile) => {
    if (profile.display_name) {
      const names = profile.display_name.split(' ');
      if (names.length >= 2) {
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return profile.display_name.slice(0, 2).toUpperCase();
    }
    if (profile.name) {
      return profile.name.slice(0, 2).toUpperCase();
    }
    return profile.pubkey.slice(0, 2).toUpperCase();
  };

  const getDisplayName = (profile: Profile) => {
    return profile.display_name || profile.name || profile.pubkey.slice(0, 12) + '...';
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="lg" className="w-full md:w-auto touch-manipulation">
          <MessageSquarePlus className="mr-2 h-5 w-5" />
          New Chat
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              <DrawerTitle>Start New Chat</DrawerTitle>
              <DrawerDescription>Search for a user to message</DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        
        <div className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by name or username..."
              className="pl-10 h-12 text-base touch-manipulation"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <ScrollArea className="h-[50vh]">
            {searching ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : searchQuery && profiles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No users found</p>
                <p className="text-sm mt-1">Try a different search term</p>
              </div>
            ) : !searchQuery ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Start typing to search for users</p>
              </div>
            ) : (
              <div className="space-y-2">
                {profiles.map((profile) => (
                  <button
                    key={profile.pubkey}
                    onClick={() => handleSelectUser(profile.pubkey)}
                    className="w-full p-4 rounded-lg hover:bg-secondary transition-colors text-left touch-manipulation"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12 flex-shrink-0">
                        <AvatarImage 
                          src={getProxiedImageUrl(profile.picture, Date.now())} 
                          alt={getDisplayName(profile)} 
                        />
                        <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
                          {getInitials(profile)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate text-base">
                          {getDisplayName(profile)}
                        </p>
                        {profile.name && (
                          <p className="text-sm text-muted-foreground truncate">
                            @{profile.name}
                          </p>
                        )}
                        {profile.about && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {profile.about}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DrawerFooter className="border-t">
          <DrawerClose asChild>
            <Button variant="outline" size="lg" className="touch-manipulation">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
