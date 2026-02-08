import { useState, useEffect } from "react";
import { SimplePool } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";

export function useNostrTinyRoomPostCounts(roomEventIds: string[]) {
  const [postCounts, setPostCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (roomEventIds.length === 0) {
      setLoading(false);
      return;
    }

    const RELAYS = parameters?.relays || [];

    const pool = new SimplePool();

    const fetchCounts = async () => {
      try {
        setLoading(true);
        const counts: Record<string, number> = {};

        // Fetch KIND 1 messages for each room (last 30 days)
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

        for (const roomId of roomEventIds) {
          const events = await pool.querySync(RELAYS, {
            kinds: [1],
            "#e": [roomId],
            since: thirtyDaysAgo,
          });

          counts[roomId] = events.length;
        }

        setPostCounts(counts);
      } catch (error) {
        console.error("Error fetching tiny room post counts:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCounts();

    return () => {
      pool.close(RELAYS);
    };
  }, [roomEventIds.join(","), parameters]);

  return { postCounts, loading };
}
