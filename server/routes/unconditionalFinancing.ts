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
 * Deleting and hiding a request follow the same rule: the caller signs a
 * kind 27235 event (see server/lib/ufSignedAction.ts) and the SIGNER — owner or
 * administrator — is the only identity there is.
 *
 * Lifecycle: publish → PENDING (seen only by its author and the administrators;
 * the author may still change it) → an administrator APPROVES it (signed; the
 * version, amount and currency are pinned, and from then on nothing an approval
 * covers may change — server/lib/ufApproval.ts) → MATURING (comments only;
 * enforced server-side and in the indexer; the length is an admin setting) →
 * REPAYING (open for funding AND repayable) →
 * REPAID (repaid_fiat >= funded_fiat, auto-recomputed). An administrator may
 * ARCHIVE a request at any point (is_hidden): out of every public list and not
 * fundable, and reversible.
 */

import { Router } from 'express';
import { verifyEvent } from 'nostr-tools';
import { getDb } from '../db/connection.js';
import { queryEventsWithRelayStatus } from '../lib/nostr.js';
import { getUfSettings, maxAmountFor } from '../lib/ufSettings.js';
import { computeEligibility, relaysOf } from '../lib/ufEligibility.js';
import { checkOwnReceivingWallet } from '../lib/ufWallet.js';
import { UF_FUTURE_SKEW_SECONDS, UF_PAST_SKEW_SECONDS } from '../lib/ufMaturing.js';
import {
  UF_ACTION_APPROVE,
  UF_ACTION_DELETE_REQUEST,
  UF_ACTION_REVIEW,
  UF_ACTION_SET_HIDDEN,
  UF_REVIEW_TARGET,
  consumeSignedAction,
  isRefused,
  verifySignedAction,
} from '../lib/ufSignedAction.js';
import {
  PUBLIC_REQUEST_SQL,
  approvalHolds,
  editAllowedAfterApproval,
  fundingRefusal,
  wasApproved,
} from '../lib/ufApproval.js';

const router = Router();

const SERVICE_TAG = 'unconditional-financing';

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

function getAdmins(): string[] {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'unconditional_financing_admins'").get() as any;
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

/**
 * An administrator is a key in admin_users — the same list that may rewrite
 * app_settings — or one named in this module's own admin list. Both lists are
 * only writable by an administrator, so naming a second place widens nothing.
 */
function isAdministrator(db: any, pubkey: string): boolean {
  const row = db.prepare('SELECT 1 FROM admin_users WHERE nostr_hex_id = ?').get(pubkey) as any;
  return !!row || getAdmins().includes(pubkey);
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
// A request whose approval does not hold is 'pending', whatever its window says.
function phaseOf(row: any, nowSec: number): 'pending' | 'maturing' | 'repaying' | 'repaid' {
  if (row.is_repaid) return 'repaid';
  if (!approvalHolds(row)) return 'pending';
  if ((row.funding_opens_at || 0) > nowSec) return 'maturing';
  return 'repaying';
}

function requestRowToApi(row: any, nowSec: number) {
  const approved = approvalHolds(row);
  const phase = phaseOf(row, nowSec);
  return {
    id: row.id,
    eventId: row.event_id,
    pubkey: row.pubkey,
    title: row.title,
    shortDesc: row.short_desc,
    content: row.content,
    requestType: row.request_type,
    // An approved request reads the amount PINNED at approval, never a later number.
    fiatGoal: approved ? row.approved_fiat_goal : row.fiat_goal,
    currency: approved ? row.approved_currency : row.currency,
    wallet: row.wallet,
    coverImage: row.cover_image,
    galleryImages: parseJsonArray(row.gallery_images),
    crowdfundingRefs: parseJsonArray(row.crowdfunding_refs),
    publishedAt: row.published_at,
    fundingOpensAt: row.funding_opens_at,
    status: row.status,
    isHidden: !!row.is_hidden,
    /** Archived = hidden by an administrator (the same flag): out of the lists, not fundable. */
    isArchived: !!row.is_hidden,
    isRepaid: !!row.is_repaid,
    phase,
    approval: approved ? 'approved' : 'pending',
    approvedAt: approved ? row.approved_at : null,
    approvedEventId: approved ? row.approved_event_id : null,
    /** May a contribution be made right now? The same rule /contributions/record enforces. */
    fundable: phase === 'repaying' && !fundingRefusal(row),
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

  // Only what an administrator approved and did not archive is public (ufApproval.ts).
  const conditions: string[] = [PUBLIC_REQUEST_SQL];
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

    // How many requests sit in each phase, so the tabs can show it. Without
    // this a request in another tab is effectively invisible: someone looking
    // at an empty (or single-entry) tab has no hint that more exist elsewhere.
    const visible = `WHERE ${PUBLIC_REQUEST_SQL}`;
    const countsRow = db.prepare(`
      SELECT
        SUM(CASE WHEN r.is_repaid = 0 AND r.funding_opens_at >  ? THEN 1 ELSE 0 END) AS maturing,
        SUM(CASE WHEN r.is_repaid = 0 AND r.funding_opens_at <= ? THEN 1 ELSE 0 END) AS repaying,
        SUM(CASE WHEN r.is_repaid = 1 THEN 1 ELSE 0 END) AS repaid
      FROM uf_requests r ${visible}
    `).get(nowSec, nowSec) as any;

    res.json({
      requests: rows.map(r => requestRowToApi(r, nowSec)),
      counts: {
        maturing: countsRow?.maturing ?? 0,
        repaying: countsRow?.repaying ?? 0,
        repaid: countsRow?.repaid ?? 0,
      },
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
      `SELECT pubkey, is_hidden, is_repaid, published_at, funding_opens_at, wallet, event_id, nostr_created_at,
              title, short_desc, content, request_type, fiat_goal, currency, cover_image, gallery_images,
              crowdfunding_refs, status, approved_at
         FROM uf_requests WHERE id = ?`
    ).get(dTag) as any;

    // Addressable identity is (pubkey, d): a different author may never take
    // over an existing d-tag row.
    if (existing && existing.pubkey && existing.pubkey !== evt.pubkey) {
      return res.status(403).json({ error: 'Request id belongs to a different author' });
    }

    if (existing) {
      // A signed event is public, and anyone can post it again. The very event the row
      // already reflects is applied once: sending it again (a retry, or somebody
      // replaying the owner's event to restart a window that is maturing) changes nothing.
      if (existing.event_id && existing.event_id === evt.id) {
        return res.json({ success: true, fundingOpensAt: existing.funding_opens_at, unchanged: true });
      }
      // …and an OLDER version never replaces a newer one (Nostr's rule for an addressable event).
      if ((evt.created_at || 0) < (existing.nostr_created_at || 0)) {
        return res.status(409).json({ error: 'A newer version of this request already exists' });
      }
    }

    const imageTags = getAllTags(evt, 'img');
    const coverImage = imageTags.find((t: string[]) => t[2] === 'cover')?.[1] || null;
    const galleryImages = imageTags.filter((t: string[]) => t[2] === 'gallery').map((t: string[]) => t[1]);
    const crowdfundingRefs = getAllTags(evt, 'crowdfunding').map((t: string[]) => t[1]);

    // Approved = frozen. Once an administrator approved a request, a later version may not change
    // anything the approval covers — above all not the amount (Jasna and Brilly, 16. 11. 2026). The
    // receiving wallet is the one exception, judged below by the owner's-own-wallet rule.
    if (existing && !editAllowedAfterApproval(existing, {
      title,
      shortDesc: getTag(evt, 'summary') || '',
      content: evt.content || '',
      requestType: getTag(evt, 'request_type') || 'personal_hardship',
      fiatGoal: parseFloat(getTag(evt, 'fiat_goal') || '0') || 0,
      currency: getTag(evt, 'currency') || 'EUR',
      coverImage,
      galleryImages,
      crowdfundingRefs,
      status: getTag(evt, 'status') || 'active',
    })) {
      return res.status(409).json({
        error: 'This request has been approved and can no longer be changed — only its receiving wallet may move to another of your own wallets',
        code: 'APPROVED_LOCKED',
      });
    }

    const settings = getUfSettings();

    // Per-group cap (admin-configurable; 0 = uncapped). Enforced on edits too,
    // otherwise a within-cap request could be edited up afterwards.
    // (An approved request's amount was checked when it was asked for and can no longer change —
    // the lock above — so a cap lowered later must not block it from switching its wallet.)
    const requestedGoal = parseFloat(getTag(evt, 'fiat_goal') || '0') || 0;
    const cap = maxAmountFor(getTag(evt, 'request_type') || '', settings);
    if (cap > 0 && requestedGoal > cap && !(existing && wasApproved(existing))) {
      return res.status(400).json({
        error: `Requested amount exceeds the maximum for this group (${cap})`,
        maxAmount: cap,
      });
    }

    // Where the money lands. While the request matures it may still change (no
    // funds are in flight and the restarted window gives the community a fresh
    // look at it). Once funding is open it is PINNED — an edit can never redirect
    // contributions away from the address people are giving to — except to
    // another of the OWNER'S OWN registered wallets, checked against the Lana
    // Registrar's record (server/lib/ufWallet.ts; Brilly, 11. 11. 2026).
    // An approval pins it the same way: what was approved is where the money goes.
    let wallet = getTag(evt, 'wallet') || '';
    if (existing && existing.wallet && (nowSec >= existing.funding_opens_at || wasApproved(existing))) {
      if (wallet && wallet !== existing.wallet) {
        const verdict = await checkOwnReceivingWallet(db, relaysOf(db), evt.pubkey, wallet, queryEventsWithRelayStatus);
        if ('unknown' in verdict) {
          return res.status(503).json({ error: `Your wallet list could not be read just now (${verdict.unknown}) — the receiving wallet was not changed yet` });
        }
        if (verdict.ok === false) return res.status(403).json({ error: verdict.reason });
      } else {
        wallet = existing.wallet;
      }
    }

    let publishedAt: number;
    let fundingOpensAt: number;
    if (existing) {
      publishedAt = existing.published_at;
      if (nowSec < existing.funding_opens_at) {
        // Refining a request WHILE IT MATURES restarts the review period, so the
        // community always gets a full window on the version it will fund.
        // Clamped to never land EARLIER than the window already announced: an
        // edit may only ever delay funding, never open it sooner (which is what
        // the write-once rule protected against).
        fundingOpensAt = Math.max(existing.funding_opens_at, nowSec + settings.maturingSeconds);
      } else {
        // Funding is already open — an edit must not drag it back into maturing.
        fundingOpensAt = existing.funding_opens_at;
      }
    } else {
      // First insert: server-clamped window. The client-supplied published_at is
      // accepted only within a small tolerance of NOW; funding_opens_at is always
      // derived from the admin-configured maturing length — a client can never
      // open its own funding early.
      const claimed = parseInt(getTag(evt, 'published_at') || '0') || nowSec;
      publishedAt = Math.min(Math.max(claimed, nowSec - UF_PAST_SKEW_SECONDS), nowSec + UF_FUTURE_SKEW_SECONDS);
      fundingOpensAt = publishedAt + settings.maturingSeconds;

      // Eligibility: Lana8Wonder member for >= 4 completed Splits.
      const elig = await computeEligibility(db, evt.pubkey, queryEventsWithRelayStatus);
      if ((elig as any).error) return res.status(503).json({ error: (elig as any).error });
      if (!(elig as any).eligible) {
        return res.status(403).json({
          error: 'Not eligible — Lana8Wonder membership of at least 4 completed Splits is required',
          eligibility: elig,
        });
      }
    }

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
        -- Both were computed above from the EXISTING row: published_at is carried
        -- over unchanged, and funding_opens_at is either the untouched window or
        -- a restarted one that can only ever be later. Writing them here is what
        -- makes a restart actually persist.
        published_at = excluded.published_at,
        funding_opens_at = excluded.funding_opens_at,
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
      wallet,
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

    // A request nobody approved yet is listed for its author and the administrators only.
    res.json({ success: true, fundingOpensAt, awaitingApproval: !(existing && wasApproved(existing)) });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/requests/upsert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// PATCH /api/unconditional-financing/requests/:id/admin
// Body: { event: <signed kind 27235> }
//   content: {"action":"uf-request-set-hidden","id":"<request id>","is_hidden":true|false}
//   tags:    ['u', <this url>], ['method', 'PATCH']
// The SIGNER must be an administrator, and is_hidden is read from the signed
// content — neither a public key nor a flag in the JSON body decides anything.
// This is ARCHIVE (true) and RESTORE (false): an archived request leaves every
// public list and cannot be funded (ufApproval.ts); repayments stay possible.
// ──────────────────────────────────────────────
router.patch('/requests/:id/admin', (req, res) => {
  const db = getDb();
  const signed = verifySignedAction(req.body?.event, {
    method: 'PATCH',
    action: UF_ACTION_SET_HIDDEN,
    target: req.params.id,
  });
  if (isRefused(signed)) return res.status(signed.status).json({ error: signed.error });

  if (!isAdministrator(db, signed.pubkey)) {
    return res.status(403).json({ error: 'Not an administrator' });
  }
  const isHidden = signed.payload.is_hidden;
  if (typeof isHidden !== 'boolean') {
    return res.status(400).json({ error: 'No fields to update' });
  }
  const spentPatch = consumeSignedAction(signed);
  if (spentPatch) return res.status(spentPatch.status).json({ error: spentPatch.error });

  try {
    const result = db.prepare(`
      UPDATE uf_requests SET is_hidden = ?, updated_at = datetime('now') WHERE id = ?
    `).run(isHidden ? 1 : 0, req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Request not found' });
    console.log(`${isHidden ? '🙈 Hid' : '👁️ Unhid'} UF request ${req.params.id} by ${signed.pubkey.slice(0, 16)}…`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ PATCH /api/unconditional-financing/requests/:id/admin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/unconditional-financing/requests/:id/approve
// Body: { event: <signed kind 27235> }
//   content: {"action":"uf-request-approve","id":"<request id>",
//             "event_id":"<the 31240 seen>","fiat_goal":<amount seen>,"currency":"<currency seen>"}
//   tags:    ['u', <this url>], ['method', 'POST'], ['nonce', <random>]
// The SIGNER must be an administrator. The approval is for the exact version the administrator
// looked at: if the author changed it meanwhile, nothing is approved (409) and the page is
// reloaded. On approval the version, amount and currency are pinned (ufApproval.ts). The
// maturing window is left as it is (ufApproval.ts says why).
// ──────────────────────────────────────────────
router.post('/requests/:id/approve', (req, res) => {
  const db = getDb();
  const signed = verifySignedAction(req.body?.event, {
    method: 'POST',
    action: UF_ACTION_APPROVE,
    target: req.params.id,
  });
  if (isRefused(signed)) return res.status(signed.status).json({ error: signed.error });
  if (!isAdministrator(db, signed.pubkey)) return res.status(403).json({ error: 'Not an administrator' });

  const { event_id: seenEventId, fiat_goal: seenGoal, currency: seenCurrency } = signed.payload;
  if (typeof seenEventId !== 'string' || typeof seenGoal !== 'number' || typeof seenCurrency !== 'string') {
    return res.status(400).json({ error: 'An approval names the version, amount and currency it is for' });
  }

  try {
    const row = db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status === 'draft') return res.status(409).json({ error: 'A draft cannot be approved', code: 'DRAFT' });
    if (row.is_hidden) return res.status(409).json({ error: 'This request is archived — restore it before approving it', code: 'ARCHIVED' });
    if (approvalHolds(row)) return res.status(409).json({ error: 'This request is already approved', code: 'ALREADY_APPROVED' });
    if (row.event_id !== seenEventId || row.currency !== seenCurrency || Math.abs((Number(row.fiat_goal) || 0) - seenGoal) > 1e-9) {
      return res.status(409).json({ error: 'The request has changed since you opened it — reload it and look again', code: 'CHANGED' });
    }

    const spent = consumeSignedAction(signed);
    if (spent) return res.status(spent.status).json({ error: spent.error });

    const now = Math.floor(Date.now() / 1000);
    // The WHERE repeats what was checked, so an edit landing between the read and this write
    // cannot be approved in the place of the version the administrator saw.
    const result = db.prepare(`
      UPDATE uf_requests
         SET approved_at = ?, approved_by = ?, approved_event_id = event_id,
             approved_fiat_goal = fiat_goal, approved_currency = currency,
             updated_at = datetime('now')
       WHERE id = ? AND event_id = ? AND fiat_goal = ? AND currency = ? AND is_hidden = 0
    `).run(now, signed.pubkey, row.id, row.event_id, row.fiat_goal, row.currency);
    if (result.changes === 0) {
      return res.status(409).json({ error: 'The request has changed since you opened it — reload it and look again', code: 'CHANGED' });
    }
    console.log(`✅ Approved UF request ${row.id} (${row.fiat_goal} ${row.currency}, event ${String(row.event_id).slice(0, 12)}…) by ${signed.pubkey.slice(0, 16)}…`);
    res.json({ success: true, fundingOpensAt: row.funding_opens_at });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/requests/:id/approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/unconditional-financing/requests/review
// Body: { event: <signed kind 27235> }
//   content: {"action":"uf-requests-review","id":"review"}
//   tags:    ['u', <this url>], ['method', 'POST'], ['nonce', <random>]
// What only an administrator sees: requests waiting for approval and archived ones.
// ──────────────────────────────────────────────
router.post('/requests/review', (req, res) => {
  const db = getDb();
  const signed = verifySignedAction(req.body?.event, {
    method: 'POST',
    action: UF_ACTION_REVIEW,
    target: UF_REVIEW_TARGET,
  });
  if (isRefused(signed)) return res.status(signed.status).json({ error: signed.error });
  if (!isAdministrator(db, signed.pubkey)) return res.status(403).json({ error: 'Not an administrator' });
  const spent = consumeSignedAction(signed);
  if (spent) return res.status(spent.status).json({ error: spent.error });

  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const rows = db.prepare(`
      SELECT r.*, ${STATS_COLS}
      FROM uf_requests r
      ${STATS_JOIN}
      WHERE r.status != 'draft'
      ORDER BY r.nostr_created_at DESC
    `).all() as any[];
    const pending = rows.filter((r) => !r.is_hidden && !approvalHolds(r));
    const archived = rows.filter((r) => !!r.is_hidden);
    res.json({
      pending: pending.map((r) => requestRowToApi(r, nowSec)),
      archived: archived.map((r) => requestRowToApi(r, nowSec)),
    });
  } catch (err: any) {
    console.error('❌ POST /api/unconditional-financing/requests/review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/unconditional-financing/requests/:id
// Body: { event: <signed kind 27235> }
//   content: {"action":"uf-request-delete","id":"<request id>"}
//   tags:    ['u', <this url>], ['method', 'DELETE']
// The owner (the request's signer) or an administrator may delete a request
// that is STILL MATURING and has no contributions; who is asking is the signer,
// nothing else. Note: rows are re-indexed from relays, so deletion is only
// durable when the KIND 5 deletion event is also published client-side.
// ──────────────────────────────────────────────
router.delete('/requests/:id', (req, res) => {
  const db = getDb();
  const signed = verifySignedAction(req.body?.event, {
    method: 'DELETE',
    action: UF_ACTION_DELETE_REQUEST,
    target: req.params.id,
  });
  if (isRefused(signed)) return res.status(signed.status).json({ error: signed.error });

  try {
    const request = db.prepare('SELECT pubkey, is_hidden, funding_opens_at FROM uf_requests WHERE id = ?').get(req.params.id) as any;
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const isOwner = request.pubkey === signed.pubkey;
    const isAdmin = isAdministrator(db, signed.pubkey);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorized to delete this request' });

    // A request an administrator hid stays an administrator's to deal with: the
    // indexer re-creates a deleted row from the relays, and the new row is NOT hidden.
    if (request.is_hidden && !isAdmin) {
      return res.status(403).json({ error: 'This request was hidden by an administrator — only an administrator can delete it' });
    }

    // Only while the review period still runs. Once funding is open, people may be sending
    // money — a contribution can be on its way (paid, published, not yet recorded here) —
    // and a deleted row is re-listed by the indexer as a request it has never seen, with a
    // restarted window that would refuse that contribution. An open request is hidden
    // (administrator), not deleted.
    if ((request.funding_opens_at || 0) <= Math.floor(Date.now() / 1000)) {
      return res.status(409).json({ error: 'The request is already open for funding and can no longer be deleted — an administrator can hide it' });
    }

    const check = db.prepare(
      'SELECT COUNT(*) AS cnt FROM uf_contributions WHERE request_id = ?'
    ).get(req.params.id) as any;
    if (check && check.cnt > 0) {
      return res.status(409).json({ error: 'Request has contributions and cannot be deleted', contributionCount: check.cnt });
    }

    const spentDelete = consumeSignedAction(signed);
    if (spentDelete) return res.status(spentDelete.status).json({ error: spentDelete.error });

    db.prepare('DELETE FROM uf_requests WHERE id = ?').run(req.params.id);
    console.log(`🗑️ Deleted UF request ${req.params.id} by ${signed.pubkey.slice(0, 16)}…`);
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
      `SELECT pubkey, funding_opens_at, status, is_hidden, fiat_goal, currency,
              approved_at, approved_fiat_goal, approved_currency
         FROM uf_requests WHERE id = ?`
    ).get(requestId) as any;
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // A contribution already counted stays counted (sending its event again changes nothing).
    const known = db.prepare('SELECT 1 FROM uf_contributions WHERE id = ?').get(evt.id);
    // Not approved (or the approval no longer covers what the row says), archived, or a draft:
    // nobody may fund it, so a new contribution is not counted — the same rule the relay
    // re-index applies. Archived and later restored, a refused one is counted by the next scan.
    const refusal = known ? null : fundingRefusal(request);
    if (refusal) return res.status(409).json({ error: refusal.error, code: refusal.code });

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
      WHERE ${PUBLIC_REQUEST_SQL}
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
    const result = await computeEligibility(db, pubkey, queryEventsWithRelayStatus);
    if ((result as any).error) return res.status(503).json({ error: (result as any).error });
    res.json(result);
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/eligibility error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /settings — the module rules the server actually enforces
// (maturing length + per-group caps), so the form and the article can
// present exactly what will be applied. Public, read-only.
// ──────────────────────────────────────────────
router.get('/settings', (_req, res) => {
  try {
    const s = getUfSettings();
    res.json({ maturingDays: s.maturingDays, maxAmounts: s.maxAmounts });
  } catch (err: any) {
    console.error('❌ GET /api/unconditional-financing/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
