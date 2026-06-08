import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { signNostrEvent } from "@/lib/nostrSigning";

interface PublishResult {
  successCount: number;
  totalRelays: number;
  eventId: string;
}

export function useFoodCornerPublisher() {
  const { session } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);

  const publishEvent = useCallback(
    async (kind: number, tags: string[][], content = ""): Promise<PublishResult> => {
      if (!session?.nostrPrivateKey || !session?.nostrHexId) {
        throw new Error("Not authenticated");
      }

      setIsPublishing(true);
      try {
        const signedEvent = signNostrEvent(session.nostrPrivateKey, kind, content, tags);

        // Publish server-side (same path the rest of the app uses). The server
        // holds stable relay connections with a 60s timeout — far more reliable
        // than publishing directly from the browser to relays, which frequently
        // failed with "Publish failed on all relays".
        const res = await fetch("/api/functions/publish-dm-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: signedEvent }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || "Publish failed on all relays");
        }

        return {
          successCount: data.publishedTo || 0,
          totalRelays: data.totalRelays || 0,
          eventId: signedEvent.id,
        };
      } finally {
        setIsPublishing(false);
      }
    },
    [session?.nostrPrivateKey, session?.nostrHexId],
  );

  return {
    isPublishing,
    publishEvent,
  };
}
