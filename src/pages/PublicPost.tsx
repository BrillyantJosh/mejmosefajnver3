import { useParams } from "react-router-dom";
import { useNostrPost } from "@/hooks/useNostrPost";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PostContent } from "@/components/social/PostContent";
import { PostReplies } from "@/components/social/PostReplies";
import { getProxiedImageUrl } from "@/lib/imageProxy";

// Lana-specific relays where posts are stored
const LANA_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com',
  'wss://relay.lovelana.org'
];

// Fallback to generic Nostr relays
const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// Use Lana relays first, then fallback relays
const DEFAULT_RELAYS = [...LANA_RELAYS, ...FALLBACK_RELAYS];

export default function PublicPost() {
  const { eventId } = useParams<{ eventId: string }>();
  const { parameters } = useSystemParameters();
  
  const relays = parameters?.relays && parameters.relays.length > 0
    ? parameters.relays
    : DEFAULT_RELAYS;

  const { post, profile, loading, error } = useNostrPost(eventId || '', relays);

  const getDisplayName = () => {
    if (!post) return '';
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    return `${post.pubkey.slice(0, 8)}...`;
  };

  const getAvatarFallback = () => {
    const displayName = getDisplayName();
    return displayName.slice(0, 2).toUpperCase();
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading post from Nostr relays...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || 'Post not found'}
            </AlertDescription>
          </Alert>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Nostr Post</h1>
          <p className="text-sm text-muted-foreground">Viewing public post</p>
        </div>
        
        <Card>
          <CardHeader className="flex flex-row items-start gap-3">
            <Avatar>
              <AvatarImage src={getProxiedImageUrl(profile?.picture, Date.now())} />
              <AvatarFallback>{getAvatarFallback()}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="font-semibold">{getDisplayName()}</p>
              <p className="text-sm text-muted-foreground">
                {formatTime(post.created_at)}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <PostContent content={post.content} tags={post.tags} />
            <div className="pt-4 border-t">
              <PostReplies postId={post.id} relays={relays} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
