import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, MessageCircle, Share, MoreVertical, Trash2, Triangle, CheckCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNostrRoomFeed } from "@/hooks/useNostrRoomFeed";
import { formatDistanceToNow } from "date-fns";
import { PostContent } from "@/components/social/PostContent";
import { PostReplies } from "@/components/social/PostReplies";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useToast } from "@/hooks/use-toast";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useLashHistory } from "@/hooks/useLashHistory";
import { getProxiedImageUrl } from "@/lib/imageProxy";

export default function RoomFeed() {
  const { roomSlug } = useParams<{ roomSlug: string }>();
  const navigate = useNavigate();
  const { posts, loading, loadingMore, error, hasMore, loadMore } = useNostrRoomFeed(roomSlug);
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { toast } = useToast();
  const { giveLash } = useNostrLash();
  const { incrementUnpaidCount } = useNostrUnpaidLashes();
  const { fetchUserLashes, addLash } = useLashHistory();
  
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [lashedEvents, setLashedEvents] = useState<Set<string>>(new Set());

  const relays = systemParameters?.relays || [];

  // Fetch user's lashed events
  useEffect(() => {
    const loadLashedEvents = async () => {
      if (posts.length > 0 && session?.nostrHexId) {
        const postIds = posts.map(p => p.id);
        const lashed = await fetchUserLashes(postIds);
        setLashedEvents(lashed);
      }
    };
    loadLashedEvents();
  }, [posts, session?.nostrHexId, fetchUserLashes]);

  const getDisplayName = (post: any) => {
    const profile = post.profile;
    if (!profile) return post.pubkey.slice(0, 8) + '...';
    return profile.display_name || profile.name || post.pubkey.slice(0, 8) + '...';
  };

  const getAvatarFallback = (post: any) => {
    const displayName = getDisplayName(post);
    return displayName[0].toUpperCase();
  };

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return 'recently';
    }
  };

  const handleSharePost = async (postId: string) => {
    try {
      const shareUrl = `${window.location.origin}/post/${postId}`;
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link copied!",
        description: "Post link has been copied to clipboard"
      });
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy link to clipboard",
        variant: "destructive"
      });
    }
  };

  const handleGiveLash = async (postId: string, authorPubkey: string, authorWallet?: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to give LASH",
        variant: "destructive"
      });
      return;
    }

    if (!authorWallet) {
      toast({
        title: "Error",
        description: "Author wallet not found",
        variant: "destructive"
      });
      return;
    }

    setLashedEvents(prev => new Set(prev).add(postId));
    incrementUnpaidCount();

    const savedToDb = await addLash(postId);
    const result = await giveLash({
      postId,
      recipientPubkey: authorPubkey,
      recipientWallet: authorWallet,
      memo: "LASH"
    });

    if (!result.success || !savedToDb) {
      setLashedEvents(prev => {
        const newSet = new Set(prev);
        newSet.delete(postId);
        return newSet;
      });
      toast({
        title: "Error",
        description: result.error || "Failed to send LASH",
        variant: "destructive"
      });
    }
  };

  const handleDeletePost = async (postId: string, postPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to delete posts",
        variant: "destructive"
      });
      return;
    }

    if (postPubkey !== session.nostrHexId) {
      toast({
        title: "Error",
        description: "You can only delete your own posts",
        variant: "destructive"
      });
      return;
    }

    setDeletingPostId(postId);

    try {
      const pool = new SimplePool();
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const deletionEvent = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['e', postId], ['k', '1']],
        content: 'Deleted by user',
        pubkey: session.nostrHexId
      };

      const signedEvent = finalizeEvent(deletionEvent, privateKeyBytes);
      const publishPromises = pool.publish(relays, signedEvent);

      await Promise.race([
        Promise.all(publishPromises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 10000))
      ]).catch(() => {});

      toast({
        title: "Success",
        description: "Post deleted successfully"
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete post",
        variant: "destructive"
      });
    } finally {
      setDeletingPostId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => navigate('/social/home')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">
          Room: {roomSlug}
        </h1>
      </div>

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="pt-6 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && !loading && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && posts.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No posts in this room yet.
          </CardContent>
        </Card>
      )}

      {/* Posts */}
      <div className="space-y-4 pb-8">
        {posts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div 
                  className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => navigate(`/social/user/${post.pubkey}`)}
                >
                  <Avatar>
                    {post.profile?.picture && (
                      <AvatarImage 
                        src={getProxiedImageUrl(
                          post.profile.picture, 
                          post.profile.last_fetched_at ? new Date(post.profile.last_fetched_at).getTime() : post.created_at
                        )} 
                        alt={getDisplayName(post)} 
                      />
                    )}
                    <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
                      {getAvatarFallback(post)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold hover:text-primary transition-colors">{getDisplayName(post)}</p>
                    {post.profile?.full_name && post.profile?.display_name && (
                      <p className="text-xs text-muted-foreground">@{post.profile.full_name}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{formatTime(post.created_at)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    Room: {roomSlug}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => handleSharePost(post.id)}>
                        <Share className="h-4 w-4 mr-2" />
                        Share post
                      </DropdownMenuItem>
                      {session?.nostrHexId === post.pubkey && (
                        <DropdownMenuItem 
                          onClick={() => handleDeletePost(post.id, post.pubkey)}
                          disabled={deletingPostId === post.id}
                          className="text-destructive focus:text-destructive cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {deletingPostId === post.id ? 'Deleting...' : 'Delete post'}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="pt-0">
              <PostContent content={post.content} />
              
              {/* Actions */}
              <div className="flex items-center gap-4 mt-4 pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-primary"
                  onClick={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  {post.replyCount || 0}
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  className={lashedEvents.has(post.id) 
                    ? "text-green-500 hover:text-green-600" 
                    : "text-muted-foreground hover:text-primary"}
                  onClick={() => handleGiveLash(post.id, post.pubkey, post.profile?.lana_wallet_id)}
                  disabled={lashedEvents.has(post.id) || !session}
                >
                  {lashedEvents.has(post.id) ? (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  ) : (
                    <Triangle className="h-4 w-4 mr-1" />
                  )}
                  {lashedEvents.has(post.id) ? 'Lashed' : 'Lash'}
                </Button>
              </div>
              
              {/* Replies */}
              {expandedPostId === post.id && (
                <PostReplies postId={post.id} relays={relays} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Load More Button */}
      {hasMore && !loading && posts.length > 0 && (
        <div className="flex justify-center pb-8">
          <Button 
            onClick={loadMore} 
            disabled={loadingMore}
            variant="outline"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
