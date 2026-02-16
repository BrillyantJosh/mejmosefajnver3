import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import {
  getRoomKeyFromCache,
  setRoomKeyToCache,
  decryptInvitePayload,
  isValidGroupKey,
} from '@/lib/encrypted-room-crypto';

/**
 * Hook to get the group key for an encrypted room.
 *
 * 1. Fast path: check localStorage cache (instant).
 * 2. Slow path: if no cached key, query relays for KIND 1102 invite events
 *    addressed to the current user, decrypt the payload, cache the key.
 *
 * This replaces the old accept-invite flow — the key is auto-fetched.
 */
export const useEncryptedRoomGroupKey = (
  roomEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null,
  keyVersion: number = 1,
  roomId: string | null = null // stable d-tag for matching when eventId has changed
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const fetchedRef = useRef(false);

  const checkCacheAndFetch = useCallback(async () => {
    if (!roomEventId) {
      setGroupKey(null);
      setIsLoading(false);
      return;
    }

    // Fast path: check localStorage
    const cachedKey = getRoomKeyFromCache(roomEventId, keyVersion);
    if (cachedKey) {
      setGroupKey(cachedKey);
      setIsLoading(false);
      return;
    }

    // Need relay fetch — check prerequisites
    const relays = parameters?.relays;
    if (!userPubkey || !userPrivateKeyHex || !relays || relays.length === 0) {
      setGroupKey(null);
      setIsLoading(false);
      return;
    }

    // Slow path: fetch KIND 1102 from relays
    const pool = new SimplePool();
    try {
      const inviteEvents = await Promise.race([
        pool.querySync(relays, {
          kinds: [1102],
          '#p': [userPubkey],
          limit: 50,
        }),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error('Invite fetch timeout')), 15000)
        ),
      ]);

      // Sort by created_at descending so we try the newest invites first
      inviteEvents.sort((a, b) => b.created_at - a.created_at);

      for (const event of inviteEvents) {
        try {
          // Find sender pubkey
          const senderTag = event.tags.find(
            (t: string[]) => t[0] === 'p' && t[2] === 'sender'
          );
          if (!senderTag) continue;

          // Verify this invite is for us
          const receiverTag = event.tags.find(
            (t: string[]) => t[0] === 'p' && t[2] === 'receiver' && t[1] === userPubkey
          );
          if (!receiverTag) continue;

          // Decrypt the invite payload
          const payload = decryptInvitePayload(
            event.content,
            userPrivateKeyHex,
            senderTag[1]
          );

          // Match by roomEventId OR roomId (d-tag) for resilience when eventId has changed
          const eTag = event.tags.find((t: string[]) => t[0] === 'e');
          const matchesEventId = payload.roomEventId === roomEventId || eTag?.[1] === roomEventId;
          const matchesRoomId = roomId && payload.roomId && payload.roomId === roomId;

          if (!matchesEventId && !matchesRoomId) continue;

          // Validate and cache the key
          if (payload.groupKey && isValidGroupKey(payload.groupKey)) {
            setRoomKeyToCache(roomEventId, keyVersion, payload.groupKey);
            setGroupKey(payload.groupKey);
            console.log(`🔑 Auto-cached group key for room ${roomEventId.slice(0, 16)} from KIND 1102`);
            return;
          }
        } catch {
          // Skip invites that fail to decrypt (not for us, corrupted, etc.)
        }
      }

      // No matching invite found
      setGroupKey(null);
    } catch (error) {
      console.error('Error fetching group key from invites:', error);
      setGroupKey(null);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [roomEventId, keyVersion, userPubkey, userPrivateKeyHex, parameters?.relays, roomId]);

  useEffect(() => {
    fetchedRef.current = false;
    setIsLoading(true);
    checkCacheAndFetch();
  }, [checkCacheAndFetch]);

  return { groupKey, isLoading, refetch: checkCacheAndFetch };
};
