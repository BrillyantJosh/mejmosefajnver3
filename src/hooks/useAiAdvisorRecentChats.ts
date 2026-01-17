import { useState, useEffect, useMemo, useCallback } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { supabase } from '@/integrations/supabase/client';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';
import { formatDistanceToNow } from 'date-fns';

// Default fallback relays (only LANA relays)
const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface RecentChatSummary {
  conversationPubkey: string;
  displayName: string;
  lastMessagePreview: string;
  lastMessageTime: number;
  lastMessageTimeFormatted: string;
  lastMessageTimeAgo: string;
  unreadCount: number;
  isFromMe: boolean;
  chatLink: string;
}

export interface RecentChatsContext {
  recentChats: RecentChatSummary[];
  totalChats: number;
  totalUnread: number;
  hasNewMessages: boolean;
  newestMessageTime: number | null;
  newestMessageTimeFormatted: string | null;
}

export function useAiAdvisorRecentChats() {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [conversations, setConversations] = useState<Map<string, { 
    messages: { id: string; content: string; created_at: number; isOwn: boolean }[];
    unreadIds: Set<string>;
  }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Get relays from system parameters or use default
  const RELAYS = useMemo(() => {
    if (systemParameters?.relays && systemParameters.relays.length > 0) {
      return systemParameters.relays;
    }
    return DEFAULT_RELAYS;
  }, [systemParameters?.relays]);

  // Get all conversation pubkeys for bulk profile fetching
  const conversationPubkeys = useMemo(() => 
    Array.from(conversations.keys()),
    [conversations]
  );

  // Use bulk profile cache
  const { profiles } = useNostrProfilesCacheBulk(conversationPubkeys);

  // Load read statuses from Supabase
  const loadUnreadMessageIds = useCallback(async (userNostrId: string): Promise<Set<string>> => {
    try {
      const { data, error } = await supabase
        .from('dm_read_status')
        .select('message_event_id')
        .eq('user_nostr_id', userNostrId)
        .eq('is_read', false);
        
      if (error) {
        console.error('❌ Error loading unread statuses for AI:', error);
        return new Set();
      }
      
      return new Set(data?.map(d => d.message_event_id) || []);
    } catch (error) {
      console.error('❌ Exception in loadUnreadMessageIds:', error);
      return new Set();
    }
  }, []);

  // Load recent messages (last 7 days) for AI context
  useEffect(() => {
    if (!session?.nostrHexId) {
      setIsLoading(false);
      return;
    }

    let isSubscribed = true;
    const pool = new SimplePool();

    const loadRecentMessages = async () => {
      setIsLoading(true);
      
      try {
        // Get unread message IDs
        const unreadIds = await loadUnreadMessageIds(session.nostrHexId);
        
        // Query messages from last 7 days
        const oneWeekAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        
        console.log('📥 Fetching recent DMs for AI context (last 7 days)...');
        
        // Query sent messages
        const sentPromise = Promise.race([
          pool.querySync(RELAYS, {
            kinds: [4],
            authors: [session.nostrHexId],
            since: oneWeekAgo
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 8000)
          )
        ]).catch(() => [] as Event[]);

        // Query received messages
        const receivedPromise = Promise.race([
          pool.querySync(RELAYS, {
            kinds: [4],
            '#p': [session.nostrHexId],
            since: oneWeekAgo
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 8000)
          )
        ]).catch(() => [] as Event[]);

        const [sentEvents, receivedEvents] = await Promise.all([sentPromise, receivedPromise]);

        if (!isSubscribed) return;

        console.log(`📨 Recent DMs: ${sentEvents.length} sent, ${receivedEvents.length} received`);

        // Process all messages
        const allEvents = [...sentEvents, ...receivedEvents];
        const conversationsMap = new Map<string, { 
          messages: { id: string; content: string; created_at: number; isOwn: boolean }[];
          unreadIds: Set<string>;
        }>();

        for (const event of allEvents) {
          const isOwn = event.pubkey === session.nostrHexId;
          const recipientPubkey = event.tags.find(tag => tag[0] === 'p')?.[1] || '';
          const otherPubkey = isOwn ? recipientPubkey : event.pubkey;

          if (!otherPubkey) continue;

          // Check if this message is actually for me
          const isForMe = isOwn || recipientPubkey === session.nostrHexId;
          if (!isForMe) continue;

          const existing = conversationsMap.get(otherPubkey) || { 
            messages: [], 
            unreadIds: new Set() 
          };

          // Check if already exists
          if (!existing.messages.some(m => m.id === event.id)) {
            existing.messages.push({
              id: event.id,
              content: event.content, // encrypted, just for reference
              created_at: event.created_at,
              isOwn
            });

            // Check if unread (only for received messages)
            if (!isOwn && unreadIds.has(event.id)) {
              existing.unreadIds.add(event.id);
            }

            conversationsMap.set(otherPubkey, existing);
          }
        }

        // Sort messages within each conversation
        conversationsMap.forEach(conv => {
          conv.messages.sort((a, b) => a.created_at - b.created_at);
        });

        setConversations(conversationsMap);
        setIsLoading(false);
        console.log(`✅ Loaded ${conversationsMap.size} recent conversations for AI`);

      } catch (error) {
        console.error('❌ Error loading recent chats for AI:', error);
        setIsLoading(false);
      } finally {
        pool.close(RELAYS);
      }
    };

    loadRecentMessages();

    return () => {
      isSubscribed = false;
    };
  }, [session?.nostrHexId, RELAYS, loadUnreadMessageIds]);

  // Process into context
  const recentChatsContext = useMemo<RecentChatsContext>(() => {
    const recentChats: RecentChatSummary[] = [];
    let totalUnread = 0;
    let newestMessageTime: number | null = null;

    conversations.forEach((conv, pubkey) => {
      if (conv.messages.length === 0) return;

      const lastMessage = conv.messages[conv.messages.length - 1];
      const unreadCount = conv.unreadIds.size;
      totalUnread += unreadCount;

      // Track newest message
      if (!newestMessageTime || lastMessage.created_at > newestMessageTime) {
        newestMessageTime = lastMessage.created_at;
      }

      // Get display name from profile
      const profile = profiles.get(pubkey);
      const displayName = profile?.display_name || profile?.full_name || `${pubkey.slice(0, 12)}...`;

      // Create preview (without decryption - just show it's encrypted or audio/image)
      let lastMessagePreview = 'Encrypted message';
      if (lastMessage.content.includes('dm-audio')) {
        lastMessagePreview = '🎤 Audio message';
      } else if (lastMessage.content.includes('dm-images')) {
        lastMessagePreview = '📷 Image message';
      }

      recentChats.push({
        conversationPubkey: pubkey,
        displayName,
        lastMessagePreview,
        lastMessageTime: lastMessage.created_at,
        lastMessageTimeFormatted: new Date(lastMessage.created_at * 1000).toLocaleDateString('sl-SI'),
        lastMessageTimeAgo: formatDistanceToNow(new Date(lastMessage.created_at * 1000), { addSuffix: true }),
        unreadCount,
        isFromMe: lastMessage.isOwn,
        chatLink: `/chat`,
      });
    });

    // Sort by most recent
    recentChats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

    return {
      recentChats,
      totalChats: recentChats.length,
      totalUnread,
      hasNewMessages: totalUnread > 0,
      newestMessageTime,
      newestMessageTimeFormatted: newestMessageTime 
        ? new Date(newestMessageTime * 1000).toLocaleDateString('sl-SI')
        : null,
    };
  }, [conversations, profiles]);

  return {
    recentChatsContext,
    isLoading,
  };
}
