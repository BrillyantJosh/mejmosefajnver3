/**
 * Nostr Library for Server-Side Relay Communication
 * Fetches KIND 38888 system parameters from official Lana relays
 */

import { verifyEvent } from 'nostr-tools';
import { computeEligibility } from './ufEligibility.js';
import { isWalletPinned, resolveKnownFundingOpensAt, resolveNewRequestTiming } from './ufMaturing.js';
import WebSocket from 'ws';
import { poolQuery } from './relayPool.js';
import { getUfSettings } from './ufSettings.js';

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
      resolve(null);
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
/** Which relays actually answered a query, and why the others did not. */
export interface RelayQueryStatus {
  /** Relays that sent a real EOSE frame within the timeout. */
  answered: string[];
  /** Relays that errored, closed early, or ran out of time. */
  failed: { url: string; reason: string }[];
}

/**
 * The same query as queryEventsFromRelays, but it also reports WHICH relays
 * answered — the distinction between "the relay said there is nothing" and
 * "we never heard back". Payment paths need it: treating an unreadable
 * paid-state as unpaid is how the same obligation gets paid twice.
 *
 * EOSE is the only success signal. A close without EOSE is a failure, because
 * a relay that drops the socket has told us nothing about what it holds.
 *
 * Never rejects: a total outage resolves with answered: [].
 */
export async function queryEventsWithRelayStatus(
  relays: string[],
  filter: Record<string, any>,
  timeout = 10000
): Promise<{ events: NostrEvent[] } & RelayQueryStatus> {
  const allEvents: NostrEvent[] = [];
  const seenIds = new Set<string>();
  const answered: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  // One shared socket per relay, and identical concurrent filters answered
  // once — see server/lib/relayPool.ts for the measurements that led to it.
  // The contract here is unchanged: a relay that reaches EOSE is 'answered',
  // anything else is 'failed' and reports what it managed to collect, so
  // callers can still tell a silent relay from a genuinely empty result.
  const fetchEventsFromRelay = async (relayUrl: string): Promise<NostrEvent[]> => {
    const r = await poolQuery(relayUrl, filter, timeout);
    if (r.ok) answered.push(relayUrl);
    else failed.push({ url: relayUrl, reason: r.reason });
    return r.events as NostrEvent[];
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
    return { events: result, answered, failed };
  }

  return { events: allEvents, answered, failed };
}

/**
 * Events only — the long-standing signature every non-payment caller uses.
 * Delegates to queryEventsWithRelayStatus so there is exactly ONE relay
 * reader on the server; callers that must tell a failed read from an empty
 * one call that function directly.
 */
export async function queryEventsFromRelays(
  relays: string[],
  filter: Record<string, any>,
  timeout = 10000
): Promise<NostrEvent[]> {
  const { events } = await queryEventsWithRelayStatus(relays, filter, timeout);
  return events;
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
    case 'frozen_own_person': return 'Frozen by the self-responsibility process';
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
    const filter: Record<string, any> = { ...baseFilter, limit: pageSize };
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

// ─────────────────────────────────────────────────────────────────
// indexLanacrowdFromRelays
// Indexes KIND 31234 projects + KIND 60200 donations into SQLite.
// Preserves admin overrides. Acts as safety net — primary path is
// the immediate upsert from the client after Nostr publish.
// ─────────────────────────────────────────────────────────────────
export async function indexLanacrowdFromRelays(db: any): Promise<void> {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ indexLanacrowdFromRelays: No relays available, skipping');
    return;
  }

  try {
    // Fetch all projects + donations from relays in parallel
    const [projectEvents, donationEvents] = await Promise.all([
      queryEventsFromRelays(relays, { kinds: [31234], limit: 1000 }, 20000),
      queryEventsFromRelays(relays, { kinds: [60200], limit: 5000 }, 20000),
    ]);

    console.log(`📦 indexLanacrowdFromRelays: ${projectEvents.length} KIND 31234, ${donationEvents.length} KIND 60200`);

    // Deduplicate projects by (pubkey+d-tag), keep newest
    const projectsByKey = new Map<string, any>();
    for (const evt of projectEvents) {
      const dTag = evt.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!dTag) continue;
      const key = `${evt.pubkey}:${dTag}`;
      const existing = projectsByKey.get(key);
      if (!existing || evt.created_at > existing.created_at) {
        projectsByKey.set(key, { ...evt, dTag });
      }
    }

    const upsertProject = db.prepare(`
      INSERT INTO lanacrowd_projects (
        id, event_id, pubkey, owner_pubkey,
        title, short_desc, content,
        fiat_goal, currency, wallet,
        responsibility_statement, project_type, what_type, status,
        cover_image, gallery_images, videos, files, participants,
        is_hidden, is_approved, is_funded, is_completed, completion_comment,
        nostr_created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        pubkey = excluded.pubkey,
        owner_pubkey = excluded.owner_pubkey,
        title = excluded.title,
        short_desc = excluded.short_desc,
        content = excluded.content,
        fiat_goal = excluded.fiat_goal,
        currency = excluded.currency,
        wallet = excluded.wallet,
        responsibility_statement = excluded.responsibility_statement,
        project_type = excluded.project_type,
        what_type = excluded.what_type,
        status = excluded.status,
        cover_image = excluded.cover_image,
        gallery_images = excluded.gallery_images,
        videos = excluded.videos,
        files = excluded.files,
        participants = excluded.participants,
        nostr_created_at = CASE WHEN excluded.nostr_created_at > lanacrowd_projects.nostr_created_at
                                THEN excluded.nostr_created_at ELSE lanacrowd_projects.nostr_created_at END,
        updated_at = datetime('now')
    `);

    let projectsIndexed = 0;
    for (const evt of projectsByKey.values()) {
      try {
        const getTag = (name: string) => evt.tags?.find((t: string[]) => t[0] === name)?.[1];
        const getAllTags = (name: string) => evt.tags?.filter((t: string[]) => t[0] === name) || [];

        const title = getTag('title');
        if (!title) continue; // skip malformed events

        // The 'owner' marker sits at tag index 2 in this app's own events
        // (['p', pk, 'owner']) but at index 3 in events published from
        // being3 (['p', pk, '', 'owner']). Accept either, then fall back to
        // the event author — for self-signed projects author === owner.
        const ownerTag = evt.tags?.find((t: string[]) => t[0] === 'p' && (t[2] === 'owner' || t[3] === 'owner'));
        const ownerPubkey = ownerTag?.[1] || evt.pubkey;
        // The recipient wallet is a content field on the event. This line was
        // missing (the sibling indexer defines it) — its absence threw a
        // ReferenceError per project, so this relay indexer silently indexed
        // NOTHING, and projects published straight to relays (e.g. from
        // being3, which never calls the upsert endpoint) never reached SQLite.
        const wallet = getTag('wallet') || '';
        const imageTags = getAllTags('img');
        const coverImage = imageTags.find((t: string[]) => t[2] === 'cover')?.[1] || null;
        const galleryImages = imageTags.filter((t: string[]) => t[2] === 'gallery').map((t: string[]) => t[1]);
        const videos = getAllTags('video').map((t: string[]) => t[1]);
        const files = getAllTags('file').map((t: string[]) => t[1]);
        const participants = getAllTags('p').filter((t: string[]) => (t[2] === 'participant' || t[3] === 'participant')).map((t: string[]) => t[1]);

        // Fetch existing admin overrides to preserve them
        const existing = db.prepare('SELECT is_hidden, is_approved, is_funded, is_completed, completion_comment FROM lanacrowd_projects WHERE id = ?').get(evt.dTag) as any;

        upsertProject.run(
          evt.dTag,
          evt.id,
          evt.pubkey,
          ownerPubkey,
          title,
          getTag('short_desc') || '',
          evt.content || '',
          parseFloat(getTag('fiat_goal') || '0') || 0,
          getTag('currency') || 'EUR',
          wallet,
          getTag('responsibility_statement') || '',
          getTag('project_type') || 'Inspiration',
          getTag('what_type') || null,
          getTag('status') || 'active',
          coverImage,
          JSON.stringify(galleryImages),
          JSON.stringify(videos),
          JSON.stringify(files),
          JSON.stringify(participants),
          existing ? existing.is_hidden : 0,
          existing ? existing.is_approved : 0,
          existing ? existing.is_funded : 0,
          existing ? existing.is_completed : 0,
          existing ? existing.completion_comment : null,
          evt.created_at,
        );
        projectsIndexed++;
      } catch (err) {
        console.error('❌ indexLanacrowdFromRelays: failed to upsert project', evt.dTag, err);
      }
    }

    // Migrate admin overrides from legacy app_settings blob (one-time safe operation)
    try {
      const settingsRow = db.prepare("SELECT value FROM app_settings WHERE key = '100millionideas_project_overrides'").get() as any;
      if (settingsRow?.value) {
        const overrides = JSON.parse(settingsRow.value);
        for (const [dTag, override] of Object.entries(overrides as Record<string, any>)) {
          db.prepare(`
            UPDATE lanacrowd_projects SET
              is_hidden = CASE WHEN ? = 1 THEN 1 ELSE is_hidden END,
              is_approved = CASE WHEN ? = 0 THEN 0 ELSE is_approved END,
              is_funded = CASE WHEN ? = 1 THEN 1 ELSE is_funded END,
              is_completed = CASE WHEN ? = 1 THEN 1 ELSE is_completed END,
              completion_comment = COALESCE(?, completion_comment),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(
            override.hidden ? 1 : 0,
            override.approved === false ? 0 : 1,
            override.funded ? 1 : 0,
            override.completed ? 1 : 0,
            override.completionComment || null,
            dTag,
          );
        }
        console.log('✅ indexLanacrowdFromRelays: migrated legacy app_settings overrides');
      }
    } catch (migrErr) {
      console.warn('⚠️ indexLanacrowdFromRelays: legacy override migration failed (non-fatal)', migrErr);
    }

    // Upsert donations.
    // ON CONFLICT: backfill `message` for legacy rows that were inserted before
    // the column existed (or before the comment was being captured). Only
    // overwrite when the new value is non-null AND the existing row is missing it.
    const upsertDonation = db.prepare(`
      INSERT INTO lanacrowd_donations (
        id, project_id, supporter_pubkey, project_owner_pubkey,
        amount_lanoshis, amount_fiat, currency,
        from_wallet, to_wallet, tx_id, message, nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        message = COALESCE(lanacrowd_donations.message, excluded.message)
    `);

    let donationsIndexed = 0;
    for (const evt of donationEvents) {
      try {
        const getTag = (name: string) => evt.tags?.find((t: string[]) => t[0] === name)?.[1];
        const projectId = getTag('project');
        if (!projectId) continue;

        // Skip mentor-fee events: batch funding publishes a separate KIND 60200
        // with type="mentor_fee" (the commission paid to the mentor wallet). It is
        // NOT a donation to the project, so it must not be stored/shown/summed as one.
        if (getTag('type') === 'mentor_fee') continue;

        const supporterTag = evt.tags?.find((t: string[]) => t[0] === 'p' && t[2] === 'supporter');
        const ownerTag = evt.tags?.find((t: string[]) => t[0] === 'p' && t[2] === 'project_owner');

        upsertDonation.run(
          evt.id,
          projectId,
          supporterTag?.[1] || evt.pubkey,
          ownerTag?.[1] || '',
          parseInt(getTag('amount_lanoshis') || '0') || 0,
          parseFloat(getTag('amount_fiat') || '0') || 0,
          getTag('currency') || 'EUR',
          getTag('from_wallet') || '',
          getTag('to_wallet') || '',
          getTag('tx') || null,
          (evt.content && evt.content.trim()) ? evt.content : null,
          evt.created_at,
        );
        donationsIndexed++;
      } catch (err) {
        console.error('❌ indexLanacrowdFromRelays: failed to upsert donation', evt.id, err);
      }
    }

    // Recompute funded status for all projects based on SQLite donations
    const toCheck = db.prepare(`
      SELECT p.id, p.fiat_goal, COALESCE(SUM(d.amount_fiat),0) AS total_raised
      FROM lanacrowd_projects p
      LEFT JOIN lanacrowd_donations d ON d.project_id = p.id
      GROUP BY p.id
    `).all() as any[];

    let fundedChanges = 0;
    for (const r of toCheck) {
      if (r.fiat_goal <= 0) continue;
      const isFunded = r.total_raised >= r.fiat_goal * 0.99 ? 1 : 0;
      const result = db.prepare('UPDATE lanacrowd_projects SET is_funded = ? WHERE id = ? AND is_funded != ?').run(isFunded, r.id, isFunded);
      if (result.changes > 0) fundedChanges++;
    }

    // Save last-indexed timestamp
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('lanacrowd_last_indexed_at', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(String(Math.floor(Date.now() / 1000)));

    console.log(`✅ indexLanacrowdFromRelays: ${projectsIndexed} projects, ${donationsIndexed} donations indexed, ${fundedChanges} funded status changes`);
  } catch (error) {
    console.error('❌ indexLanacrowdFromRelays error:', error);
  }
}

/**
 * How many people one scan may ask the relays about. A request the database has
 * not seen before has to pass the eligibility check before it is listed; a flood
 * of requests from throwaway keys must not turn every scan into a flood of relay
 * queries. Whatever is not reached is looked at again by the next scan — and
 * until it has been, the scan watermark does not move (see the end of the scan).
 * The time budget, not this number, is the real bound: a lookup is ~100 ms.
 */
export const UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN = 100;
const UF_ELIGIBILITY_BUDGET_MS = 60_000;
/** Someone judged "not a member" is not asked about again for this long (the scan runs every 30 minutes). */
const UF_NOT_ELIGIBLE_TTL_MS = 60 * 60 * 1000;
const ufNotEligibleUntil = new Map<string, number>();

/** For tests: forget who was judged not eligible. */
export function resetUfIndexerCaches(): void {
  ufNotEligibleUntil.clear();
}

/** When this database last completed a scan of the relays (unix seconds); 0 = never. */
function readUfScanWatermark(db: any): number {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'unconditional_financing_last_indexed_at'").get() as any;
    const n = parseInt(row?.value ?? '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Index Unconditional Financing state from relays into SQLite.
 * KIND 31240 requests, 60210 contributions, 60211 repayments.
 * Mirrors indexLanacrowdFromRelays: relays are the source of truth, SQLite is
 * the fast read cache; admin/derived flags (is_hidden) are preserved.
 *
 * It is a safety net for the REST route (the app publishes to the relays first
 * and the route may not be reached), so it must never be a way AROUND the
 * route. Every rule the route enforces on a new request is enforced here too:
 *   • the event's signature holds;
 *   • the signer is a Lana8Wonder member of at least 4 completed Splits
 *     (server/lib/ufEligibility.ts — the same function the route calls);
 *   • the review period starts when the database first SAW the request, never
 *     earlier than the dates it can believe (server/lib/ufMaturing.ts holds the
 *     rule and the reasoning, including why a database rebuilt from the relays
 *     does not restart every window).
 * A request that fails any of them is simply not listed, and is looked at again
 * by the next scan.
 */
export async function indexUnconditionalFinancingFromRelays(db: any): Promise<void> {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  let relays: string[] = [];
  if (row?.relays) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) relays = parsed;
    } catch {}
  }
  if (relays.length === 0) {
    console.log('⚠️ indexUnconditionalFinancingFromRelays: No relays available, skipping');
    return;
  }

  // Same rules the REST route enforces, so both write paths agree.
  const { maturingSeconds } = getUfSettings(db);

  // What this database knows about its own past: when it last completed a scan.
  // It decides how far back a request we have never seen may claim to date.
  const scanStartedAt = Math.floor(Date.now() / 1000);
  const lastScanAt = readUfScanWatermark(db);

  const nowMs = Date.now();
  for (const [key, until] of ufNotEligibleUntil) if (until <= nowMs) ufNotEligibleUntil.delete(key);
  if (ufNotEligibleUntil.size > 5000) ufNotEligibleUntil.clear();

  try {
    const [requestRead, contributionRead, repaymentRead] = await Promise.all([
      queryEventsWithRelayStatus(relays, { kinds: [31240], limit: 1000 }, 20000),
      queryEventsFromRelays(relays, { kinds: [60210], limit: 5000 }, 20000),
      queryEventsFromRelays(relays, { kinds: [60211], limit: 5000 }, 20000),
    ]);

    // Not one relay reached EOSE for the requests: we saw nothing, which is not
    // the same as "there is nothing". Index nothing, and leave the watermark
    // where it was — it must only ever move past a scan that really happened.
    if (requestRead.answered.length === 0) {
      console.warn('⚠️ indexUnconditionalFinancingFromRelays: no relay answered the request query — nothing indexed, scan watermark unchanged');
      return;
    }
    let requestEvents = requestRead.events;
    let contributionEvents = contributionRead;
    let repaymentEvents = repaymentRead;

    // Only index events that explicitly belong to this module — another app
    // reusing these kind numbers on the shared relays must never leak into
    // uf_* tables. (strfry cannot filter multi-letter tag names in the REQ,
    // so this is a client-side post-filter.)
    const isUf = (evt: any) =>
      evt.tags?.some((t: string[]) => t[0] === 'service' && t[1] === 'unconditional-financing');
    requestEvents = requestEvents.filter(isUf);
    contributionEvents = contributionEvents.filter(isUf);
    repaymentEvents = repaymentEvents.filter(isUf);

    // The REST route verifies every signature; so does this. The relays are
    // trusted to have checked on the way in — here nothing that decides who a
    // request, a contribution or a repayment BELONGS to is taken on their word.
    const validSignature = (evt: any): boolean => {
      try { return verifyEvent(evt); } catch { return false; }
    };
    const requestsBeforeSignatures = requestEvents.length;
    requestEvents = requestEvents.filter(validSignature);
    if (requestEvents.length < requestsBeforeSignatures) {
      console.warn(`⚠️ indexUnconditionalFinancingFromRelays: ignored ${requestsBeforeSignatures - requestEvents.length} KIND 31240 event(s) with an invalid signature`);
    }

    console.log(`📦 indexUnconditionalFinancingFromRelays: ${requestEvents.length} KIND 31240, ${contributionEvents.length} KIND 60210, ${repaymentEvents.length} KIND 60211`);

    // Deduplicate requests by (pubkey + d-tag), keep newest (addressable kind)
    const requestsByKey = new Map<string, any>();
    for (const evt of requestEvents) {
      const dTag = evt.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!dTag) continue;
      const key = `${evt.pubkey}:${dTag}`;
      const existing = requestsByKey.get(key);
      if (!existing || evt.created_at > existing.created_at) {
        requestsByKey.set(key, { ...evt, dTag });
      }
    }

    const upsertRequest = db.prepare(`
      INSERT INTO uf_requests (
        id, event_id, pubkey,
        title, short_desc, content,
        request_type, fiat_goal, currency, wallet,
        cover_image, gallery_images, crowdfunding_refs,
        published_at, funding_opens_at, status,
        is_hidden, is_repaid,
        nostr_created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        title = excluded.title,
        short_desc = excluded.short_desc,
        content = excluded.content,
        request_type = excluded.request_type,
        fiat_goal = excluded.fiat_goal,
        currency = excluded.currency,
        wallet = excluded.wallet,
        cover_image = excluded.cover_image,
        gallery_images = excluded.gallery_images,
        crowdfunding_refs = excluded.crowdfunding_refs,
        -- first-seen-wins: the original publication date never changes
        published_at = CASE WHEN uf_requests.published_at > 0
                            THEN uf_requests.published_at ELSE excluded.published_at END,
        -- the caller computed this (restart-on-edit while maturing) and already
        -- clamped it to never land earlier than the window announced so far
        funding_opens_at = CASE WHEN excluded.funding_opens_at > uf_requests.funding_opens_at
                                THEN excluded.funding_opens_at ELSE uf_requests.funding_opens_at END,
        status = excluded.status,
        nostr_created_at = CASE WHEN excluded.nostr_created_at > uf_requests.nostr_created_at
                                THEN excluded.nostr_created_at ELSE uf_requests.nostr_created_at END,
        updated_at = datetime('now')
    `);

    // A request the database has not seen must pass the eligibility check
    // before it is listed. Only a real answer counts: if nobody could be asked,
    // that is not a verdict — the request waits and is asked about again.
    const eligibilityVerdicts = new Map<string, boolean>();
    const eligibilityDeadline = Date.now() + UF_ELIGIBILITY_BUDGET_MS;
    let eligibilityLookups = 0;
    const waiting = { notListed: 0, deferred: 0, unavailable: 0 };
    const mayBeListed = async (pubkey: string): Promise<boolean> => {
      const verdict = eligibilityVerdicts.get(pubkey);
      if (verdict !== undefined) return verdict;
      if ((ufNotEligibleUntil.get(pubkey) ?? 0) > Date.now()) return false;
      if (eligibilityLookups >= UF_MAX_ELIGIBILITY_LOOKUPS_PER_SCAN || Date.now() > eligibilityDeadline) {
        waiting.deferred++;
        return false;
      }
      eligibilityLookups++;
      const result = await computeEligibility(db, pubkey, queryEventsWithRelayStatus) as any;
      if (result.error) {
        waiting.unavailable++;
        return false;
      }
      const eligible = !!result.eligible;
      eligibilityVerdicts.set(pubkey, eligible);
      if (!eligible) ufNotEligibleUntil.set(pubkey, Date.now() + UF_NOT_ELIGIBLE_TTL_MS);
      return eligible;
    };

    let requestsIndexed = 0;
    for (const evt of requestsByKey.values()) {
      try {
        const getTag = (name: string) => evt.tags?.find((t: string[]) => t[0] === name)?.[1];
        const getAllTags = (name: string) => evt.tags?.filter((t: string[]) => t[0] === name) || [];

        const title = getTag('title');
        if (!title) continue; // skip malformed events

        const imageTags = getAllTags('img');
        const coverImage = imageTags.find((t: string[]) => t[2] === 'cover')?.[1] || getTag('image') || null;
        const galleryImages = imageTags.filter((t: string[]) => t[2] === 'gallery').map((t: string[]) => t[1]);
        const crowdfundingRefs = getAllTags('crowdfunding').map((t: string[]) => t[1]);

        // Preserve admin/derived flags + enforce addressable identity: the
        // nostr identity of an addressable event is (pubkey, d) — a different
        // author may never take over an existing row by reusing its d-tag.
        const readExisting = () => db.prepare(
          'SELECT pubkey, is_hidden, is_repaid, published_at, funding_opens_at, wallet FROM uf_requests WHERE id = ?'
        ).get(evt.dTag) as any;
        let existing = readExisting();
        if (existing && existing.pubkey && existing.pubkey !== evt.pubkey) continue;

        // A request this database has not seen must pass the same gate as the
        // REST route: members only. Asking takes relay round-trips, during which
        // the route may list the very same request — so the row is read again.
        if (!existing) {
          if (!(await mayBeListed(evt.pubkey))) {
            waiting.notListed++;
            continue;
          }
          existing = readExisting();
          if (existing && existing.pubkey && existing.pubkey !== evt.pubkey) continue;
        }

        const nowSec = Math.floor(Date.now() / 1000);

        // What the EVENT claims. Every one of these is written by the signer —
        // they are evidence to weigh, never facts (see ufMaturing.ts).
        const timing = resolveNewRequestTiming({
          claimedPublishedAt: parseInt(getTag('published_at') || '0') || evt.created_at,
          claimedFundingOpensAt: parseInt(getTag('funding_opens_at') || '0') || 0,
          createdAt: evt.created_at,
          now: nowSec,
          maturingSeconds,
          lastScanAt,
        });

        let publishedAt: number;
        let fundingOpensAt: number;
        let wallet = getTag('wallet') || '';

        if (existing && existing.funding_opens_at > 0) {
          // KNOWN request: the database is the memory of its window. The
          // publication date is first-seen-wins (the SQL keeps it); the
          // window only ever moves later, and is decided by OUR clock, so a
          // backdated edit cannot pass for "refined while maturing".
          publishedAt = existing.published_at > 0 ? existing.published_at : timing.publishedAt;
          fundingOpensAt = resolveKnownFundingOpensAt({
            existingOpensAt: existing.funding_opens_at,
            eventCreatedAt: evt.created_at,
            now: nowSec,
            maturingSeconds,
          });
          // The receiving address may still change while the request matures,
          // but is PINNED once funding is open — an edit must never redirect
          // contributions away from the address people are giving to.
          if (existing.wallet && isWalletPinned(existing.funding_opens_at, nowSec)) {
            wallet = existing.wallet;
          }
        } else {
          // A request this database has not seen (or a row that never got a window).
          publishedAt = timing.publishedAt;
          fundingOpensAt = timing.fundingOpensAt;
          if (timing.publishedAtClamped) {
            console.warn(
              `⚠️ indexUnconditionalFinancingFromRelays: ${evt.dTag} claims an earlier publication date than a scan can vouch for — ` +
              `counted from ${new Date(timing.publishedAt * 1000).toISOString()} (${timing.mode})`,
            );
          }
        }

        upsertRequest.run(
          evt.dTag,
          evt.id,
          evt.pubkey,
          title,
          getTag('summary') || '',
          evt.content || '',
          getTag('request_type') || 'personal_hardship',
          parseFloat(getTag('fiat_goal') || '0') || 0,
          getTag('currency') || 'EUR',
          wallet,
          coverImage,
          JSON.stringify(galleryImages),
          JSON.stringify(crowdfundingRefs),
          publishedAt,
          fundingOpensAt,
          getTag('status') || 'active',
          existing ? existing.is_hidden : 0,
          existing ? existing.is_repaid : 0,
          evt.created_at,
        );
        requestsIndexed++;
      } catch (err) {
        console.error('❌ indexUnconditionalFinancingFromRelays: failed to upsert request', evt.dTag, err);
      }
    }
    if (waiting.notListed > 0) {
      console.warn(
        `⚠️ indexUnconditionalFinancingFromRelays: ${waiting.notListed} unknown request(s) not listed ` +
        `(deferred past this scan's lookup budget: ${waiting.deferred}; eligibility could not be checked: ${waiting.unavailable})`,
      );
    }

    // Contributions (regular events; keyed by event id)
    const upsertContribution = db.prepare(`
      INSERT INTO uf_contributions (
        id, request_id, supporter_pubkey, recipient_pubkey,
        amount_lanoshis, amount_fiat, currency, rate,
        from_wallet, repayment_wallet, to_wallet, tx_id, message,
        nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        message = COALESCE(uf_contributions.message, excluded.message)
    `);
    const knownContributionIds = new Set<string>(
      (db.prepare('SELECT id FROM uf_contributions').all() as any[]).map(r => r.id),
    );
    const datedBeforeOpening = new Map<string, number>();
    let unsignedContributions = 0;

    let contributionsIndexed = 0;
    for (const evt of contributionEvents) {
      try {
        const getTag = (name: string) => evt.tags?.find((t: string[]) => t[0] === name)?.[1];
        const requestId = getTag('request');
        if (!requestId) continue;

        // The request must exist (requests are indexed above in this same run).
        const parentReq = db.prepare(
          'SELECT pubkey, funding_opens_at FROM uf_requests WHERE id = ?'
        ).get(requestId) as any;
        if (!parentReq) continue;

        // Identity = the event SIGNER. A p-tag is attacker-controlled and must
        // never attribute a contribution (and its repayment share) to someone else.
        const supporterPubkey = evt.pubkey;

        // No self-contributions — a requester must not dilute real financiers.
        if (supporterPubkey === parentReq.pubkey) continue;

        // MATURING guard (mirrors POST /contributions/record): events dated
        // inside the maturing window are invalid per the protocol and must not
        // be indexed — otherwise a direct-to-relay publish would bypass the
        // server-side 409 rule within one heartbeat re-index.
        const timestampPaid = parseInt(getTag('timestamp_paid') || '0') || evt.created_at;
        const effectiveTs = Math.min(evt.created_at, timestampPaid);
        if ((parentReq.funding_opens_at || 0) > effectiveTs) {
          // Said out loud: if a window were ever wrong, this is where real
          // contributions would vanish, and a silent `continue` hides it.
          if (!knownContributionIds.has(evt.id)) {
            datedBeforeOpening.set(requestId, (datedBeforeOpening.get(requestId) || 0) + 1);
          }
          continue;
        }

        // Not in the database yet: the signature has to hold before it is believed.
        if (!knownContributionIds.has(evt.id) && !validSignature(evt)) {
          unsignedContributions++;
          continue;
        }

        upsertContribution.run(
          evt.id,
          requestId,
          supporterPubkey,
          parentReq.pubkey,
          parseInt(getTag('amount_lanoshis') || '0') || 0,
          parseFloat(getTag('amount_fiat') || '0') || 0,
          getTag('currency') || 'EUR',
          parseFloat(getTag('rate') || '0') || 0,
          getTag('from_wallet') || '',
          getTag('repayment_wallet') || '',
          getTag('to_wallet') || '',
          getTag('tx') || null,
          (evt.content && evt.content.trim()) ? evt.content : null,
          evt.created_at,
        );
        contributionsIndexed++;
      } catch (err) {
        console.error('❌ indexUnconditionalFinancingFromRelays: failed to upsert contribution', evt.id, err);
      }
    }
    if (datedBeforeOpening.size > 0) {
      const total = [...datedBeforeOpening.values()].reduce((a, b) => a + b, 0);
      console.warn(
        `⚠️ indexUnconditionalFinancingFromRelays: ${total} contribution(s) are dated before their request opened for funding and were not indexed: ` +
        [...datedBeforeOpening].map(([id, n]) => `${id} ×${n}`).join(', '),
      );
    }
    if (unsignedContributions > 0) {
      console.warn(`⚠️ indexUnconditionalFinancingFromRelays: ignored ${unsignedContributions} KIND 60210 event(s) with an invalid signature`);
    }

    // Repayments (regular events; keyed by event id). Per-financier outputs are
    // rebuilt from the repeatable `out` tags: [out, pubkey, wallet, lanoshis, fiat]
    const upsertRepayment = db.prepare(`
      INSERT INTO uf_repayments (
        id, request_id, payer_pubkey,
        total_lanoshis, total_fiat, currency, rate,
        tx_id, outputs, nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const knownRepaymentIds = new Set<string>(
      (db.prepare('SELECT id FROM uf_repayments').all() as any[]).map(r => r.id),
    );
    let unsignedRepayments = 0;

    let repaymentsIndexed = 0;
    for (const evt of repaymentEvents) {
      try {
        const getTag = (name: string) => evt.tags?.find((t: string[]) => t[0] === name)?.[1];
        const requestId = getTag('request');
        if (!requestId) continue;

        // Only the REQUEST OWNER's signature counts — a forged repayment from
        // any other pubkey must never erase a requester's open obligation.
        const parentReq = db.prepare('SELECT pubkey FROM uf_requests WHERE id = ?').get(requestId) as any;
        if (!parentReq || parentReq.pubkey !== evt.pubkey) continue;

        const outputs = (evt.tags?.filter((t: string[]) => t[0] === 'out') || []).map((t: string[]) => ({
          pubkey: t[1] || '',
          wallet: t[2] || '',
          lanoshis: parseInt(t[3] || '0') || 0,
          fiat: parseFloat(t[4] || '0') || 0,
        }));

        // The declared totals must match the out-tag breakdown — an inflated
        // total with a tiny breakdown must not flip is_repaid.
        const totalFiat = parseFloat(getTag('amount_fiat_total') || '0') || 0;
        const totalLanoshis = parseInt(getTag('amount_lanoshis_total') || '0') || 0;
        const sumFiat = outputs.reduce((s, o) => s + o.fiat, 0);
        const sumLanoshis = outputs.reduce((s, o) => s + o.lanoshis, 0);
        if (outputs.length === 0) continue;
        if (totalFiat <= 0 || Math.abs(sumFiat - totalFiat) > Math.max(0.05, totalFiat * 0.01)) continue;
        if (totalLanoshis <= 0 || sumLanoshis !== totalLanoshis) continue;

        // Not in the database yet: the signature has to hold before it is believed.
        if (!knownRepaymentIds.has(evt.id) && !validSignature(evt)) {
          unsignedRepayments++;
          continue;
        }

        upsertRepayment.run(
          evt.id,
          requestId,
          evt.pubkey,
          totalLanoshis,
          totalFiat,
          getTag('currency') || 'EUR',
          parseFloat(getTag('rate') || '0') || 0,
          getTag('tx') || null,
          JSON.stringify(outputs),
          evt.created_at,
        );
        repaymentsIndexed++;
      } catch (err) {
        console.error('❌ indexUnconditionalFinancingFromRelays: failed to upsert repayment', evt.id, err);
      }
    }
    if (unsignedRepayments > 0) {
      console.warn(`⚠️ indexUnconditionalFinancingFromRelays: ignored ${unsignedRepayments} KIND 60211 event(s) with an invalid signature`);
    }

    // Recompute repaid status for all requests from the indexed data
    const toCheck = db.prepare(`
      SELECT r.id,
             COALESCE((SELECT SUM(amount_fiat) FROM uf_contributions WHERE request_id = r.id), 0) AS funded,
             COALESCE((SELECT SUM(total_fiat) FROM uf_repayments WHERE request_id = r.id), 0) AS repaid
      FROM uf_requests r
    `).all() as any[];

    let repaidChanges = 0;
    for (const r of toCheck) {
      const isRepaid = r.funded > 0 && r.repaid >= r.funded * 0.99 ? 1 : 0;
      const result = db.prepare('UPDATE uf_requests SET is_repaid = ? WHERE id = ? AND is_repaid != ?').run(isRepaid, r.id, isRepaid);
      if (result.changes > 0) repaidChanges++;
    }

    // The watermark is the moment this scan STARTED reading. It is what the next
    // scan believes about how far back an unknown request can honestly date, so
    // it may only move past a scan that SETTLED every request it did not know:
    // listed, or refused for good. A request still waiting for its membership
    // check (the relays did not answer, or the scan's lookup budget ran out) has
    // not been looked at yet — if the watermark moved on, the next scan would
    // distrust its dates, restart its window and drop its real contributions.
    // On a database being rebuilt this is what keeps "from scratch" in force
    // until the whole relay record has been taken in.
    if (waiting.deferred === 0 && waiting.unavailable === 0) {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('unconditional_financing_last_indexed_at', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(String(scanStartedAt));
    } else {
      console.warn(
        `⚠️ indexUnconditionalFinancingFromRelays: scan watermark left where it was — ` +
        `${waiting.deferred + waiting.unavailable} unknown request(s) still wait for a membership verdict`,
      );
    }

    console.log(`✅ indexUnconditionalFinancingFromRelays: ${requestsIndexed} requests, ${contributionsIndexed} contributions, ${repaymentsIndexed} repayments, ${repaidChanges} repaid changes`);
  } catch (error) {
    console.error('❌ indexUnconditionalFinancingFromRelays error:', error);
  }
}
