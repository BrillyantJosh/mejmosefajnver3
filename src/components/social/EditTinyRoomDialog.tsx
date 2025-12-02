import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Search, UserPlus, Archive } from "lucide-react";
import { toast } from "sonner";
import { finalizeEvent, SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { supabase } from "@/integrations/supabase/client";
import type { TinyRoom } from "@/hooks/useNostrTinyRooms";

interface EditTinyRoomDialogProps {
  room: TinyRoom;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditTinyRoomDialog({ room, open, onOpenChange }: EditTinyRoomDialogProps) {
  const [updating, setUpdating] = useState(false);
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const [formData, setFormData] = useState({
    name: room.name,
    description: room.description,
    topic: room.topic || "",
    rules: room.rules || "",
    image: room.image || "",
    members: room.members,
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

  // Reset form when room changes
  useEffect(() => {
    setFormData({
      name: room.name,
      description: room.description,
      topic: room.topic || "",
      rules: room.rules || "",
      image: room.image || "",
      members: room.members,
    });
  }, [room]);

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
    // Don't allow removing the admin
    if (pubkey === room.admin) {
      toast.error("Cannot remove the room admin");
      return;
    }
    
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter(m => m !== pubkey),
    }));
  };

  const handleUpdate = async (newStatus?: "archived") => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error("You must be logged in");
      return;
    }

    if (!formData.name.trim()) {
      toast.error("Room name is required");
      return;
    }

    setUpdating(true);

    try {
      const RELAYS = parameters?.relays || [
        "wss://relay.damus.io",
        "wss://relay.primal.net",
        "wss://nos.lol",
      ];

      // Build tags
      const tags: string[][] = [
        ["d", room.slug],
        ["name", formData.name.trim()],
        ["admin", room.admin],
        ["status", newStatus || room.status || "active"],
      ];

      // Add members
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

      console.log('Updating KIND 30150 to relays:', RELAYS);
      console.log('Event:', signedEvent);

      // Publish to relays
      const pool = new SimplePool();
      const publishPromises = pool.publish(RELAYS, signedEvent);
      
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

      toast.success(newStatus === "archived" ? "Room archived successfully" : "Room updated successfully");
      onOpenChange(false);
      
      // Refresh page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error("Error updating room:", error);
      toast.error("Failed to update room");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Tiny Room</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <Label htmlFor="name">Room Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              disabled={updating}
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              disabled={updating}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={formData.topic}
              onChange={e => setFormData(prev => ({ ...prev, topic: e.target.value }))}
              disabled={updating}
            />
          </div>

          <div>
            <Label htmlFor="rules">Rules</Label>
            <Textarea
              id="rules"
              value={formData.rules}
              onChange={e => setFormData(prev => ({ ...prev, rules: e.target.value }))}
              disabled={updating}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="image">Cover Image URL</Label>
            <Input
              id="image"
              value={formData.image}
              onChange={e => setFormData(prev => ({ ...prev, image: e.target.value }))}
              disabled={updating}
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
                disabled={updating}
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
                  const isAdded = formData.members.includes(profile.nostr_hex_id);
                  
                  return (
                    <button
                      key={profile.nostr_hex_id}
                      type="button"
                      onClick={() => !isAdded && handleAddMember(profile.nostr_hex_id)}
                      disabled={updating || isAdded}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {profile.picture ? (
                        <img src={profile.picture} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-xs font-medium">{(profile.display_name || profile.full_name || "?").charAt(0).toUpperCase()}</span>
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
                <p className="text-sm font-medium mb-2">Members ({formData.members.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {formData.members.map(member => {
                    const cachedProfile = memberProfiles.get(member);
                    const displayName = cachedProfile?.display_name || cachedProfile?.full_name || `${member.slice(0, 8)}...`;
                    const isAdmin = member === room.admin;
                    
                    return (
                      <div key={member} className="flex items-center gap-2 text-sm bg-muted p-2 rounded">
                        {cachedProfile?.picture && (
                          <img src={cachedProfile.picture} alt="" className="w-6 h-6 rounded-full object-cover" />
                        )}
                        <span className="flex-1 truncate">{displayName}</span>
                        {isAdmin && (
                          <Badge variant="outline" className="text-xs">Admin</Badge>
                        )}
                        {!isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member)}
                            disabled={updating}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between gap-2 mt-6">
          <Button 
            variant="outline" 
            onClick={() => handleUpdate("archived")} 
            disabled={updating || room.status === "archived"}
            className="gap-2"
          >
            <Archive className="h-4 w-4" />
            Archive Room
          </Button>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updating}>
              Cancel
            </Button>
            <Button onClick={() => handleUpdate()} disabled={updating}>
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
