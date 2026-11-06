/**
 * LanaCrowd (100millionideas) — server-authoritative REST API
 *
 * All reads come from SQLite (fast, consistent, paginated).
 * Writes: client publishes to Nostr first, then calls upsert/record here
 * so the project is immediately visible — no waiting for relay propagation.
 * Background indexer (heartbeat) acts as safety net.
 * Every write rests on a signed event: see server/lib/lanacrowdSigned.ts.
 */

import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { consumeSignedAction, isRefused, verifySignedAction } from '../lib/ufSignedAction.js';
import {
  DELETION_KIND,
  DELETION_MAX_AGE_SECONDS,
  DONATION_KIND,
  LANACROWD_ACTION_ADMIN,
  LANACROWD_ACTION_DELETE,
  MAX_FUTURE_SECONDS,
  PROJECT_KIND,
  decisionFor,
  deletionNames,
  donationFromEvent,
  isEventRefused,
  projectFromEvent,
  readSignedEvent,
} from '../lib/lanacrowdSigned.js';
import { publishEventToRelays } from '../lib/nostr.js';

const router = Router();

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
  const row = db.prepare("SELECT value FROM app_settings WHERE key = '100millionideas_admins'").get() as any;
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

/** Whose decisions LetsBalance.world and every other reader of the relays count: the signed 38888 says. */
function getDeciders(): string[] {
  const row = getDb().prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  try {
    const list = JSON.parse(row?.trusted_signers || '{}')['100MillionFun'];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** True once `needed` relays took the event; the others keep trying on their own. */
function acceptedByRelays(relays: string[], event: unknown, needed: number): Promise<boolean> {
  return new Promise((resolve) => {
    let accepted = 0, left = relays.length;
    if (!left) resolve(false);
    for (const relay of relays) {
      publishEventToRelays([relay], event)
        .then((r) => !!r[0]?.success, () => false)
        .then((ok) => {
          if (ok && ++accepted === needed) resolve(true);
          if (--left === 0) resolve(accepted >= needed);
        });
    }
  });
}

function parseJsonArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return [];
}

function projectRowToApi(row: any) {
  return {
    id: row.id,
    eventId: row.event_id,
    pubkey: row.pubkey,
    ownerPubkey: row.owner_pubkey,
    title: row.title,
    shortDesc: row.short_desc,
    content: row.content,
    fiatGoal: row.fiat_goal,
    currency: row.currency,
    wallet: row.wallet,
    responsibilityStatement: row.responsibility_statement,
    projectType: row.project_type,
    whatType: row.what_type,
    status: row.status,
    coverImage: row.cover_image,
    galleryImages: parseJsonArray(row.gallery_images),
    videos: parseJsonArray(row.videos),
    files: parseJsonArray(row.files),
    participants: parseJsonArray(row.participants),
    isHidden: !!row.is_hidden,
    isApproved: !!row.is_approved,
    isFunded: !!row.is_funded,
    isCompleted: !!row.is_completed,
    completionComment: row.completion_comment,
    nostrCreatedAt: row.nostr_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // donation stats (optional JOINs)
    totalRaised: row.total_raised ?? 0,
    donationCount: row.donation_count ?? 0,
  };
}

function donationRowToApi(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    supporterPubkey: row.supporter_pubkey,
    projectOwnerPubkey: row.project_owner_pubkey,
    amountLanoshis: row.amount_lanoshis,
    amountFiat: row.amount_fiat,
    currency: row.currency,
    fromWallet: row.from_wallet,
    toWallet: row.to_wallet,
    txId: row.tx_id,
    message: row.message || '',
    nostrCreatedAt: row.nostr_created_at,
    createdAt: row.created_at,
  };
}

// ──────────────────────────────────────────────
// GET /api/lanacrowd/projects
// ──────────────────────────────────────────────
router.get('/projects', (req, res) => {
  const db = getDb();
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const filter = (req.query.filter as string) || 'open';
  const search = (req.query.search as string || '').trim();
  const adminPubkey = req.query.adminPubkey as string | undefined;
  const viewerPubkey = (req.query.viewerPubkey as string | undefined) || adminPubkey;
  const isAdmin = adminPubkey && getAdmins().includes(adminPubkey);
  const offset = (page - 1) * limit;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: any[] = [];

  // Drafts are never shown in the public listing (only visible in my-projects)
  conditions.push("status != 'draft'");

  // Hidden projects live ONLY under the 'hidden' tab (admin-only). Every other
  // tab excludes them for all viewers (incl. admins), so they never appear in
  // Open/Funded/Completed/All nor in the public totals.
  if (filter === 'hidden') {
    conditions.push('is_hidden = 1');
    if (!isAdmin) conditions.push('1 = 0'); // non-admins may never see hidden
  } else {
    conditions.push('is_hidden = 0');
  }

  // Approval gate: non-admins only see approved projects, except for projects
  // they own — owners may see their own pending submissions in the listing.
  if (!isAdmin) {
    if (viewerPubkey) {
      conditions.push('(is_approved = 1 OR owner_pubkey = ? OR pubkey = ?)');
      params.push(viewerPubkey, viewerPubkey);
    } else {
      conditions.push('is_approved = 1');
    }
  }

  switch (filter) {
    case 'open':
      conditions.push('is_funded = 0');
      conditions.push('is_completed = 0');
      break;
    case 'funded':
      conditions.push('is_funded = 1');
      conditions.push('is_completed = 0');
      break;
    case 'completed':
      conditions.push('is_completed = 1');
      break;
    case 'hidden': // is_hidden = 1 already applied above; show all hidden regardless of fund/complete
    case 'all':
    default:
      break;
  }

  if (search) {
    conditions.push("(title LIKE ? OR short_desc LIKE ? OR content LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM lanacrowd_projects ${where}
    `).get(...params) as any;
    const total = countRow?.total ?? 0;

    const rows = db.prepare(`
      SELECT p.*,
             COALESCE(d.total_raised, 0) AS total_raised,
             COALESCE(d.donation_count, 0) AS donation_count
      FROM lanacrowd_projects p
      LEFT JOIN (
        SELECT project_id,
               SUM(amount_fiat) AS total_raised,
               COUNT(*) AS donation_count
        FROM lanacrowd_donations
        GROUP BY project_id
      ) d ON p.id = d.project_id
      ${where}
      ORDER BY p.is_approved ASC, p.nostr_created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    res.json({
      projects: rows.map(projectRowToApi),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/lanacrowd/projects/:id
// ──────────────────────────────────────────────
router.get('/projects/:id', (req, res) => {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT p.*,
             COALESCE(d.total_raised, 0) AS total_raised,
             COALESCE(d.donation_count, 0) AS donation_count
      FROM lanacrowd_projects p
      LEFT JOIN (
        SELECT project_id,
               SUM(amount_fiat) AS total_raised,
               COUNT(*) AS donation_count
        FROM lanacrowd_donations
        WHERE project_id = ?
      ) d ON p.id = d.project_id
      WHERE p.id = ?
    `).get(req.params.id, req.params.id) as any;

    if (!row) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: projectRowToApi(row) });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/projects/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/lanacrowd/projects/upsert
// Called immediately after successful Nostr publish
// Body: { event: <the signed KIND 31234> }
// The project is read from the event. A project belongs to its signer, and an
// older version of it does not replace a newer one.
// ──────────────────────────────────────────────
router.post('/projects/upsert', (req, res) => {
  const db = getDb();
  const signed = readSignedEvent(req.body?.event, PROJECT_KIND);
  if (isEventRefused(signed)) return res.status(signed.status).json({ error: signed.error });
  const evt = signed.event;

  const p = projectFromEvent(evt);
  if (!p) return res.status(400).json({ error: 'Missing required project fields' });
  if (p.ownerPubkey !== evt.pubkey) return res.status(403).json({ error: 'A project is signed by its owner' });

  try {
    // Preserve existing admin overrides — only upsert content fields
    const existing = db.prepare('SELECT pubkey, owner_pubkey, event_id, nostr_created_at, is_hidden, is_approved, is_funded, is_completed, completion_comment FROM lanacrowd_projects WHERE id = ?').get(p.id) as any;

    if (existing) {
      if (existing.pubkey !== evt.pubkey && existing.owner_pubkey !== evt.pubkey) {
        return res.status(403).json({ error: 'Not authorized to change this project' });
      }
      if (existing.event_id === evt.id) return res.json({ success: true });
      if (evt.created_at < existing.nostr_created_at) {
        return res.status(409).json({ error: 'A newer version of this project is already stored' });
      }
    }

    db.prepare(`
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
    `).run(
      p.id,
      p.eventId,
      p.pubkey,
      p.ownerPubkey,
      p.title,
      p.shortDesc,
      p.content,
      p.fiatGoal,
      p.currency,
      p.wallet,
      p.responsibilityStatement,
      p.projectType,
      p.whatType,
      p.status,
      p.coverImage,
      JSON.stringify(p.galleryImages),
      JSON.stringify(p.videos),
      JSON.stringify(p.files),
      JSON.stringify(p.participants),
      existing ? existing.is_hidden : 0,
      existing ? existing.is_approved : 0,
      existing ? existing.is_funded : 0,
      existing ? existing.is_completed : 0,
      existing ? existing.completion_comment : null,
      p.nostrCreatedAt,
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ POST /api/lanacrowd/projects/upsert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// PATCH /api/lanacrowd/projects/:id/admin
// Admin-only: toggle hidden/approved/funded/completed
// Body: { event: <signed kind 27235>, decision?: <signed 31235 or 60201> }
//   content: {"action":"lanacrowd-project-admin","id":"<d-tag>", …the fields, decision_id}
//   tags:    ['u', <this url>], ['method', 'PATCH'], ['nonce', <random>]
// The SIGNER must be an admin; the fields are read from the signed content.
// A change to hidden, approved or completed also needs the signer in the signed 38888
// and that decision's event, which goes to the relays before the row changes.
// ──────────────────────────────────────────────
router.patch('/projects/:id/admin', async (req, res) => {
  const db = getDb();
  const signed = verifySignedAction(req.body?.event, {
    method: 'PATCH',
    action: LANACROWD_ACTION_ADMIN,
    target: req.params.id,
  });
  if (isRefused(signed)) return res.status(signed.status).json({ error: signed.error });

  if (!getAdmins().includes(signed.pubkey)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { is_hidden, is_approved, is_funded, is_completed, completion_comment } = signed.payload;
  // Only update provided fields
  const sets: string[] = [];
  const vals: any[] = [];

  for (const [column, value] of Object.entries({ is_hidden, is_approved, is_funded, is_completed })) {
    if (value === undefined) continue;
    if (typeof value !== 'boolean') return res.status(400).json({ error: `${column} must be true or false` });
    sets.push(`${column} = ?`);
    vals.push(value ? 1 : 0);
  }
  if (completion_comment !== undefined) {
    if (completion_comment !== null && typeof completion_comment !== 'string') {
      return res.status(400).json({ error: 'completion_comment must be text' });
    }
    sets.push('completion_comment = ?');
    vals.push(completion_comment || null);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  const decides = is_hidden !== undefined || is_approved !== undefined || is_completed !== undefined;
  let decision: any = null;
  if (decides) {
    if (is_completed !== undefined && (is_hidden !== undefined || is_approved !== undefined)) {
      return res.status(400).json({ error: 'One decision at a time' });
    }
    if (!getDeciders().includes(signed.pubkey)) {
      return res.status(403).json({ error: 'This key is not in the signed 38888: its decision would not count', code: 'NOT_A_DECIDER' });
    }
    const project = db.prepare('SELECT * FROM lanacrowd_projects WHERE id = ?').get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (req.body?.decision) {
      const read = readSignedEvent(req.body.decision, req.body.decision.kind);
      if (isEventRefused(read)) return res.status(read.status).json({ error: read.error });
      decision = read.event;
    }
    const age = decision ? Math.floor(Date.now() / 1000) - decision.created_at : 0;
    const want = decisionFor(
      { id: project.id, pubkey: project.pubkey, wallet: project.wallet, fiatGoal: project.fiat_goal, currency: project.currency, status: project.status, isHidden: !!project.is_hidden, isApproved: !!project.is_approved },
      { is_hidden, is_approved, is_completed, completion_comment } as any,
      signed.pubkey,
      decision?.created_at ?? 0,
    );
    const sameEvent = !!want && !!decision && decision.kind === want.kind && decision.content === want.content && JSON.stringify(decision.tags) === JSON.stringify(want.tags);
    if (want ? !sameEvent || decision.pubkey !== signed.pubkey || signed.payload.decision_id !== decision.id || age > DELETION_MAX_AGE_SECONDS || age < -MAX_FUTURE_SECONDS : !!decision) {
      return res.status(400).json({ error: 'The decision does not match this change' });
    }
  }

  const spentPatch = consumeSignedAction(signed);
  if (spentPatch) return res.status(spentPatch.status).json({ error: spentPatch.error });

  try {
    if (decision) {
      const relays = getRelays();
      if (!(await acceptedByRelays(relays, decision, Math.min(2, relays.length)))) {
        return res.status(502).json({ error: 'The relays did not take this decision: nothing was changed', code: 'NOT_ON_RELAYS' });
      }
    }
    sets.push("updated_at = datetime('now')");
    vals.push(req.params.id);

    const result = db.prepare(`
      UPDATE lanacrowd_projects SET ${sets.join(', ')} WHERE id = ?
    `).run(...vals);

    if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ PATCH /api/lanacrowd/projects/:id/admin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/lanacrowd/projects/:id
// Owner or 100M admin can delete a project that has received NO donations.
// Body: { event } — one of:
//   a signed kind 27235, content {"action":"lanacrowd-project-delete","id":"<d-tag>"},
//     tags ['u', <this url>], ['method', 'DELETE'], ['nonce', <random>]; or
//   the owner's KIND 5 deletion request naming the project in its `a` tag, which
//     is what a server holding the signed event but not the key can pass on.
//
// The Nostr KIND 5 deletion event must be published from the client (we can't
// sign it here without the private key). This endpoint only:
//   1. Verifies the signer owns the project (or is a 100M admin)
//   2. Refuses if any donation has been recorded for this project
//   3. Removes the project row from SQLite so it disappears immediately
// ──────────────────────────────────────────────
router.delete('/projects/:id', (req, res) => {
  const db = getDb();
  const dTag = req.params.id;
  const nowSec = Math.floor(Date.now() / 1000);

  let signer: string;
  let deletionSignedAt: number | null = null;
  let action: ReturnType<typeof verifySignedAction> | null = null;

  if (req.body?.event?.kind === DELETION_KIND) {
    const signed = readSignedEvent(req.body.event, DELETION_KIND);
    if (isEventRefused(signed)) return res.status(signed.status).json({ error: signed.error });
    if (!deletionNames(signed.event, dTag)) {
      return res.status(401).json({ error: 'Event was signed for a different project' });
    }
    const age = nowSec - signed.event.created_at;
    if (age > DELETION_MAX_AGE_SECONDS || age < -MAX_FUTURE_SECONDS) {
      return res.status(401).json({ error: 'Event expired — check the device clock and retry' });
    }
    signer = signed.event.pubkey;
    deletionSignedAt = signed.event.created_at;
  } else {
    action = verifySignedAction(req.body?.event, {
      method: 'DELETE',
      action: LANACROWD_ACTION_DELETE,
      target: dTag,
    });
    if (isRefused(action)) return res.status(action.status).json({ error: action.error });
    signer = action.pubkey;
  }

  try {
    const project = db.prepare(
      'SELECT owner_pubkey, pubkey, is_hidden, nostr_created_at FROM lanacrowd_projects WHERE id = ?',
    ).get(dTag) as any;

    if (!project) return res.status(404).json({ error: 'Project not found' });

    const isOwner = project.owner_pubkey === signer || project.pubkey === signer;
    // A KIND 5 speaks for its author's own events only.
    const isAdmin = deletionSignedAt === null && getAdmins().includes(signer);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this project' });
    }

    // A project an admin hid stays an admin's to deal with: the indexer re-creates
    // a deleted row from the relays, and the new row is not hidden.
    if (project.is_hidden && !isAdmin) {
      return res.status(403).json({ error: 'This project was hidden by an administrator — only an administrator can delete it' });
    }

    // A deletion request covers what existed when it was signed, not a later version.
    if (deletionSignedAt !== null && deletionSignedAt < project.nostr_created_at) {
      return res.status(409).json({ error: 'The project has changed since this deletion was signed' });
    }

    // Block deletion if any donation has ever been recorded.
    const donationCheck = db.prepare(
      'SELECT COUNT(*) as cnt, COALESCE(SUM(amount_fiat), 0) as raised FROM lanacrowd_donations WHERE project_id = ?',
    ).get(dTag) as any;

    if (donationCheck && (donationCheck.cnt > 0 || donationCheck.raised > 0)) {
      return res.status(409).json({
        error: 'Project has donations and cannot be deleted',
        donationCount: donationCheck.cnt,
        totalRaised: donationCheck.raised,
      });
    }

    if (action && !isRefused(action)) {
      const spentDelete = consumeSignedAction(action);
      if (spentDelete) return res.status(spentDelete.status).json({ error: spentDelete.error });
    }

    const result = db.prepare('DELETE FROM lanacrowd_projects WHERE id = ?').run(dTag);
    if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });

    console.log(`🗑️ Deleted lanacrowd project ${dTag} by ${signer.slice(0, 16)}…`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ DELETE /api/lanacrowd/projects/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/lanacrowd/donations/record
// Called after successful KIND 60200 Nostr publish
// Body: { event: <the signed KIND 60200> }
// The donation is read from the event and stored under its event id, so sending
// the same event again changes nothing.
// ──────────────────────────────────────────────
router.post('/donations/record', (req, res) => {
  const db = getDb();
  const signed = readSignedEvent(req.body?.event, DONATION_KIND);
  if (isEventRefused(signed)) return res.status(signed.status).json({ error: signed.error });

  const d = donationFromEvent(signed.event);
  if (!d) return res.status(400).json({ error: 'Not a donation to a project' });

  try {
    db.prepare(`
      INSERT INTO lanacrowd_donations (
        id, project_id, supporter_pubkey, project_owner_pubkey,
        amount_lanoshis, amount_fiat, currency,
        from_wallet, to_wallet, tx_id, message,
        nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        message = COALESCE(lanacrowd_donations.message, excluded.message)
    `).run(
      d.id,
      d.projectId,
      d.supporterPubkey,
      d.projectOwnerPubkey,
      d.amountLanoshis,
      d.amountFiat,
      d.currency,
      d.fromWallet,
      d.toWallet,
      d.txId,
      d.message,
      d.nostrCreatedAt,
    );

    // Auto-update funded status for this project
    const fundRow = db.prepare(`
      SELECT p.fiat_goal, COALESCE(SUM(dn.amount_fiat), 0) AS total_raised
      FROM lanacrowd_projects p
      LEFT JOIN lanacrowd_donations dn ON dn.project_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `).get(d.projectId) as any;

    if (fundRow && fundRow.fiat_goal > 0) {
      const isFunded = fundRow.total_raised >= fundRow.fiat_goal * 0.99 ? 1 : 0;
      db.prepare(`UPDATE lanacrowd_projects SET is_funded = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(isFunded, d.projectId);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ POST /api/lanacrowd/donations/record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/lanacrowd/donations/:projectId
// ──────────────────────────────────────────────
router.get('/donations/:projectId', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM lanacrowd_donations
      WHERE project_id = ?
      ORDER BY nostr_created_at DESC
    `).all(req.params.projectId) as any[];

    const totalRaised = rows.reduce((sum, r) => sum + (r.amount_fiat || 0), 0);
    res.json({ donations: rows.map(donationRowToApi), totalRaised });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/donations/:projectId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/lanacrowd/my-projects/:pubkey
// ──────────────────────────────────────────────
router.get('/my-projects/:pubkey', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT p.*,
             COALESCE(d.total_raised, 0) AS total_raised,
             COALESCE(d.donation_count, 0) AS donation_count
      FROM lanacrowd_projects p
      LEFT JOIN (
        SELECT project_id,
               SUM(amount_fiat) AS total_raised,
               COUNT(*) AS donation_count
        FROM lanacrowd_donations
        GROUP BY project_id
      ) d ON p.id = d.project_id
      WHERE p.owner_pubkey = ? OR p.pubkey = ?
      ORDER BY p.nostr_created_at DESC
    `).all(req.params.pubkey, req.params.pubkey) as any[];

    res.json({ projects: rows.map(projectRowToApi) });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/my-projects/:pubkey error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/lanacrowd/my-donations/:pubkey
// ──────────────────────────────────────────────
router.get('/my-donations/:pubkey', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT d.*, p.title AS project_title, p.cover_image AS project_cover
      FROM lanacrowd_donations d
      LEFT JOIN lanacrowd_projects p ON p.id = d.project_id
      WHERE d.project_owner_pubkey = ?
      ORDER BY d.nostr_created_at DESC
    `).all(req.params.pubkey) as any[];

    res.json({
      donations: rows.map(r => ({
        ...donationRowToApi(r),
        projectTitle: r.project_title,
        projectCover: r.project_cover,
      }))
    });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/my-donations/:pubkey error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/lanacrowd/summary
// Aggregated totals for SummaryBar
// ──────────────────────────────────────────────
router.get('/summary', (req, res) => {
  const db = getDb();
  const filter = (req.query.filter as string) || 'open';

  // Summary always reflects what USERS see: approved + visible + non-draft only.
  // Admins see pending/hidden in the list for moderation, but those don't count
  // toward public statistics.
  const conditions: string[] = ["status != 'draft'"];
  if (filter === 'hidden') {
    // The Hidden tab's header reflects the hidden projects themselves.
    conditions.push('is_hidden = 1');
  } else {
    // Public totals: approved + visible only (hidden/pending never counted).
    conditions.push('is_hidden = 0', 'is_approved = 1');
  }
  switch (filter) {
    case 'open':      conditions.push('is_funded = 0', 'is_completed = 0'); break;
    case 'funded':    conditions.push('is_funded = 1', 'is_completed = 0'); break;
    case 'completed': conditions.push('is_completed = 1'); break;
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT p.id) AS total_projects,
        COALESCE(SUM(p.fiat_goal), 0) AS total_goal,
        COALESCE(SUM(d.total_raised), 0) AS total_raised
      FROM lanacrowd_projects p
      LEFT JOIN (
        SELECT project_id, SUM(amount_fiat) AS total_raised
        FROM lanacrowd_donations GROUP BY project_id
      ) d ON d.project_id = p.id
      ${where}
    `).get() as any;

    const totalGoal    = row?.total_goal ?? 0;
    const totalRaised  = row?.total_raised ?? 0;
    const remaining    = Math.max(totalGoal - totalRaised, 0);
    const percentFunded = totalGoal > 0 ? (totalRaised / totalGoal) * 100 : 0;

    res.json({
      totalProjects: row?.total_projects ?? 0,
      totalGoal,
      totalRaised,
      remaining,
      percentFunded,
    });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
