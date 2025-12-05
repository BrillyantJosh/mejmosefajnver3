import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, Clock } from "lucide-react";
import { useNostrRooms } from "@/hooks/useNostrRooms";
import { useNostrRoomPostCounts } from "@/hooks/useNostrRoomPostCounts";
import { useNostrRoomLatestPosts } from "@/hooks/useNostrRoomLatestPosts";
import { getProxiedImageUrl } from "@/lib/imageProxy";

interface NostrRoom {
  slug: string;
  title: string;
  visibility: 'public' | 'gated' | 'private';
  status: 'active' | 'archived';
  langs?: string[];
  icon?: string;
  order: number;
  description?: string;
  owners?: string[];
  publishers?: string[];
  rules?: string[];
  members?: number;
}

// Featured card with large image
function FeaturedCard({ 
  room, 
  latestPost, 
  postCount, 
  onClick,
  size = 'large'
}: { 
  room: NostrRoom; 
  latestPost?: { content: string; imageUrl?: string; created_at: number };
  postCount: number;
  onClick: () => void;
  size?: 'hero' | 'large' | 'medium' | 'small';
}) {
  const imageUrl = latestPost?.imageUrl 
    ? getProxiedImageUrl(latestPost.imageUrl, latestPost.created_at) 
    : undefined;
  
  const isLargeSize = size === 'hero' || size === 'large';
  const previewText = latestPost?.content
    ? latestPost.content.replace(/https?:\/\/[^\s]+/g, '').slice(0, isLargeSize ? 150 : 80).trim()
    : room.description?.slice(0, isLargeSize ? 150 : 80);

  const heightClass = size === 'hero' ? 'h-full min-h-[500px]' : size === 'large' ? 'h-[400px]' : size === 'medium' ? 'h-[240px]' : 'h-[180px]';

  return (
    <div 
      onClick={onClick}
      className={`relative ${heightClass} rounded-lg overflow-hidden cursor-pointer group transition-transform hover:scale-[1.02]`}
    >
      {/* Background Image or Gradient */}
      {imageUrl ? (
        <img 
          src={imageUrl} 
          alt={room.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-accent/80" />
      )}
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      
      {/* Room Badge */}
      <div className="absolute top-3 left-3">
        <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-bold uppercase rounded">
          {room.icon} {room.title}
        </span>
      </div>
      
      {/* Post Count */}
      <div className="absolute top-3 right-3 flex items-center gap-1 text-white/80 text-sm">
        <MessageSquare className="w-4 h-4" />
        <span>{postCount}</span>
      </div>
      
      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
        <h3 className={`font-bold leading-tight mb-2 ${isLargeSize ? 'text-2xl' : 'text-lg'}`}>
          {room.title}
        </h3>
        {previewText && (
          <p className={`text-white/80 line-clamp-2 ${isLargeSize ? 'text-sm' : 'text-xs'}`}>
            {previewText}...
          </p>
        )}
        {room.description && isLargeSize && (
          <p className="text-white/60 text-xs mt-2 line-clamp-1">
            {room.description}
          </p>
        )}
      </div>
    </div>
  );
}

// Simple list item without image
function SimpleRoomItem({ 
  room, 
  postCount,
  onClick 
}: { 
  room: NostrRoom; 
  postCount: number;
  onClick: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{room.icon || '📰'}</span>
        <div>
          <h4 className="font-medium text-sm">{room.title}</h4>
          {room.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{room.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <MessageSquare className="w-3 h-3" />
        <span>{postCount}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { rooms, loading } = useNostrRooms();
  
  const roomSlugs = useMemo(() => rooms.map(r => r.slug), [rooms]);
  const { postCounts, loading: loadingCounts } = useNostrRoomPostCounts(roomSlugs);
  const { latestPosts, loading: loadingPosts } = useNostrRoomLatestPosts(roomSlugs);

  // Sort rooms into categories
  const { featuredRooms, last24hRooms, lastWeekRooms, otherRooms } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const oneWeekAgo = now - 604800;

    // Rooms with explicit order (first 4, with default room at position 2)
    const orderedRooms = rooms
      .filter(r => r.order < 9999)
      .sort((a, b) => a.order - b.order);
    
    // Find default room and insert at position 2
    const defaultRoom = rooms.find(r => r.slug === 'default' || r.slug === 'general');
    let featured = orderedRooms.slice(0, 4);
    
    if (defaultRoom && !featured.some(r => r.slug === defaultRoom.slug)) {
      featured = [featured[0], defaultRoom, ...featured.slice(1, 3)].filter(Boolean);
    }

    // Remaining rooms
    const featuredSlugs = new Set(featured.map(r => r.slug));
    const remaining = rooms.filter(r => !featuredSlugs.has(r.slug));

    // Categorize by activity
    const last24h: NostrRoom[] = [];
    const lastWeek: NostrRoom[] = [];
    const other: NostrRoom[] = [];

    remaining.forEach(room => {
      const post = latestPosts.get(room.slug);
      if (post) {
        if (post.created_at >= oneDayAgo) {
          last24h.push(room);
        } else if (post.created_at >= oneWeekAgo) {
          lastWeek.push(room);
        } else {
          other.push(room);
        }
      } else {
        other.push(room);
      }
    });

    // Sort by post count
    const sortByPosts = (a: NostrRoom, b: NostrRoom) => 
      (postCounts[b.slug] || 0) - (postCounts[a.slug] || 0);

    return {
      featuredRooms: featured.slice(0, 4),
      last24hRooms: last24h.sort(sortByPosts).slice(0, 4),
      lastWeekRooms: lastWeek.sort(sortByPosts).slice(0, 5),
      otherRooms: other.sort(sortByPosts)
    };
  }, [rooms, latestPosts, postCounts]);

  const handleRoomClick = (roomSlug: string) => {
    // Navigate to feed with room filter
    navigate(`/social/feed/${roomSlug}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-8">
      {/* Featured Section - Grid Layout like siol.net */}
      {featuredRooms.length > 0 && (
        <section>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Main featured (large, spans full height) */}
            {featuredRooms[0] && (
              <div className="lg:row-span-2">
                <FeaturedCard
                  room={featuredRooms[0]}
                  latestPost={latestPosts.get(featuredRooms[0].slug)}
                  postCount={postCounts[featuredRooms[0].slug] || 0}
                  onClick={() => handleRoomClick(featuredRooms[0].slug)}
                  size="hero"
                />
              </div>
            )}
            
            {/* Right top: Medium card */}
            {featuredRooms[1] && (
              <FeaturedCard
                room={featuredRooms[1]}
                latestPost={latestPosts.get(featuredRooms[1].slug)}
                postCount={postCounts[featuredRooms[1].slug] || 0}
                onClick={() => handleRoomClick(featuredRooms[1].slug)}
                size="medium"
              />
            )}
            
            {/* Right bottom: Two small cards side by side */}
            <div className="grid grid-cols-2 gap-4">
              {featuredRooms.slice(2, 4).map(room => (
                <FeaturedCard
                  key={room.slug}
                  room={room}
                  latestPost={latestPosts.get(room.slug)}
                  postCount={postCounts[room.slug] || 0}
                  onClick={() => handleRoomClick(room.slug)}
                  size="small"
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Last 24 Hours Section */}
      {last24hRooms.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold">Last 24 Hours</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {last24hRooms.map(room => (
              <FeaturedCard
                key={room.slug}
                room={room}
                latestPost={latestPosts.get(room.slug)}
                postCount={postCounts[room.slug] || 0}
                onClick={() => handleRoomClick(room.slug)}
                size="small"
              />
            ))}
          </div>
        </section>
      )}

      {/* Last Week Section */}
      {lastWeekRooms.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-xl font-bold text-muted-foreground">Last Week</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {lastWeekRooms.map(room => (
              <FeaturedCard
                key={room.slug}
                room={room}
                latestPost={latestPosts.get(room.slug)}
                postCount={postCounts[room.slug] || 0}
                onClick={() => handleRoomClick(room.slug)}
                size="small"
              />
            ))}
          </div>
        </section>
      )}

      {/* Other Rooms - Simple List */}
      {otherRooms.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-muted-foreground">More Rooms</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 bg-card rounded-lg p-2">
            {otherRooms.map(room => (
              <SimpleRoomItem
                key={room.slug}
                room={room}
                postCount={postCounts[room.slug] || 0}
                onClick={() => handleRoomClick(room.slug)}
              />
            ))}
          </div>
        </section>
      )}

      {rooms.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          No rooms available yet.
        </div>
      )}
    </div>
  );
}

