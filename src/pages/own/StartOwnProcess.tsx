import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ArrowLeft, Triangle, Loader2, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { toast } from 'sonner';

interface PostAuthor {
  pubkey: string;
  displayName: string;
  picture?: string;
}

export default function StartOwnProcess() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postAuthor, setPostAuthor] = useState<PostAuthor | null>(null);
  const [isLoadingAuthor, setIsLoadingAuthor] = useState(true);

  const relays = systemParameters?.relays || [];

  // Fetch post author info
  useEffect(() => {
    const fetchPostAuthor = async () => {
      if (!postId) return;
      
      setIsLoadingAuthor(true);
      const pool = new SimplePool();

      try {
        // First fetch the post to get author pubkey
        const post = await pool.get(relays, {
          ids: [postId],
          kinds: [1]
        });

        if (post) {
          const authorPubkey = post.pubkey;
          
          // Then fetch author profile
          const profile = await pool.get(relays, {
            authors: [authorPubkey],
            kinds: [0]
          });

          let displayName = authorPubkey.slice(0, 8) + '...';
          let picture: string | undefined;

          if (profile) {
            try {
              const content = JSON.parse(profile.content);
              displayName = content.display_name || content.name || displayName;
              picture = content.picture;
            } catch (e) {
              console.error('Error parsing profile:', e);
            }
          }

          setPostAuthor({
            pubkey: authorPubkey,
            displayName,
            picture
          });
        }
      } catch (error) {
        console.error('Error fetching post author:', error);
      } finally {
        setIsLoadingAuthor(false);
        pool.close(relays);
      }
    };

    fetchPostAuthor();
  }, [postId, relays]);

  const handleStartProcess = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error('You must be logged in');
      return;
    }

    if (!reason.trim()) {
      toast.error('Please enter a reason to start the process');
      return;
    }

    if (!postAuthor) {
      toast.error('Post author not found');
      return;
    }

    setIsSubmitting(true);

    try {
      const pool = new SimplePool();

      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      // Build tags array
      const tags: string[][] = [
        ['status', 'opened'],
        ['lang', 'en'],
        ['p', session.nostrHexId], // Initiator
        ['p', postAuthor.pubkey], // Post author as participant
      ];

      // Add trigger event reference
      if (postId) {
        tags.push(['e', postId, 'trigger']);
      }

      // Create KIND 87044 event
      const ownEvent = {
        kind: 87044,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: reason.trim(),
        pubkey: session.nostrHexId
      };

      // Sign the event
      const signedEvent = finalizeEvent(ownEvent, privateKeyBytes);

      console.log('📤 Sending OWN process event:', signedEvent);

      // Publish to relays
      const publishPromises = pool.publish(relays, signedEvent);

      const trackedPromises = publishPromises.map((promise, idx) => {
        const relay = relays[idx];
        return promise
          .then(() => {
            console.log(`✅ OWN event published to ${relay}`);
            return { relay, success: true };
          })
          .catch((err) => {
            console.error(`❌ Failed to publish to ${relay}:`, err);
            return { relay, success: false, error: err };
          });
      });

      // Wait with timeout
      try {
        await Promise.race([
          Promise.all(trackedPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout')), 10000)
          )
        ]);
      } catch (error) {
        console.warn('⚠️ Publish timeout:', error);
      }

      pool.close(relays);

      toast.success('OWN process started successfully!');
      navigate('/own');

    } catch (error) {
      console.error('Error starting OWN process:', error);
      toast.error('Error starting process');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Triangle className="h-6 w-6 text-primary fill-primary" />
          <h1 className="text-2xl font-bold">Start OWN Process</h1>
        </div>
      </div>

      {/* Process explanation */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            The OWN (▲) process creates a transparent, structured space 
            where people take responsibility for actions, words, agreements, and misunderstandings.
          </p>
        </CardContent>
      </Card>

      {/* Participant card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Participant
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingAuthor ? (
            <div className="flex items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : postAuthor ? (
            <div className="flex items-center gap-3">
              <UserAvatar pubkey={postAuthor.pubkey} picture={postAuthor.picture} name={postAuthor.displayName} className="h-12 w-12" />
              <div>
                <p className="font-semibold">{postAuthor.displayName}</p>
                <Badge variant="secondary" className="text-xs mt-1">
                  Post Author
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Author not found</p>
          )}
        </CardContent>
      </Card>

      {/* Reason input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reason for starting the process</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Describe the reason for starting the OWN process..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Example: "Clarifying responsibility around a shared task."
          </p>
        </CardContent>
      </Card>

      {/* Submit button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleStartProcess}
        disabled={isSubmitting || !reason.trim() || !postAuthor}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Triangle className="h-4 w-4 mr-2 fill-current" />
            Start OWN Process
          </>
        )}
      </Button>
    </div>
  );
}
