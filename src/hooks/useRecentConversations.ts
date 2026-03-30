import { useMemo } from 'react';
import { nip04 } from 'nostr-tools';
import { nip04Decrypt as customNip04Decrypt } from '@/lib/nostr-nip04';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';
import { useQuery } from '@tanstack/react-query';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function tryDecrypt(content: string, privateKeyHex: string, theirPubkey: string): Promise<string> {
  try {
    return await nip04.decrypt(privateKeyHex, theirPubkey, content);
  } catch {
    try {
      return await customNip04Decrypt(content, privateKeyHex, theirPubkey);
    } catch {
      return '';
    }
  }
}

interface RecentConversation {
  pubkey: string;
  displayName: string;
  preview: string;
  timestamp: number;
  unreadCount: number;
  isOwnMessage: boolean;
}

/**
 * Lightweight hook for home page DM previews.
 * Fetches recent DM events (no polling), decrypts only the last message per conversation.
 * Much lighter than useNostrDMs which polls every 10s and decrypts everything.
 */
export function useRecentConversations(maxConversations = 3) {
  const { session } = useAuth();
  const userPubkey = session?.nostrHexId;
  const privateKey = session?.nostrPrivateKey;

  // Fetch recent DM events from server (single request, no polling)
  const { data: rawEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['recent-dm-events', userPubkey],
    queryFn: async () => {
      const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
      const res = await fetch(`${API_URL}/api/functions/fetch-dm-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPubkey, since: fourteenDaysAgo }),
      });
      const data = await res.json();
      return data?.events || [];
    },
    enabled: !!userPubkey,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Group by conversation partner, keep only the most recent event per partner
  const latestPerConversation = useMemo(() => {
    if (!userPubkey || rawEvents.length === 0) return [];

    const map = new Map<string, any>();
    for (const evt of rawEvents) {
      const isOwn = evt.pubkey === userPubkey;
      const partnerPubkey = isOwn
        ? evt.tags?.find((t: string[]) => t[0] === 'p')?.[1]
        : evt.pubkey;
      if (!partnerPubkey) continue;

      const existing = map.get(partnerPubkey);
      if (!existing || evt.created_at > existing.created_at) {
        map.set(partnerPubkey, { ...evt, _isOwn: isOwn, _partnerPubkey: partnerPubkey });
      }
    }

    // Sort by timestamp descending, take top N
    return Array.from(map.values())
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, maxConversations);
  }, [rawEvents, userPubkey, maxConversations]);

  // Fetch profiles for conversation partners
  const partnerPubkeys = useMemo(
    () => latestPerConversation.map(e => e._partnerPubkey),
    [latestPerConversation]
  );
  const { profiles } = useNostrProfilesCacheBulk(partnerPubkeys);

  // Decrypt only the latest message per conversation (max 3 decryptions)
  const { data: conversations = [], isLoading: decrypting } = useQuery<RecentConversation[]>({
    queryKey: ['recent-dm-decrypted', latestPerConversation.map(e => e.id).join(',')],
    queryFn: async () => {
      if (!privateKey || latestPerConversation.length === 0) return [];

      const privateKeyHex = typeof privateKey === 'string'
        ? privateKey
        : bytesToHex(privateKey);

      const results: RecentConversation[] = [];

      for (const evt of latestPerConversation) {
        const partnerPubkey = evt._partnerPubkey;
        const isOwn = evt._isOwn;
        const profile = profiles.get(partnerPubkey);
        const displayName = profile?.display_name || profile?.full_name || partnerPubkey.slice(0, 12) + '...';

        let preview = '';
        try {
          const decrypted = await tryDecrypt(evt.content, privateKeyHex, partnerPubkey);
          if (decrypted.startsWith('audio:') || decrypted.includes('dm-audio')) {
            preview = isOwn ? 'You: 🎵 Audio' : '🎵 Audio';
          } else if (decrypted.startsWith('image:') || decrypted.includes('dm-images')) {
            preview = isOwn ? 'You: 📷 Image' : '📷 Image';
          } else {
            const text = decrypted.length > 50 ? decrypted.slice(0, 47) + '...' : decrypted;
            preview = isOwn ? `You: ${text}` : text;
          }
        } catch {
          preview = '...';
        }

        results.push({
          pubkey: partnerPubkey,
          displayName,
          preview,
          timestamp: evt.created_at,
          unreadCount: 0, // Skip unread count on home page for speed
          isOwnMessage: isOwn,
        });
      }

      return results;
    },
    enabled: latestPerConversation.length > 0 && !!privateKey,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    conversations,
    loading: eventsLoading || decrypting,
  };
}
