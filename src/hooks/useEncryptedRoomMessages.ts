import { useState, useEffect, useCallback, useRef } from 'react';
import { Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { decryptRoomMessage } from '@/lib/encrypted-room-crypto';
import type { RoomMessage, RoomMessageContent } from '@/types/encryptedRooms';

const POLL_INTERVAL = 10_000; // 10 seconds
const MESSAGES_PER_PAGE = 50;

/**
 * Hook to fetch, decrypt, and poll room messages (KIND 1101).
 * Uses server endpoint for relay queries.
 */
export const useEncryptedRoomMessages = (
  roomEventId: string | null,
  groupKey: string | null
) => {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const { session } = useAuth();
  const lastFetchTimestamp = useRef<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const parseMessage = async (event: Event, key: string): Promise<RoomMessage | null> => {
    try {
      const roomRef = event.tags.find(
        (t) => t[0] === 'e' && (t[3] === 'root' || !t[3])
      );
      if (!roomRef) return null;

      const keyVersionTag = event.tags.find((t) => t[0] === 'key_version');
      const keyVersion = keyVersionTag ? parseInt(keyVersionTag[1], 10) : 1;

      const replyTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'reply');

      // Decrypt message content
      let text = '';
      let type: RoomMessageContent['type'] = 'text';
      let decryptionFailed = false;

      try {
        const decrypted = await decryptRoomMessage(event.content, key);
        const parsed: RoomMessageContent = JSON.parse(decrypted);
        text = parsed.text || '';
        type = parsed.type || 'text';
      } catch {
        text = '🔒 Could not decrypt message';
        decryptionFailed = true;
      }

      return {
        id: event.id,
        roomEventId: roomRef[1],
        senderPubkey: event.pubkey,
        text,
        type,
        replyToId: replyTag?.[1],
        keyVersion,
        createdAt: event.created_at,
        decryptionFailed,
      };
    } catch {
      return null;
    }
  };

  const fetchMessages = useCallback(
    async (since?: number) => {
      if (!roomEventId || !groupKey) return;

      try {
        const body: Record<string, any> = {
          roomEventId,
          kinds: [1101],
          limit: MESSAGES_PER_PAGE,
        };
        if (since) {
          body.since = since;
        }

        const response = await fetch('/api/functions/fetch-room-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!data.success || !data.events) return;

        const events: Event[] = data.events;

        // Parse and decrypt all messages
        const parsed = await Promise.all(
          events.map((e) => parseMessage(e, groupKey))
        );

        const newMessages = parsed
          .filter((m): m is RoomMessage => m !== null)
          .sort((a, b) => a.createdAt - b.createdAt);

        if (since) {
          // Merge new messages (polling update)
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const unique = newMessages.filter((m) => !existingIds.has(m.id));
            return [...prev, ...unique];
          });
        } else {
          // Initial load
          setMessages(newMessages);
          setHasMore(events.length >= MESSAGES_PER_PAGE);
        }

        // Update last fetch timestamp
        if (newMessages.length > 0) {
          const latest = Math.max(...newMessages.map((m) => m.createdAt));
          lastFetchTimestamp.current = latest;
        }
      } catch (error) {
        console.error('Error fetching room messages:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [roomEventId, groupKey]
  );

  // Initial fetch
  useEffect(() => {
    if (!roomEventId || !groupKey) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setMessages([]);
    lastFetchTimestamp.current = 0;
    fetchMessages();
  }, [roomEventId, groupKey, fetchMessages]);

  // Polling for new messages
  useEffect(() => {
    if (!roomEventId || !groupKey) return;

    pollingRef.current = setInterval(() => {
      if (lastFetchTimestamp.current > 0) {
        fetchMessages(lastFetchTimestamp.current);
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [roomEventId, groupKey, fetchMessages]);

  // Add optimistic message (for immediate UI feedback)
  const addOptimisticMessage = (message: RoomMessage) => {
    setMessages((prev) => [...prev, message]);
  };

  return { messages, isLoading, hasMore, addOptimisticMessage, refetch: fetchMessages };
};
