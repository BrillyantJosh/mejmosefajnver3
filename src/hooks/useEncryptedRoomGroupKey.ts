import { useState, useEffect, useCallback } from 'react';
import { getRoomKeyFromCache } from '@/lib/encrypted-room-crypto';

/**
 * Hook to get the group key for an encrypted room from localStorage cache.
 * The key is ONLY cached after:
 *   1. Owner creates a room (CreateRoomDialog caches it)
 *   2. User accepts an invite (Invites.tsx caches it)
 * This hook never fetches from relays or auto-caches — acceptance is required.
 */
export const useEncryptedRoomGroupKey = (
  roomEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null,
  keyVersion: number = 1
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkCache = useCallback(() => {
    if (!roomEventId) {
      setGroupKey(null);
      setIsLoading(false);
      return;
    }
    const cachedKey = getRoomKeyFromCache(roomEventId, keyVersion);
    setGroupKey(cachedKey);
    setIsLoading(false);
  }, [roomEventId, keyVersion]);

  useEffect(() => {
    setIsLoading(true);
    checkCache();
  }, [checkCache]);

  return { groupKey, isLoading, refetch: checkCache };
};
