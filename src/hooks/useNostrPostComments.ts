import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface CommentNotification {
  commentId: string;
  commentContent: string;
  commentAuthor: string;
  commentAuthorProfile?: {
    name?: string;
    display_name?: string;
    picture?: string;
  };
  commentCreatedAt: number;
  originalPostId: string;
  originalPostContent: string;
  originalPostCreatedAt: number;
}

export const useNostrPostComments = () => {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [comments, setComments] = useState<CommentNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];
  const nostrPublicKey = session?.nostrHexId;

  useEffect(() => {
    if (!nostrPublicKey || relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchCommentsOnMyPosts = async () => {
      const pool = new SimplePool();
      
      try {
        // Step 1: Fetch my posts (kind 1, author = me)
        const myPosts = await Promise.race([
          pool.querySync(relays, {
            kinds: [1],
            authors: [nostrPublicKey],
            limit: 100,
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout fetching posts')), 10000)
          )
        ]);

        if (myPosts.length === 0) {
          setIsLoading(false);
          return;
        }

        // Create a map of post ID -> post content
        const postMap = new Map(
          myPosts.map(post => [post.id, { content: post.content, createdAt: post.created_at }])
        );

        const myPostIds = Array.from(postMap.keys());

        // Step 2: Fetch all comments (kind 1 events with "e" tag referencing my posts)
        const commentEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [1],
            '#e': myPostIds,
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout fetching comments')), 10000)
          )
        ]);

        // Filter out my own comments
        const otherComments = commentEvents.filter(comment => comment.pubkey !== nostrPublicKey);

        if (otherComments.length === 0) {
          setIsLoading(false);
          return;
        }

        // Step 3: Fetch profiles for comment authors
        const authorPubkeys = Array.from(new Set(otherComments.map(c => c.pubkey)));
        const profileEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [0],
            authors: authorPubkeys,
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout fetching profiles')), 5000)
          )
        ]);

        const profileMap = new Map(
          profileEvents.map(event => {
            try {
              return [event.pubkey, JSON.parse(event.content)];
            } catch {
              return [event.pubkey, {}];
            }
          })
        );

        // Step 4: Build comment notifications
        const notifications: CommentNotification[] = otherComments
          .map(comment => {
            // Find the referenced post ID
            const eTag = comment.tags.find(tag => tag[0] === 'e');
            if (!eTag || !eTag[1]) return null;

            const postId = eTag[1];
            const post = postMap.get(postId);
            if (!post) return null;

            return {
              commentId: comment.id,
              commentContent: comment.content,
              commentAuthor: comment.pubkey,
              commentAuthorProfile: profileMap.get(comment.pubkey),
              commentCreatedAt: comment.created_at,
              originalPostId: postId,
              originalPostContent: post.content,
              originalPostCreatedAt: post.createdAt,
            } as CommentNotification;
          })
          .filter((n: CommentNotification | null): n is CommentNotification => n !== null)
          .sort((a, b) => b.commentCreatedAt - a.commentCreatedAt);

        setComments(notifications);
      } catch (error) {
        console.error('Error fetching post comments:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchCommentsOnMyPosts();
  }, [nostrPublicKey, relays.join(',')]);

  return { comments, isLoading };
};
