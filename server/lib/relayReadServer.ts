/**
 * Honest relay reads on the server: WHICH relays answered, not just what came
 * back. An unreadable paid-state must never be served as "unpaid" — that is
 * how the same obligation gets paid twice.
 *
 * The browser uses src/lib/relayRead.ts (nostr-tools SimplePool). The server
 * deliberately does NOT: SimplePool's AbstractRelay falls back to the bare
 * `WebSocket` identifier when no implementation is injected, which is a
 * ReferenceError on node:20 — in the production container every relay failed
 * that way (0 answered / 4 failed) while the raw `ws` reader in nostr.ts read
 * the same relays fine. So the server reads through queryEventsWithRelayStatus,
 * the reader that is proven in that container, and this module only maps its
 * result onto the shared RelayReadResult shape.
 */
import { queryEventsWithRelayStatus } from './nostr.js';
import type { RelayReadResult } from '../../src/lib/relayRead.js';

export type { RelayReadResult };

export async function readFromRelaysServer(
  relays: string[],
  filter: Record<string, any>,
  budgetMs: number,
): Promise<RelayReadResult> {
  const { events, answered, failed } = await queryEventsWithRelayStatus(relays, filter, budgetMs);
  return { events: events as RelayReadResult['events'], answered, failed };
}
