import { useState, useEffect, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const ROOMS_PUBKEY = "b66ccf84bc6cf1a56ba9941f29932824f4986803358a0bed03769a1cbf480101";

interface NostrRoom {
  slug: string;
  title: string;
  visibility: 'public' | 'gated' | 'private';
  status: 'active' | 'archived';
  langs?: string[];
  icon?: string;
  order: number;
  description?: string;
  owners?: string[];
  publishers?: string[];
  rules?: string[];
  members?: number;
}

export const useNostrRooms = () => {
  const { parameters } = useSystemParameters();
  const [rooms, setRooms] = useState<NostrRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomsManifest, setRoomsManifest] = useState<Event | null>(null);

  const RELAYS = useMemo(() => {
    return parameters?.relays || [];
  }, [parameters]);

  useEffect(() => {
    const pool = new SimplePool();
    let isMounted = true;

    const fetchRooms = async () => {
      try {
        setLoading(true);

        const filter = {
          kinds: [38889],
          authors: [ROOMS_PUBKEY],
          "#d": ["rooms"],
          limit: 1
        };

        const events = await pool.querySync(RELAYS, filter);
        
        if (!isMounted) return;

        if (events.length === 0) {
          console.warn('No rooms manifest found');
          setRooms([]);
          setLoading(false);
          return;
        }

        // Get the latest event
        const manifest = events.reduce((latest: Event | null, event: Event) => {
          if (!latest || event.created_at > latest.created_at) {
            return event;
          }
          return latest;
        }, null);

        if (!manifest) {
          setRooms([]);
          setLoading(false);
          return;
        }

        // Store manifest for permission checks
        setRoomsManifest(manifest);

        // Parse rooms from tags
        const roomTags = manifest.tags.filter(t => t[0] === "room");
        const iconTags = manifest.tags.filter(t => t[0] === "icon");
        const orderTags = manifest.tags.filter(t => t[0] === "order");
        const descTags = manifest.tags.filter(t => t[0] === "desc");
        const ownerTags = manifest.tags.filter(t => t[0] === "owner");
        const publisherTags = manifest.tags.filter(t => t[0] === "publisher");
        const ruleTags = manifest.tags.filter(t => t[0] === "rule");

        const parsedRooms: NostrRoom[] = roomTags.map(tag => {
          const slug = tag[1];
          const title = tag[2] || slug;
          const visibility = (tag[3] || 'public') as 'public' | 'gated' | 'private';
          const status = (tag[4] || 'active') as 'active' | 'archived';
          const langs = tag[5] ? tag[5].split(',').filter(Boolean) : undefined;

          const icon = iconTags.find(t => t[1] === slug)?.[2];
          const orderStr = orderTags.find(t => t[1] === slug)?.[2];
          const order = orderStr ? parseInt(orderStr, 10) : 9999;
          const description = descTags.find(t => t[1] === slug)?.[2];
          const owners = ownerTags.filter(t => t[1] === slug).map(t => t[2]);
          const publishers = publisherTags.filter(t => t[1] === slug).map(t => t[2]);
          const rules = ruleTags.filter(t => t[1] === slug).map(t => t[2]);

          return {
            slug,
            title,
            visibility,
            status,
            langs,
            icon,
            order,
            description,
            owners,
            publishers,
            rules,
            // For now, we don't have member count - could be fetched separately
            members: Math.floor(Math.random() * 1000) + 50 // Placeholder
          };
        });

        // Filter only active rooms and sort by order
        const activeRooms = parsedRooms
          .filter(room => room.status === 'active')
          .sort((a, b) => a.order - b.order);

        setRooms(activeRooms);
      } catch (error) {
        console.error('Error fetching rooms:', error);
        setRooms([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchRooms();

    return () => {
      isMounted = false;
      pool.close(RELAYS);
    };
  }, [RELAYS]);

  // Check if a user can publish to a specific room
  const canPublish = (authorPubkey: string, roomSlug: string): boolean => {
    const room = rooms.find(r => r.slug === roomSlug);
    if (!room) return false;

    // If no publishers defined → open room (everyone can publish)
    if (!room.publishers || room.publishers.length === 0) {
      return true;
    }

    // Restricted room: check if author is publisher OR owner
    const isPublisher = room.publishers.includes(authorPubkey);
    const isOwner = room.owners?.includes(authorPubkey) || false;
    
    return isPublisher || isOwner;
  };

  return { rooms, loading, canPublish };
};
