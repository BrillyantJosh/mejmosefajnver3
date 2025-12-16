import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RoomLatestPost {
  room_slug: string;
  post_event_id: string;
  content: string;
  author_pubkey: string;
  created_at: number;
  image_url: string | null;
  post_count: number;
  fetched_at: string;
}

interface UseRoomLatestPostsFromDBResult {
  latestPosts: Map<string, { content: string; authorPubkey: string; createdAt: number; imageUrl?: string }>;
  postCounts: Record<string, number>;
  loading: boolean;
}

export function useRoomLatestPostsFromDB(): UseRoomLatestPostsFromDBResult {
  const [latestPosts, setLatestPosts] = useState<Map<string, { content: string; authorPubkey: string; createdAt: number; imageUrl?: string }>>(new Map());
  const [postCounts, setPostCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFromDB = async () => {
      try {
        const { data, error } = await supabase
          .from('room_latest_posts')
          .select('*');

        if (error) {
          console.error('Error fetching room posts from DB:', error);
          setLoading(false);
          return;
        }

        const postsMap = new Map<string, { content: string; authorPubkey: string; createdAt: number; imageUrl?: string }>();
        const countsMap: Record<string, number> = {};

        for (const post of (data as RoomLatestPost[]) || []) {
          postsMap.set(post.room_slug, {
            content: post.content,
            authorPubkey: post.author_pubkey,
            createdAt: post.created_at,
            imageUrl: post.image_url || undefined
          });
          countsMap[post.room_slug] = post.post_count;
        }

        setLatestPosts(postsMap);
        setPostCounts(countsMap);
      } catch (err) {
        console.error('Error in useRoomLatestPostsFromDB:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFromDB();
  }, []);

  return { latestPosts, postCounts, loading };
}
