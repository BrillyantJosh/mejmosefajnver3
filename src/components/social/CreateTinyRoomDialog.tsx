import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, X, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { finalizeEvent, SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { supabase } from "@/integrations/supabase/client";

export function CreateTinyRoomDialog() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const [formData, setFormData] = useState({
    roomId: "",
    name: "",
    description: "",
    topic: "",
    rules: "",
    image: "",
    members: [] as string[],
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{
    nostr_hex_id: string;
    display_name: string | null;
    full_name: string | null;
    picture: string | null;
  }>>([]);
  const [searching, setSearching] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, {
    display_name: string | null;
    full_name: string | null;
    picture: string | null;
  }>>(new Map());

  // Auto-generate room ID on mount
  useEffect(() => {
    const generateRoomId = () => {
      const timestamp = Date.now().toString(36);
      const randomStr = Math.random().toString(36).substring(2, 7);
      return `${timestamp}-${randomStr}`;
    };
    
    setFormData(prev => ({ ...prev, roomId: generateRoomId() }));
  }, []);

  // Search for profiles
  useEffect(() => {
    const searchProfiles = async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const { data, error } = await supabase
          .from('nostr_profiles')
          .select('nostr_hex_id, display_name, full_name, picture')
          .or(`display_name.ilike.%${searchQuery}%,full_name.ilike.%${searchQuery}%`)
          .limit(10);

        if (error) throw error;
        setSearchResults(data || []);
      } catch (error) {
        console.error('Error searching profiles:', error);
      } finally {
        setSearching(false);
      }
    };

    const debounce = setTimeout(searchProfiles, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleAddMember = (pubkey: string) => {
    if (!formData.members.includes(pubkey)) {
      setFormData(prev => ({
        ...prev,
        members: [...prev.members, pubkey],
      }));
      
      // Cache profile data for added member
      const profile = searchResults.find(p => p.nostr_hex_id === pubkey);
      if (profile) {
        setMemberProfiles(prev => new Map(prev).set(pubkey, {
          display_name: profile.display_name,
          full_name: profile.full_name,
          picture: profile.picture,
        }));
      }
      
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  const handleRemoveMember = (pubkey: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter(m => m !== pubkey),
    }));
  };

  const handleCreate = async () => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error("You must be logged in to create a room");
      return;
    }

    if (!formData.roomId.trim() || !formData.name.trim()) {
      toast.error("Room ID and Name are required");
      return;
    }

    setCreating(true);

    try {
      if (!parameters?.relays || parameters.relays.length === 0) {
        toast.error("Relays not loaded. Please refresh the page.");
        return;
      }

      const RELAYS = parameters.relays;
      console.log('Using relays from parameters:', RELAYS);

      // Build tags
      const tags: string[][] = [
        ["d", `room:${formData.roomId.trim()}`],
        ["name", formData.name.trim()],
        ["admin", session.nostrHexId],
      ];

      // Add creator as first member
      tags.push(["p", session.nostrHexId]);

      // Add additional members
      formData.members.forEach(member => {
        tags.push(["p", member]);
      });

      if (formData.topic.trim()) {
        tags.push(["topic", formData.topic.trim()]);
      }

      if (formData.rules.trim()) {
        tags.push(["rules", formData.rules.trim()]);
      }

      if (formData.image.trim()) {
        tags.push(["image", formData.image.trim()]);
      }

      // Create event
      const eventTemplate = {
        kind: 30150,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: formData.description.trim(),
      };

      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      const signedEvent = finalizeEvent(eventTemplate, privKeyBytes);

      console.log('Publishing KIND 30150 to relays:', RELAYS);
      console.log('Event:', signedEvent);

      // Publish to relays - same approach as CreatePost
      const pool = new SimplePool();
      const publishPromises = pool.publish(RELAYS, signedEvent);
      
      // Create array from promises for tracking
      const publishArray = Array.from(publishPromises);
      let successCount = 0;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            reject(new Error('Publish timeout - no relays responded'));
          } else {
            resolve();
          }
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              console.log(`✅ Published to relay (${successCount})`);
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(err => {
              console.error('❌ Failed to publish to relay:', err);
            });
        });
      });

      pool.close(RELAYS);

      toast.success("Tiny room created successfully");
      setOpen(false);
      
      // Reset form
      const newRoomId = (() => {
        const timestamp = Date.now().toString(36);
        const randomStr = Math.random().toString(36).substring(2, 7);
        return `${timestamp}-${randomStr}`;
      })();
      
      setFormData({
        roomId: newRoomId,
        name: "",
        description: "",
        topic: "",
        rules: "",
        image: "",
        members: [],
      });
      setSearchQuery("");
      setSearchResults([]);
      setMemberProfiles(new Map());

      // Refresh page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error("Error creating tiny room:", error);
      toast.error("Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Tiny Room
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Tiny Room</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <Label htmlFor="name">Room Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Magic Lounge"
              disabled={creating}
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="A private room for aligned conversations."
              disabled={creating}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={formData.topic}
              onChange={e => setFormData(prev => ({ ...prev, topic: e.target.value }))}
              placeholder="Alignment & Creation"
              disabled={creating}
            />
          </div>

          <div>
            <Label htmlFor="rules">Rules</Label>
            <Textarea
              id="rules"
              value={formData.rules}
              onChange={e => setFormData(prev => ({ ...prev, rules: e.target.value }))}
              placeholder="Open heart. Zero judgement."
              disabled={creating}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="image">Cover Image URL</Label>
            <Input
              id="image"
              value={formData.image}
              onChange={e => setFormData(prev => ({ ...prev, image: e.target.value }))}
              placeholder="https://example.com/cover.jpg"
              disabled={creating}
            />
          </div>

          <div>
            <Label htmlFor="searchMembers">Search & Add Members</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="searchMembers"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name..."
                disabled={creating}
                className="pl-9"
              />
            </div>
            
            {searching && (
              <div className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto border rounded-md">
                {searchResults.map(profile => {
                  const displayName = profile.display_name || profile.full_name || `${profile.nostr_hex_id.slice(0, 8)}...`;
                  const isAdded = formData.members.includes(profile.nostr_hex_id);
                  
                  return (
                    <button
                      key={profile.nostr_hex_id}
                      type="button"
                      onClick={() => !isAdded && handleAddMember(profile.nostr_hex_id)}
                      disabled={creating || isAdded}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {profile.picture ? (
                        <img src={profile.picture} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-xs font-medium">{displayName.charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                  <div className="flex-1 text-left">
                        <p className="text-sm font-medium">{profile.display_name || `${profile.nostr_hex_id.slice(0, 8)}...`}</p>
                        {profile.full_name && <p className="text-xs text-muted-foreground">{profile.full_name}</p>}
                      </div>
                      {isAdded ? (
                        <Badge variant="secondary" className="text-xs">Added</Badge>
                      ) : (
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {formData.members.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium mb-2">Selected Members ({formData.members.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {formData.members.map(member => {
                    const cachedProfile = memberProfiles.get(member);
                    const displayName = cachedProfile?.display_name || cachedProfile?.full_name || `${member.slice(0, 8)}...`;
                    
                    return (
                      <div key={member} className="flex items-center gap-2 text-sm bg-muted p-2 rounded">
                        {cachedProfile?.picture && (
                          <img src={cachedProfile.picture} alt="" className="w-6 h-6 rounded-full object-cover" />
                        )}
                        <span className="flex-1 truncate">{displayName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveMember(member)}
                          disabled={creating}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground mt-2">
              You will be automatically added as a member and owner
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
