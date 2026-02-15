import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import type { RoomMember } from '@/types/encryptedRooms';

/**
 * Hook to compute the current member list for a room.
 * Reconstructs members from:
 * - KIND 30100 (room creation) initial member list
 * - KIND 1103 (invite accept) additions
 * - KIND 1105 (leave/removal) removals
 */
export const useEncryptedRoomMembers = (roomEventId: string | null) => {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  const fetchMembers = useCallback(async () => {
    if (!roomEventId || !parameters?.relays) return;

    const pool = new SimplePool();
    try {
      // Fetch room creation, accepts (KIND 1103), and leaves/removals (KIND 1105) in parallel
      const [roomEvents, acceptEvents, leaveEvents] = await Promise.all([
        pool.querySync(parameters.relays, {
          kinds: [30100],
          ids: [roomEventId],
          limit: 1,
        } as Filter),
        pool.querySync(parameters.relays, {
          kinds: [1103],
          '#e': [roomEventId],
          limit: 200,
        } as Filter),
        pool.querySync(parameters.relays, {
          kinds: [1105],
          '#e': [roomEventId],
          limit: 200,
        } as Filter),
      ]);

      if (roomEvents.length === 0) {
        setMembers([]);
        return;
      }

      const roomEvent = roomEvents[0];

      // 1. Start with initial members from room creation
      const memberMap = new Map<string, RoomMember>();

      for (const tag of roomEvent.tags) {
        if (tag[0] === 'p' && tag[1]) {
          memberMap.set(tag[1], {
            pubkey: tag[1],
            role: (tag[2] as RoomMember['role']) || 'member',
            joinedAt: roomEvent.created_at,
          });
        }
      }

      // 2. Add members who accepted invites
      // Sort accepts chronologically
      const sortedAccepts = acceptEvents
        .filter((e) => {
          const responseTag = e.tags.find((t) => t[0] === 'response');
          return responseTag?.[1] === 'accept';
        })
        .sort((a, b) => a.created_at - b.created_at);

      for (const accept of sortedAccepts) {
        if (!memberMap.has(accept.pubkey)) {
          memberMap.set(accept.pubkey, {
            pubkey: accept.pubkey,
            role: 'member',
            joinedAt: accept.created_at,
          });
        }
      }

      // 3. Remove members who left or were removed
      const sortedLeaves = leaveEvents.sort(
        (a, b) => a.created_at - b.created_at
      );

      for (const leave of sortedLeaves) {
        const targetTag = leave.tags.find((t) => t[0] === 'p');
        if (targetTag) {
          const targetPubkey = targetTag[1];
          const member = memberMap.get(targetPubkey);
          // Owner cannot be removed
          if (member && member.role !== 'owner') {
            memberMap.delete(targetPubkey);
          }
        }
      }

      // Convert to array, owner first
      const result = Array.from(memberMap.values()).sort((a, b) => {
        if (a.role === 'owner') return -1;
        if (b.role === 'owner') return 1;
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (b.role === 'admin' && a.role !== 'admin') return 1;
        return (a.joinedAt || 0) - (b.joinedAt || 0);
      });

      setMembers(result);
    } catch (error) {
      console.error('Error fetching room members:', error);
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  }, [roomEventId, parameters?.relays]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return { members, isLoading, refetch: fetchMembers };
};
