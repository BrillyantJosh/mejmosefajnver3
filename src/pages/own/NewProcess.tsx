import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, User, X, Loader2, ArrowLeft, Triangle } from "lucide-react";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
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

const createProcessSchema = z.object({
  content: z.string()
    .trim()
    .min(10, { message: "Reason must be at least 10 characters" })
    .max(1000, { message: "Reason must be less than 1000 characters" }),
  lang: z.string().min(2).max(2, { message: "Language code must be 2 characters" }),
});

type CreateProcessFormData = z.infer<typeof createProcessSchema>;

interface SelectedParticipant {
  pubkey: string;
  name: string;
  picture?: string;
}

export default function NewProcess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const triggerEventId = searchParams.get("trigger");
  const initialParticipantPubkey = searchParams.get("participant");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<SelectedParticipant[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [formData, setFormData] = useState<CreateProcessFormData>({
    content: "",
    lang: "sl",
  });

  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const { toast } = useToast();

  // Fetch initial participant profile
  const { profile: initialParticipantProfile, isLoading: initialProfileLoading } = useNostrProfileCache(initialParticipantPubkey);

  // Add initial participant when profile is loaded
  useEffect(() => {
    if (initialParticipantPubkey && initialParticipantProfile && selectedParticipants.length === 0) {
      setSelectedParticipants([{
        pubkey: initialParticipantPubkey,
        name: initialParticipantProfile.display_name || initialParticipantProfile.full_name || initialParticipantPubkey.slice(0, 8),
        picture: initialParticipantProfile.picture,
      }]);
    }
  }, [initialParticipantPubkey, initialParticipantProfile]);

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
    const validation = createProcessSchema.safeParse(formData);
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

      // Add trigger event if present
      if (triggerEventId) {
        tags.push(["e", triggerEventId, "trigger"]);
      }

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
        break;
      }
      
      if (results.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      toast({
        title: "Success",
        description: "OWN process opened successfully",
      });

      // Navigate to my cases
      navigate("/own/my-cases");
    } catch (error) {
      console.error("Error creating process:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to open process. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-4 md:px-0 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Triangle className="h-6 w-6 text-primary fill-primary" />
          <h2 className="text-xl font-bold">Open OWN Process</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Process Details */}
        <Card>
          <CardHeader>
            <CardTitle>Process Details</CardTitle>
            <CardDescription>
              Provide a clear explanation of why this process is being opened
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="content">
                Reason for Process <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="content"
                placeholder="Clarifying responsibility around a shared task..."
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
              <Label htmlFor="lang">Language</Label>
              <Select
                value={formData.lang}
                onValueChange={(value) => setFormData(prev => ({ ...prev, lang: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="sl">Slovenščina</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="it">Italiano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Add Participants */}
        <Card>
          <CardHeader>
            <CardTitle>Add Participants</CardTitle>
            <CardDescription>
              Search for people to involve in this process
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Selected Participants */}
            {selectedParticipants.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedParticipants.map((participant) => (
                  <Badge key={participant.pubkey} variant="secondary" className="gap-2 pr-1 py-1.5">
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

            {initialProfileLoading && initialParticipantPubkey && (
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
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
                          {profile.about && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {profile.about}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-3">
          <Button 
            type="submit" 
            className="flex-1" 
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Open Process
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
