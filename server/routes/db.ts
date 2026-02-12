import { Router, Request, Response } from 'express';
import { getDb } from '../db/connection';

const router = Router();

// Allowed tables (whitelist for security)
const ALLOWED_TABLES = new Set([
  'admin_users', 'ai_knowledge', 'ai_unsupported_prompts', 'ai_usage_logs',
  'app_settings', 'bug_reports', 'direct_messages', 'dm_lashes', 'dm_last_seen',
  'dm_read_status', 'kind_38888', 'lash_users_history', 'nostr_profiles',
  'push_subscriptions', 'room_latest_posts', 'transaction_history', 'wallet_types'
]);

// Boolean columns that need integer conversion (SQLite stores booleans as 0/1)
const BOOLEAN_COLUMNS: Record<string, string[]> = {
  dm_read_status: ['is_read'],
  wallet_types: ['is_active'],
};

function validateTable(table: string): boolean {
  return ALLOWED_TABLES.has(table);
}

// Parse Supabase-style filters from query params
// e.g. ?nostr_hex_id=eq.abc123&is_active=eq.true&order=created_at.desc&limit=10
function buildWhereClause(query: Record<string, any>, table: string): { where: string; params: any[]; orderBy: string; limit: string; selectColumns: string } {
  const conditions: string[] = [];
  const params: any[] = [];
  let orderBy = '';
  let limit = '';
  let selectColumns = '*';

  const boolCols = BOOLEAN_COLUMNS[table] || [];

  for (const [key, rawValue] of Object.entries(query)) {
    const value = String(rawValue);

    // Skip non-filter params
    if (key === 'order' || key === 'limit' || key === 'offset' || key === 'select' || key === 'upsert' ||
        key === 'single' || key === 'maybeSingle' || key === 'count' ||
        key === 'onConflict' || key === 'ignoreDuplicates') continue;

    if (!value.includes('.')) continue;

    const dotIndex = value.indexOf('.');
    const operator = value.substring(0, dotIndex);
    let operand = value.substring(dotIndex + 1);

    // Convert boolean strings to integers for boolean columns
    if (boolCols.includes(key)) {
      if (operand === 'true') operand = '1';
      else if (operand === 'false') operand = '0';
    }

    switch (operator) {
      case 'eq':
        if (operand === 'null') {
          conditions.push(`"${key}" IS NULL`);
        } else {
          conditions.push(`"${key}" = ?`);
          params.push(operand);
        }
        break;
      case 'neq':
        conditions.push(`"${key}" != ?`);
        params.push(operand);
        break;
      case 'gt':
        conditions.push(`"${key}" > ?`);
        params.push(operand);
        break;
      case 'gte':
        conditions.push(`"${key}" >= ?`);
        params.push(operand);
        break;
      case 'lt':
        conditions.push(`"${key}" < ?`);
        params.push(operand);
        break;
      case 'lte':
        conditions.push(`"${key}" <= ?`);
        params.push(operand);
        break;
      case 'like':
        conditions.push(`"${key}" LIKE ?`);
        params.push(operand);
        break;
      case 'ilike':
        conditions.push(`"${key}" LIKE ? COLLATE NOCASE`);
        params.push(operand);
        break;
      case 'is':
        if (operand === 'null') {
          conditions.push(`"${key}" IS NULL`);
        } else if (operand === 'true') {
          conditions.push(`"${key}" = 1`);
        } else if (operand === 'false') {
          conditions.push(`"${key}" = 0`);
        }
        break;
      case 'in':
        // Format: in.(val1,val2,val3)
        const inValues = operand.replace(/^\(/, '').replace(/\)$/, '').split(',');
        const placeholders = inValues.map(() => '?').join(',');
        conditions.push(`"${key}" IN (${placeholders})`);
        params.push(...inValues);
        break;
      default:
        // Unknown operator, skip
        break;
    }
  }

  // Handle order
  if (query.order) {
    const orderParts = String(query.order).split(',').map(part => {
      const [col, dir] = part.split('.');
      return `"${col}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    });
    orderBy = ` ORDER BY ${orderParts.join(', ')}`;
  }

  // Handle limit and offset
  if (query.limit) {
    limit = ` LIMIT ${parseInt(query.limit, 10)}`;
    if (query.offset) {
      limit += ` OFFSET ${parseInt(query.offset, 10)}`;
    }
  }

  // Handle select
  if (query.select && query.select !== '*') {
    const cols = String(query.select).split(',').map(c => `"${c.trim()}"`).join(', ');
    selectColumns = cols;
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { where, params, orderBy, limit, selectColumns };
}

// Convert boolean integer values back to booleans for response
function convertBooleans(rows: any[], table: string): any[] {
  const boolCols = BOOLEAN_COLUMNS[table] || [];
  if (boolCols.length === 0) return rows;

  return rows.map(row => {
    const converted = { ...row };
    for (const col of boolCols) {
      if (col in converted) {
        converted[col] = converted[col] === 1;
      }
    }
    return converted;
  });
}

// Parse JSON columns back to objects
const JSON_COLUMNS: Record<string, string[]> = {
  app_settings: ['value'],
  bug_reports: ['images'],
  kind_38888: ['relays', 'electrum_servers', 'exchange_rates', 'trusted_signers', 'raw_event'],
  direct_messages: ['tags', 'raw_event'],
  nostr_profiles: ['raw_metadata'],
  ai_knowledge: ['keywords'],
};

function parseJsonColumns(rows: any[], table: string): any[] {
  const jsonCols = JSON_COLUMNS[table] || [];
  if (jsonCols.length === 0) return rows;

  return rows.map(row => {
    const parsed = { ...row };
    for (const col of jsonCols) {
      if (col in parsed && typeof parsed[col] === 'string') {
        try {
          parsed[col] = JSON.parse(parsed[col]);
        } catch {
          // Keep as string if not valid JSON
        }
      }
    }
    return parsed;
  });
}

function processRows(rows: any[], table: string): any[] {
  let result = convertBooleans(rows, table);
  result = parseJsonColumns(result, table);
  return result;
}

// GET /api/db/_schema/tables - List all tables with row counts and column info
router.get('/_schema/tables', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const tables = Array.from(ALLOWED_TABLES).sort().map(table => {
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as any;
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as any[];
      return {
        name: table,
        rowCount: countRow.count,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type,
          notnull: !!c.notnull,
          pk: !!c.pk,
          dflt_value: c.dflt_value,
        })),
      };
    });
    return res.json(tables);
  } catch (error: any) {
    console.error('Schema tables error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/db/:table - SELECT
router.get('/:table', (req: Request, res: Response) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ error: `Invalid table: ${table}` });
  }

  try {
    const db = getDb();
    const { where, params, orderBy, limit, selectColumns } = buildWhereClause(req.query as Record<string, any>, table);

    const sql = `SELECT ${selectColumns} FROM "${table}"${where}${orderBy}${limit}`;
    const rows = db.prepare(sql).all(...params);

    const processed = processRows(rows, table);

    // Handle single/maybeSingle
    if (req.query.single === 'true') {
      if (processed.length === 0) {
        return res.status(406).json({ error: 'No rows found', code: 'PGRST116' });
      }
      return res.json(processed[0]);
    }

    if (req.query.maybeSingle === 'true') {
      return res.json(processed.length > 0 ? processed[0] : null);
    }

    // Handle count
    if (req.query.count === 'true') {
      const countSql = `SELECT COUNT(*) as count FROM "${table}"${where}`;
      const countResult = db.prepare(countSql).get(...params) as any;
      return res.json({ data: processed, count: countResult.count });
    }

    return res.json(processed);
  } catch (error: any) {
    console.error(`DB GET error for ${table}:`, error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/db/:table - INSERT or UPSERT
router.post('/:table', (req: Request, res: Response) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ error: `Invalid table: ${table}` });
  }

  try {
    const db = getDb();
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const upsertColumn = req.query.upsert as string | undefined;
    const onConflict = req.query.onConflict as string | undefined;
    const ignoreDuplicates = req.query.ignoreDuplicates === 'true';
    const boolCols = BOOLEAN_COLUMNS[table] || [];
    const jsonCols = JSON_COLUMNS[table] || [];

    const results: any[] = [];

    const insertMany = db.transaction((items: any[]) => {
      for (const item of items) {
        // Convert booleans to integers
        for (const col of boolCols) {
          if (col in item) {
            item[col] = item[col] ? 1 : 0;
          }
        }
        // Stringify JSON columns
        for (const col of jsonCols) {
          if (col in item && typeof item[col] !== 'string') {
            item[col] = JSON.stringify(item[col]);
          }
        }

        const columns = Object.keys(item);
        const values = Object.values(item);
        const placeholders = columns.map(() => '?').join(', ');
        const colList = columns.map(c => `"${c}"`).join(', ');

        let sql: string;
        // upsert=true is a boolean flag, not a column name — use onConflict for the actual conflict columns
        const conflictCol = (upsertColumn && upsertColumn !== 'true') ? upsertColumn : onConflict;

        if (conflictCol) {
          // UPSERT
          const updateParts = columns
            .filter(c => c !== conflictCol && c !== 'id')
            .map(c => `"${c}" = excluded."${c}"`);

          if (ignoreDuplicates) {
            sql = `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`;
          } else {
            sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})
                   ON CONFLICT(${conflictCol.split(',').map(c => `"${c.trim()}"`).join(',')})
                   DO UPDATE SET ${updateParts.join(', ')}, "updated_at" = datetime('now')`;
          }
        } else {
          sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;
        }

        try {
          const result = db.prepare(sql).run(...values);
          results.push({ ...item, _changes: result.changes });
        } catch (insertError: any) {
          // If UNIQUE constraint violation on non-upsert, skip or throw
          if (insertError.message.includes('UNIQUE constraint') && ignoreDuplicates) {
            // Skip
          } else {
            throw insertError;
          }
        }
      }
    });

    insertMany(rows);

    // Emit SSE event if dm_read_status was modified
    if (table === 'dm_read_status') {
      const { emitDmReadStatusUpdate } = require('./sse');
      for (const row of rows) {
        emitDmReadStatusUpdate(row);
      }
    }

    return res.status(201).json(results.length === 1 ? results[0] : results);
  } catch (error: any) {
    console.error(`DB POST error for ${table}:`, error);
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/db/:table - UPDATE
router.patch('/:table', (req: Request, res: Response) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ error: `Invalid table: ${table}` });
  }

  try {
    const db = getDb();
    const updates = req.body;
    const boolCols = BOOLEAN_COLUMNS[table] || [];
    const jsonCols = JSON_COLUMNS[table] || [];

    // Convert booleans and JSON
    for (const col of boolCols) {
      if (col in updates) {
        updates[col] = updates[col] ? 1 : 0;
      }
    }
    for (const col of jsonCols) {
      if (col in updates && typeof updates[col] !== 'string') {
        updates[col] = JSON.stringify(updates[col]);
      }
    }

    const { where, params: whereParams } = buildWhereClause(req.query as Record<string, any>, table);

    if (!where) {
      return res.status(400).json({ error: 'UPDATE requires at least one filter' });
    }

    const setParts = Object.keys(updates).map(col => `"${col}" = ?`);
    // Auto-update updated_at if the table has it
    setParts.push(`"updated_at" = datetime('now')`);
    const setValues = Object.values(updates);

    const sql = `UPDATE "${table}" SET ${setParts.join(', ')}${where}`;
    const result = db.prepare(sql).run(...setValues, ...whereParams);

    // Emit SSE event if dm_read_status was modified
    if (table === 'dm_read_status') {
      const { emitDmReadStatusUpdate } = require('./sse');
      emitDmReadStatusUpdate({ ...updates, ...req.query });
    }

    return res.json({ changes: result.changes });
  } catch (error: any) {
    console.error(`DB PATCH error for ${table}:`, error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/db/:table - DELETE
router.delete('/:table', (req: Request, res: Response) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ error: `Invalid table: ${table}` });
  }

  try {
    const db = getDb();
    const { where, params } = buildWhereClause(req.query as Record<string, any>, table);

    if (!where) {
      return res.status(400).json({ error: 'DELETE requires at least one filter' });
    }

    const sql = `DELETE FROM "${table}"${where}`;
    const result = db.prepare(sql).run(...params);

    return res.json({ changes: result.changes });
  } catch (error: any) {
    console.error(`DB DELETE error for ${table}:`, error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
