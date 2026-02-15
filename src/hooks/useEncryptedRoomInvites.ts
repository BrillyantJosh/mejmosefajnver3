import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { decryptInvitePayload, isValidGroupKey } from '@/lib/encrypted-room-crypto';
import type { RoomInvite } from '@/types/encryptedRooms';

/**
 * Hook to fetch pending invites for the current user.
 * Queries KIND 10102 (invites) and KIND 10103 (responses) to determine pending state.
 */
export const useEncryptedRoomInvites = () => {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  const userPubkey = session?.nostrHexId;
  const userPrivKey = session?.nostrPrivateKey;

  const fetchInvites = useCallback(async () => {
    if (!userPubkey || !userPrivKey || !parameters?.relays) return;

    const pool = new SimplePool();
    try {
      console.log('📨 Fetching room invites for:', userPubkey.slice(0, 16));

      // Fetch invites and responses in parallel
      const [inviteEvents, responseEvents] = await Promise.all([
        pool.querySync(parameters.relays, {
          kinds: [10102],
          '#p': [userPubkey],
          limit: 100,
        } as Filter),
        pool.querySync(parameters.relays, {
          kinds: [10103],
          authors: [userPubkey],
          limit: 100,
        } as Filter),
      ]);

      console.log(`📦 Found ${inviteEvents.length} invites, ${responseEvents.length} responses`);

      // Collect responded invite IDs
      const respondedInviteIds = new Set<string>();
      const respondedRoomIds = new Set<string>();
      for (const resp of responseEvents) {
        const inviteRef = resp.tags.find((t) => t[0] === 'e');
        if (inviteRef) respondedInviteIds.add(inviteRef[1]);
        const roomRef = resp.tags.filter((t) => t[0] === 'e');
        if (roomRef.length > 1) respondedRoomIds.add(roomRef[1][1]);
      }

      // Parse and decrypt pending invites
      const pendingInvites: RoomInvite[] = [];

      for (const event of inviteEvents) {
        // Skip if already responded
        if (respondedInviteIds.has(event.id)) continue;

        // Check room ID to avoid duplicates
        const roomRef = event.tags.find((t) => t[0] === 'e');
        if (roomRef && respondedRoomIds.has(roomRef[1])) continue;

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

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  return { invites, isLoading, refetch: fetchInvites };
};
