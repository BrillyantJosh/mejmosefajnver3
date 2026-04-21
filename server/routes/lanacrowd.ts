/**
 * LanaCrowd (100millionideas) — server-authoritative REST API
 *
 * All reads come from SQLite (fast, consistent, paginated).
 * Writes: client publishes to Nostr first, then calls upsert/record here
 * so the project is immediately visible — no waiting for relay propagation.
 * Background indexer (heartbeat) acts as safety net.
 */

import { Router } from 'express';
import { getDb } from '../db/connection.js';

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
  const isAdmin = adminPubkey && getAdmins().includes(adminPubkey);
  const offset = (page - 1) * limit;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: any[] = [];

  // Non-admins can't see hidden projects
  if (!isAdmin) {
    conditions.push('is_hidden = 0');
    conditions.push("status != 'draft'");
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
      ORDER BY p.nostr_created_at DESC
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
// ──────────────────────────────────────────────
router.post('/projects/upsert', (req, res) => {
  const db = getDb();
  const p = req.body?.project;
  if (!p || !p.id || !p.title) {
    return res.status(400).json({ error: 'Missing required project fields' });
  }

  try {
    // Preserve existing admin overrides — only upsert content fields
    const existing = db.prepare('SELECT is_hidden, is_approved, is_funded, is_completed, completion_comment FROM lanacrowd_projects WHERE id = ?').get(p.id) as any;

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
      p.eventId || null,
      p.pubkey || '',
      p.ownerPubkey || p.pubkey || '',
      p.title,
      p.shortDesc || '',
      p.content || '',
      parseFloat(p.fiatGoal) || 0,
      p.currency || 'EUR',
      p.wallet || '',
      p.responsibilityStatement || '',
      p.projectType || 'Inspiration',
      p.whatType || null,
      p.status || 'active',
      p.coverImage || null,
      JSON.stringify(p.galleryImages || []),
      JSON.stringify(p.videos || []),
      JSON.stringify(p.files || []),
      JSON.stringify(p.participants || []),
      existing ? existing.is_hidden : 0,
      existing ? existing.is_approved : 1,
      existing ? existing.is_funded : 0,
      existing ? existing.is_completed : 0,
      existing ? existing.completion_comment : null,
      p.nostrCreatedAt || Math.floor(Date.now() / 1000),
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
// ──────────────────────────────────────────────
router.patch('/projects/:id/admin', (req, res) => {
  const db = getDb();
  const { adminPubkey, is_hidden, is_approved, is_funded, is_completed, completion_comment } = req.body;

  if (!adminPubkey || !getAdmins().includes(adminPubkey)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    // Only update provided fields
    const sets: string[] = [];
    const vals: any[] = [];

    if (is_hidden !== undefined) { sets.push('is_hidden = ?'); vals.push(is_hidden ? 1 : 0); }
    if (is_approved !== undefined) { sets.push('is_approved = ?'); vals.push(is_approved ? 1 : 0); }
    if (is_funded !== undefined) { sets.push('is_funded = ?'); vals.push(is_funded ? 1 : 0); }
    if (is_completed !== undefined) { sets.push('is_completed = ?'); vals.push(is_completed ? 1 : 0); }
    if (completion_comment !== undefined) { sets.push('completion_comment = ?'); vals.push(completion_comment || null); }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

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
// POST /api/lanacrowd/donations/record
// Called after successful KIND 60200 Nostr publish
// ──────────────────────────────────────────────
router.post('/donations/record', (req, res) => {
  const db = getDb();
  const d = req.body?.donation;
  if (!d || !d.id || !d.projectId) {
    return res.status(400).json({ error: 'Missing required donation fields' });
  }

  try {
    db.prepare(`
      INSERT OR IGNORE INTO lanacrowd_donations (
        id, project_id, supporter_pubkey, project_owner_pubkey,
        amount_lanoshis, amount_fiat, currency,
        from_wallet, to_wallet, tx_id,
        nostr_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.id,
      d.projectId,
      d.supporterPubkey || '',
      d.projectOwnerPubkey || '',
      d.amountLanoshis || 0,
      parseFloat(d.amountFiat) || 0,
      d.currency || 'EUR',
      d.fromWallet || '',
      d.toWallet || '',
      d.txId || null,
      d.nostrCreatedAt || Math.floor(Date.now() / 1000),
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
  try {
    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT p.id) AS total_projects,
        COALESCE(SUM(d.amount_fiat), 0) AS total_raised
      FROM lanacrowd_projects p
      LEFT JOIN lanacrowd_donations d ON d.project_id = p.id
      WHERE p.is_hidden = 0 AND p.status != 'draft'
    `).get() as any;

    const perProject = db.prepare(`
      SELECT project_id, SUM(amount_fiat) AS total_raised
      FROM lanacrowd_donations
      GROUP BY project_id
    `).all() as any[];

    res.json({
      totalProjects: row?.total_projects ?? 0,
      totalRaised: row?.total_raised ?? 0,
      perProject: Object.fromEntries(perProject.map(r => [r.project_id, r.total_raised])),
    });
  } catch (err: any) {
    console.error('❌ GET /api/lanacrowd/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
