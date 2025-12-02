import { useState, useEffect } from "react";
import { SimplePool, Event as NostrEvent } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";

export interface TinyRoom {
  id: string;
  eventId: string;
  slug: string;
  name: string;
  description: string;
  admin: string;
  members: string[];
  status?: string; // "active" or "archived"
  topic?: string;
  rules?: string;
  image?: string;
  created_at: number;
}

export function useNostrTinyRooms(userPubkey?: string) {
  const [rooms, setRooms] = useState<TinyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!userPubkey) {
      setLoading(false);
      return;
    }

    const RELAYS = parameters?.relays || [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol",
    ];

    const pool = new SimplePool();
    
    const fetchRooms = async () => {
      try {
        setLoading(true);

        // Fetch all KIND 30150 events where user is mentioned in 'p' tags
        const events = await pool.querySync(RELAYS, {
          kinds: [30150],
          "#p": [userPubkey],
        });

        const parsedRooms: TinyRoom[] = events.map((event: NostrEvent) => {
          const dTag = event.tags.find(t => t[0] === "d")?.[1] || "";
          const name = event.tags.find(t => t[0] === "name")?.[1] || "Unnamed Room";
          const admin = event.tags.find(t => t[0] === "admin")?.[1] || event.pubkey;
          const members = event.tags.filter(t => t[0] === "p").map(t => t[1]);
          const status = event.tags.find(t => t[0] === "status")?.[1] || "active";
          const topic = event.tags.find(t => t[0] === "topic")?.[1];
          const rules = event.tags.find(t => t[0] === "rules")?.[1];
          const image = event.tags.find(t => t[0] === "image")?.[1];

          return {
            id: event.id,
            eventId: event.id,
            slug: dTag,
            name,
            description: event.content || "",
            admin,
            members,
            status,
            topic,
            rules,
            image,
            created_at: event.created_at,
          };
        });

        // Sort by created_at descending
        parsedRooms.sort((a, b) => b.created_at - a.created_at);

        setRooms(parsedRooms);
      } catch (error) {
        console.error("Error fetching tiny rooms:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRooms();

    return () => {
      pool.close(RELAYS);
    };
  }, [userPubkey, parameters]);

  return { rooms, loading };
}
