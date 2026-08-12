/**
 * Server-side entry to the one honest relay reader (src/lib/relayRead.ts).
 *
 * queryEventsFromRelays (server/lib/nostr.ts) never rejects and discards
 * per-relay outcomes — a total relay outage resolves to `[]`, byte-identical
 * to "no events exist". For payment paths that distinction is the whole game:
 * an unreadable paid-state must never be presented as "unpaid".
 *
 * This is deliberately NOT another reader: it only gives readFromRelays the
 * two things the browser has for free — a SimplePool and a WebSocket
 * implementation (node:20 has no global WebSocket, so we hand nostr-tools the
 * same `ws` package the rest of the server already uses).
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import type { Filter } from 'nostr-tools';
import WebSocket from 'ws';
import { readFromRelays, type RelayReadResult } from '../../src/lib/relayRead.js';

if (typeof (globalThis as any).WebSocket === 'undefined') {
  useWebSocketImplementation(WebSocket as any);
}

// One pool for the server's lifetime — reuses relay connections across requests.
let pool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

export type { RelayReadResult };

export async function readFromRelaysServer(
  relays: string[],
  filter: Filter,
  budgetMs: number,
): Promise<RelayReadResult> {
  const pool = getPool();
  // The fleet's relays verify signatures on ingest; skipping re-verification
  // here matches the previous raw-WebSocket reader's semantics exactly and
  // keeps schnorr work off the server event loop.
  for (const url of relays) {
    try { pool.trustedRelayURLs.add(normalizeURL(url)); } catch { /* malformed URL fails in the read itself */ }
  }
  return readFromRelays(pool, relays, filter, { budgetMs });
}
