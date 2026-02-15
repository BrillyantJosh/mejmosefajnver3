import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface InviteStatus {
  pubkey: string;
  status: 'pending' | 'accepted' | 'declined';
  invitedAt: number;
  respondedAt?: number;
}

/**
 * Hook for room owners to see invite statuses (pending, accepted, declined).
 * Queries KIND 10102 (invites sent) and KIND 10103 (responses) for a room.
 * Only fetches if `enabled` is true (typically when current user is the owner).
 */
export const useRoomInviteStatuses = (
  roomEventId: string | null,
  enabled: boolean = false
) => {
  const [statuses, setStatuses] = useState<InviteStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { parameters } = useSystemParameters();

  const fetchStatuses = useCallback(async () => {
    if (!roomEventId || !enabled || !parameters?.relays) return;

    setIsLoading(true);
    const pool = new SimplePool();

    try {
      // Fetch invites and responses for this room in parallel
      const [inviteEvents, responseEvents] = await Promise.all([
        pool.querySync(parameters.relays, {
          kinds: [10102],
          '#e': [roomEventId],
          limit: 200,
        } as Filter),
        pool.querySync(parameters.relays, {
          kinds: [10103],
          '#e': [roomEventId],
          limit: 200,
        } as Filter),
      ]);

      // Build response map: responder pubkey → { response, respondedAt }
      const responseMap = new Map<string, { response: 'accept' | 'reject'; respondedAt: number }>();
      for (const resp of responseEvents) {
        const responseTag = resp.tags.find((t) => t[0] === 'response');
        if (!responseTag) continue;

        const existing = responseMap.get(resp.pubkey);
        // Keep the latest response if multiple exist
        if (!existing || resp.created_at > existing.respondedAt) {
          responseMap.set(resp.pubkey, {
            response: responseTag[1] as 'accept' | 'reject',
            respondedAt: resp.created_at,
          });
        }
      }

      // Build invite statuses, deduplicate by receiver pubkey (keep latest invite)
      const inviteMap = new Map<string, InviteStatus>();

      for (const invite of inviteEvents) {
        const receiverTag = invite.tags.find((t) => t[0] === 'p' && t[2] === 'receiver');
        if (!receiverTag) continue;

        const pubkey = receiverTag[1];
        const existing = inviteMap.get(pubkey);

        // Keep the latest invite per user
        if (existing && existing.invitedAt > invite.created_at) continue;

        const resp = responseMap.get(pubkey);
        inviteMap.set(pubkey, {
          pubkey,
          status: resp
            ? resp.response === 'accept' ? 'accepted' : 'declined'
            : 'pending',
          invitedAt: invite.created_at,
          respondedAt: resp?.respondedAt,
        });
      }

      // Sort: declined first, then pending, then accepted (by time)
      const result = Array.from(inviteMap.values()).sort((a, b) => {
        const order = { declined: 0, pending: 1, accepted: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return b.invitedAt - a.invitedAt;
      });

      setStatuses(result);
    } catch (error) {
      console.error('Error fetching invite statuses:', error);
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  }, [roomEventId, enabled, parameters?.relays]);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  return { statuses, isLoading, refetch: fetchStatuses };
};
