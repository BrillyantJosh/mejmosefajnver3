import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { SimplePool } from "nostr-tools";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Heart, MessageCircle, ArrowLeft, MapPin, Globe, Wallet, User, Sparkles, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useLashHistory } from "@/hooks/useLashHistory";
import { PostContent } from "@/components/social/PostContent";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import type { NostrProfile } from "@/hooks/useNostrProfile";

interface UserPost {
  id: string;
  content: string;
  created_at: number;
  tags: string[][];
  pubkey: string;
}

export default function UserProfile() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();
  const { parameters: systemParameters } = useSystemParameters();
  const { session } = useAuth();
  const { toast } = useToast();
  const { giveLash } = useNostrLash();
  const { incrementUnpaidCount } = useNostrUnpaidLashes();
  const { fetchUserLashes, addLash } = useLashHistory();

  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [posts, setPosts] = useState<UserPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [lashedEvents, setLashedEvents] = useState<Set<string>>(new Set());

  const relays = systemParameters?.relays || [];

  // Fetch profile and posts
  useEffect(() => {
    if (!pubkey) return;

    const fetchData = async () => {
      setLoading(true);
      const pool = new SimplePool();

      try {
        // Fetch KIND 0 profile
        const profileEvent = await Promise.race([
          pool.get(relays, {
            kinds: [0],
            authors: [pubkey],
            limit: 1
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
        ]);

        if (profileEvent?.content) {
          try {
            const content = JSON.parse(profileEvent.content);
            const langTag = profileEvent.tags.find(t => t[0] === 'lang')?.[1];
            const interestTags = profileEvent.tags.filter(t => t[0] === 't').map(t => t[1]);
            const intimateTags = profileEvent.tags.filter(t => t[0] === 'o').map(t => t[1]);
            
            setProfile({
              ...content,
              lang: langTag,
              interests: interestTags,
              intimateInterests: intimateTags
            });
          } catch (e) {
            console.error('Failed to parse profile:', e);
          }
        }

        // Fetch user's posts (KIND 1)
        const userPostsEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [1],
            authors: [pubkey],
            limit: 50
          }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000))
        ]);

        // Filter out replies (posts with 'e' tag are comments)
        const userPosts: UserPost[] = userPostsEvents
          .filter((event: any) => {
            const hasReplyTag = event.tags?.some((tag: string[]) => tag[0] === 'e');
            return !hasReplyTag; // Only keep original posts, not replies
          })
          .map((event: any) => ({
            id: event.id,
            content: event.content,
            created_at: event.created_at,
            tags: event.tags,
            pubkey: event.pubkey
          }));

        // Sort by created_at descending
        userPosts.sort((a, b) => b.created_at - a.created_at);
        setPosts(userPosts);

      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoading(false);
        pool.close(relays);
      }
    };

    fetchData();
  }, [pubkey, relays]);

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

  const handleGiveLash = async (postId: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to give LASH",
        variant: "destructive"
      });
      return;
    }

    if (!profile?.lanaWalletID) {
      toast({
        title: "Error",
        description: "User wallet not found",
        variant: "destructive"
      });
      return;
    }

    // Optimistic update
    setLashedEvents(prev => new Set(prev).add(postId));
    incrementUnpaidCount();

    // Save to Supabase
    await addLash(postId);

    // Publish to Nostr
    const result = await giveLash({
      postId,
      recipientPubkey: pubkey!,
      recipientWallet: profile.lanaWalletID,
      memo: "LASH"
    });

    if (!result.success) {
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

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return 'recently';
    }
  };

  const getDisplayName = () => {
    if (!profile) return pubkey?.slice(0, 8) + '...';
    return profile.display_name || profile.name || pubkey?.slice(0, 8) + '...';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      {/* Profile Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20">
              {profile?.picture && (
                <AvatarImage 
                  src={getProxiedImageUrl(profile.picture)} 
                  alt={getDisplayName()} 
                />
              )}
              <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white text-2xl font-bold">
                {getDisplayName()[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{profile?.display_name || profile?.name || 'Unknown'}</h1>
              {profile?.name && profile?.display_name && profile.name !== profile.display_name && (
                <p className="text-muted-foreground">@{profile.name}</p>
              )}
              {profile?.nip05 && (
                <p className="text-sm text-primary">{profile.nip05}</p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* About */}
          {profile?.about && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">About</p>
              <p className="whitespace-pre-wrap">{profile.about}</p>
            </div>
          )}

          <Separator />

          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Location */}
            {(profile?.location || profile?.country) && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {profile.location}{profile.country && `, ${profile.country}`}
                </span>
              </div>
            )}

            {/* Website */}
            {profile?.website && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <a 
                  href={profile.website} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline truncate"
                >
                  {profile.website}
                </a>
              </div>
            )}

            {/* Lana Wallet */}
            {profile?.lanaWalletID && (
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-mono truncate">{profile.lanaWalletID}</span>
              </div>
            )}

            {/* Who Are You */}
            {profile?.whoAreYou && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary">{profile.whoAreYou}</Badge>
              </div>
            )}

            {/* Currency */}
            {profile?.currency && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Currency:</span>
                <Badge variant="outline">{profile.currency}</Badge>
              </div>
            )}

            {/* Language */}
            {profile?.lang && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Language:</span>
                <Badge variant="outline">{profile.lang}</Badge>
              </div>
            )}

            {/* Lanoshi2Lash */}
            {profile?.lanoshi2lash && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Lanoshi2Lash:</span>
                <span className="text-sm font-mono">{profile.lanoshi2lash}</span>
              </div>
            )}
          </div>

          {/* Orgasmic Profile */}
          {profile?.orgasmic_profile && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-pink-500" />
                  <span className="text-sm font-medium">Orgasmic Profile</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{profile.orgasmic_profile}</p>
              </div>
            </>
          )}

          {/* Interests */}
          {profile?.interests && profile.interests.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-2">Interests</p>
                <div className="flex flex-wrap gap-2">
                  {profile.interests.map((interest, idx) => (
                    <Badge key={idx} variant="secondary">{interest}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Intimate Interests */}
          {profile?.intimateInterests && profile.intimateInterests.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-2">Intimate Interests</p>
                <div className="flex flex-wrap gap-2">
                  {profile.intimateInterests.map((interest, idx) => (
                    <Badge key={idx} variant="outline" className="border-pink-500/50">{interest}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Statement of Responsibility */}
          {profile?.statement_of_responsibility && (
            <>
              <Separator />
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Statement of Responsibility</p>
                <p className="text-sm italic">"{profile.statement_of_responsibility}"</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Posts Section */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Posts ({posts.length})</h2>
      </div>

      {posts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No posts found from this user.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 pb-8">
          {posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="pt-6">
                <PostContent content={post.content} tags={post.tags} />
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <button 
                      className={`flex items-center gap-1.5 transition-all duration-200 ${
                        lashedEvents.has(post.id) 
                          ? 'text-green-500' 
                          : 'hover:text-green-500 hover:scale-110'
                      }`}
                      onClick={() => !lashedEvents.has(post.id) && handleGiveLash(post.id)}
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
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatTime(post.created_at)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
