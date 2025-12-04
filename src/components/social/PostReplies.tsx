import { useEffect, useState } from 'react';
import { SimplePool, Event, finalizeEvent } from 'nostr-tools';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Heart, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NostrProfile } from "@/types/nostr";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getProxiedImageUrl } from "@/lib/imageProxy";

interface Reply {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  profile?: NostrProfile;
}

interface PostRepliesProps {
  postId: string;
  relays: string[];
  onLashComment?: (commentId: string, commentPubkey: string, commentWallet?: string) => void;
  isSendingLash?: boolean;
  lashedEventIds?: Set<string>;
}

export function PostReplies({ postId, relays, onLashComment, isSendingLash, lashedEventIds }: PostRepliesProps) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [profiles, setProfiles] = useState<Map<string, NostrProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [pool] = useState(() => new SimplePool());
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState('');
  const { session } = useAuth();
  
  // Detect mobile and older devices for optimized timeouts
  const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
  const FETCH_TIMEOUT = isMobile ? 15000 : 5000; // 15s for mobile, 5s for desktop
  const PUBLISH_TIMEOUT = isMobile ? 20000 : 10000; // 20s for mobile, 10s for desktop

  const fetchReplies = async (skipLoadingState = false) => {
    console.log('💬 Fetching replies for post:', postId.slice(0, 8), { isMobile, timeout: FETCH_TIMEOUT });
    
    if (!skipLoadingState) {
      setLoading(true);
    }

    try {
      // Fetch all posts that reference this post ID with mobile-optimized timeout
      const replyEvents = await Promise.race([
        pool.querySync(relays, {
          kinds: [1],
          '#e': [postId], // Posts that reference this event
          limit: 100
        }),
        new Promise<Event[]>((_, reject) => 
          setTimeout(() => reject(new Error('Replies query timeout')), FETCH_TIMEOUT)
        )
      ]).catch(err => {
        console.error('❌ Replies query failed:', err);
        return [];
      });

      console.log('💬 Found replies:', replyEvents.length);

      const newReplies: Reply[] = replyEvents.map(event => ({
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        created_at: event.created_at
      }));

      // Sort by oldest first (chronological order)
      newReplies.sort((a, b) => a.created_at - b.created_at);
      setReplies(newReplies);

      // Fetch profiles for all reply authors
      const uniqueAuthors = [...new Set(replyEvents.map(e => e.pubkey))];
      
      for (const pubkey of uniqueAuthors) {
        try {
          const profileEvent = await pool.querySync(relays, {
            kinds: [0],
            authors: [pubkey],
            limit: 1
          });

          if (profileEvent && profileEvent.length > 0) {
            const profileData = JSON.parse(profileEvent[0].content) as NostrProfile;
            setProfiles(prev => new Map(prev).set(pubkey, profileData));
          }
        } catch (error) {
          console.error('❌ Error fetching reply author profile:', error);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('❌ Error loading replies:', error);
      setLoading(false);
    }
  };

  // Only re-fetch when postId changes, not when relays reference changes
  // This prevents duplicate comment accumulation on every re-render
  useEffect(() => {
    fetchReplies();

    return () => {
      pool.close(relays);
    };
  }, [postId]); // ✅ Only postId dependency to prevent unnecessary refetches

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !session?.nostrPrivateKey) {
      toast.error("Please enter a comment");
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress('Preparing comment...');
    
    try {
      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      // Create KIND 1 comment event with proper tags
      const commentEvent = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', postId, '', 'root'], // Reference to original post
        ],
        content: commentText,
        pubkey: session.nostrHexId
      };

      setSubmitProgress('Signing comment...');
      
      // Sign the event
      const signedEvent = finalizeEvent(commentEvent, privateKeyBytes);

      // ✅ OPTIMISTIC UI: Add comment immediately
      const optimisticReply: Reply = {
        id: signedEvent.id,
        pubkey: session.nostrHexId,
        content: commentText,
        created_at: signedEvent.created_at
      };
      
      setReplies(prev => [...prev, optimisticReply]);
      const savedComment = commentText;
      setCommentText('');

      setSubmitProgress(`Publishing to ${relays.length} relays...`);
      console.log('💬 Publishing comment to', relays.length, 'relays');

      // Publish to all relays with individual tracking
      const publishPromises = pool.publish(relays, signedEvent);
      
      // Track each relay individually
      const trackedPromises = publishPromises.map((promise, idx) => {
        const relay = relays[idx];
        return promise
          .then(() => {
            console.log(`✅ Comment published to ${relay}`);
            return { relay, success: true };
          })
          .catch((err) => {
            console.error(`❌ Failed to publish to ${relay}:`, err);
            return { relay, success: false, error: err };
          });
      });

      // Wait for all with graceful timeout (mobile-optimized)
      try {
        await Promise.race([
          Promise.all(trackedPromises),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Publish timeout')), PUBLISH_TIMEOUT)
          )
        ]);
      } catch (error) {
        console.warn('⚠️ Some relays timed out');
      }

      // Check results - at least one relay must succeed
      const results = await Promise.allSettled(trackedPromises);
      const successful = results.filter(
        r => r.status === 'fulfilled' && r.value.success
      ).length;

      console.log(`📊 Comment Publish: ${successful}/${relays.length} successful`);

      if (successful === 0) {
        // Rollback optimistic UI on complete failure
        setReplies(prev => prev.filter(r => r.id !== signedEvent.id));
        setCommentText(savedComment);
        throw new Error('All relays failed to publish comment');
      }

      toast.success(`Comment posted! (${successful}/${relays.length} relays)`);
      
      // ✅ CRITICAL FIX: Refresh in background without showing loading state
      setTimeout(() => {
        fetchReplies(true).catch(err => {
          console.error('❌ Background refresh failed:', err);
          // Don't show error to user - comment is already visible optimistically
        });
      }, 2000);

    } catch (error) {
      console.error('❌ Error posting comment:', error);
      toast.error("Failed to post comment. Please try again.");
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  };


  const getDisplayName = (reply: Reply) => {
    const profile = profiles.get(reply.pubkey);
    if (!profile) return reply.pubkey.slice(0, 8) + '...';
    return profile.display_name || profile.name || reply.pubkey.slice(0, 8) + '...';
  };

  const getAvatarFallback = (reply: Reply) => {
    const displayName = getDisplayName(reply);
    return displayName[0].toUpperCase();
  };

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return 'recently';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-4 border-t">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (replies.length === 0) {
    return (
      <div className="border-t mt-4 pt-4 space-y-4">
        <div className="text-center py-2 text-sm text-muted-foreground">
          No comments yet. Be the first to comment!
        </div>
        
        {/* Comment input */}
        {session?.nostrPrivateKey && (
          <div className="space-y-2">
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment..."
              className="min-h-[80px] resize-none"
            />
            <Button 
              onClick={handleSubmitComment}
              disabled={isSubmitting || !commentText.trim()}
              size="sm"
              className="w-full md:w-auto"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {submitProgress || 'Posting...'}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Post Comment
                </>
              )}
            </Button>
            {submitProgress && (
              <p className="text-xs text-muted-foreground mt-2">
                {submitProgress}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t mt-4 pt-4 space-y-4 pb-6">
      {/* Comment input at top */}
      {session?.nostrPrivateKey && (
        <div className="space-y-2 mb-4">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Write a comment..."
            className="min-h-[80px] resize-none"
          />
          <Button 
            onClick={handleSubmitComment}
            disabled={isSubmitting || !commentText.trim()}
            size="sm"
            className="w-full md:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {submitProgress || 'Posting...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Post Comment
              </>
            )}
          </Button>
          {submitProgress && (
            <p className="text-xs text-muted-foreground mt-2">
              {submitProgress}
            </p>
          )}
        </div>
      )}
      
      {/* Existing replies */}
      {replies.map((reply) => (
        <div key={reply.id} className="flex gap-3 pl-4">
          <Avatar className="h-8 w-8 flex-shrink-0">
            {profiles.get(reply.pubkey)?.picture && (
              <AvatarImage 
                src={getProxiedImageUrl(profiles.get(reply.pubkey)?.picture, Date.now())} 
                alt={getDisplayName(reply)} 
              />
            )}
            <AvatarFallback className="bg-gradient-to-br from-secondary to-accent text-xs">
              {getAvatarFallback(reply)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">{getDisplayName(reply)}</p>
              <p className="text-xs text-muted-foreground">{formatTime(reply.created_at)}</p>
            </div>
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">{reply.content}</p>
            
            {/* LASH button for comment */}
            {onLashComment && (
              <button
                className={`flex items-center gap-1 mt-2 transition-all duration-200 ${
                  lashedEventIds?.has(reply.id)
                    ? 'text-green-500'
                    : 'text-muted-foreground hover:text-green-500 hover:scale-110'
                } ${isSendingLash ? 'animate-pulse' : ''}`}
                onClick={() => !lashedEventIds?.has(reply.id) && onLashComment(reply.id, reply.pubkey, profiles.get(reply.pubkey)?.lanaWalletID)}
                disabled={isSendingLash || lashedEventIds?.has(reply.id)}
              >
                <Heart className={`h-3.5 w-3.5 transition-transform ${lashedEventIds?.has(reply.id) ? 'fill-green-500 scale-110' : ''}`} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
