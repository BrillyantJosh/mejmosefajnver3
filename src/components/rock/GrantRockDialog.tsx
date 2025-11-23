import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, User, Plus, Loader2 } from "lucide-react";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, Event as NostrEvent, finalizeEvent } from 'nostr-tools';
import { toast } from "sonner";

interface GrantRockDialogProps {
  onSuccess?: () => void;
}

const familiarityOptions = [
  { value: 'real_life', label: 'Real Life - I know this person face-to-face' },
  { value: 'virtual', label: 'Virtual - I know this person through online interactions' },
  { value: 'limited', label: 'Limited - I don\'t know this person well enough' },
];

const relationOptions = [
  { value: 'friend', label: 'Friend' },
  { value: 'family', label: 'Family' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'business_partner', label: 'Business Partner' },
  { value: 'community', label: 'Community' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'student', label: 'Student' },
  { value: 'neighbor', label: 'Neighbor' },
  { value: 'acquaintance', label: 'Acquaintance' },
  { value: 'romantic', label: 'Romantic' },
  { value: 'trust', label: 'Trust' },
  { value: 'other', label: 'Other' },
];

export function GrantRockDialog({ onSuccess }: GrantRockDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [familiarity, setFamiliarity] = useState<string>("");
  const [relation, setRelation] = useState<string>("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const filteredProfiles = profiles.filter(
    (profile) =>
      profile.pubkey !== session?.nostrHexId &&
      (profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.pubkey?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSubmit = async () => {
    if (!selectedProfile || !familiarity || !relation || !content || !session || !parameters?.relays) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      // Find the target's KIND 0 event ID
      const pool = new SimplePool();
      const kind0Events = await pool.querySync(parameters.relays, {
        kinds: [0],
        authors: [selectedProfile.pubkey],
        limit: 1
      });

      const kind0EventId = kind0Events[0]?.id;

      // Create KIND 87033 event
      const eventTemplate = {
        kind: 87033,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', selectedProfile.pubkey],
          ...(kind0EventId ? [['e', kind0EventId]] : []),
          ['familiarity', familiarity],
          ['relation', relation],
        ],
        content: content,
      };

      // Sign the event
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );
      
      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes) as NostrEvent;

      console.log('🪨 Publishing KIND 87033 ROCK event:', signedEvent);

      // Publish to relays
      const results = await Promise.allSettled(
        parameters.relays.map(relay => pool.publish([relay], signedEvent))
      );

      pool.close(parameters.relays);

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      
      if (successCount > 0) {
        toast.success(`ROCK endorsement published to ${successCount} relay(s)`);
        setOpen(false);
        resetForm();
        onSuccess?.();
      } else {
        toast.error("Failed to publish ROCK endorsement");
      }
    } catch (error) {
      console.error('❌ Error publishing ROCK:', error);
      toast.error("Failed to publish ROCK endorsement");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSearchTerm("");
    setSelectedProfile(null);
    setFamiliarity("");
    setRelation("");
    setContent("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-green-600 hover:bg-green-700">
          <Plus className="mr-2 h-4 w-4" />
          Grant ROCK
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Grant ROCK Endorsement</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Search for user */}
          {!selectedProfile && (
            <div className="space-y-4">
              <div>
                <Label>Search for a person</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, display name, or pubkey..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {searchTerm && (
                <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                  {profilesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Loading profiles...
                    </div>
                  ) : filteredProfiles.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No profiles found</p>
                  ) : (
                    filteredProfiles.map((profile) => (
                      <div
                        key={profile.pubkey}
                        onClick={() => setSelectedProfile(profile)}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted transition-colors"
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={profile.picture} alt={profile.name || profile.display_name} />
                          <AvatarFallback>
                            <User className="h-5 w-5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {profile.display_name || profile.name || 'Anonymous'}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {profile.location && `${profile.location} • `}
                            {profile.pubkey.substring(0, 16)}...
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Selected profile and form */}
          {selectedProfile && (
            <div className="space-y-6">
              {/* Selected profile display */}
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={selectedProfile.picture} alt={selectedProfile.name} />
                  <AvatarFallback>
                    <User className="h-6 w-6" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">
                    {selectedProfile.display_name || selectedProfile.name || 'Anonymous'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProfile.location}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProfile(null)}
                >
                  Change
                </Button>
              </div>

              {/* Form fields */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="familiarity">How well do you know them?</Label>
                  <Select value={familiarity} onValueChange={setFamiliarity}>
                    <SelectTrigger id="familiarity" className="mt-2">
                      <SelectValue placeholder="Select familiarity level" />
                    </SelectTrigger>
                    <SelectContent>
                      {familiarityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="relation">What is your relationship?</Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger id="relation" className="mt-2">
                      <SelectValue placeholder="Select relationship type" />
                    </SelectTrigger>
                    <SelectContent>
                      {relationOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="content">Your endorsement</Label>
                  <Textarea
                    id="content"
                    placeholder="Write your reference/endorsement here. Provide context about your relationship, their trustworthiness, skills, or character..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="mt-2 min-h-[120px]"
                  />
                </div>
              </div>

              {/* Submit button */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedProfile(null)}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !familiarity || !relation || !content}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Publishing...' : 'Grant ROCK'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
