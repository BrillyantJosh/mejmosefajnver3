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
      let resolved = false;
      const safeResolve = (result: NostrEvent[]) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const timeoutId = setTimeout(() => {
        try { ws.close(); } catch {}
        safeResolve(events);
      }, timeout);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeoutId);
        safeResolve([]);
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
            try { ws.close(); } catch {}
            safeResolve(events);
          }
        } catch (error) {
          // Ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeoutId);
        safeResolve(events);
      });

      ws.on('close', () => {
        clearTimeout(timeoutId);
        // CRITICAL: resolve on close too — if relay drops connection without
        // error event, the promise would hang forever without this
        safeResolve(events);
      });
    });
  };

  const results = await Promise.all(
    relays.map(relay => fetchEventsFromRelay(relay))
  );

  // Flatten and deduplicate by event ID
  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        allEvents.push(event);
      }
    }
  }

  // NIP-33: For parameterized replaceable events (kinds 30000-39999),
  // keep only the newest per (pubkey + kind + d-tag)
  const isReplaceableKind = (k: number) => k >= 30000 && k < 40000;
  if (allEvents.some(e => isReplaceableKind(e.kind))) {
    const replaceableMap = new Map<string, NostrEvent>();
    const result: NostrEvent[] = [];

    for (const event of allEvents) {
      if (isReplaceableKind(event.kind)) {
        const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1] || '';
        const key = `${event.pubkey}:${event.kind}:${dTag}`;
        const existing = replaceableMap.get(key);
        if (!existing || event.created_at > existing.created_at) {
          replaceableMap.set(key, event);
        }
      } else {
        result.push(event);
      }
    }

    result.push(...replaceableMap.values());
    return result;
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
  freezeStatus?: string;  // per-wallet freeze: '' | 'frozen_l8w' | 'frozen_max_cap' | 'frozen_too_wild' | 'frozen_unreg_Lanas'
}

/**
 * Get human-readable freeze reason from freeze_status code
 */
export function getFreezeReason(freezeStatus: string): string {
  switch (freezeStatus) {
    case 'frozen_l8w': return 'Late wallet registration';
    case 'frozen_max_cap': return 'Maximum balance cap exceeded';
    case 'frozen_too_wild': return 'Irregular or suspicious activity';
    case 'frozen_unreg_Lanas': return 'Received unregistered LANA exceeding threshold';
    default: return 'Account frozen';
  }
}

export async function fetchUserWallets(
  pubkey: string,
  relays: string[],
  trustedSigners: string[] = []
): Promise<WalletData[]> {
  console.log(`🔄 Fetching wallets (KIND 30889) for pubkey: ${pubkey}`);
  console.log(`📡 Using ${relays.length} relays, ${trustedSigners.length} trusted signers`);

  // Query by both #d (pubkey or wallet-list-pubkey) and #p tag for robust matching
  // Different registrars use different d-tag formats
  const [eventsByD, eventsByWalletD, eventsByP] = await Promise.all([
    queryEventsFromRelays(relays, { kinds: [30889], '#d': [pubkey] }),
    queryEventsFromRelays(relays, { kinds: [30889], '#d': [`wallet-list-${pubkey}`] }),
    queryEventsFromRelays(relays, { kinds: [30889], '#p': [pubkey] }),
  ]);

  // Merge and deduplicate by event id
  const eventMap = new Map<string, any>();
  [...eventsByD, ...eventsByWalletD, ...eventsByP].forEach(e => eventMap.set(e.id, e));
  const events = Array.from(eventMap.values());

  console.log(`📥 Received ${events.length} KIND 30889 events (d:${eventsByD.length}, wallet-d:${eventsByWalletD.length}, p:${eventsByP.length})`);

  // Filter by trusted signers if configured
  const filteredEvents = trustedSigners.length === 0
    ? events
    : events.filter(event => trustedSigners.includes(event.pubkey));

  // Only keep events that have w tags (wallet-list events, not individual wallet registrations)
  const walletListEvents = filteredEvents.filter(event =>
    event.tags.some((t: string[]) => t[0] === 'w')
  );

  console.log(`✅ ${walletListEvents.length} wallet-list events after filter (${filteredEvents.length} total trusted)`);

  if (walletListEvents.length === 0) {
    console.log('⚠️ No wallet-list events found');
    return [];
  }

  // CRITICAL: Use ONLY the newest wallet-list event.
  // The latest event from a trusted registrar is the authoritative wallet list.
  // Merging wallets from multiple events causes stale/old wallets to appear.
  walletListEvents.sort((a, b) => b.created_at - a.created_at);
  const latestEvent = walletListEvents[0];

  console.log(`📋 Using latest event: ${latestEvent.id} (created_at: ${latestEvent.created_at}, registrar: ${latestEvent.pubkey.slice(0, 8)}...)`);

  const statusTag = latestEvent.tags.find((t: string[]) => t[0] === 'status');
  const status = statusTag?.[1] || 'active';
  const isAccountFrozen = status === 'frozen';

  const walletTags = latestEvent.tags.filter((t: string[]) => t[0] === 'w');
  const wallets: WalletData[] = [];

  for (const tag of walletTags) {
    if (tag.length >= 6) {
      // 7th field (index 6) is optional freeze_status
      const perWalletFreeze = tag.length >= 7 ? (tag[6] || '') : '';

      // Determine effective freeze status:
      // If account-level status=frozen → all wallets frozen
      // If per-wallet freeze code is set → that wallet is frozen
      // Any unrecognized non-empty freeze code → treat as frozen (fail-safe)
      let freezeStatus = '';
      if (isAccountFrozen) {
        freezeStatus = perWalletFreeze || 'frozen';
      } else if (perWalletFreeze) {
        freezeStatus = perWalletFreeze;
      }

      wallets.push({
        walletId: tag[1],
        walletType: tag[2],
        note: tag[4] || '',
        amountUnregistered: tag[5],
        status,
        freezeStatus,
        registrarPubkey: latestEvent.pubkey,
        eventId: latestEvent.id,
        createdAt: latestEvent.created_at,
      });
    }
  }

  console.log(`✅ Found ${wallets.length} wallets from latest event (status: ${status}, frozen: ${isAccountFrozen})`);
  return wallets;
}

/**
 * Publish a signed Nostr event to multiple relays
 * Returns an array of { relay, success, error? } results
 *
 * ⚠️⚠️⚠️ CRITICAL: NEVER reduce the default timeout below 60000ms! ⚠️⚠️⚠️
 *
 * History of failures caused by short timeouts:
 * - 8s timeout → audio messages always failed ("Sending failed")
 * - 30s timeout → still failed for 4+ minute audio recordings
 * - 60s timeout → works reliably with server-side publish
 *
 * The OWN module (audio messages), Shop, and DM modules all depend on this.
 * Reducing this timeout WILL break audio message delivery.
 */
const MINIMUM_PUBLISH_TIMEOUT = 60000; // Absolute minimum — do NOT change

export async function publishEventToRelays(
  relays: string[],
  event: any,
  timeout = 60000
): Promise<Array<{ relay: string; success: boolean; error?: string }>> {
  // Enforce minimum timeout to prevent future regressions
  if (timeout < MINIMUM_PUBLISH_TIMEOUT) {
    console.warn(`⚠️ publishEventToRelays: timeout ${timeout}ms is below minimum ${MINIMUM_PUBLISH_TIMEOUT}ms, using minimum`);
    timeout = MINIMUM_PUBLISH_TIMEOUT;
  }
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
 * Refresh stale profiles from Nostr relays and update the database.
 * Called periodically by the server heartbeat.
 * Fetches profiles where last_fetched_at is older than 10 minutes, up to 50 at a time.
 */
export async function refreshStaleProfiles(db: any): Promise<void> {
  // 1. Get relays from kind_38888
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ refreshStaleProfiles: No relays available, skipping');
    return;
  }

  // 2. Find stale profiles (last_fetched_at older than 1 hour), limit 100
  const staleProfiles = db.prepare(
    `SELECT nostr_hex_id FROM nostr_profiles WHERE last_fetched_at < datetime('now', '-60 minutes') LIMIT 100`
  ).all() as { nostr_hex_id: string }[];

  if (staleProfiles.length === 0) {
    console.log('✅ refreshStaleProfiles: All profiles are fresh');
    return;
  }

  const pubkeys = staleProfiles.map(p => p.nostr_hex_id);
  console.log(`🔄 refreshStaleProfiles: Refreshing ${pubkeys.length} stale profiles...`);

  // 3. Fetch KIND 0 events from relays
  let events: NostrEvent[];
  try {
    events = await queryEventsFromRelays(relays, {
      kinds: [0],
      authors: pubkeys,
    }, 15000);
  } catch (error) {
    console.error('❌ refreshStaleProfiles: Relay fetch failed:', error);
    // Bump last_fetched_at for all queried pubkeys to avoid re-querying every cycle
    const bumpStmt = db.prepare(`UPDATE nostr_profiles SET last_fetched_at = datetime('now') WHERE nostr_hex_id = ?`);
    for (const pk of pubkeys) bumpStmt.run(pk);
    return;
  }

  console.log(`📥 refreshStaleProfiles: Fetched ${events.length} KIND 0 events`);

  // 4. Deduplicate - keep newest per pubkey
  const latestEvents = new Map<string, NostrEvent>();
  for (const event of events) {
    const existing = latestEvents.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latestEvents.set(event.pubkey, event);
    }
  }

  // 5. Upsert to database
  const upsertStmt = db.prepare(`
    INSERT INTO nostr_profiles (nostr_hex_id, full_name, display_name, picture, about, lana_wallet_id, raw_metadata, last_fetched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(nostr_hex_id) DO UPDATE SET
      full_name = excluded.full_name,
      display_name = excluded.display_name,
      picture = excluded.picture,
      about = excluded.about,
      lana_wallet_id = excluded.lana_wallet_id,
      raw_metadata = excluded.raw_metadata,
      last_fetched_at = datetime('now'),
      updated_at = datetime('now')
  `);

  let upsertedCount = 0;
  for (const [pubkey, event] of latestEvents) {
    try {
      const content = JSON.parse(event.content);

      // Extract tags (lang, interests, intimateInterests) - same as refresh-nostr-profiles endpoint
      const langTag = event.tags?.find((t: string[]) => t[0] === 'lang')?.[1];
      const interests = event.tags?.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]) || [];
      const intimateInterests = event.tags?.filter((t: string[]) => t[0] === 'o').map((t: string[]) => t[1]) || [];

      const rawMetadata = {
        ...content,
        created_at: event.created_at,
        ...(langTag ? { lang: langTag } : {}),
        ...(interests.length > 0 ? { interests } : {}),
        ...(intimateInterests.length > 0 ? { intimateInterests } : {}),
      };

      upsertStmt.run(
        pubkey,
        content.name || null,
        content.display_name || null,
        content.picture || null,
        content.about || null,
        content.lanaWalletID || null,
        JSON.stringify(rawMetadata)
      );
      upsertedCount++;
    } catch (error) {
      console.error(`❌ refreshStaleProfiles: Error parsing profile for ${pubkey}:`, error);
    }
  }

  // 6. Bump last_fetched_at for pubkeys NOT found on relays (to avoid re-querying)
  const foundPubkeys = new Set(latestEvents.keys());
  const bumpStmt = db.prepare(`UPDATE nostr_profiles SET last_fetched_at = datetime('now') WHERE nostr_hex_id = ?`);
  for (const pk of pubkeys) {
    if (!foundPubkeys.has(pk)) {
      bumpStmt.run(pk);
    }
  }

  const notFound = pubkeys.length - upsertedCount;
  console.log(`✅ refreshStaleProfiles: ${upsertedCount} updated, ${notFound} not found on relays`);
}

/**
 * Daily cleanup: removes profiles from the DB that no longer exist on any relay.
 * Queries all profiles in batches, checks each against relays, deletes orphans.
 */
export async function cleanupOrphanedProfiles(db: any): Promise<void> {
  // 1. Get relays from kind_38888
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ cleanupOrphanedProfiles: No relays available, skipping');
    return;
  }

  // 2. Get all profiles from DB
  const allProfiles = db.prepare('SELECT nostr_hex_id FROM nostr_profiles').all() as { nostr_hex_id: string }[];
  if (allProfiles.length === 0) {
    console.log('✅ cleanupOrphanedProfiles: No profiles in DB');
    return;
  }

  console.log(`🧹 cleanupOrphanedProfiles: Checking ${allProfiles.length} profiles against relays...`);

  const orphanedPubkeys: string[] = [];
  const BATCH_SIZE = 50;

  // 3. Check in batches of 50
  for (let i = 0; i < allProfiles.length; i += BATCH_SIZE) {
    const batch = allProfiles.slice(i, i + BATCH_SIZE).map(p => p.nostr_hex_id);

    let events: NostrEvent[] = [];
    try {
      events = await queryEventsFromRelays(relays, {
        kinds: [0],
        authors: batch,
      }, 15000);
    } catch (error) {
      console.error(`❌ cleanupOrphanedProfiles: Relay fetch failed for batch ${i / BATCH_SIZE + 1}:`, error);
      // Skip this batch — don't delete profiles we couldn't verify
      continue;
    }

    // Found pubkeys from relay response
    const foundPubkeys = new Set(events.map(e => e.pubkey));

    // Mark missing ones as orphaned
    for (const pk of batch) {
      if (!foundPubkeys.has(pk)) {
        orphanedPubkeys.push(pk);
      }
    }

    // Small delay between batches to not hammer relays
    if (i + BATCH_SIZE < allProfiles.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 4. Delete orphaned profiles
  if (orphanedPubkeys.length === 0) {
    console.log(`✅ cleanupOrphanedProfiles: All ${allProfiles.length} profiles verified on relays`);
    return;
  }

  const deleteStmt = db.prepare('DELETE FROM nostr_profiles WHERE nostr_hex_id = ?');
  let deletedCount = 0;
  for (const pk of orphanedPubkeys) {
    try {
      deleteStmt.run(pk);
      deletedCount++;
    } catch (error) {
      console.error(`❌ cleanupOrphanedProfiles: Error deleting ${pk}:`, error);
    }
  }

  console.log(`🧹 cleanupOrphanedProfiles: Deleted ${deletedCount} orphaned profiles (not found on any relay). ${allProfiles.length - deletedCount} remain.`);
}

/**
 * Paginated fetch of events from a single relay.
 * Uses `until` cursor to walk backwards through time, getting all events.
 * Returns deduplicated events (newest per pubkey for KIND 0).
 */
async function fetchAllFromRelay(
  relayUrl: string,
  baseFilter: Record<string, any>,
  pageSize = 500,
  maxPages = 20,
  pageTimeout = 15000
): Promise<NostrEvent[]> {
  const allByPubkey = new Map<string, NostrEvent>();
  let until: number | undefined = undefined;

  for (let page = 0; page < maxPages; page++) {
    const filter = { ...baseFilter, limit: pageSize };
    if (until !== undefined) filter.until = until;

    const events = await queryEventsFromRelays([relayUrl], filter, pageTimeout);
    if (events.length === 0) break;

    let oldestCreatedAt = Infinity;
    for (const e of events) {
      const existing = allByPubkey.get(e.pubkey);
      if (!existing || e.created_at > existing.created_at) {
        allByPubkey.set(e.pubkey, e);
      }
      if (e.created_at < oldestCreatedAt) oldestCreatedAt = e.created_at;
    }

    // Last page (fewer results than limit) or no progress
    if (events.length < pageSize) break;
    if (until !== undefined && oldestCreatedAt >= until) break;
    until = oldestCreatedAt;
  }

  return Array.from(allByPubkey.values());
}

/** Helper to parse a KIND 0 event and upsert into nostr_profiles */
function upsertProfileEvent(db: any, upsertStmt: any, pubkey: string, event: NostrEvent): boolean {
  const content = JSON.parse(event.content);

  const langTag = event.tags?.find((t: string[]) => t[0] === 'lang')?.[1];
  const interests = event.tags?.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]) || [];
  const intimateInterests = event.tags?.filter((t: string[]) => t[0] === 'o').map((t: string[]) => t[1]) || [];

  const rawMetadata = {
    ...content,
    created_at: event.created_at,
    ...(langTag ? { lang: langTag } : {}),
    ...(interests.length > 0 ? { interests } : {}),
    ...(intimateInterests.length > 0 ? { intimateInterests } : {}),
  };

  upsertStmt.run(
    pubkey,
    content.name || null,
    content.display_name || null,
    content.picture || null,
    content.about || null,
    content.lanaWalletID || null,
    JSON.stringify(rawMetadata)
  );
  return true;
}

/**
 * Full paginated profile sweep across all relays.
 * Walks backwards through time to catch ALL KIND 0 events,
 * including older profiles that single-page queries miss.
 * Called on startup and periodically (every 30 min).
 */
export async function discoverNewProfiles(db: any): Promise<void> {
  // 1. Get relays from kind_38888
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ discoverNewProfiles: No relays available, skipping');
    return;
  }

  // Skip damus.io for KIND 0 sweep (too many non-Lana profiles)
  const lanaRelays = relays.filter(r => !r.includes('damus.io'));

  console.log(`🔍 discoverNewProfiles: Full paginated sweep across ${lanaRelays.length} Lana relays...`);

  // 2. Paginated fetch from each relay, merge all results
  const allProfiles = new Map<string, NostrEvent>();

  for (const relay of lanaRelays) {
    try {
      const events = await fetchAllFromRelay(relay, { kinds: [0] }, 500, 20, 15000);
      let added = 0;
      for (const event of events) {
        const existing = allProfiles.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          allProfiles.set(event.pubkey, event);
          added++;
        }
      }
      console.log(`  📡 ${relay}: ${events.length} profiles fetched, ${added} kept (newest)`);
    } catch (error) {
      console.error(`  ❌ ${relay}: fetch failed:`, error);
    }
  }

  if (allProfiles.size === 0) {
    console.log('✅ discoverNewProfiles: No profiles found on relays');
    return;
  }

  console.log(`📥 discoverNewProfiles: ${allProfiles.size} unique profiles across all relays`);

  // 3. Upsert all into database
  const upsertStmt = db.prepare(`
    INSERT INTO nostr_profiles (nostr_hex_id, full_name, display_name, picture, about, lana_wallet_id, raw_metadata, last_fetched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(nostr_hex_id) DO UPDATE SET
      full_name = excluded.full_name,
      display_name = excluded.display_name,
      picture = excluded.picture,
      about = excluded.about,
      lana_wallet_id = excluded.lana_wallet_id,
      raw_metadata = excluded.raw_metadata,
      last_fetched_at = datetime('now'),
      updated_at = datetime('now')
  `);

  let newCount = 0;
  let updateCount = 0;
  let walletCount = 0;
  let errorCount = 0;

  for (const [pubkey, event] of allProfiles) {
    try {
      const existing = db.prepare('SELECT nostr_hex_id FROM nostr_profiles WHERE nostr_hex_id = ?').get(pubkey);
      upsertProfileEvent(db, upsertStmt, pubkey, event);

      // Count stats
      try {
        const c = JSON.parse(event.content);
        if (c.lanaWalletID) walletCount++;
      } catch {}

      if (existing) updateCount++;
      else newCount++;
    } catch (error) {
      errorCount++;
    }
  }

  console.log(`✅ discoverNewProfiles: ${newCount} new, ${updateCount} updated, ${walletCount} with wallet, ${errorCount} errors (${allProfiles.size} total)`);
}

/**
 * Get the authorized pubkey for KIND 38888
 */
export function getAuthorizedPubkey(): string {
  return AUTHORIZED_PUBKEY;
}

/**
 * Sync project funded status: fetches KIND 31234 projects and KIND 60200 donations,
 * then updates project_overrides.funded in app_settings DB.
 * Runs periodically via heartbeat (every 30 min).
 */
export async function syncProjectFundedStatus(db: any): Promise<void> {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ syncProjectFundedStatus: No relays available, skipping');
    return;
  }

  try {
    // Fetch KIND 31234 projects and KIND 60200 donations in parallel
    const [projectEvents, donationEvents] = await Promise.all([
      queryEventsFromRelays(relays, { kinds: [31234], limit: 500 }, 15000),
      queryEventsFromRelays(relays, { kinds: [60200], limit: 1000 }, 15000),
    ]);

    console.log(`📊 syncProjectFundedStatus: ${projectEvents.length} projects, ${donationEvents.length} donations`);

    // Deduplicate projects by d-tag (keep newest)
    const projectsByDTag = new Map<string, any>();
    for (const evt of projectEvents) {
      const dTag = evt.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!dTag) continue;
      const existing = projectsByDTag.get(dTag);
      if (!existing || evt.created_at > existing.created_at) {
        projectsByDTag.set(dTag, evt);
      }
    }

    // Aggregate donations per project
    const donationsPerProject = new Map<string, number>();
    for (const evt of donationEvents) {
      const projectTag = evt.tags?.find((t: string[]) => t[0] === 'project')?.[1];
      if (!projectTag) continue;
      const amountStr = evt.tags?.find((t: string[]) => t[0] === 'amount_fiat')?.[1];
      if (!amountStr) continue;
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        donationsPerProject.set(projectTag, (donationsPerProject.get(projectTag) || 0) + amount);
      }
    }

    // Load current overrides
    const settingsRow = db.prepare("SELECT value FROM app_settings WHERE key = '100millionideas_project_overrides'").get() as any;
    let overrides: Record<string, any> = {};
    if (settingsRow?.value) {
      try { overrides = JSON.parse(settingsRow.value); } catch {}
    }

    let changed = 0;

    // Check each project
    for (const [dTag, evt] of projectsByDTag) {
      const fiatGoalStr = evt.tags?.find((t: string[]) => t[0] === 'fiat_goal')?.[1];
      const fiatGoal = parseFloat(fiatGoalStr || '0');
      if (fiatGoal <= 0) continue;

      const totalRaised = donationsPerProject.get(dTag) || 0;
      const isFunded = totalRaised >= fiatGoal * 0.99;

      const current = overrides[dTag] || {};
      const wasFunded = !!current.funded;

      if (isFunded && !wasFunded) {
        overrides[dTag] = { ...current, funded: true };
        changed++;
      } else if (!isFunded && wasFunded) {
        overrides[dTag] = { ...current, funded: false };
        changed++;
      }
    }

    // Save if anything changed
    if (changed > 0) {
      db.prepare("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = '100millionideas_project_overrides'").run(JSON.stringify(overrides));
      console.log(`✅ syncProjectFundedStatus: Updated ${changed} project funded statuses`);
    } else {
      console.log('✅ syncProjectFundedStatus: No changes needed');
    }

    const fundedCount = Object.values(overrides).filter((o: any) => o.funded).length;
    console.log(`📊 syncProjectFundedStatus: ${fundedCount} funded of ${projectsByDTag.size} total projects`);
  } catch (error) {
    console.error('❌ syncProjectFundedStatus error:', error);
  }
}
