import { useCallback, useState } from "react";
import { SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { signNostrEvent } from "@/lib/nostrSigning";

interface PublishResult {
  successCount: number;
  totalRelays: number;
  eventId: string;
}

export function useFoodCornerPublisher() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [isPublishing, setIsPublishing] = useState(false);

  const publishEvent = useCallback(
    async (kind: number, tags: string[][], content = ""): Promise<PublishResult> => {
      if (!session?.nostrPrivateKey || !session?.nostrHexId) {
        throw new Error("Not authenticated");
      }

      const relays = parameters?.relays || [];
      if (relays.length === 0) {
        throw new Error("No relays configured");
      }

      setIsPublishing(true);
      const pool = new SimplePool();

      try {
        const signedEvent = signNostrEvent(session.nostrPrivateKey, kind, content, tags);
        const publishPromises = Array.from(pool.publish(relays, signedEvent));

        const results = await Promise.race([
          Promise.allSettled(publishPromises),
          new Promise<PromiseSettledResult<string>[]>((resolve) =>
            setTimeout(
              () => resolve(publishPromises.map(() => ({ status: "rejected", reason: new Error("Publish timeout") }))),
              12000,
            ),
          ),
        ]);

        const successCount = results.filter((result) => result.status === "fulfilled").length;
        if (successCount === 0) {
          throw new Error("Publish failed on all relays");
        }

        return {
          successCount,
          totalRelays: relays.length,
          eventId: signedEvent.id,
        };
      } finally {
        setIsPublishing(false);
        pool.close(relays);
      }
    },
    [session?.nostrPrivateKey, session?.nostrHexId, parameters?.relays],
  );

  return {
    isPublishing,
    publishEvent,
  };
}
