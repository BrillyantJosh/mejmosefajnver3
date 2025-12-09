import { useState, useEffect, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface RoomLatestPost {
  roomSlug: string;
  postId: string;
  content: string;
  created_at: number;
  imageUrl?: string;
  authorPubkey: string;
}

// Extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Get YouTube thumbnail URL
function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

// Extract best image from post content and tags
function extractImageFromPost(event: Event): string | undefined {
  const content = event.content;
  
  // 1. Check for direct image URLs in content
  const imageMatch = content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?/i);
  if (imageMatch) {
    return imageMatch[0];
  }
  
  // 2. Check for YouTube URLs and get thumbnail
  const youtubeUrls = content.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=)[^\s]+/gi);
  if (youtubeUrls) {
    for (const url of youtubeUrls) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        return getYouTubeThumbnail(videoId);
      }
    }
  }
  
  // 3. Check imurl tag (commonly used for images)
  const imurlTag = event.tags.find(t => t[0] === 'imurl');
  if (imurlTag && imurlTag[1]) {
    return imurlTag[1];
  }
  
  // 4. Check imeta tags for images
  const imetaTag = event.tags.find(t => t[0] === 'imeta');
  if (imetaTag) {
    const urlMatch = imetaTag.find(v => v.startsWith('url '));
    if (urlMatch) {
      return urlMatch.replace('url ', '');
    }
  }
  
  // 5. Check image tag
  const imageTag = event.tags.find(t => t[0] === 'image');
  if (imageTag && imageTag[1]) {
    return imageTag[1];
  }
  
  // 5. Check r tag for media URLs
  const rTags = event.tags.filter(t => t[0] === 'r');
  for (const rTag of rTags) {
    const url = rTag[1];
    if (url && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
      return url;
    }
    // Check if r tag is YouTube
    const ytId = extractYouTubeId(url);
    if (ytId) {
      return getYouTubeThumbnail(ytId);
    }
  }
  
  return undefined;
}

export function useNostrRoomLatestPosts(roomSlugs: string[]) {
  const [latestPosts, setLatestPosts] = useState<Map<string, RoomLatestPost>>(new Map());
  const [loading, setLoading] = useState(true);
  const { parameters } = useSystemParameters();

  const RELAYS = useMemo(() => {
    return parameters?.relays || [
      "wss://relay.lanavault.space",
      "wss://relay.lanacoin-eternity.com",
      "wss://relay.lanaheartvoice.com"
    ];
  }, [parameters]);

  useEffect(() => {
    if (roomSlugs.length === 0) {
      setLoading(false);
      return;
    }

    const pool = new SimplePool();
    let isMounted = true;

    const fetchLatestPosts = async () => {
      try {
        setLoading(true);

        const postsMap = new Map<string, RoomLatestPost>();

        // Fetch posts for each room slug
        for (const slug of roomSlugs) {
          try {
            // Query with 't' tag
            const events = await pool.querySync(RELAYS, {
              kinds: [1],
              '#t': [slug],
              limit: 10
            });

            // Also query with 'a' tag
            const eventsA = await pool.querySync(RELAYS, {
              kinds: [1],
              '#a': [slug],
              limit: 10
            });

            const allEvents = [...events, ...eventsA];

            if (allEvents.length > 0) {
              // Sort by created_at descending - newest first
              allEvents.sort((a, b) => b.created_at - a.created_at);
              
              // ALWAYS use the latest post for content
              const latestEvent = allEvents[0];
              
              // Try to extract image from the latest post first
              let imageUrl = extractImageFromPost(latestEvent);
              
              // If latest post has no image, try to find one from recent posts (within last 5)
              if (!imageUrl) {
                for (let i = 1; i < Math.min(allEvents.length, 5); i++) {
                  const extractedImage = extractImageFromPost(allEvents[i]);
                  if (extractedImage) {
                    imageUrl = extractedImage;
                    break;
                  }
                }
              }

              postsMap.set(slug, {
                roomSlug: slug,
                postId: latestEvent.id,
                content: latestEvent.content,
                created_at: latestEvent.created_at,
                imageUrl,
                authorPubkey: latestEvent.pubkey
              });
            }
          } catch (err) {
            console.warn(`Error fetching posts for room ${slug}:`, err);
          }
        }

        if (isMounted) {
          setLatestPosts(postsMap);
        }
      } catch (error) {
        console.error('Error fetching latest posts:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchLatestPosts();

    return () => {
      isMounted = false;
      pool.close(RELAYS);
    };
  }, [roomSlugs.join(','), RELAYS]);

  return { latestPosts, loading };
}
