import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, MessageSquarePlus } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ScrollArea } from "@/components/ui/scroll-area";

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

interface NewChatDialogProps {
  onSelectUser: (pubkey: string) => void;
}

export default function NewChatDialog({ onSelectUser }: NewChatDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setProfiles([]);
    }
  }, [open]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setProfiles([]);
      return;
    }

    const searchProfiles = async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`${API_URL}/api/functions/list-profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search: searchQuery }),
        });
        const data = await res.json();

        if (data?.profiles) {
          setProfiles(data.profiles.slice(0, 30).map((p: any) => ({
            pubkey: p.pubkey,
            name: p.name,
            display_name: p.display_name,
            picture: p.picture,
            about: p.about,
          })));
        } else {
          setProfiles([]);
        }
      } catch (error) {
        console.error('Error searching profiles:', error);
        setProfiles([]);
      } finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleSelectUser = (pubkey: string) => {
    onSelectUser(pubkey);
    setOpen(false);
  };

  const getDisplayName = (profile: Profile) => {
    return profile.display_name || profile.name || profile.pubkey.slice(0, 12) + '...';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-w-[95vw] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Start New Chat</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden px-6 pb-6">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <ScrollArea className="h-[50vh] max-h-[400px]">
            <div className="pr-4">
              {isSearching ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : searchQuery.length < 2 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Enter at least 2 characters to search</p>
                </div>
              ) : profiles.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-sm">No profiles found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {profiles.map((profile) => (
                    <div
                      key={profile.pubkey}
                      className="p-3 rounded-lg hover:bg-secondary cursor-pointer transition-colors"
                      onClick={() => handleSelectUser(profile.pubkey)}
                    >
                      <div className="flex items-start gap-3">
                        <UserAvatar
                          pubkey={profile.pubkey}
                          picture={profile.picture}
                          name={getDisplayName(profile)}
                          className="h-10 w-10 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <p className="font-semibold truncate text-sm">
                            {getDisplayName(profile)}
                          </p>
                          {profile.name && profile.display_name && (
                            <p className="text-xs text-muted-foreground truncate">
                              @{profile.name}
                            </p>
                          )}
                          {profile.about && (
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {profile.about}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
