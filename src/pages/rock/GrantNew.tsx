import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, ArrowLeft } from "lucide-react";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, Event as NostrEvent, finalizeEvent } from 'nostr-tools';
import { toast } from "sonner";

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

export default function GrantNew() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [familiarity, setFamiliarity] = useState<string>("");
  const [relation, setRelation] = useState<string>("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [searchParams] = useSearchParams();
  const preselectedPubkey = searchParams.get('pubkey');

  // Auto-select profile from URL parameter
  useEffect(() => {
    if (preselectedPubkey && profiles.length > 0 && !selectedProfile) {
      const profile = profiles.find(p => p.pubkey === preselectedPubkey);
      if (profile) {
        setSelectedProfile(profile);
      }
    }
  }, [preselectedPubkey, profiles, selectedProfile]);

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

      // Publish to relays with proper timeout handling
      const publishResults: Array<{ relay: string; success: boolean; error?: string }> = [];

      const publishPromises = parameters.relays.map(async (relay: string) => {
        console.log(`🔄 Publishing ROCK to ${relay}...`);
        
        return new Promise<void>((resolve) => {
          // Outer timeout: 10s - guards against relay never responding
          const timeout = setTimeout(() => {
            publishResults.push({ relay, success: false, error: 'Connection timeout (10s)' });
            console.error(`❌ ${relay}: Timeout`);
            resolve();
          }, 10000);

          try {
            const pubs = pool.publish([relay], signedEvent);
            
            // Inner timeout: 8s - guards against publish promise hanging
            Promise.race([
              Promise.all(pubs),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Publish timeout')), 8000)
              )
            ]).then(() => {
              clearTimeout(timeout);
              publishResults.push({ relay, success: true });
              console.log(`✅ ${relay}: ROCK published successfully`);
              resolve();
            }).catch((error) => {
              clearTimeout(timeout);
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              publishResults.push({ relay, success: false, error: errorMsg });
              console.error(`❌ ${relay}: ${errorMsg}`);
              resolve();
            });
          } catch (error) {
            clearTimeout(timeout);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            publishResults.push({ relay, success: false, error: errorMsg });
            console.error(`❌ ${relay}: ${errorMsg}`);
            resolve();
          }
        });
      });

      // Wait for ALL relays to complete or timeout
      await Promise.all(publishPromises);

      // Close pool in finally block
      pool.close(parameters.relays);

      const successCount = publishResults.filter(r => r.success).length;
      
      console.log('📊 ROCK publishing summary:', {
        eventId: signedEvent.id,
        total: publishResults.length,
        successful: successCount,
        failed: publishResults.filter(r => !r.success).length,
        details: publishResults
      });
      
      if (successCount > 0) {
        toast.success(`ROCK endorsement published to ${successCount} relay(s)`);
        navigate('/rock');
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

  return (
    <div className="container mx-auto p-6 max-w-4xl pb-20">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/rock')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to ROCK
        </Button>
        <h1 className="text-3xl font-bold">Grant ROCK Endorsement</h1>
        <p className="text-muted-foreground">Provide a reference for someone you know</p>
      </div>

      <div className="space-y-6">
        {/* Search for user */}
        {!selectedProfile && (
          <Card>
            <CardHeader>
              <CardTitle>Search for a person</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, display name, or pubkey..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {searchTerm && (
                <div className="space-y-2 max-h-96 overflow-y-auto border rounded-lg p-2">
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
                        <UserAvatar pubkey={profile.pubkey} picture={profile.picture} name={profile.display_name || profile.name} className="h-12 w-12" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {profile.display_name || profile.name || 'Anonymous'}
                          </p>
                          {profile.name && profile.name !== profile.display_name && (
                            <p className="text-sm text-muted-foreground truncate">{profile.name}</p>
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {profile.location && `${profile.location} • `}
                            {profile.pubkey.substring(0, 16)}...
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Selected profile and form */}
        {selectedProfile && (
          <>
            {/* Selected profile display */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <UserAvatar pubkey={selectedProfile.pubkey} picture={selectedProfile.picture} name={selectedProfile.display_name || selectedProfile.name} className="h-16 w-16" />
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold">
                      {selectedProfile.display_name || selectedProfile.name || 'Anonymous'}
                    </h2>
                    {selectedProfile.name && selectedProfile.name !== selectedProfile.display_name && (
                      <p className="text-sm text-muted-foreground">{selectedProfile.name}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {selectedProfile.location}
                    </p>
                    {selectedProfile.about && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {selectedProfile.about}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedProfile(null)}
                  >
                    Change
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Form fields */}
            <Card>
              <CardHeader>
                <CardTitle>Endorsement Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="familiarity">How well do you know them?</Label>
                  <Select value={familiarity} onValueChange={setFamiliarity}>
                    <SelectTrigger id="familiarity">
                      <SelectValue placeholder="Select familiarity level" />
                    </SelectTrigger>
                    <SelectContent side="bottom" align="start">
                      {familiarityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="relation">What is your relationship?</Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger id="relation">
                      <SelectValue placeholder="Select relationship type" />
                    </SelectTrigger>
                    <SelectContent side="bottom" align="start">
                      {relationOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content">Your endorsement</Label>
                  <Textarea
                    id="content"
                    placeholder="Write your reference/endorsement here. Provide context about your relationship, their trustworthiness, skills, or character..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-[160px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Submit buttons */}
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => navigate('/rock')}
                disabled={isSubmitting}
              >
                Cancel
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
          </>
        )}
      </div>
    </div>
  );
}
