/**
 * Unregistered LANA Monitoring
 * Syncs KIND 87003 (unregistered coins detected) and KIND 87009 (returned confirmation)
 * from Nostr relays into the local database.
 */

import type Database from 'better-sqlite3';
import { queryEventsFromRelays } from './nostr';

// =============================================
// Helper functions (same pattern as aiTasks.ts)
// =============================================

function getRelaysFromDb(db: Database.Database): string[] {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [];
}

function getTrustedSignersFromDb(db: Database.Database): string[] {
  const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row?.trusted_signers) {
    try {
      const parsed = JSON.parse(row.trusted_signers);
      if (parsed?.LanaRegistrar && Array.isArray(parsed.LanaRegistrar)) {
        return parsed.LanaRegistrar;
      }
    } catch {}
  }
  return [];
}

// =============================================
// Tag helper
// =============================================

function getTagValue(tags: string[][], name: string): string {
  const tag = tags.find(t => t[0] === name);
  return tag?.[1] || '';
}

// =============================================
// Main sync function
// =============================================

export async function syncUnregisteredLana(db: Database.Database): Promise<void> {
  const relays = getRelaysFromDb(db);
  if (relays.length === 0) {
    console.log('⚠️ No relays found for unregistered LANA sync');
    return;
  }

  const trustedSigners = getTrustedSignersFromDb(db);
  if (trustedSigners.length === 0) {
    console.log('⚠️ No LanaRegistrar trusted signers found — skipping unregistered LANA sync');
    return;
  }

  // -------------------------------------------
  // 1. Fetch KIND 87003 (unregistered coins detected)
  // -------------------------------------------
  let events87003;
  try {
    events87003 = await queryEventsFromRelays(relays, { kinds: [87003] }, 15000);
  } catch (err) {
    console.error('❌ Error fetching KIND 87003:', err);
    return;
  }

  // Filter by trusted signers
  const valid87003 = events87003.filter(e => trustedSigners.includes(e.pubkey));
  console.log(`📥 KIND 87003: ${events87003.length} total, ${valid87003.length} from trusted signers`);

  // Upsert into database
  const upsertStmt = db.prepare(`
    INSERT OR IGNORE INTO unregistered_lana (
      event_id_87003, pubkey, wallet_id, tx_id, linked_event,
      amount_lanoshis, registrar_pubkey, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const event of valid87003) {
    const pubkey = getTagValue(event.tags, 'p');
    const walletId = getTagValue(event.tags, 'WalletID');
    const txId = getTagValue(event.tags, 'TX');
    const linkedEvent = getTagValue(event.tags, 'Linked_event');
    const amountStr = getTagValue(event.tags, 'UnregistratedAmountLatoshis');
    const amount = parseInt(amountStr) || 0;

    if (!pubkey || !walletId) {
      continue; // Required fields missing
    }

    const result = upsertStmt.run(
      event.id,
      pubkey,
      walletId,
      txId,
      linkedEvent,
      amount,
      event.pubkey,
      event.created_at
    );

    if (result.changes > 0) inserted++;
  }

  if (inserted > 0) {
    console.log(`✅ Inserted ${inserted} new KIND 87003 records`);
  }

  // -------------------------------------------
  // 2. Fetch KIND 87009 (return confirmation)
  // -------------------------------------------
  let events87009;
  try {
    events87009 = await queryEventsFromRelays(relays, { kinds: [87009] }, 15000);
  } catch (err) {
    console.error('❌ Error fetching KIND 87009:', err);
    return;
  }

  const valid87009 = events87009.filter(e => trustedSigners.includes(e.pubkey));
  console.log(`📥 KIND 87009: ${events87009.length} total, ${valid87009.length} from trusted signers`);

  // Mark resolved records
  const resolveStmt = db.prepare(`
    UPDATE unregistered_lana
    SET resolved = 1,
        resolved_event_id = ?,
        resolved_tx_id = ?,
        resolved_at = datetime(?, 'unixepoch')
    WHERE event_id_87003 = ? AND resolved = 0
  `);

  let resolved = 0;
  for (const event of valid87009) {
    // "e" tag references the original KIND 87003 event ID
    const refEventId = getTagValue(event.tags, 'e');
    const returnTxId = getTagValue(event.tags, 'tx');

    if (!refEventId) continue;

    const result = resolveStmt.run(
      event.id,
      returnTxId,
      event.created_at,
      refEventId
    );

    if (result.changes > 0) resolved++;
  }

  if (resolved > 0) {
    console.log(`✅ Resolved ${resolved} unregistered LANA records (KIND 87009)`);
  }

  // Summary
  const totalUnresolved = (db.prepare('SELECT COUNT(*) as cnt FROM unregistered_lana WHERE resolved = 0').get() as any)?.cnt || 0;
  if (totalUnresolved > 0) {
    console.log(`⚠️ ${totalUnresolved} unresolved unregistered LANA records in database`);
  }
}
