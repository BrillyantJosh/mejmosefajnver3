import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Heart, MessageCircle, Share, Loader2, MoreVertical, Trash2, Triangle, CheckCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useNostrFeed } from "@/hooks/useNostrFeed";
import { formatDistanceToNow } from "date-fns";
import { PostContent } from "@/components/social/PostContent";
import { PostReplies } from "@/components/social/PostReplies";
import { useEffect, useRef, useState, useMemo } from "react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrUserRoomSubscriptions } from "@/hooks/useNostrUserRoomSubscriptions";
import { useNostrTinyRooms } from "@/hooks/useNostrTinyRooms";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useToast } from "@/hooks/use-toast";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useLashHistory } from "@/hooks/useLashHistory";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import { useAdmin } from "@/contexts/AdminContext";
import { useNavigate } from "react-router-dom";

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export default function Feed() {
  const navigate = useNavigate();
  const { posts, loading, loadingMore, error, retryCount, hasMore, loadMore, retry } = useNostrFeed();
  const { parameters: systemParameters } = useSystemParameters();
  const { session } = useAuth();
  const { appSettings } = useAdmin();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'rooms' | 'friends'>('rooms');
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [lashedEvents, setLashedEvents] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { giveLash } = useNostrLash();
  const { incrementUnpaidCount } = useNostrUnpaidLashes();
  const { fetchUserLashes, addLash } = useLashHistory();

  // Get user's room subscriptions
  const { subscriptions } = useNostrUserRoomSubscriptions({
    userPubkey: session?.nostrHexId || '',
    userPrivateKey: session?.nostrPrivateKey || ''
  });

  // Get user's Tiny Rooms
  const { rooms: tinyRooms } = useNostrTinyRooms(session?.nostrHexId);

  // Create list of valid Tiny Room 'a' tag values
  const tinyRoomATags = useMemo(() => {
    return tinyRooms
      .filter(room => room.status === 'active')
      .map(room => `30150:${room.admin}:${room.slug}`);
  }, [tinyRooms]);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  // Fetch user's lashed events from Supabase when posts change
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

  // Filter posts based on selected filter mode
  const filteredPosts = useMemo(() => {
    if (filterMode === 'all') {
      return posts;
    }

    if (filterMode === 'rooms' && session) {
      // Get active subscription slugs
      const activeRoomSlugs = subscriptions
        .filter(sub => sub.status === 'active')
        .map(sub => sub.slug);

      // If user has no subscribed rooms, use default_rooms from app_settings
      const roomsToFilter = activeRoomSlugs.length > 0 
        ? activeRoomSlugs 
        : (appSettings?.default_rooms || []);

      // Filter posts that have 'a' or 't' tag matching rooms or Tiny Rooms
      const filtered = posts.filter(post => {
        const roomTags = post.tags?.filter(tag => tag[0] === 'a' || tag[0] === 't') || [];
        const matchesRoom = roomTags.some(tag => {
          const tagValue = tag[1];
          
          // Check regular rooms
          if (roomsToFilter.includes(tagValue)) {
            return true;
          }
          
          // Check Tiny Rooms - if tag starts with '30150:'
          if (tagValue.startsWith('30150:')) {
            return tinyRoomATags.includes(tagValue);
          }
          
          return false;
        });
        return matchesRoom;
      });

      return filtered;
    }

    if (filterMode === 'friends') {
      return [];
    }

    return posts;
  }, [posts, filterMode, subscriptions, session, appSettings?.default_rooms, tinyRoomATags]);

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

  // Share post function - copies URL to clipboard
  const handleSharePost = async (postId: string) => {
    try {
      const shareUrl = `${window.location.origin}/post/${postId}`;
      await navigator.clipboard.writeText(shareUrl);
      
      toast({
        title: "Link copied!",
        description: "Post link has been copied to clipboard"
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy link to clipboard",
        variant: "destructive"
      });
    }
  };

  // Give LASH function - saves to Supabase and publishes to Nostr
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

    // OPTIMISTIC UPDATE - immediately show green
    setLashedEvents(prev => new Set(prev).add(postId));
    incrementUnpaidCount();

    // Save to Supabase (for display)
    const savedToDb = await addLash(postId);
    
    // Publish to Nostr (for protocol)
    const result = await giveLash({
      postId,
      recipientPubkey: authorPubkey,
      recipientWallet: authorWallet,
      memo: "LASH"
    });

    if (!result.success || !savedToDb) {
      // Rollback on error
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

  // Delete post function - sends KIND 5 deletion event
  const handleDeletePost = async (postId: string, postPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to delete posts",
        variant: "destructive"
      });
      return;
    }

    // Check if user is the author
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

      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      // Create KIND 5 deletion event (NIP-09)
      const deletionEvent = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', postId],
          ['k', '1'] // kind 1 = text note
        ],
        content: 'Deleted by user',
        pubkey: session.nostrHexId
      };

      // Sign the event with private key
      const signedEvent = finalizeEvent(deletionEvent, privateKeyBytes);

      console.log('🗑️ Sending deletion event:', signedEvent);

      // Publish to ALL relays at once
      const publishPromises = pool.publish(relays, signedEvent);

      // Track each relay individually
      const trackedPromises = publishPromises.map((promise, idx) => {
        const relay = relays[idx];
        return promise
          .then(() => {
            console.log(`✅ Deletion published to ${relay}`);
            return { relay, success: true };
          })
          .catch((err) => {
            console.error(`❌ Failed to publish deletion to ${relay}:`, err);
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
        console.warn('⚠️ Publish timeout, but deletion may have been sent:', error);
      }

      toast({
        title: "Success",
        description: "Post deleted successfully"
      });
      
    } catch (error) {
      console.error('❌ Error deleting post:', error);
      toast({
        title: "Error",
        description: "Failed to delete post",
        variant: "destructive"
      });
    } finally {
      setDeletingPostId(null);
    }
  };

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Filter Mode Selection */}
      <Card>
        <CardContent className="pt-6">
          <RadioGroup value={filterMode} onValueChange={(value) => setFilterMode(value as 'all' | 'rooms' | 'friends')}>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="all" />
                <Label htmlFor="all" className="cursor-pointer">All</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="rooms" id="rooms" />
                <Label htmlFor="rooms" className="cursor-pointer">My rooms</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="friends" id="friends" />
                <Label htmlFor="friends" className="cursor-pointer">My friends</Label>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && !loading && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-destructive font-medium">{error}</p>
              {retryCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  Attempted {retryCount} time{retryCount > 1 ? 's' : ''}
                </p>
              )}
              <Button onClick={retry} variant="outline" className="mt-4">
                Retry Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Posts Feed */}
      {!loading && !error && filteredPosts.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {filterMode === 'rooms' 
              ? subscriptions.filter(sub => sub.status === 'active').length > 0
                ? 'No posts in your subscribed rooms. Try selecting "All" to see all posts.'
                : 'No posts in default rooms yet. Try selecting "All" to see all posts.'
              : filterMode === 'friends'
              ? 'Friends filter coming soon!'
              : 'No posts found. Be the first to post!'}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4 pb-8">
          {filteredPosts.map((post) => (
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
                  
                  {/* Top right corner: Room badge + Three-dot menu */}
                  <div className="flex items-center gap-2">
                    {post.tags && post.tags.some(tag => tag[0] === 'a' || tag[0] === 't') && (
                      <Badge variant="secondary" className="text-xs">
                        {(() => {
                          const roomTag = post.tags.find(tag => tag[0] === 'a' || tag[0] === 't')?.[1];
                          if (roomTag?.startsWith('30150:')) {
                            // Find Tiny Room name
                            const tinyRoom = tinyRooms.find(r => `30150:${r.admin}:${r.slug}` === roomTag);
                            return tinyRoom ? `🚪 ${tinyRoom.name}` : roomTag;
                          }
                          return `Room: ${roomTag}`;
                        })()}
                      </Badge>
                    )}
                    <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {/* Share option - always visible */}
                      <DropdownMenuItem onClick={() => handleSharePost(post.id)}>
                        <Share className="h-4 w-4 mr-2" />
                        Share post
                      </DropdownMenuItem>
                      
                      {/* Delete option - only for author */}
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
              <CardContent>
                <PostContent content={post.content} tags={post.tags} />
                <div className="flex items-center gap-6 text-muted-foreground">
                  <button 
                    className={`flex items-center gap-1.5 transition-all duration-200 ${
                      lashedEvents.has(post.id) 
                        ? 'text-green-500' 
                        : 'hover:text-green-500 hover:scale-110'
                    }`}
                    onClick={() => !lashedEvents.has(post.id) && handleGiveLash(post.id, post.pubkey, post.profile?.lana_wallet_id)}
                    disabled={lashedEvents.has(post.id)}
                  >
                    <Heart
                      className={`h-5 w-5 transition-transform ${
                        lashedEvents.has(post.id) 
                          ? 'fill-green-500 scale-110' 
                          : ''
                      }`} 
                    />
                  </button>
                  <button
                    className="flex items-center gap-2 hover:text-primary transition-colors"
                    onClick={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-sm">{post.replyCount || 0}</span>
                  </button>
                  <button
                    className="flex items-center gap-2 hover:text-primary transition-colors"
                    onClick={() => navigate(`/own/start/${post.id}`)}
                    title="Start OWN process"
                  >
                    <Triangle className="h-4 w-4" />
                    <span className="text-sm">OWN</span>
                  </button>
                  <button
                    className="flex items-center gap-2 hover:text-green-600 transition-colors"
                    onClick={() => navigate(`/rock/grant-new?pubkey=${post.pubkey}`)}
                    title="Grant ROCK endorsement"
                  >
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm">ROCK</span>
                  </button>
                </div>
                
                {/* Show replies when expanded */}
                {expandedPostId === post.id && (
                  <div className="mb-6">
                    <PostReplies 
                      postId={post.id} 
                      relays={relays}
                      onLashComment={handleGiveLash}
                      isSendingLash={false}
                      lashedEventIds={lashedEvents}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          
          {/* Infinite scroll trigger */}
          {hasMore && (
            <div ref={loadMoreRef} className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </div>
    </div>
  );
}
