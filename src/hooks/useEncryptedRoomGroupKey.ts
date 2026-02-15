import { useState, useEffect } from 'react';
import { SimplePool, Filter } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import {
  decryptInvitePayload,
  getRoomKeyFromCache,
  setRoomKeyToCache,
  isValidGroupKey,
} from '@/lib/encrypted-room-crypto';

/**
 * Hook to fetch and decrypt the group key for an encrypted room.
 * Follows the same pattern as useNostrGroupKey.ts (OWN ▲ module).
 * Looks for KIND 10102 invite events addressed to the user.
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

  useEffect(() => {
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
      return;
    }

    const fetchGroupKey = async () => {
      const pool = new SimplePool();

      try {
        console.log('🔑 Fetching KIND 10102 (room invite) for group key:', {
          roomEventId: roomEventId.slice(0, 16) + '...',
          userPubkey: userPubkey.slice(0, 16) + '...',
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
              break;
            }
          } catch (decryptError) {
            console.warn('Failed to decrypt invite from event:', event.id.slice(0, 16), decryptError);
          }
        }
      } catch (error) {
        console.error('Error fetching room group key:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchGroupKey();
  }, [roomEventId, userPubkey, userPrivateKeyHex, keyVersion, parameters?.relays]);

  return { groupKey, isLoading };
};
