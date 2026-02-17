import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Event, finalizeEvent, nip04 } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { nip04Decrypt as customNip04Decrypt } from '@/lib/nostr-nip04';
import { supabase } from '@/integrations/supabase/client';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';
import { getAllCachedEvents, saveCachedEvents, deleteCachedEvent, getLatestTimestamp, setLatestTimestamp, type CachedEvent } from '@/lib/dmCache';

// Helper: Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper: Uint8Array to Hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Polling interval for new messages (milliseconds)
const POLL_INTERVAL_MS = 10000;

interface DirectMessage {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  decryptedContent?: string;
  isOwn: boolean;
  isRead?: boolean;
  replyToId?: string;
}

interface Conversation {
  pubkey: string;
  messages: DirectMessage[];
  lastMessage?: DirectMessage;
  unreadCount: number;
}

export function useNostrDMs() {
  const { session } = useAuth();
  const [conversations, setConversations] = useState<Map<string, Conversation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [totalEvents, setTotalEvents] = useState(0);
  const [readStatuses, setReadStatuses] = useState<Map<string, boolean>>(new Map());

  // Track seen event IDs to avoid re-processing
  const seenEventIds = useRef<Set<string>>(new Set());
  // Track the latest event timestamp for incremental polling
  const latestTimestamp = useRef<number>(0);
  // Track if initial load is done
  const initialLoadDone = useRef(false);
  // Guard against concurrent poll requests
  const isPolling = useRef(false);
  // Mirror readStatuses as ref to avoid re-triggering initial load effect
  const readStatusesRef = useRef<Map<string, boolean>>(new Map());
  readStatusesRef.current = readStatuses;

  // Get all conversation pubkeys for bulk profile fetching
  const conversationPubkeys = useMemo(() =>
    Array.from(conversations.keys()),
    [conversations]
  );

  // Use bulk profile cache
  const { profiles: cachedProfiles, isLoading: profilesLoading } = useNostrProfilesCacheBulk(conversationPubkeys);

  const decryptMessage = useCallback(async (event: Event, theirPubkey: string): Promise<string> => {
    if (!session?.nostrPrivateKey) return '';

    const privateKeyHex = typeof session.nostrPrivateKey === 'string'
      ? session.nostrPrivateKey
      : bytesToHex(session.nostrPrivateKey);

    // Try standard nostr-tools NIP-04 first (compatible with DAMUS, Amethyst, etc.)
    try {
      const decrypted = await nip04.decrypt(privateKeyHex, theirPubkey, event.content);
      return decrypted;
    } catch (error1) {
      // Fallback to custom implementation for old messages encrypted with our custom method
      try {
        const decrypted = await customNip04Decrypt(
          event.content,
          privateKeyHex,
          theirPubkey
        );
        return decrypted;
      } catch (error2) {
        console.error('❌ Both decrypt methods failed for event:', event.id.slice(0, 8));
        return `[Cannot decrypt - wrong key]`;
      }
    }
  }, [session?.nostrPrivateKey]);

  // Supabase read status functions
  const saveMessageReadStatus = useCallback(async (
    userNostrId: string,
    messageEventId: string,
    senderPubkey: string,
    conversationPubkey: string,
    isOwn: boolean
  ) => {
    if (isOwn) return;

    try {
      const { error } = await supabase
        .from('dm_read_status')
        .upsert({
          user_nostr_id: userNostrId,
          message_event_id: messageEventId,
          sender_pubkey: senderPubkey,
          conversation_pubkey: conversationPubkey,
          is_read: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_nostr_id,message_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('❌ Error saving read status:', error);
      }
    } catch (error) {
      console.error('❌ Exception in saveMessageReadStatus:', error);
    }
  }, []);

  const markMessagesAsReadInDB = useCallback(async (
    userNostrId: string,
    conversationPubkey: string
  ) => {
    try {
      const { error } = await supabase
        .from('dm_read_status')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_nostr_id', userNostrId)
        .eq('conversation_pubkey', conversationPubkey)
        .eq('is_read', false);

      if (error) {
        console.error('❌ Error marking messages as read:', error);
      }
    } catch (error) {
      console.error('❌ Exception in markMessagesAsReadInDB:', error);
    }
  }, []);

  const loadReadStatuses = useCallback(async (userNostrId: string) => {
    try {
      const { data, error } = await supabase
        .from('dm_read_status')
        .select('message_event_id, is_read')
        .eq('user_nostr_id', userNostrId);

      if (error) {
        console.error('❌ Error loading read statuses:', error);
        return new Map<string, boolean>();
      }

      const statusMap = new Map<string, boolean>();
      data?.forEach(status => {
        statusMap.set(status.message_event_id, status.is_read);
      });

      return statusMap;
    } catch (error) {
      console.error('❌ Exception in loadReadStatuses:', error);
      return new Map<string, boolean>();
    }
  }, []);

  const deleteReadStatus = useCallback(async (
    userNostrId: string,
    messageEventId: string
  ) => {
    try {
      const { error } = await supabase
        .from('dm_read_status')
        .delete()
        .eq('user_nostr_id', userNostrId)
        .eq('message_event_id', messageEventId);

      if (error) {
        console.error('❌ Error deleting read status:', error);
      }
    } catch (error) {
      console.error('❌ Exception in deleteReadStatus:', error);
    }
  }, []);

  // Load read statuses on mount
  useEffect(() => {
    if (!session?.nostrHexId) return;

    const loadStatuses = async () => {
      const statuses = await loadReadStatuses(session.nostrHexId);
      setReadStatuses(statuses);
    };

    loadStatuses();
  }, [session?.nostrHexId, loadReadStatuses]);

  const processMessage = useCallback(async (event: Event) => {
    if (!session?.nostrHexId) return;

    const isOwn = event.pubkey === session.nostrHexId;
    const recipientPubkey = event.tags.find(tag => tag[0] === 'p')?.[1] || '';
    const otherPubkey = isOwn ? recipientPubkey : event.pubkey;

    if (!otherPubkey) return;

    // Check if this message is actually for me
    const isForMe = isOwn || recipientPubkey === session.nostrHexId;
    if (!isForMe) return;

    // Check for reply tag
    const replyTag = event.tags.find(
      tag => tag[0] === 'e' && tag[3] === 'reply'
    );
    const replyToId = replyTag ? replyTag[1] : undefined;

    const decryptedContent = await decryptMessage(event, otherPubkey);

    // Save read status in database (only for received messages)
    if (!isOwn && session.nostrHexId) {
      await saveMessageReadStatus(
        session.nostrHexId,
        event.id,
        event.pubkey,
        otherPubkey,
        isOwn
      );
    }

    // Get read status from map (own messages are always "read")
    const isRead = isOwn ? true : (readStatuses.get(event.id) ?? false);

    const message: DirectMessage = {
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      created_at: event.created_at,
      decryptedContent,
      isOwn,
      isRead,
      replyToId
    };

    setConversations(prev => {
      const newConversations = new Map(prev);
      const existing = newConversations.get(otherPubkey) || {
        pubkey: otherPubkey,
        messages: [],
        unreadCount: 0
      };

      // Check if message already exists
      if (existing.messages.some(m => m.id === message.id)) {
        return prev;
      }

      const updatedMessages = [...existing.messages, message].sort(
        (a, b) => a.created_at - b.created_at
      );

      // Calculate unread count from actual read status
      const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

      newConversations.set(otherPubkey, {
        ...existing,
        messages: updatedMessages,
        lastMessage: updatedMessages[updatedMessages.length - 1],
        unreadCount
      });

      return newConversations;
    });
  }, [session?.nostrHexId, decryptMessage, readStatuses, saveMessageReadStatus]);

  // Batch decrypt messages in parallel for fast initial load
  const decryptMessagesBatch = useCallback(async (
    events: Event[],
    userHexId: string,
    batchSize = 50
  ) => {
    const results: Map<string, {
      decryptedContent: string;
      otherPubkey: string;
      isOwn: boolean;
      replyToId?: string;
      event: Event;
    }> = new Map();

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (event) => {
          const isOwn = event.pubkey === userHexId;
          const recipientPubkey = event.tags.find(tag => tag[0] === 'p')?.[1] || '';
          const otherPubkey = isOwn ? recipientPubkey : event.pubkey;

          if (!otherPubkey) return null;

          // Check if this message is actually for me
          const isForMe = isOwn || recipientPubkey === userHexId;
          if (!isForMe) return null;

          // Check for reply tag
          const replyTag = event.tags.find(
            tag => tag[0] === 'e' && tag[3] === 'reply'
          );
          const replyToId = replyTag ? replyTag[1] : undefined;

          const decryptedContent = await decryptMessage(event, otherPubkey);

          return {
            eventId: event.id,
            decryptedContent,
            otherPubkey,
            isOwn,
            replyToId,
            event
          };
        })
      );

      for (const result of batchResults) {
        if (result) {
          results.set(result.eventId, {
            decryptedContent: result.decryptedContent,
            otherPubkey: result.otherPubkey,
            isOwn: result.isOwn,
            replyToId: result.replyToId,
            event: result.event
          });
        }
      }
    }

    return results;
  }, [decryptMessage]);

  // Batch save read statuses (fire and forget, non-blocking)
  const saveBatchReadStatuses = useCallback(async (
    statuses: Array<{
      user_nostr_id: string;
      message_event_id: string;
      sender_pubkey: string;
      conversation_pubkey: string;
    }>
  ) => {
    if (statuses.length === 0) return;

    const CHUNK_SIZE = 100;
    for (let i = 0; i < statuses.length; i += CHUNK_SIZE) {
      const chunk = statuses.slice(i, i + CHUNK_SIZE);
      try {
        const rows = chunk.map(s => ({
          user_nostr_id: s.user_nostr_id,
          message_event_id: s.message_event_id,
          sender_pubkey: s.sender_pubkey,
          conversation_pubkey: s.conversation_pubkey,
          is_read: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        const { error } = await supabase
          .from('dm_read_status')
          .upsert(rows, {
            onConflict: 'user_nostr_id,message_event_id',
            ignoreDuplicates: true
          });

        if (error) {
          console.error('❌ Error batch saving read statuses:', error);
        }
      } catch (error) {
        console.error('❌ Exception in saveBatchReadStatuses:', error);
      }
    }
  }, []);

  // Fetch DM events from server endpoint
  const fetchDMEvents = useCallback(async (since?: number) => {
    if (!session?.nostrHexId) return [];

    try {
      const response = await supabase.functions.invoke('fetch-dm-events', {
        body: {
          userPubkey: session.nostrHexId,
          since: since || undefined
        }
      });

      if (response.error) {
        console.error('❌ Error fetching DM events:', response.error);
        return [];
      }

      const data = response.data as any;
      if (!data?.success) {
        console.error('❌ Server error fetching DM events:', data?.error);
        return [];
      }

      return data.events || [];
    } catch (error) {
      console.error('❌ Exception fetching DM events:', error);
      return [];
    }
  }, [session?.nostrHexId]);

  // Main effect: initial load + polling
  useEffect(() => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      setLoading(false);
      return;
    }

    let isActive = true;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const doInitialLoad = async () => {
      console.log('🔌 Loading DM messages...');
      setConnected(true);
      setLoading(true);

      // ═══════════════════════════════════════════════════════════════
      // PHASE 0: Load from IndexedDB cache (encrypted events → decrypt → show)
      // This skips the network round-trip and shows cached conversations fast
      // ═══════════════════════════════════════════════════════════════
      let cacheLoaded = false;
      try {
        const cachedEvents = await getAllCachedEvents(session!.nostrHexId);
        if (cachedEvents.length > 0) {
          console.log(`📦 Cache: ${cachedEvents.length} encrypted events found, decrypting...`);

          // Mark all cached events as seen to avoid re-processing
          cachedEvents.forEach(e => seenEventIds.current.add(e.id));

          // Convert CachedEvent[] → Event[] for decryptMessagesBatch
          const eventsAsNostr = cachedEvents.map(e => ({
            id: e.id,
            pubkey: e.pubkey,
            content: e.content,   // ⚠️ Still encrypted — decrypted in-memory only
            created_at: e.created_at,
            tags: e.tags,
            kind: 4,
            sig: ''               // Not needed for decryption
          })) as Event[];

          const cacheStartTime = Date.now();
          const decryptedCache = await decryptMessagesBatch(eventsAsNostr, session!.nostrHexId, 50);
          console.log(`🔓 Cache decrypted: ${decryptedCache.size} messages in ${Date.now() - cacheStartTime}ms`);

          if (!isActive) return;

          // Build conversations from cached data
          const readStatusPendingCache: Array<{
            user_nostr_id: string;
            message_event_id: string;
            sender_pubkey: string;
            conversation_pubkey: string;
          }> = [];

          for (const [, data] of decryptedCache) {
            const { isOwn, event, otherPubkey } = data;
            if (event.created_at > latestTimestamp.current) {
              latestTimestamp.current = event.created_at;
            }
            if (!isOwn && session?.nostrHexId) {
              readStatusPendingCache.push({
                user_nostr_id: session.nostrHexId,
                message_event_id: event.id,
                sender_pubkey: event.pubkey,
                conversation_pubkey: otherPubkey
              });
            }
          }

          setConversations(prev => {
            const newConversationsMap = new Map(prev);

            for (const [, data] of decryptedCache) {
              const { decryptedContent, otherPubkey, isOwn, replyToId, event } = data;
              const currentReadStatuses = readStatusesRef.current;
              const isRead = isOwn ? true : (currentReadStatuses.get(event.id) ?? false);

              const message: DirectMessage = {
                id: event.id,
                pubkey: event.pubkey,
                content: event.content,
                created_at: event.created_at,
                decryptedContent,
                isOwn,
                isRead,
                replyToId
              };

              const existing = newConversationsMap.get(otherPubkey) || {
                pubkey: otherPubkey,
                messages: [],
                unreadCount: 0
              };

              if (existing.messages.some(m => m.id === message.id)) continue;

              const updatedMessages = [...existing.messages, message].sort(
                (a, b) => a.created_at - b.created_at
              );
              const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

              newConversationsMap.set(otherPubkey, {
                ...existing,
                messages: updatedMessages,
                lastMessage: updatedMessages[updatedMessages.length - 1],
                unreadCount
              });
            }

            return newConversationsMap;
          });
          setTotalEvents(cachedEvents.length);

          // Show cached data immediately
          setLoading(false);
          cacheLoaded = true;

          // Get latest cached timestamp for narrower relay query
          const cachedTs = await getLatestTimestamp(session!.nostrHexId);
          if (cachedTs > 0) latestTimestamp.current = cachedTs;

          // Save read statuses in background
          if (readStatusPendingCache.length > 0) {
            saveBatchReadStatuses(readStatusPendingCache).catch(() => {});
          }

          console.log(`✅ Cache loaded: ${decryptedCache.size} messages shown instantly`);
        }
      } catch (err) {
        console.warn('⚠️ Cache load failed, falling back to relay:', err);
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: Relay sync (narrower window if cache exists)
      // ═══════════════════════════════════════════════════════════════
      const sinceTimestamp = latestTimestamp.current > 0
        ? latestTimestamp.current - 60  // 1 min buffer for relay propagation
        : Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // Full 30 days

      console.log(`📡 Syncing from relay (since ${new Date(sinceTimestamp * 1000).toLocaleString()})...`);
      const events = await fetchDMEvents(sinceTimestamp);

      if (!isActive) return;

      // Filter out already-seen events
      const newEvents = events.filter((e: Event) => {
        if (seenEventIds.current.has(e.id)) return false;
        seenEventIds.current.add(e.id);
        return true;
      });

      console.log(`📨 Relay sync: ${events.length} total, ${newEvents.length} new`);

      if (newEvents.length > 0) {
        // Decrypt new messages
        const startTime = Date.now();
        const decryptedMap = await decryptMessagesBatch(
          newEvents as Event[],
          session!.nostrHexId,
          50
        );
        console.log(`🔓 Decrypted ${decryptedMap.size} new messages in ${Date.now() - startTime}ms`);

        if (!isActive) return;

        // Build/merge conversations
        const readStatusPending: Array<{
          user_nostr_id: string;
          message_event_id: string;
          sender_pubkey: string;
          conversation_pubkey: string;
        }> = [];

        for (const [, data] of decryptedMap) {
          const { isOwn, event, otherPubkey } = data;
          if (event.created_at > latestTimestamp.current) {
            latestTimestamp.current = event.created_at;
          }
          if (!isOwn && session?.nostrHexId) {
            readStatusPending.push({
              user_nostr_id: session.nostrHexId,
              message_event_id: event.id,
              sender_pubkey: event.pubkey,
              conversation_pubkey: otherPubkey
            });
          }
        }

        // Single state update using functional updater
        setConversations(prev => {
          const newConversationsMap = new Map(prev);

          for (const [, data] of decryptedMap) {
            const { decryptedContent, otherPubkey, isOwn, replyToId, event } = data;

            const currentReadStatuses = readStatusesRef.current;
            const isRead = isOwn ? true : (currentReadStatuses.get(event.id) ?? false);

            const message: DirectMessage = {
              id: event.id,
              pubkey: event.pubkey,
              content: event.content,
              created_at: event.created_at,
              decryptedContent,
              isOwn,
              isRead,
              replyToId
            };

            const existing = newConversationsMap.get(otherPubkey) || {
              pubkey: otherPubkey,
              messages: [],
              unreadCount: 0
            };

            // Skip duplicate
            if (existing.messages.some(m => m.id === message.id)) continue;

            const updatedMessages = [...existing.messages, message].sort(
              (a, b) => a.created_at - b.created_at
            );

            const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

            newConversationsMap.set(otherPubkey, {
              ...existing,
              messages: updatedMessages,
              lastMessage: updatedMessages[updatedMessages.length - 1],
              unreadCount
            });
          }

          return newConversationsMap;
        });
        setTotalEvents(prev => prev + newEvents.length);

        // Save read statuses in background
        if (readStatusPending.length > 0) {
          saveBatchReadStatuses(readStatusPending).catch(() => {});
        }

        // ═══════════════════════════════════════════════════════════
        // Save new ENCRYPTED events to IndexedDB cache (fire and forget)
        // ⚠️ Only encrypted content is persisted — never decrypted text
        // ═══════════════════════════════════════════════════════════
        const eventsToCache: CachedEvent[] = newEvents.map((e: any) => ({
          id: e.id,
          pubkey: e.pubkey,
          content: e.content,         // ⚠️ Encrypted NIP-04 ciphertext
          created_at: e.created_at,
          tags: e.tags,
          userHexId: session!.nostrHexId
        }));
        saveCachedEvents(eventsToCache).catch(() => {});
        setLatestTimestamp(session!.nostrHexId, latestTimestamp.current).catch(() => {});
      }

      setLoading(false);
      initialLoadDone.current = true;
      console.log(`✅ DM load complete (cache: ${cacheLoaded ? 'yes' : 'no'}), starting polling...`);

      // Start polling for new messages
      pollTimer = setInterval(async () => {
        if (!isActive || isPolling.current) return;
        isPolling.current = true;

        try {
          // Poll for events since latest known timestamp (minus small buffer for relay propagation)
          const sincePoll = latestTimestamp.current > 0
            ? latestTimestamp.current - 2  // 2 second buffer
            : Math.floor(Date.now() / 1000) - 60; // fallback: last 60s

          const newEvents = await fetchDMEvents(sincePoll);

          if (!isActive) return;

          let newCount = 0;
          const pollEventsToCache: CachedEvent[] = [];

          for (const event of newEvents) {
            if (!isActive) break;
            if (seenEventIds.current.has(event.id)) continue;
            seenEventIds.current.add(event.id);
            newCount++;
            setTotalEvents(prev => prev + 1);
            await processMessage(event as Event);

            if (event.created_at > latestTimestamp.current) {
              latestTimestamp.current = event.created_at;
            }

            // Collect encrypted event for cache
            pollEventsToCache.push({
              id: event.id,
              pubkey: event.pubkey,
              content: event.content,   // ⚠️ Encrypted only
              created_at: event.created_at,
              tags: event.tags,
              userHexId: session!.nostrHexId
            });
          }

          if (newCount > 0) {
            console.log(`📨 ${newCount} new DM event(s) received via polling`);
            // Save polled encrypted events to cache
            saveCachedEvents(pollEventsToCache).catch(() => {});
            setLatestTimestamp(session!.nostrHexId, latestTimestamp.current).catch(() => {});
          }
        } finally {
          isPolling.current = false;
        }
      }, POLL_INTERVAL_MS);
    };

    doInitialLoad();

    return () => {
      isActive = false;
      setConnected(false);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [session?.nostrHexId, session?.nostrPrivateKey, processMessage, fetchDMEvents, decryptMessagesBatch, saveBatchReadStatuses]);

  // Supabase Realtime subscription for READ STATUS updates ONLY
  useEffect(() => {
    if (!session?.nostrHexId) return;

    // Subscribe to READ STATUS updates
    const readStatusChannel = supabase
      .channel('dm-read-status-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dm_read_status',
          filter: `user_nostr_id=eq.${session.nostrHexId}`
        },
        (payload) => {
          const updatedStatus = payload.new as any;

          // Update read statuses map
          setReadStatuses(prev => {
            const newMap = new Map(prev);
            newMap.set(updatedStatus.message_event_id, updatedStatus.is_read);
            return newMap;
          });

          // Update conversation unread counts
          setConversations(prev => {
            const newConversations = new Map(prev);
            const conversation = newConversations.get(updatedStatus.conversation_pubkey);

            if (conversation) {
              const updatedMessages = conversation.messages.map(msg =>
                msg.id === updatedStatus.message_event_id
                  ? { ...msg, isRead: updatedStatus.is_read }
                  : msg
              );

              const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

              newConversations.set(updatedStatus.conversation_pubkey, {
                ...conversation,
                messages: updatedMessages,
                unreadCount
              });
            }

            return newConversations;
          });
        }
      )
      .subscribe();

    // Cleanup
    return () => {
      supabase.removeChannel(readStatusChannel);
    };
  }, [session?.nostrHexId]);

  // Send message via server-side relay publish
  const sendMessage = useCallback(async (recipientPubkey: string, message: string, replyToId?: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: 'Error',
        description: 'Not authenticated',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Use standard nostr-tools NIP-04 encrypt
      const privateKeyHex = typeof session.nostrPrivateKey === 'string'
        ? session.nostrPrivateKey
        : bytesToHex(session.nostrPrivateKey);

      const encrypted = await nip04.encrypt(privateKeyHex, recipientPubkey, message);

      const privKeyBytes = typeof session.nostrPrivateKey === 'string'
        ? hexToBytes(session.nostrPrivateKey)
        : session.nostrPrivateKey;

      // Build tags
      const tags: string[][] = [['p', recipientPubkey]];

      // Add reply tag if replying to a message
      if (replyToId) {
        tags.push(['e', replyToId, '', 'reply']);
      }

      const event = finalizeEvent({
        kind: 4,
        content: encrypted,
        tags,
        created_at: Math.floor(Date.now() / 1000)
      }, privKeyBytes);

      console.log('📡 Publishing DM via server...');

      // Publish via server endpoint
      const response = await supabase.functions.invoke('publish-dm-event', {
        body: { event }
      });

      const data = response.data as any;
      const successCount = data?.publishedTo || 0;
      const totalRelays = data?.totalRelays || 0;

      console.log(`✅ DM published to ${successCount}/${totalRelays} relays`);

      // Add to local state immediately (optimistic update)
      seenEventIds.current.add(event.id);
      await processMessage(event);

      // Cache the encrypted event in IndexedDB (fire and forget)
      saveCachedEvents([{
        id: event.id,
        pubkey: session.nostrHexId,
        content: event.content,       // ⚠️ Encrypted NIP-04 ciphertext
        created_at: event.created_at,
        tags: event.tags,
        userHexId: session.nostrHexId
      }]).catch(() => {});

      // Only show error toast if all relays failed
      if (successCount === 0) {
        toast({
          title: 'Warning',
          description: 'Message sent locally but failed to reach relays',
          variant: 'destructive'
        });
      } else {
        // Send push notification to recipient (fire and forget)
        try {
          const senderProfile = cachedProfiles.get(session.nostrHexId);
          const senderDisplayName = senderProfile?.display_name || senderProfile?.full_name || 'Someone';
          const messagePreview = message.length > 50 ? message.substring(0, 47) + '...' : message;

          supabase.functions.invoke('send-push-notification', {
            body: {
              recipientPubkey,
              senderDisplayName,
              messagePreview
            }
          }).catch(() => {});
        } catch {}
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    }
  }, [session, processMessage, cachedProfiles]);

  // Delete message via server-side relay publish
  const deleteMessage = useCallback(async (messageId: string, conversationPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: 'Error',
        description: 'Not authenticated',
        variant: 'destructive'
      });
      return;
    }

    try {
      const privKeyBytes = typeof session.nostrPrivateKey === 'string'
        ? hexToBytes(session.nostrPrivateKey)
        : session.nostrPrivateKey;

      // Create KIND 5 deletion event
      const deletionEvent = finalizeEvent({
        kind: 5,
        content: 'Message deleted by user',
        tags: [['e', messageId]],
        created_at: Math.floor(Date.now() / 1000)
      }, privKeyBytes);

      console.log('📡 Publishing deletion via server...');

      // Publish deletion via server
      const response = await supabase.functions.invoke('publish-dm-event', {
        body: { event: deletionEvent }
      });

      const data = response.data as any;
      const successCount = data?.publishedTo || 0;

      // Delete read status from database
      if (session.nostrHexId) {
        await deleteReadStatus(session.nostrHexId, messageId);
      }

      // Remove from IndexedDB cache
      deleteCachedEvent(messageId).catch(() => {});

      // Remove from local state
      setConversations(prev => {
        const newConversations = new Map(prev);
        const conversation = newConversations.get(conversationPubkey);

        if (conversation) {
          const updatedMessages = conversation.messages.filter(m => m.id !== messageId);

          if (updatedMessages.length > 0) {
            newConversations.set(conversationPubkey, {
              ...conversation,
              messages: updatedMessages,
              lastMessage: updatedMessages[updatedMessages.length - 1]
            });
          } else {
            newConversations.delete(conversationPubkey);
          }
        }

        return newConversations;
      });

      if (successCount > 0) {
        toast({
          title: 'Success',
          description: 'Message deleted'
        });
      } else {
        toast({
          title: 'Warning',
          description: 'Message deleted locally but failed to reach relays',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete message',
        variant: 'destructive'
      });
    }
  }, [session, deleteReadStatus]);

  const markAsRead = useCallback(async (pubkey: string) => {
    if (!session?.nostrHexId) return;

    // Mark messages as read in database
    await markMessagesAsReadInDB(session.nostrHexId, pubkey);

    // Update local state
    setConversations(prev => {
      const newConversations = new Map(prev);
      const conversation = newConversations.get(pubkey);

      if (conversation) {
        const updatedMessages = conversation.messages.map(msg => ({
          ...msg,
          isRead: true
        }));

        newConversations.set(pubkey, {
          ...conversation,
          messages: updatedMessages,
          unreadCount: 0
        });

        // Update read statuses in memory
        const newReadStatuses = new Map(readStatuses);
        conversation.messages.forEach(msg => {
          if (!msg.isOwn) {
            newReadStatuses.set(msg.id, true);
          }
        });
        setReadStatuses(newReadStatuses);
      }

      return newConversations;
    });
  }, [session, readStatuses, markMessagesAsReadInDB]);

  return {
    conversations: Array.from(conversations.values()).sort((a, b) => {
      const aTime = a.lastMessage?.created_at || 0;
      const bTime = b.lastMessage?.created_at || 0;
      return bTime - aTime;
    }),
    profiles: cachedProfiles,
    loading: loading || profilesLoading,
    connected,
    sendMessage,
    deleteMessage,
    markAsRead,
    totalEvents,
    relayCount: 7 // Server handles relay count from KIND 38888
  };
}
