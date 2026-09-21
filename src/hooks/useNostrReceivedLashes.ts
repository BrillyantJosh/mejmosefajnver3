import { useState, useEffect, useMemo, useRef } from 'react';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface ReceivedLash {
  lashId: string;
  senderPubkey: string;
  senderName?: string;
  senderDisplayName?: string;
  senderPicture?: string;
  amount: string; // lanoshis
  amountLana: string; // LANA
  createdAt: number;
  isPaid: boolean;
  postId?: string;
  postContent?: string;
  postAuthor?: string;
  memo?: string;
}

export function useNostrReceivedLashes() {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [receivedLashes, setReceivedLashes] = useState<ReceivedLash[]>([]);
  const [loading, setLoading] = useState(false);
  const profileCache = useRef<Map<string, any>>(new Map());
  const postCache = useRef<Map<string, any>>(new Map());

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (!session?.nostrHexId) {
      setReceivedLashes([]);
      return;
    }

    let isSubscribed = true;

    const fetchReceivedLashes = async () => {
      setLoading(true);

      try {
        console.log('💜 Fetching received LASHes...');

        // Fetch KIND 39991 events where "p" tag equals current user's pubkey
        // Through this app's server — see src/lib/relayReadViaServer.ts. These
        // are what somebody owes this person; a short list is money not shown.
        const paymentRecords = await queryEventsViaServer({
          kinds: [39991],
          '#p': [session.nostrHexId],
          limit: 1000
        }, { timeout: 10000, label: 'LASHes I received (KIND 39991)' }).catch(err => {
          console.error('❌ Payment intents query failed:', err);
          return [];
        });

        console.log('💜 Found', paymentRecords.length, 'payment records to me');

        if (!isSubscribed || paymentRecords.length === 0) {
          setReceivedLashes([]);
          setLoading(false);
          return;
        }

        // With Protocol 2.0, payment state is in the event itself (state="paid")
        // No need to fetch separate confirmation events
        const paidLashIds = new Set(
          paymentRecords
            .filter(event => {
              const stateTag = event.tags.find((tag: string[]) => tag[0] === 'state');
              return stateTag?.[1] === 'paid';
            })
            .map(event => event.tags.find((tag: string[]) => tag[0] === 'd')?.[1])
            .filter(Boolean)
        );

        console.log('💜 Found', paidLashIds.size, 'paid LASHes');

        // Fetch sender profiles
        const senderPubkeys = [...new Set(paymentRecords.map((e: any) => e.pubkey))];
        const profiles = await fetchProfiles(senderPubkeys);

        // Fetch referenced posts
        const postIds = paymentRecords
          .map((event: any) => event.tags.find((tag: string[]) => tag[0] === 'e')?.[1])
          .filter(Boolean);
        const posts = await fetchPosts([...new Set(postIds)]);

        if (!isSubscribed) return;

        // Build received lashes array
        const lashes: ReceivedLash[] = paymentRecords.map((event: any) => {
          const lashId = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
          const amount = event.tags.find((tag: string[]) => tag[0] === 'amount')?.[1] || '0';
          const postId = event.tags.find((tag: string[]) => tag[0] === 'e')?.[1];
          const memo = event.tags.find((tag: string[]) => tag[0] === 'memo')?.[1];

          const senderProfile = profiles.get(event.pubkey);
          const post = postId ? posts.get(postId) : undefined;

          const amountNum = parseInt(amount);
          const amountLana = (amountNum / 100000000).toFixed(8);

          return {
            lashId,
            senderPubkey: event.pubkey,
            senderName: senderProfile?.name,
            senderDisplayName: senderProfile?.display_name,
            senderPicture: senderProfile?.picture,
            amount,
            amountLana,
            createdAt: event.created_at,
            isPaid: paidLashIds.has(lashId),
            postId,
            postContent: post?.content,
            postAuthor: post?.author,
            memo
          };
        });

        // Sort by date (newest first)
        lashes.sort((a, b) => b.createdAt - a.createdAt);

        setReceivedLashes(lashes);
        setLoading(false);

      } catch (error) {
        console.error('❌ Error fetching received LASHes:', error);
        setLoading(false);
      }
    };

    const fetchProfiles = async (pubkeys: string[]) => {
      const profileMap = new Map();
      const uncachedPubkeys = pubkeys.filter(pk => !profileCache.current.has(pk));

      if (uncachedPubkeys.length > 0) {
        try {
          const profileEvents = await queryEventsViaServer({
            kinds: [0],
            authors: uncachedPubkeys,
            limit: uncachedPubkeys.length
          }, { label: 'LASHer profiles (KIND 0)' });

          for (const event of profileEvents) {
            try {
              const content = JSON.parse(event.content);
              profileCache.current.set(event.pubkey, content);
            } catch (error) {
              console.error('Error parsing profile:', error);
            }
          }
        } catch (error) {
          console.error('Error fetching profiles:', error);
        }
      }

      // Build map from cache
      for (const pubkey of pubkeys) {
        if (profileCache.current.has(pubkey)) {
          profileMap.set(pubkey, profileCache.current.get(pubkey));
        }
      }

      return profileMap;
    };

    const fetchPosts = async (postIds: string[]) => {
      const postMap = new Map();
      const uncachedPostIds = postIds.filter(id => !postCache.current.has(id));

      if (uncachedPostIds.length > 0) {
        try {
          const postEvents = await queryEventsViaServer({
            kinds: [1], // Text notes
            ids: uncachedPostIds,
            limit: uncachedPostIds.length
          }, { label: 'posts behind the LASHes (KIND 1)' });

          for (const event of postEvents) {
            postCache.current.set(event.id, {
              content: event.content,
              author: event.pubkey
            });
          }
        } catch (error) {
          console.error('Error fetching posts:', error);
        }
      }

      // Build map from cache
      for (const postId of postIds) {
        if (postCache.current.has(postId)) {
          postMap.set(postId, postCache.current.get(postId));
        }
      }

      return postMap;
    };

    fetchReceivedLashes();

    return () => {
      isSubscribed = false;
    };
  }, [session?.nostrHexId, relays.join(',')]);

  return { receivedLashes, loading };
}
