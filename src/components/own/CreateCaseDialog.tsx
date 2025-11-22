import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, User, X, Loader2 } from "lucide-react";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

// Helper function to convert hex string to Uint8Array
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

const createCaseSchema = z.object({
  content: z.string()
    .trim()
    .min(10, { message: "Reason must be at least 10 characters" })
    .max(1000, { message: "Reason must be less than 1000 characters" }),
  lang: z.string().min(2).max(2, { message: "Language code must be 2 characters" }),
});

type CreateCaseFormData = z.infer<typeof createCaseSchema>;

interface SelectedParticipant {
  pubkey: string;
  name: string;
  picture?: string;
}

export default function CreateCaseDialog() {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<SelectedParticipant[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [formData, setFormData] = useState<CreateCaseFormData>({
    content: "",
    lang: "sl",
  });

  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const { toast } = useToast();

  const filteredProfiles = profiles.filter(
    (profile) =>
      (profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.pubkey?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      !selectedParticipants.some(p => p.pubkey === profile.pubkey)
  );

  const addParticipant = (profile: any) => {
    setSelectedParticipants(prev => [...prev, {
      pubkey: profile.pubkey,
      name: profile.display_name || profile.name || profile.pubkey.slice(0, 8),
      picture: profile.picture,
    }]);
    setSearchTerm("");
  };

  const removeParticipant = (pubkey: string) => {
    setSelectedParticipants(prev => prev.filter(p => p.pubkey !== pubkey));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate form data
    const validation = createCaseSchema.safeParse(formData);
    if (!validation.success) {
      const newErrors: Record<string, string> = {};
      validation.error.errors.forEach(err => {
        if (err.path[0]) {
          newErrors[err.path[0].toString()] = err.message;
        }
      });
      setErrors(newErrors);
      return;
    }

    // Validate participants
    if (selectedParticipants.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please add at least one participant",
      });
      return;
    }

    if (!session?.nostrPrivateKey || !parameters?.relays) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Missing session or relay configuration",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const pool = new SimplePool();
      const relays = parameters.relays;

      // Build tags
      const tags: string[][] = [
        ["status", "opened"],
        ["lang", validation.data.lang],
        ...selectedParticipants.map(p => ["p", p.pubkey]),
      ];

      // Create and sign event
      const privateKeyBytes = hexToBytes(session.nostrPrivateKey);
      const event = finalizeEvent({
        kind: 87044,
        tags,
        content: validation.data.content.trim(),
        created_at: Math.floor(Date.now() / 1000),
      }, privateKeyBytes);

      // Publish to relays
      const publishPromises = pool.publish(relays, event);
      
      // Wait for at least one relay to accept
      const results = [];
      for await (const relay of publishPromises) {
        results.push(relay);
        // Break after first successful publish
        break;
      }
      
      if (results.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      toast({
        title: "Success",
        description: "OWN case created successfully",
      });

      // Reset form
      setFormData({
        content: "",
        lang: "sl",
      });
      setSelectedParticipants([]);
      setOpen(false);

      // Reload page to show new case
      window.location.reload();
    } catch (error) {
      console.error("Error creating case:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create case. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      content: "",
      lang: "sl",
    });
    setSelectedParticipants([]);
    setSearchTerm("");
    setErrors({});
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) resetForm();
    }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create New Case
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New OWN Case</DialogTitle>
          <DialogDescription>
            Start a new self-responsibility process with participants
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="content">
              Reason for Process <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="content"
              placeholder="E.g., Clarifying responsibility around a shared task..."
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              className="min-h-[100px]"
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content}</p>
            )}
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label htmlFor="lang">
              Language <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formData.lang}
              onValueChange={(value) => setFormData(prev => ({ ...prev, lang: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English (EN)</SelectItem>
                <SelectItem value="sl">Slovenian (SL)</SelectItem>
                <SelectItem value="de">German (DE)</SelectItem>
                <SelectItem value="es">Spanish (ES)</SelectItem>
                <SelectItem value="fr">French (FR)</SelectItem>
                <SelectItem value="it">Italian (IT)</SelectItem>
              </SelectContent>
            </Select>
            {errors.lang && (
              <p className="text-sm text-destructive">{errors.lang}</p>
            )}
          </div>

          {/* Participants */}
          <div className="space-y-2">
            <Label>
              Participants <span className="text-destructive">*</span>
            </Label>
            
            {/* Selected Participants */}
            {selectedParticipants.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedParticipants.map((participant) => (
                  <Badge key={participant.pubkey} variant="secondary" className="gap-2 pr-1">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={getProxiedImageUrl(participant.picture)} />
                      <AvatarFallback className="text-xs">
                        {participant.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span>{participant.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 hover:bg-transparent"
                      onClick={() => removeParticipant(participant.pubkey)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search profiles by name or pubkey..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Search Results */}
            {searchTerm && (
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {profilesLoading ? (
                  <div className="space-y-2 p-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1">
                          <Skeleton className="h-4 w-32 mb-1" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredProfiles.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    No profiles found
                  </p>
                ) : (
                  <div className="p-1">
                    {filteredProfiles.slice(0, 10).map((profile) => (
                      <div
                        key={profile.pubkey}
                        onClick={() => addParticipant(profile)}
                        className="flex items-start gap-3 p-3 rounded-md cursor-pointer hover:bg-muted transition-colors"
                      >
                        <Avatar className="h-10 w-10 flex-shrink-0">
                          <AvatarImage src={getProxiedImageUrl(profile.picture)} />
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {profile.display_name || profile.name || "Anonymous"}
                          </p>
                          {profile.name && profile.display_name && profile.name !== profile.display_name && (
                            <p className="text-xs text-muted-foreground truncate">
                              @{profile.name}
                            </p>
                          )}
                          {profile.about && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                              {profile.about}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                            {profile.pubkey.substring(0, 16)}...
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Case
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
