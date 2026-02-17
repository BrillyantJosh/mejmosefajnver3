import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle } from "lucide-react";
import { useNostrPostComments } from "@/hooks/useNostrPostComments";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { finalizeEvent, SimplePool } from "nostr-tools";
import { toast } from "sonner";
export default function Comments() {
  const { comments, isLoading } = useNostrPostComments();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const relays = parameters?.relays || [];
  const nostrPrivateKey = session?.nostrPrivateKey;

  const getDisplayName = (profile?: { name?: string; display_name?: string }, pubkey?: string) => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    if (pubkey) return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
    return "Anonymous";
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + "...";
  };

  const handleReply = async (commentId: string, originalPostId: string) => {
    if (!replyContent.trim() || !nostrPrivateKey) {
      toast.error("Please enter a reply");
      return;
    }

    if (relays.length === 0) {
      toast.error("No relays available");
      return;
    }

    setIsSubmitting(true);
    const pool = new SimplePool();
    
    try {
      const privKeyBytes = new Uint8Array(nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", originalPostId, "", "root"],
          ["e", commentId, "", "reply"],
        ],
        content: replyContent,
      }, privKeyBytes);

      // Use Promise.allSettled to handle partial failures gracefully
      const publishPromises = pool.publish(relays, event);
      
      const results = await Promise.race([
        Promise.allSettled(publishPromises),
        new Promise<PromiseSettledResult<string>[]>((_, reject) => 
          setTimeout(() => reject(new Error('Publish timeout')), 15000)
        )
      ]);

      // Check if at least one relay succeeded
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      
      if (successCount > 0) {
        toast.success(`Reply posted to ${successCount}/${relays.length} relays`);
        setReplyContent("");
        setReplyingTo(null);
      } else {
        toast.error("Failed to post reply to any relay");
      }
    } catch (error) {
      console.error("Error posting reply:", error);
      toast.error("Failed to post reply");
    } finally {
      pool.close(relays);
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Comments</h2>
          <p className="text-muted-foreground">Replies to your posts</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Comments</h2>
          <p className="text-muted-foreground">Replies to your posts</p>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No comments on your posts yet</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Comments</h2>
        <p className="text-muted-foreground">Replies to your posts ({comments.length})</p>
      </div>

      <div className="space-y-4">
        {comments.map((notification) => (
          <Card key={notification.commentId}>
            <CardContent className="p-4">
              {/* Comment */}
              <div className="flex gap-4 mb-4">
                <UserAvatar
                  pubkey={notification.commentAuthor}
                  picture={notification.commentAuthorProfile?.picture}
                  name={getDisplayName(notification.commentAuthorProfile, notification.commentAuthor)}
                  className="h-10 w-10"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">
                      {getDisplayName(notification.commentAuthorProfile, notification.commentAuthor)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(notification.commentCreatedAt)}
                    </span>
                  </div>
                  <p className="text-sm mb-2">{notification.commentContent}</p>
                </div>
              </div>

              {/* Original Post Preview */}
              <div className="bg-muted/30 rounded-lg p-3 mb-3 border-l-2 border-primary/50">
                <p className="text-xs text-muted-foreground mb-1">Your post:</p>
                <p className="text-sm text-muted-foreground italic">
                  {truncateContent(notification.originalPostContent)}
                </p>
              </div>

              {/* Reply Section */}
              {replyingTo === notification.commentId ? (
                <div className="space-y-2">
                  <Textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    className="min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => handleReply(notification.commentId, notification.originalPostId)}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "Posting..." : "Post Reply"}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyContent("");
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setReplyingTo(notification.commentId)}
                >
                  Reply
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
