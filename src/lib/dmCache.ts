/**
 * DM Cache — IndexedDB storage for encrypted Nostr DM events
 *
 * SECURITY: Only NIP-04 encrypted ciphertext is stored.
 * Decrypted plaintext is NEVER persisted — decryption happens
 * in-memory only when the user's private key is present.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'mejmo-dm-cache';
const DB_VERSION = 1;

export interface CachedEvent {
  id: string;              // Nostr event ID (primary key)
  pubkey: string;          // sender pubkey
  content: string;         // ⚠️ ENCRYPTED NIP-04 ciphertext only
  created_at: number;      // timestamp
  tags: string[][];        // event tags (contains ['p', recipientPubkey])
  userHexId: string;       // which user this cache belongs to
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Events store: encrypted DM events
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('by-user', 'userHexId');
          store.createIndex('by-timestamp', 'created_at');
        }
        // Meta store: sync timestamps etc.
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      }
    });
  }
  return dbPromise;
}

/**
 * Get all cached encrypted events for a user
 */
export async function getAllCachedEvents(userHexId: string): Promise<CachedEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('events', 'by-user', userHexId);
}

/**
 * Save encrypted events to cache (upsert)
 */
export async function saveCachedEvents(events: CachedEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('events', 'readwrite');
  for (const event of events) {
    await tx.store.put(event);
  }
  await tx.done;
}

/**
 * Delete a single cached event
 */
export async function deleteCachedEvent(eventId: string): Promise<void> {
  const db = await getDB();
  await db.delete('events', eventId);
}

/**
 * Get the latest cached timestamp for incremental sync
 */
export async function getLatestTimestamp(userHexId: string): Promise<number> {
  const db = await getDB();
  const meta = await db.get('meta', `latest_ts_${userHexId}`);
  return meta?.value || 0;
}

/**
 * Set the latest cached timestamp after sync
 */
export async function setLatestTimestamp(userHexId: string, ts: number): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: `latest_ts_${userHexId}`, value: ts });
}

/**
 * Clear all cached data for a user (e.g. on logout)
 */
export async function clearUserCache(userHexId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('events', 'readwrite');
  const index = tx.store.index('by-user');
  let cursor = await index.openCursor(userHexId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  await db.delete('meta', `latest_ts_${userHexId}`);
}
