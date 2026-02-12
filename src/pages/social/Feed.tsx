import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Heart, MessageCircle, Share, Loader2, MoreVertical, Trash2, Triangle, CheckCircle, Radio, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useNostrFeed } from "@/hooks/useNostrFeed";
import { formatDistanceToNow } from "date-fns";
import { PostContent } from "@/components/social/PostContent";
import { PostReplies } from "@/components/social/PostReplies";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useToast } from "@/hooks/use-toast";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useLashHistory } from "@/hooks/useLashHistory";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import { useNavigate } from "react-router-dom";

export default function Feed() {
  const navigate = useNavigate();
  const { parameters: systemParameters } = useSystemParameters();
  const { session } = useAuth();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [lashedEvents, setLashedEvents] = useState<Set<string>>(new Set());
  const [relayPanelOpen, setRelayPanelOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'lana'>('all');
  const { toast } = useToast();
  const { giveLash } = useNostrLash();
  const { incrementUnpaidCount } = useNostrUnpaidLashes();
  const { fetchUserLashes, addLash } = useLashHistory();

  // All available relays from system parameters
  const allRelays = useMemo(() => systemParameters?.relays || [], [systemParameters?.relays]);

  // Selected relays state — default all selected
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(new Set());

  // Initialize selectedRelays when allRelays loads
  useEffect(() => {
    if (allRelays.length > 0 && selectedRelays.size === 0) {
      setSelectedRelays(new Set(allRelays));
    }
  }, [allRelays]);

  // Stable array of selected relays for the hook — use JSON to prevent reference changes
  const activeRelaysKey = useMemo(() => {
    const selected = Array.from(selectedRelays);
    const arr = selected.length > 0 ? selected : allRelays;
    return JSON.stringify(arr);
  }, [selectedRelays, allRelays]);

  const activeRelays = useMemo(() => JSON.parse(activeRelaysKey) as string[], [activeRelaysKey]);

  const { posts, loading, loadingMore, error, retryCount, hasMore, loadMore, retry } = useNostrFeed(activeRelays);

  // Filter posts by LANA tag
  const filteredPosts = useMemo(() => {
    if (feedFilter === 'all') return posts;
    return posts.filter(post =>
      post.tags?.some(tag => tag[0] === 't' && tag[1]?.toLowerCase() === 'lana')
    );
  }, [posts, feedFilter]);

  const relays = allRelays;

  // Refresh feed when a new post is created
  useEffect(() => {
    const handlePostCreated = () => {
      console.log('📝 New post created, refreshing feed...');
      retry();
    };
    window.addEventListener('post-created', handlePostCreated);
    return () => window.removeEventListener('post-created', handlePostCreated);
  }, [retry]);

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

  const toggleRelay = useCallback((relay: string) => {
    setSelectedRelays(prev => {
      const next = new Set(prev);
      if (next.has(relay)) {
        // Don't allow deselecting all
        if (next.size <= 1) return prev;
        next.delete(relay);
      } else {
        next.add(relay);
      }
      return next;
    });
  }, []);

  const selectAllRelays = useCallback(() => {
    setSelectedRelays(new Set(allRelays));
  }, [allRelays]);

  const getRelayDisplayName = (relay: string) => {
    return relay.replace('wss://', '').replace('ws://', '').replace(/\/$/, '');
  };

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

  // Relay filter sidebar component
  const RelayFilter = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Relays</span>
        </div>
        {selectedRelays.size < allRelays.length && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAllRelays}>
            Select all
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {allRelays.map(relay => (
          <label
            key={relay}
            className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-2 py-1.5 transition-colors"
          >
            <Checkbox
              checked={selectedRelays.has(relay)}
              onCheckedChange={() => toggleRelay(relay)}
            />
            <span className="truncate text-muted-foreground">{getRelayDisplayName(relay)}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedRelays.size}/{allRelays.length} selected
      </p>
    </div>
  );

  return (
    <div className="w-full mx-auto px-4">
      <div className="flex justify-between gap-8">
        {/* Main Feed Column */}
        <div className="flex-1 max-w-2xl mx-auto space-y-4">

          {/* Mobile Relay Filter Toggle */}
          <div className="lg:hidden">
            <Button
              variant="outline"
              size="sm"
              className="w-full flex items-center justify-between"
              onClick={() => setRelayPanelOpen(!relayPanelOpen)}
            >
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4" />
                <span>Relays ({selectedRelays.size}/{allRelays.length})</span>
              </div>
              <ChevronDown className={`h-4 w-4 transition-transform ${relayPanelOpen ? 'rotate-180' : ''}`} />
            </Button>
            {relayPanelOpen && (
              <Card className="mt-2">
                <CardContent className="pt-4">
                  <RelayFilter />
                </CardContent>
              </Card>
            )}
          </div>

          {/* All / Lana Filter Toggle */}
          <div className="flex gap-2">
            <Button
              variant={feedFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFeedFilter('all')}
            >
              All
            </Button>
            <Button
              variant={feedFilter === 'lana' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFeedFilter('lana')}
            >
              Lana
            </Button>
          </div>

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

          {/* Loading State */}
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Posts Feed */}
          {!loading && !error && filteredPosts.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                {feedFilter === 'lana' ? 'No Lana posts found. Try switching to "All".' : 'No posts found. Be the first to post!'}
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
                        {post.tags && (() => {
                          const tTag = post.tags.find(tag => tag[0] === 't');
                          const aTag = post.tags.find(tag => tag[0] === 'a');
                          if (tTag) return <Badge variant="secondary" className="text-xs">{tTag[1]}</Badge>;
                          if (aTag) return <Badge variant="secondary" className="text-xs">Room: {aTag[1]}</Badge>;
                          return null;
                        })()}
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
                    <PostContent content={post.content} tags={post.tags} nostrHexId={session?.nostrHexId} />
                    <div className="flex items-center gap-6 text-muted-foreground">
                      {/* LASH — only if author has LANA wallet */}
                      {post.profile?.lana_wallet_id && (
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
                      )}
                      <button
                        className="flex items-center gap-2 hover:text-primary transition-colors"
                        onClick={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span className="text-sm">{post.replyCount || 0}</span>
                      </button>
                      {/* OWN — only if author has LANA wallet */}
                      {post.profile?.lana_wallet_id && (
                        <button
                          className="flex items-center gap-2 hover:text-primary transition-colors"
                          onClick={() => navigate(`/own/start/${post.id}`)}
                          title="Start OWN process"
                        >
                          <Triangle className="h-4 w-4" />
                          <span className="text-sm">OWN</span>
                        </button>
                      )}
                      {/* ROCK — only if author has LANA wallet */}
                      {post.profile?.lana_wallet_id && (
                        <button
                          className="flex items-center gap-2 hover:text-green-600 transition-colors"
                          onClick={() => navigate(`/rock/grant-new?pubkey=${post.pubkey}`)}
                          title="Grant ROCK endorsement"
                        >
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm">ROCK</span>
                        </button>
                      )}
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

              {/* Infinite scroll trigger — only show when there are visible filtered posts and more to load */}
              {hasMore && filteredPosts.length > 0 && (
                <div ref={loadMoreRef} className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>
        </div>

        {/* Desktop Relay Sidebar */}
        <div className="hidden lg:block w-[250px] shrink-0">
          <div className="sticky top-20">
            <Card>
              <CardContent className="pt-4">
                <RelayFilter />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
