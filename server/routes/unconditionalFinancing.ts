/**
 * Unconditional Financing — server-authoritative REST API
 *
 * Mirrors the LanaCrowd pattern (SQLite read cache, Nostr-first writes, relay
 * indexer as safety net) but with a HARDENED write model: every mutating write
 * (request upsert, contribution record, repayment record) requires the SIGNED
 * Nostr event in the body. The server verifies the signature (verifyEvent) and
 * derives ALL fields from the verified event's tags — the JSON body is never
 * trusted for identity or amounts.
 *
 * Lifecycle: publish → 8-day MATURING (comments only; enforced server-side and
 * in the indexer) → REPAYING (open for funding AND repayable) → REPAID
 * (repaid_fiat >= funded_fiat, auto-recomputed).
 */

import { Router } from 'express';
import { verifyEvent } from 'nostr-tools';
import { getDb } from '../db/connection.js';
import { queryEventsFromRelays } from '../lib/nostr.js';

const router = Router();

// How many completed Splits of Lana8Wonder membership a requester needs.
const REQUIRED_COMPLETED_SPLITS = 4;
const MATURING_SECONDS = 8 * 86400;
const SERVICE_TAG = 'unconditional-financing';

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

function getRelays(): string[] {
  const db = getDb();
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (!row?.relays) return [];
  try { return JSON.parse(row.relays); } catch { return []; }
}

function getAdmins(): string[] {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'unconditional_financing_admins'").get() as any;
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

function parseJsonArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return [];
}

/** Verify a signed Nostr event of the expected kind carrying the module service tag. */
function verifyModuleEvent(event: any, kind: number): string | null {
  if (!event || typeof event !== 'object') return 'Missing signed event';
  if (event.kind !== kind) return `Expected kind ${kind}`;
  try {
    if (!verifyEvent(event)) return 'Invalid event signature';
  } catch {
    return 'Invalid event signature';
  }
  const hasService = Array.isArray(event.tags)
    && event.tags.some((t: string[]) => t[0] === 'service' && t[1] === SERVICE_TAG);
  if (!hasService) return 'Missing service tag';
  return null;
}

const getTag = (evt: any, name: string): string | undefined =>
  evt.tags?.find((t: string[]) => t[0] === name)?.[1];
const getAllTags = (evt: any, name: string): string[][] =>
  evt.tags?.filter((t: string[]) => t[0] === name) || [];
/** p-tag with a role marker at index 3 (NIP convention) or 2 (legacy). */
const getPWithMarker = (evt: any, marker: string): string | undefined =>
  evt.tags?.find((t: string[]) => t[0] === 'p' && (t[3] === marker || t[2] === marker))?.[1];

// Derived lifecycle phase — the single source of truth for tabs and gating.
function phaseOf(row: any, nowSec: number): 'maturing' | 'repaying' | 'repaid' {
  if (row.is_repaid) return 'repaid';
  if ((row.funding_opens_at || 0) > nowSec) return 'maturing';
  return 'repaying';
}

function requestRowToApi(row: any, nowSec: number) {
  return {
    id: row.id,
    eventId: row.event_id,
    pubkey: row.pubkey,
    title: row.title,
    shortDesc: row.short_desc,
    content: row.content,
    requestType: row.request_type,
    fiatGoal: row.fiat_goal,
    currency: row.currency,
    wallet: row.wallet,
    coverImage: row.cover_image,
    galleryImages: parseJsonArray(row.gallery_images),
    crowdfundingRefs: parseJsonArray(row.crowdfunding_refs),
    publishedAt: row.published_at,
    fundingOpensAt: row.funding_opens_at,
    status: row.status,
    isHidden: !!row.is_hidden,
    isRepaid: !!row.is_repaid,
    phase: phaseOf(row, nowSec),
    nostrCreatedAt: row.nostr_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalFunded: row.total_funded ?? 0,
    contributionCount: row.contribution_count ?? 0,
    financierCount: row.financier_count ?? 0,
    totalRepaid: row.total_repaid ?? 0,
  };
}

function contributionRowToApi(row: any) {
  return {
    id: row.id,
    requestId: row.request_id,
    supporterPubkey: row.supporter_pubkey,
    recipientPubkey: row.recipient_pubkey,
    amountLanoshis: row.amount_lanoshis,
    amountFiat: row.amount_fiat,
    currency: row.currency,
    rate: row.rate,
    fromWallet: row.from_wallet,
    repaymentWallet: row.repayment_wallet,
    toWallet: row.to_wallet,
    txId: row.tx_id,
    message: row.message || '',
    nostrCreatedAt: row.nostr_created_at,
    createdAt: row.created_at,
  };
}

function repaymentRowToApi(row: any) {
  return {
    id: row.id,
    requestId: row.request_id,
    payerPubkey: row.payer_pubkey,
    totalLanoshis: row.total_lanoshis,
    totalFiat: row.total_fiat,
    currency: row.currency,
    rate: row.rate,
    txId: row.tx_id,
    outputs: parseJsonArray(row.outputs),
    nostrCreatedAt: row.nostr_created_at,
    createdAt: row.created_at,
  };
}

// Funding + repayment totals as LEFT JOIN subqueries (lanacrowd pattern).
const STATS_JOIN = `
  LEFT JOIN (
    SELECT request_id,
           SUM(amount_fiat) AS total_funded,
           COUNT(*) AS contribution_count,
           COUNT(DISTINCT supporter_pubkey) AS financier_count
    FROM uf_contributions
    GROUP BY request_id
  ) c ON r.id = c.request_id
  LEFT JOIN (
    SELECT request_id,
           SUM(total_fiat) AS total_repaid
    FROM uf_repayments
    GROUP BY request_id
  ) rp ON r.id = rp.request_id
`;
const STATS_COLS = `
  COALESCE(c.total_funded, 0) AS total_funded,
  COALESCE(c.contribution_count, 0) AS contribution_count,
  COALESCE(c.financier_count, 0) AS financier_count,
  COALESCE(rp.total_repaid, 0) AS total_repaid
`;

// Recompute the repaid flag: fully repaid once repaid FIAT covers funded FIAT
// (0.99 tolerance), and only when something was actually funded.
function recomputeRepaid(db: any, requestId: string): void {
  const row = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(amount_fiat) FROM uf_contributions WHERE request_id = ?), 0) AS funded,
      COALESCE((SELECT SUM(total_fiat) FROM uf_repayments WHERE request_id = ?), 0) AS repaid
  `).get(requestId, requestId) as any;
  const isRepaid = row && row.funded > 0 && row.repaid >= row.funded * 0.99 ? 1 : 0;
  db.prepare(`UPDATE uf_requests SET is_repaid = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isRepaid, requestId);
}

function getCurrentSplit(db: any): number {
  try {
    const row = db.prepare('SELECT raw_event FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    if (!row?.raw_event) return 0;
    const evt = JSON.parse(row.raw_event);
    const splitTag = evt.tags?.find((t: string[]) => t[0] === 'split');
    return splitTag ? parseInt(splitTag[1]) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * "Lana8Wonder member for at least 4 completed Splits."
 * enrolledAt = MIN(created_at) across ALL of the user's KIND 88888 events
 * (88888 is outside the replaceable ranges → relays retain every version).
 * completed = COUNT(split_history rows started after enrolledAt).
 * Grandfather: enrolled before our recorded history began → long-time member.
 */
async function computeEligibility(db: any, pubkey: string) {
  const relays = getRelays();
  if (relays.length === 0) {
    return { error: 'No relays available' };
  }

  // One retry — a transient relay failure must not read as "not a member".
  let events = await queryEventsFromRelays(relays, { kinds: [88888], '#p': [pubkey], limit: 100 }, 15000);
  if (!events || events.length === 0) {
    events = await queryEventsFromRelays(relays, { kinds: [88888], '#p': [pubkey], limit: 100 }, 15000);
  }

  if (!events || events.length === 0) {
    return {
      eligible: false,
      exists: false,
      enrolledAt: null,
      completedSplitsSinceEnrollment: 0,
      requiredSplits: REQUIRED_COMPLETED_SPLITS,
      currentSplit: getCurrentSplit(db),
    };
  }

  const enrolledAt = Math.min(...events.map((e: any) => e.created_at));
  const history = db.prepare('SELECT split, started_at FROM split_history ORDER BY split ASC').all() as any[];
  const earliestRecorded = history.length > 0 ? Math.min(...history.map(h => h.started_at)) : null;
  const completedSince = history.filter(h => h.started_at > enrolledAt).length;

  const grandfathered = earliestRecorded !== null && enrolledAt < earliestRecorded
    && completedSince < REQUIRED_COMPLETED_SPLITS;
  const eligible = grandfathered || completedSince >= REQUIRED_COMPLETED_SPLITS;

  return {
    eligible,
    exists: true,
    enrolledAt,
    completedSplitsSinceEnrollment: completedSince,
    grandfathered,
    requiredSplits: REQUIRED_COMPLETED_SPLITS,
    currentSplit: getCurrentSplit(db),
  };
}

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/requests
// ──────────────────────────────────────────────
router.get('/requests', (req, res) => {
  const db = getDb();
  const page  = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const tab   = (req.query.tab as string) || 'all';
  const offset = (page - 1) * limit;
  const nowSec = Math.floor(Date.now() / 1000);

  const conditions: string[] = ["r.status != 'draft'", 'r.is_hidden = 0'];
  const params: any[] = [];

  switch (tab) {
    case 'maturing':
      conditions.push('r.is_repaid = 0', 'r.funding_opens_at > ?');
      params.push(nowSec);
      break;
    case 'repaying':
      conditions.push('r.is_repaid = 0', 'r.funding_opens_at <= ?');
      params.push(nowSec);
      break;
    case 'repaid':
      conditions.push('r.is_repaid = 1');
      break;
    case 'all':
    default:
      break;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countRow = db.prepare(`
      SELECT COUNT(*) AS total FROM uf_requests r ${where}
    `).get(...params) as any;
    const total = countRow?.total ?? 0;

    const rows = db.prepare(`
      SELECT r.*, ${STATS_COLS}
      FROM uf_requests r
      ${STATS_JOIN}
      ${where}
      ORDER BY r.nostr_created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    res.json({
      requests: rows.map(r => requestRowToApi(r, nowSec)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/requests error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/requests/:id
// ──────────────────────────────────────────────
router.get('/requests/:id', (req, res) => {
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const row = db.prepare(`
      SELECT r.*, ${STATS_COLS}
      FROM uf_requests r
      ${STATS_JOIN}
      WHERE r.id = ?
    `).get(req.params.id) as any;

    if (!row) return res.status(404).json({ error: 'Request not found' });

    const contributions = db.prepare(`
      SELECT * FROM uf_contributions WHERE request_id = ? ORDER BY nostr_created_at DESC
    `).all(req.params.id) as any[];

    const repayments = db.prepare(`
      SELECT * FROM uf_repayments WHERE request_id = ? ORDER BY nostr_created_at DESC
    `).all(req.params.id) as any[];

    const totalFunded = contributions.reduce((s, c) => s + (c.amount_fiat || 0), 0);

    // Per-financier aggregation with % share — NEVER stored, always derived.
    const byFinancier = new Map<string, { pubkey: string; wallet: string; amountFiat: number; amountLanoshis: number }>();
    for (const c of contributions) {
      const ex = byFinancier.get(c.supporter_pubkey);
      if (ex) {
        ex.amountFiat += c.amount_fiat || 0;
        ex.amountLanoshis += c.amount_lanoshis || 0;
        if (c.repayment_wallet) ex.wallet = c.repayment_wallet;
      } else {
        byFinancier.set(c.supporter_pubkey, {
          pubkey: c.supporter_pubkey,
          wallet: c.repayment_wallet || c.from_wallet || '',
          amountFiat: c.amount_fiat || 0,
          amountLanoshis: c.amount_lanoshis || 0,
        });
      }
    }
    const financiers = [...byFinancier.values()]
      .map(f => ({
        ...f,
        sharePercent: totalFunded > 0 ? (f.amountFiat / totalFunded) * 100 : 0,
      }))
      .sort((a, b) => b.amountFiat - a.amountFiat);

    res.json({
      request: requestRowToApi(row, nowSec),
      contributions: contributions.map(contributionRowToApi),
      repayments: repayments.map(repaymentRowToApi),
      financiers,
      totalFunded,
      totalRepaid: repayments.reduce((s, r) => s + (r.total_fiat || 0), 0),
    });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/requests/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/unconditional-financing/requests/upsert
// Body: { event: <signed KIND 31240> }
// All fields are derived from the VERIFIED event; the maturing window is
// server-clamped on first insert and preserved on updates; updates must be
// signed by the same pubkey as the stored row; NEW requests must pass the
// Lana8Wonder 4-Splits eligibility rule.
// ──────────────────────────────────────────────
router.post('/requests/upsert', async (req, res) => {
  const db = getDb();
  const evt = req.body?.event;

  const verr = verifyModuleEvent(evt, 31240);
  if (verr) return res.status(400).json({ error: verr });

  const dTag = getTag(evt, 'd');
  const title = getTag(evt, 'title');
  if (!dTag || !title) return res.status(400).json({ error: 'Missing d or title tag' });

  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const existing = db.prepare(
      'SELECT pubkey, is_hidden, is_repaid, published_at, funding_opens_at FROM uf_requests WHERE id = ?'
    ).get(dTag) as any;

    // Addressable identity is (pubkey, d): a different author may never take
    // over an existing d-tag row.
    if (existing && existing.pubkey && existing.pubkey !== evt.pubkey) {
      return res.status(403).json({ error: 'Request id belongs to a different author' });
    }

    let publishedAt: number;
    let fundingOpensAt: number;
    if (existing) {
      // Edits never move the maturing window.
      publishedAt = existing.published_at;
      fundingOpensAt = existing.funding_opens_at;
    } else {
      // First insert: server-clamped window. The client-supplied published_at is
      // accepted only within a small tolerance of NOW; funding_opens_at is
      // always derived (+8 days) — a client can never open its own funding early.
      const claimed = parseInt(getTag(evt, 'published_at') || '0') || nowSec;
      publishedAt = Math.min(Math.max(claimed, nowSec - 3600), nowSec + 300);
      fundingOpensAt = publishedAt + MATURING_SECONDS;

      // Eligibility: Lana8Wonder member for >= 4 completed Splits.
      const elig = await computeEligibility(db, evt.pubkey);
      if ((elig as any).error) return res.status(503).json({ error: (elig as any).error });
      if (!(elig as any).eligible) {
        return res.status(403).json({
          error: 'Not eligible — Lana8Wonder membership of at least 4 completed Splits is required',
          eligibility: elig,
        });
      }
    }

    const imageTags = getAllTags(evt, 'img');
    const coverImage = imageTags.find((t: string[]) => t[2] === 'cover')?.[1] || null;
    const galleryImages = imageTags.filter((t: string[]) => t[2] === 'gallery').map((t: string[]) => t[1]);
    const crowdfundingRefs = getAllTags(evt, 'crowdfunding').map((t: string[]) => t[1]);

    db.prepare(`
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
        status = excluded.status,
        nostr_created_at = CASE WHEN excluded.nostr_created_at > uf_requests.nostr_created_at
                                THEN excluded.nostr_created_at ELSE uf_requests.nostr_created_at END,
        updated_at = datetime('now')
    `).run(
      dTag,
      evt.id || null,
      evt.pubkey,
      title,
      getTag(evt, 'summary') || '',
      evt.content || '',
      getTag(evt, 'request_type') || 'personal_hardship',
      parseFloat(getTag(evt, 'fiat_goal') || '0') || 0,
      getTag(evt, 'currency') || 'EUR',
      getTag(evt, 'wallet') || '',
      coverImage,
      JSON.stringify(galleryImages),
      JSON.stringify(crowdfundingRefs),
      publishedAt,
      fundingOpensAt,
      getTag(evt, 'status') || 'active',
      existing ? existing.is_hidden : 0,
      existing ? existing.is_repaid : 0,
      evt.created_at || nowSec,
    );

    res.json({ success: true, fundingOpensAt });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/requests/upsert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// PATCH /api/unconditional-financing/requests/:id/admin
// ──────────────────────────────────────────────
router.patch('/requests/:id/admin', (req, res) => {
  const db = getDb();
  const { adminPubkey, is_hidden } = req.body;

  if (!adminPubkey || !getAdmins().includes(adminPubkey)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (is_hidden === undefined) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const result = db.prepare(`
      UPDATE uf_requests SET is_hidden = ?, updated_at = datetime('now') WHERE id = ?
    `).run(is_hidden ? 1 : 0, req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ PATCH /api/unconditional-financing/requests/:id/admin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/unconditional-financing/requests/:id
// Owner (or admin) may delete a request with NO contributions. Note: rows are
// re-indexed from relays, so deletion is only durable when the KIND 5 deletion
// event is also published client-side.
// ──────────────────────────────────────────────
router.delete('/requests/:id', (req, res) => {
  const db = getDb();
  const requesterPubkey = (req.body?.requesterPubkey || '').trim();
  if (!requesterPubkey) return res.status(400).json({ error: 'requesterPubkey required' });

  try {
    const request = db.prepare('SELECT pubkey FROM uf_requests WHERE id = ?').get(req.params.id) as any;
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const isOwner = request.pubkey === requesterPubkey;
    const isAdmin = getAdmins().includes(requesterPubkey);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorized to delete this request' });

    const check = db.prepare(
      'SELECT COUNT(*) AS cnt FROM uf_contributions WHERE request_id = ?'
    ).get(req.params.id) as any;
    if (check && check.cnt > 0) {
      return res.status(409).json({ error: 'Request has contributions and cannot be deleted', contributionCount: check.cnt });
    }

    db.prepare('DELETE FROM uf_requests WHERE id = ?').run(req.params.id);
    console.log(`🗑️ Deleted UF request ${req.params.id} by ${requesterPubkey.slice(0, 16)}…`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ DELETE /api/unconditional-financing/requests/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/unconditional-financing/contributions/record
// Body: { event: <signed KIND 60210> }
// Identity = event signer. Guards: request exists, no self-contribution,
// MATURING window (server-side rule, mirrored in the indexer).
// ──────────────────────────────────────────────
router.post('/contributions/record', (req, res) => {
  const db = getDb();
  const evt = req.body?.event;

  const verr = verifyModuleEvent(evt, 60210);
  if (verr) return res.status(400).json({ error: verr });

  const requestId = getTag(evt, 'request');
  if (!requestId) return res.status(400).json({ error: 'Missing request tag' });

  try {
    const request = db.prepare(
      'SELECT pubkey, funding_opens_at FROM uf_requests WHERE id = ?'
    ).get(requestId) as any;
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // The supporter is the SIGNER — never a claimable tag.
    const supporterPubkey = evt.pubkey;
    if (supporterPubkey === request.pubkey) {
      return res.status(403).json({ error: 'Requester cannot finance their own request' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const timestampPaid = parseInt(getTag(evt, 'timestamp_paid') || '0') || evt.created_at || nowSec;
    const effectiveTs = Math.min(evt.created_at || nowSec, timestampPaid);
    if ((request.funding_opens_at || 0) > nowSec || (request.funding_opens_at || 0) > effectiveTs) {
      return res.status(409).json({
        error: 'Request is still maturing — funding has not opened yet',
        fundingOpensAt: request.funding_opens_at,
      });
    }

    db.prepare(`
      INSERT INTO uf_contributions (
        id, request_id, supporter_pubkey, recipient_pubkey,
        amount_lanoshis, amount_fiat, currency, rate,
        from_wallet, repayment_wallet, to_wallet, tx_id, message,
        nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        message = COALESCE(uf_contributions.message, excluded.message)
    `).run(
      evt.id,
      requestId,
      supporterPubkey,
      request.pubkey,
      parseInt(getTag(evt, 'amount_lanoshis') || '0') || 0,
      parseFloat(getTag(evt, 'amount_fiat') || '0') || 0,
      getTag(evt, 'currency') || 'EUR',
      parseFloat(getTag(evt, 'rate') || '0') || 0,
      getTag(evt, 'from_wallet') || '',
      getTag(evt, 'repayment_wallet') || '',
      getTag(evt, 'to_wallet') || '',
      getTag(evt, 'tx') || null,
      (evt.content && evt.content.trim()) ? evt.content : null,
      evt.created_at || nowSec,
    );

    recomputeRepaid(db, requestId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/contributions/record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/unconditional-financing/repayments/record
// Body: { event: <signed KIND 60211> }
// Only the REQUEST OWNER's signature is accepted (only the requester repays),
// and the out-tag breakdown must sum to the declared total.
// ──────────────────────────────────────────────
router.post('/repayments/record', (req, res) => {
  const db = getDb();
  const evt = req.body?.event;

  const verr = verifyModuleEvent(evt, 60211);
  if (verr) return res.status(400).json({ error: verr });

  const requestId = getTag(evt, 'request');
  if (!requestId) return res.status(400).json({ error: 'Missing request tag' });

  try {
    const request = db.prepare('SELECT pubkey FROM uf_requests WHERE id = ?').get(requestId) as any;
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (evt.pubkey !== request.pubkey) {
      return res.status(403).json({ error: 'Only the requester can record a repayment' });
    }

    const totalFiat = parseFloat(getTag(evt, 'amount_fiat_total') || '0') || 0;
    const totalLanoshis = parseInt(getTag(evt, 'amount_lanoshis_total') || '0') || 0;
    const outputs = getAllTags(evt, 'out').map((t: string[]) => ({
      pubkey: t[1] || '',
      wallet: t[2] || '',
      lanoshis: parseInt(t[3] || '0') || 0,
      fiat: parseFloat(t[4] || '0') || 0,
    }));

    if (outputs.length === 0) return res.status(400).json({ error: 'Missing out tags' });
    const sumFiat = outputs.reduce((s, o) => s + o.fiat, 0);
    const sumLanoshis = outputs.reduce((s, o) => s + o.lanoshis, 0);
    if (totalFiat <= 0 || Math.abs(sumFiat - totalFiat) > Math.max(0.05, totalFiat * 0.01)) {
      return res.status(400).json({ error: 'Output fiat breakdown does not match the declared total' });
    }
    if (totalLanoshis <= 0 || sumLanoshis !== totalLanoshis) {
      return res.status(400).json({ error: 'Output lanoshi breakdown does not match the declared total' });
    }

    db.prepare(`
      INSERT INTO uf_repayments (
        id, request_id, payer_pubkey,
        total_lanoshis, total_fiat, currency, rate,
        tx_id, outputs, nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      evt.id,
      requestId,
      evt.pubkey,
      totalLanoshis,
      totalFiat,
      getTag(evt, 'currency') || 'EUR',
      parseFloat(getTag(evt, 'rate') || '0') || 0,
      getTag(evt, 'tx') || null,
      JSON.stringify(outputs),
      evt.created_at || Math.floor(Date.now() / 1000),
    );

    recomputeRepaid(db, requestId);

    const updated = db.prepare('SELECT is_repaid FROM uf_requests WHERE id = ?').get(requestId) as any;
    res.json({ success: true, isRepaid: !!updated?.is_repaid });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/repayments/record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/my-supports/:pubkey
// ──────────────────────────────────────────────
router.get('/my-supports/:pubkey', (req, res) => {
  const db = getDb();
  const pubkey = req.params.pubkey;
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const rows = db.prepare(`
      SELECT r.*, ${STATS_COLS},
             my.my_fiat, my.my_lanoshis
      FROM uf_requests r
      ${STATS_JOIN}
      INNER JOIN (
        SELECT request_id,
               SUM(amount_fiat) AS my_fiat,
               SUM(amount_lanoshis) AS my_lanoshis
        FROM uf_contributions
        WHERE supporter_pubkey = ?
        GROUP BY request_id
      ) my ON my.request_id = r.id
      ORDER BY r.nostr_created_at DESC
    `).all(pubkey) as any[];

    // Repaid-to-me: sum my outputs across the repayments of MY requests only.
    const requestIds = rows.map(r => r.id);
    const repaidToMe = new Map<string, number>();
    if (requestIds.length > 0) {
      const placeholders = requestIds.map(() => '?').join(',');
      const repayRows = db.prepare(
        `SELECT request_id, outputs FROM uf_repayments WHERE request_id IN (${placeholders})`
      ).all(...requestIds) as any[];
      for (const rr of repayRows) {
        for (const out of parseJsonArray(rr.outputs)) {
          if (out?.pubkey === pubkey) {
            repaidToMe.set(rr.request_id, (repaidToMe.get(rr.request_id) || 0) + (parseFloat(out.fiat) || 0));
          }
        }
      }
    }

    res.json({
      supports: rows.map(r => {
        const myFiat = r.my_fiat || 0;
        const sharePercent = r.total_funded > 0 ? (myFiat / r.total_funded) * 100 : 0;
        const returned = repaidToMe.get(r.id) || 0;
        return {
          request: requestRowToApi(r, nowSec),
          myFiat,
          myLanoshis: r.my_lanoshis || 0,
          sharePercent,
          repaidToMe: returned,
          outstandingToMe: Math.max(myFiat - returned, 0),
        };
      }),
    });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/my-supports/:pubkey error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/my-financings/:pubkey
// ──────────────────────────────────────────────
router.get('/my-financings/:pubkey', (req, res) => {
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const rows = db.prepare(`
      SELECT r.*, ${STATS_COLS}
      FROM uf_requests r
      ${STATS_JOIN}
      WHERE r.pubkey = ?
      ORDER BY r.nostr_created_at DESC
    `).all(req.params.pubkey) as any[];

    res.json({
      financings: rows.map(r => ({
        request: requestRowToApi(r, nowSec),
        totalFunded: r.total_funded || 0,
        totalRepaid: r.total_repaid || 0,
        outstanding: Math.max((r.total_funded || 0) - (r.total_repaid || 0), 0),
      })),
    });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/my-financings/:pubkey error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/summary
// ──────────────────────────────────────────────
router.get('/summary', (_req, res) => {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT r.id) AS total_requests,
        COALESCE(SUM(r.fiat_goal), 0) AS total_goal,
        COALESCE(SUM(c.total_funded), 0) AS total_funded,
        COALESCE(SUM(rp.total_repaid), 0) AS total_repaid
      FROM uf_requests r
      LEFT JOIN (
        SELECT request_id, SUM(amount_fiat) AS total_funded
        FROM uf_contributions GROUP BY request_id
      ) c ON c.request_id = r.id
      LEFT JOIN (
        SELECT request_id, SUM(total_fiat) AS total_repaid
        FROM uf_repayments GROUP BY request_id
      ) rp ON rp.request_id = r.id
      WHERE r.status != 'draft' AND r.is_hidden = 0
    `).get() as any;

    res.json({
      totalRequests: row?.total_requests ?? 0,
      totalGoal: row?.total_goal ?? 0,
      totalFunded: row?.total_funded ?? 0,
      totalRepaid: row?.total_repaid ?? 0,
    });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/unconditional-financing/eligibility/:pubkey
// ──────────────────────────────────────────────
router.get('/eligibility/:pubkey', async (req, res) => {
  const db = getDb();
  const pubkey = (req.params.pubkey || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: 'Invalid pubkey' });
  }

  try {
    const result = await computeEligibility(db, pubkey);
    if ((result as any).error) return res.status(503).json({ error: (result as any).error });
    res.json(result);
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/eligibility error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
