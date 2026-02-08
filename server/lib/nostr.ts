/**
 * Nostr Library for Server-Side Relay Communication
 * Fetches KIND 38888 system parameters from official Lana relays
 */

import WebSocket from 'ws';

// Official Lana Relays - ONLY these should be used for KIND 38888
const LANA_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com'
];

// Authorized publisher for KIND 38888
const AUTHORIZED_PUBKEY = '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface Kind38888Data {
  event_id: string;
  pubkey: string;
  created_at: number;
  relays: string[];
  electrum_servers: Array<{ host: string; port: string }>;
  exchange_rates: { EUR: number; USD: number; GBP: number };
  split: string;
  split_target_lana?: number;
  split_started_at?: number;
  split_ends_at?: number;
  version: string;
  valid_from: number;
  trusted_signers: Record<string, string[]>;
  raw_event: string;
}

/**
 * Connect to a single relay and fetch KIND 38888
 */
async function fetchFromRelay(relayUrl: string, timeout = 15000): Promise<NostrEvent | null> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log(`⏱️ Timeout connecting to ${relayUrl}`);
      ws.close();
      resolve(null);
    }, timeout);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch (error) {
      console.error(`❌ Failed to create WebSocket for ${relayUrl}:`, error);
      clearTimeout(timeoutId);
      resolve(null);
      return;
    }

    const subscriptionId = `kind38888_${Date.now()}`;

    ws.on('open', () => {
      console.log(`✅ Connected to ${relayUrl}`);

      // Request KIND 38888 from authorized pubkey with d=main
      const filter = {
        kinds: [38888],
        authors: [AUTHORIZED_PUBKEY],
        '#d': ['main'],
        limit: 1
      };

      const req = JSON.stringify(['REQ', subscriptionId, filter]);
      console.log(`📤 Sending request to ${relayUrl}:`, req);
      ws.send(req);
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`📥 Received from ${relayUrl}:`, message[0]);

        if (message[0] === 'EVENT' && message[1] === subscriptionId) {
          const event = message[2] as NostrEvent;

          // Verify it's from authorized pubkey
          if (event.pubkey !== AUTHORIZED_PUBKEY) {
            console.warn(`⚠️ Ignoring event from unauthorized pubkey: ${event.pubkey}`);
            return;
          }

          // Verify it's KIND 38888
          if (event.kind !== 38888) {
            console.warn(`⚠️ Ignoring non-38888 event: kind ${event.kind}`);
            return;
          }

          console.log(`✅ Got valid KIND 38888 event from ${relayUrl}, id: ${event.id}`);
          clearTimeout(timeoutId);
          ws.close();
          resolve(event);
        } else if (message[0] === 'EOSE') {
          console.log(`📭 End of stored events from ${relayUrl}`);
          // Don't resolve null yet, wait for timeout in case event arrives late
        }
      } catch (error) {
        console.error(`❌ Error parsing message from ${relayUrl}:`, error);
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for ${relayUrl}:`, error);
      clearTimeout(timeoutId);
      resolve(null);
    });

    ws.on('close', () => {
      console.log(`🔌 Disconnected from ${relayUrl}`);
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Parse KIND 38888 event into structured data
 */
function parseKind38888Event(event: NostrEvent): Kind38888Data {
  // Parse content (may be JSON string or object)
  let content: any = {};
  try {
    content = typeof event.content === 'string' && event.content.trim().startsWith('{')
      ? JSON.parse(event.content)
      : {};
  } catch (e) {
    console.warn('Failed to parse content as JSON, using tags only');
  }

  // Extract from tags (primary source)
  const tags = event.tags;

  const relays = tags
    .filter(t => t[0] === 'relay')
    .map(t => t[1]);

  const electrum_servers = tags
    .filter(t => t[0] === 'electrum')
    .map(t => ({ host: t[1], port: t[2] || '5097' }));

  const fxTags = tags.filter(t => t[0] === 'fx');
  const exchange_rates = {
    EUR: parseFloat(fxTags.find(t => t[1] === 'EUR')?.[2] || '0'),
    USD: parseFloat(fxTags.find(t => t[1] === 'USD')?.[2] || '0'),
    GBP: parseFloat(fxTags.find(t => t[1] === 'GBP')?.[2] || '0')
  };

  const split = tags.find(t => t[0] === 'split')?.[1] || content.split || '';
  const split_target_lana = parseInt(tags.find(t => t[0] === 'split_target_lana')?.[1] || content.split_target_lana || '0');
  const split_started_at = parseInt(tags.find(t => t[0] === 'split_started_at')?.[1] || content.split_started_at || '0');
  const split_ends_at = parseInt(tags.find(t => t[0] === 'split_ends_at')?.[1] || content.split_ends_at || '0');
  const version = tags.find(t => t[0] === 'version')?.[1] || content.version || '1';
  const valid_from = parseInt(tags.find(t => t[0] === 'valid_from')?.[1] || content.valid_from || '0');

  // Trusted signers from content
  const trusted_signers = content.trusted_signers || {};

  return {
    event_id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    relays: relays.length > 0 ? relays : content.relays || LANA_RELAYS,
    electrum_servers: electrum_servers.length > 0 ? electrum_servers : content.electrum || [],
    exchange_rates,
    split,
    split_target_lana,
    split_started_at,
    split_ends_at,
    version,
    valid_from,
    trusted_signers,
    raw_event: JSON.stringify(event)
  };
}

/**
 * Fetch KIND 38888 from all Lana relays and return the newest valid event
 */
export async function fetchKind38888(): Promise<Kind38888Data | null> {
  console.log('🔄 Fetching KIND 38888 from Lana relays...');
  console.log(`📡 Relays: ${LANA_RELAYS.join(', ')}`);

  const results = await Promise.all(
    LANA_RELAYS.map(relay => fetchFromRelay(relay))
  );

  // Filter out nulls and find the newest event
  const validEvents = results.filter((e): e is NostrEvent => e !== null);

  if (validEvents.length === 0) {
    console.error('❌ No valid KIND 38888 events received from any relay');
    return null;
  }

  // Sort by created_at (newest first)
  validEvents.sort((a, b) => b.created_at - a.created_at);
  const newestEvent = validEvents[0];

  console.log(`✅ Using KIND 38888 event: ${newestEvent.id} (created_at: ${newestEvent.created_at})`);

  return parseKind38888Event(newestEvent);
}

/**
 * Generic function to query events from relays with a custom filter
 * Returns all matching events from all relays (deduplicated by event id)
 */
export async function queryEventsFromRelays(
  relays: string[],
  filter: Record<string, any>,
  timeout = 10000
): Promise<NostrEvent[]> {
  const allEvents: NostrEvent[] = [];
  const seenIds = new Set<string>();

  const fetchEventsFromRelay = (relayUrl: string): Promise<NostrEvent[]> => {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timeoutId = setTimeout(() => {
        ws.close();
        resolve(events);
      }, timeout);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeoutId);
        resolve([]);
        return;
      }

      const subscriptionId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      ws.on('open', () => {
        const req = JSON.stringify(['REQ', subscriptionId, filter]);
        ws.send(req);
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message[0] === 'EVENT' && message[1] === subscriptionId) {
            events.push(message[2] as NostrEvent);
          } else if (message[0] === 'EOSE') {
            // All stored events received, close connection
            clearTimeout(timeoutId);
            ws.close();
            resolve(events);
          }
        } catch (error) {
          // Ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeoutId);
        resolve(events);
      });

      ws.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  };

  const results = await Promise.all(
    relays.map(relay => fetchEventsFromRelay(relay))
  );

  // Flatten and deduplicate
  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        allEvents.push(event);
      }
    }
  }

  return allEvents;
}

/**
 * Fetch user wallets (KIND 30889) from relays
 * Returns parsed wallet objects filtered by trusted LanaRegistrar signers
 */
export interface WalletData {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
}

export async function fetchUserWallets(
  pubkey: string,
  relays: string[],
  trustedSigners: string[] = []
): Promise<WalletData[]> {
  console.log(`🔄 Fetching wallets (KIND 30889) for pubkey: ${pubkey}`);
  console.log(`📡 Using ${relays.length} relays, ${trustedSigners.length} trusted signers`);

  const events = await queryEventsFromRelays(relays, {
    kinds: [30889],
    '#d': [pubkey],
  });

  console.log(`📥 Received ${events.length} KIND 30889 events`);

  // Filter by trusted signers if configured
  const filteredEvents = trustedSigners.length === 0
    ? events
    : events.filter(event => trustedSigners.includes(event.pubkey));

  console.log(`✅ ${filteredEvents.length} events after trusted signer filter`);

  const allWallets: WalletData[] = [];

  for (const event of filteredEvents) {
    const statusTag = event.tags.find(t => t[0] === 'status');
    const status = statusTag?.[1] || 'active';

    const walletTags = event.tags.filter(t => t[0] === 'w');

    for (const tag of walletTags) {
      if (tag.length >= 6) {
        allWallets.push({
          walletId: tag[1],
          walletType: tag[2],
          note: tag[4] || '',
          amountUnregistered: tag[5],
          status,
          registrarPubkey: event.pubkey,
          eventId: event.id,
          createdAt: event.created_at,
        });
      }
    }
  }

  // Sort by createdAt (newest first)
  allWallets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Deduplicate by walletId (keep newest)
  const uniqueWallets = Array.from(
    new Map(allWallets.map(w => [w.walletId, w])).values()
  );

  console.log(`✅ Found ${uniqueWallets.length} unique wallets`);
  return uniqueWallets;
}

/**
 * Publish a signed Nostr event to multiple relays
 * Returns an array of { relay, success, error? } results
 */
export async function publishEventToRelays(
  relays: string[],
  event: any,
  timeout = 8000
): Promise<Array<{ relay: string; success: boolean; error?: string }>> {
  const publishToRelay = (relayUrl: string): Promise<{ relay: string; success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result: { relay: string; success: boolean; error?: string }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        try { ws.close(); } catch {}
        done({ relay: relayUrl, success: false, error: 'Timeout' });
      }, timeout);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        done({ relay: relayUrl, success: false, error: 'Connection failed' });
        return;
      }

      ws.on('open', () => {
        const msg = JSON.stringify(['EVENT', event]);
        ws.send(msg);
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message[0] === 'OK') {
            const accepted = message[2] === true;
            if (!accepted) {
              console.log(`⚠️ Relay ${relayUrl} rejected: ${message[3] || 'unknown'}`);
            }
            try { ws.close(); } catch {}
            done({ relay: relayUrl, success: accepted, error: accepted ? undefined : (message[3] || 'Rejected') });
          }
        } catch {}
      });

      ws.on('error', (err: any) => {
        try { ws.close(); } catch {}
        done({ relay: relayUrl, success: false, error: err.message || 'WebSocket error' });
      });

      ws.on('close', () => {
        if (!resolved) {
          done({ relay: relayUrl, success: false, error: 'Closed without response' });
        }
      });
    });
  };

  return Promise.all(relays.map(relay => publishToRelay(relay)));
}

// getLanaRelays() removed — relays should come from kind_38888 DB table, not hardcoded

/**
 * Get the authorized pubkey for KIND 38888
 */
export function getAuthorizedPubkey(): string {
  return AUTHORIZED_PUBKEY;
}
