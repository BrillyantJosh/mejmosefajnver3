import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { finalizeEvent, SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";

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
    memberInput: "",
  });

  const handleAddMember = () => {
    const trimmed = formData.memberInput.trim();
    if (trimmed && !formData.members.includes(trimmed)) {
      setFormData(prev => ({
        ...prev,
        members: [...prev.members, trimmed],
        memberInput: "",
      }));
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
      const RELAYS = parameters?.relays || [
        "wss://relay.damus.io",
        "wss://relay.primal.net",
        "wss://nos.lol",
      ];

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

      // Publish to relays
      const pool = new SimplePool();
      const publishPromises = RELAYS.map(relay =>
        pool.publish([relay], signedEvent)
      );

      await Promise.race([
        Promise.all(publishPromises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 10000)
        ),
      ]);

      pool.close(RELAYS);

      toast.success("Tiny room created successfully");
      setOpen(false);
      
      // Reset form
      setFormData({
        roomId: "",
        name: "",
        description: "",
        topic: "",
        rules: "",
        image: "",
        members: [],
        memberInput: "",
      });

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
            <Label htmlFor="roomId">Room ID *</Label>
            <Input
              id="roomId"
              value={formData.roomId}
              onChange={e => setFormData(prev => ({ ...prev, roomId: e.target.value }))}
              placeholder="magic-lounge"
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Unique identifier for this room
            </p>
          </div>

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
            <Label htmlFor="members">Add Members (Pubkeys)</Label>
            <div className="flex gap-2">
              <Input
                id="members"
                value={formData.memberInput}
                onChange={e => setFormData(prev => ({ ...prev, memberInput: e.target.value }))}
                onKeyPress={e => e.key === "Enter" && handleAddMember()}
                placeholder="Paste member pubkey and press Enter"
                disabled={creating}
              />
              <Button type="button" onClick={handleAddMember} disabled={creating} variant="outline">
                Add
              </Button>
            </div>
            {formData.members.length > 0 && (
              <div className="mt-2 space-y-1">
                {formData.members.map(member => (
                  <div key={member} className="flex items-center gap-2 text-sm bg-muted p-2 rounded">
                    <span className="flex-1 truncate">{member}</span>
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
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              You will be automatically added as a member
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
