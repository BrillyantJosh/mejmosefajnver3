import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { decryptInvitePayload, isValidGroupKey } from '@/lib/encrypted-room-crypto';
import type { RoomInvite } from '@/types/encryptedRooms';

const POLL_INTERVAL = 10_000; // 10 seconds

/**
 * Hook to fetch pending invites for the current user.
 * Queries KIND 1102 (invites) and KIND 1103 (responses) to determine pending state.
 * Polls every 10 seconds to pick up new invites (relay propagation delay).
 */
export const useEncryptedRoomInvites = () => {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const userPubkey = session?.nostrHexId;
  const userPrivKey = session?.nostrPrivateKey;

  const fetchInvites = useCallback(async () => {
    if (!userPubkey || !userPrivKey || !parameters?.relays) return;

    const pool = new SimplePool();
    try {
      console.log('📨 Fetching room invites for:', userPubkey.slice(0, 16));

      // Fetch invites (KIND 1102) and responses (KIND 1103) in parallel
      const [inviteEvents, responseEvents] = await Promise.all([
        pool.querySync(parameters.relays, {
          kinds: [1102],
          '#p': [userPubkey],
          limit: 100,
        } as Filter),
        pool.querySync(parameters.relays, {
          kinds: [1103],
          authors: [userPubkey],
          limit: 100,
        } as Filter),
      ]);

      console.log(`📦 Found ${inviteEvents.length} invite events (KIND 1102), ${responseEvents.length} responses (KIND 1103)`);

      // Collect responded invite IDs
      const respondedInviteIds = new Set<string>();
      for (const resp of responseEvents) {
        const inviteRef = resp.tags.find((t) => t[0] === 'e');
        if (inviteRef) respondedInviteIds.add(inviteRef[1]);
      }

      console.log(`🔑 respondedInviteIds: ${respondedInviteIds.size}`);

      // Parse and decrypt pending invites
      const pendingInvites: RoomInvite[] = [];

      for (const event of inviteEvents) {
        // Skip if already responded to this specific invite
        if (respondedInviteIds.has(event.id)) continue;

        const roomRef = event.tags.find((t) => t[0] === 'e');

        try {
          // Check receiver tag
          const receiverTag = event.tags.find(
            (t) => t[0] === 'p' && t[2] === 'receiver' && t[1] === userPubkey
          );
          if (!receiverTag) continue;

          const senderTag = event.tags.find(
            (t) => t[0] === 'p' && t[2] === 'sender'
          );
          if (!senderTag) continue;

          // Decrypt invite payload
          const payload = decryptInvitePayload(
            event.content,
            userPrivKey,
            senderTag[1]
          );

          if (!payload.groupKey || !isValidGroupKey(payload.groupKey)) continue;

          pendingInvites.push({
            id: event.id,
            roomEventId: payload.roomEventId || roomRef?.[1] || '',
            roomId: payload.roomId,
            roomName: payload.roomName,
            inviterPubkey: senderTag[1],
            inviteePubkey: userPubkey,
            groupKey: payload.groupKey,
            keyVersion: payload.keyVersion || 1,
            role: payload.role || 'member',
            message: payload.message,
            createdAt: event.created_at,
            status: 'pending',
          });
        } catch (err) {
          console.warn('Failed to decrypt invite:', event.id.slice(0, 16), err);
        }
      }

      // Sort newest first
      pendingInvites.sort((a, b) => b.createdAt - a.createdAt);
      setInvites(pendingInvites);
    } catch (error) {
      console.error('Error fetching room invites:', error);
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  }, [userPubkey, userPrivKey, parameters?.relays]);

  // Initial fetch
  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  // Polling for new invites every 10 seconds
  useEffect(() => {
    if (!userPubkey || !userPrivKey || !parameters?.relays) return;

    pollingRef.current = setInterval(() => {
      fetchInvites();
    }, POLL_INTERVAL);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [userPubkey, userPrivKey, parameters?.relays, fetchInvites]);

  return { invites, isLoading, refetch: fetchInvites };
};
