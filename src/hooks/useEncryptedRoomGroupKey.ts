import { useState, useEffect, useRef, useCallback } from 'react';
import { SimplePool, Filter } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import {
  decryptInvitePayload,
  getRoomKeyFromCache,
  setRoomKeyToCache,
  isValidGroupKey,
} from '@/lib/encrypted-room-crypto';

const RETRY_INTERVAL = 3_000; // 3 seconds between retries
const MAX_RETRIES = 10; // Up to 10 retries (~30 seconds total)

/**
 * Hook to fetch and decrypt the group key for an encrypted room.
 * Follows the same pattern as useNostrGroupKey.ts (OWN ▲ module).
 * Looks for KIND 10102 invite events addressed to the user.
 * Retries automatically if key is not found (relay propagation delay).
 */
export const useEncryptedRoomGroupKey = (
  roomEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null,
  keyVersion: number = 1
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foundRef = useRef(false);

  const fetchGroupKey = useCallback(async () => {
    if (!roomEventId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    // Check localStorage cache first
    const cachedKey = getRoomKeyFromCache(roomEventId, keyVersion);
    if (cachedKey) {
      console.log('✅ Using cached room group key for:', roomEventId.slice(0, 16));
      setGroupKey(cachedKey);
      setIsLoading(false);
      foundRef.current = true;
      return;
    }

    const pool = new SimplePool();

    try {
      console.log('🔑 Fetching KIND 10102 (room invite) for group key:', {
        roomEventId: roomEventId.slice(0, 16) + '...',
        userPubkey: userPubkey.slice(0, 16) + '...',
        attempt: retryCountRef.current + 1,
      });

      const filter: Filter = {
        kinds: [10102],
        '#e': [roomEventId],
        '#p': [userPubkey],
        limit: 20,
      };

      const events = await pool.querySync(parameters.relays, filter);
      console.log(`📦 Found ${events.length} invite events (KIND 10102)`);

      for (const event of events) {
        try {
          // Check if user is the receiver
          const receiverTag = event.tags.find(
            (tag) => tag[0] === 'p' && tag[2] === 'receiver' && tag[1] === userPubkey
          );
          if (!receiverTag) continue;

          // Find sender pubkey
          const senderTag = event.tags.find(
            (tag) => tag[0] === 'p' && tag[2] === 'sender'
          );
          if (!senderTag) continue;

          const senderPubkey = senderTag[1];

          // Decrypt invite payload using NIP-44
          const payload = decryptInvitePayload(
            event.content,
            userPrivateKeyHex,
            senderPubkey
          );

          if (payload.groupKey && isValidGroupKey(payload.groupKey)) {
            console.log('✅ Room group key decrypted successfully');
            setRoomKeyToCache(roomEventId, payload.keyVersion || keyVersion, payload.groupKey);
            setGroupKey(payload.groupKey);
            setIsLoading(false);
            foundRef.current = true;
            pool.close(parameters.relays);
            return; // Success - stop retrying
          }
        } catch (decryptError) {
          console.warn('Failed to decrypt invite from event:', event.id.slice(0, 16), decryptError);
        }
      }

      // Key not found - schedule retry if under limit
      if (retryCountRef.current < MAX_RETRIES && !foundRef.current) {
        retryCountRef.current++;
        console.log(`🔄 Group key not found, retrying in ${RETRY_INTERVAL / 1000}s (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
        retryTimerRef.current = setTimeout(fetchGroupKey, RETRY_INTERVAL);
      } else if (!foundRef.current) {
        console.warn('⚠️ Group key not found after max retries');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error fetching room group key:', error);
      // Also retry on error
      if (retryCountRef.current < MAX_RETRIES && !foundRef.current) {
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(fetchGroupKey, RETRY_INTERVAL);
      } else {
        setIsLoading(false);
      }
    } finally {
      pool.close(parameters.relays);
    }
  }, [roomEventId, userPubkey, userPrivateKeyHex, keyVersion, parameters?.relays]);

  useEffect(() => {
    // Reset state when dependencies change
    retryCountRef.current = 0;
    foundRef.current = false;
    setGroupKey(null);
    setIsLoading(true);

    fetchGroupKey();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [fetchGroupKey]);

  // Manual refetch (for Retry button)
  const refetch = useCallback(() => {
    retryCountRef.current = 0;
    foundRef.current = false;
    setIsLoading(true);
    fetchGroupKey();
  }, [fetchGroupKey]);

  return { groupKey, isLoading, refetch };
};
