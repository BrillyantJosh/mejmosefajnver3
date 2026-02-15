import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import type { EncryptedRoom, RoomMember } from '@/types/encryptedRooms';

/**
 * Hook to fetch all encrypted rooms where the user is a member.
 * Queries KIND 30100 (parameterized replaceable) events tagged with user's pubkey.
 */
export const useEncryptedRooms = () => {
  const [rooms, setRooms] = useState<EncryptedRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  const userPubkey = session?.nostrHexId;

  const parseRoomEvent = (event: Event): EncryptedRoom | null => {
    try {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
      const name = event.tags.find((t) => t[0] === 'name')?.[1] || 'Unnamed Room';
      const description = event.tags.find((t) => t[0] === 'description')?.[1] || '';
      const image = event.tags.find((t) => t[0] === 'image')?.[1];
      const status = (event.tags.find((t) => t[0] === 'status')?.[1] || 'active') as 'active' | 'archived' | 'read-only' | 'deleted';
      const keyVersion = parseInt(event.tags.find((t) => t[0] === 'key_version')?.[1] || '1', 10);

      // Parse members from p-tags
      const members: RoomMember[] = event.tags
        .filter((t) => t[0] === 'p' && t[1])
        .map((t) => ({
          pubkey: t[1],
          role: (t[2] as 'owner' | 'admin' | 'member' | 'readonly') || 'member',
        }));

      const ownerTag = members.find((m) => m.role === 'owner');

      return {
        id: event.id,
        roomId: dTag,
        name,
        description,
        image,
        ownerPubkey: ownerTag?.pubkey || event.pubkey,
        members,
        status,
        keyVersion,
        createdAt: event.created_at,
        eventId: event.id,
      };
    } catch {
      return null;
    }
  };

  const fetchRooms = useCallback(async () => {
    if (!userPubkey || !parameters?.relays) return;

    const pool = new SimplePool();
    try {
      console.log('🔒 Fetching encrypted rooms for user:', userPubkey.slice(0, 16));

      const filter: Filter = {
        kinds: [30100],
        '#p': [userPubkey],
        limit: 100,
      };

      const events = await pool.querySync(parameters.relays, filter);
      console.log(`📦 Found ${events.length} room events (KIND 30100)`);

      const parsedRooms = events
        .map(parseRoomEvent)
        .filter((r): r is EncryptedRoom => r !== null)
        .filter((r) => r.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt);

      setRooms(parsedRooms);
    } catch (error) {
      console.error('Error fetching encrypted rooms:', error);
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  }, [userPubkey, parameters?.relays]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  return { rooms, isLoading, refetch: fetchRooms };
};
