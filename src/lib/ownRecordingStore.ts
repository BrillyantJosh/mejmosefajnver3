/**
 * Best-effort persistence for a pending OWN voice recording, so a failed upload —
 * or a reload / navigation / iOS tab eviction — never loses the recording.
 *
 * We store the ArrayBuffer + mimeType (NOT the Blob itself — Safari Private Browsing
 * cannot put a Blob in IndexedDB, and blob-in-IDB is historically flaky on WebKit) and
 * reconstruct the Blob on read. Every call is wrapped so a storage failure (private
 * mode, disabled storage, iOS 17.4 dropped-connection) degrades to a no-op/null — the
 * Download button in the recorder UI is the ultimate guarantee that a clip is never lost.
 */
import { openDB } from 'idb';

const DB_NAME = 'own-pending-audio';
const STORE = 'recordings';

// Cached open promise. Reset to null on failure so a later call can retry (Safari can
// fail the very first open right after load, and the iOS 17.4 connection can drop).
let dbPromise: Promise<any> | null = null;

function getDB(): Promise<any> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      },
    }).catch(() => {
      dbPromise = null;
      return null;
    });
  }
  return dbPromise;
}

const keyFor = (sender: string, process: string) => `${sender}|${process}`;

export interface PendingRecording {
  blob: Blob;
  mimeType: string;
  durationSec: number | null;
}

/** Persist the recording the moment it exists (fire-and-forget). */
export async function saveRecording(
  sender: string,
  process: string,
  blob: Blob,
  meta: { durationSec?: number } = {},
): Promise<void> {
  try {
    const db = await getDB();
    if (!db) return;
    const buf = await blob.arrayBuffer(); // ArrayBuffer, not Blob (iOS-safe)
    await db.put(STORE, {
      key: keyFor(sender, process),
      buf,
      mimeType: blob.type || 'audio/mp4',
      durationSec: meta.durationSec ?? null,
      createdAt: Date.now(),
    });
  } catch {
    dbPromise = null; // reopen on next call — the connection may have dropped (iOS 17.4)
  }
}

/** Load a previously-persisted recording for this chat (or null). */
export async function loadPendingRecording(sender: string, process: string): Promise<PendingRecording | null> {
  try {
    const db = await getDB();
    if (!db) return null;
    const rec: any = await db.get(STORE, keyFor(sender, process));
    if (!rec || !rec.buf) return null;
    const mimeType = rec.mimeType || 'audio/mp4';
    return { blob: new Blob([rec.buf], { type: mimeType }), mimeType, durationSec: rec.durationSec ?? null };
  } catch {
    dbPromise = null; // reopen on next call
    return null;
  }
}

/** Remove the persisted recording — call ONLY on confirmed send or explicit discard. */
export async function deletePendingRecording(sender: string, process: string): Promise<void> {
  try {
    const db = await getDB();
    if (!db) return;
    await db.delete(STORE, keyFor(sender, process));
  } catch {
    dbPromise = null; // reopen on next call
  }
}

/** Save the recording to the device as a last resort (Blob → download). */
export function downloadBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    /* ignore */
  }
}
