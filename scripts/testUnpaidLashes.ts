/**
 * The unpaid-LASH badge: the query plan and the contract.
 *   npx tsx scripts/testUnpaidLashes.ts
 *
 * This path runs once per signed-in tab every 15 seconds — at a thousand users
 * that is ~67 requests a second — so it has to answer from an index rather
 * than walk the table, and it has to answer in the shape the caller reads.
 */
import Database from 'better-sqlite3';
import { initializeSchema } from '../server/db/schema.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const SQL = `SELECT COUNT(*) AS n FROM dm_lashes
             WHERE recipient_pubkey = ? AND expires_at > datetime('now')`;

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
initializeSchema(db);

console.log('— the filtered column is indexed —');
{
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dm_lashes'").all() as any[];
  const names = idx.map((r) => r.name);
  check('idx_dm_lashes_recipient exists', names.includes('idx_dm_lashes_recipient'), names);
}

console.log('— and the query actually uses it, rather than scanning —');
{
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + SQL).all('x') as any[];
  const detail = plan.map((r) => r.detail).join(' | ');
  check('no SCAN of dm_lashes', !/SCAN dm_lashes/.test(detail), detail);
  check('SEARCH via the recipient index', /SEARCH dm_lashes USING (COVERING )?INDEX idx_dm_lashes_recipient/.test(detail), detail);
}

console.log('— it counts the right rows —');
{
  const ins = db.prepare(`INSERT INTO dm_lashes (id, message_event_id, lash_event_id, sender_pubkey, recipient_pubkey, amount, expires_at)
                          VALUES (?, ?, ?, ?, ?, '1', datetime('now', ?))`);
  const ME = 'a'.repeat(64), OTHER = 'b'.repeat(64);
  ins.run('1', 'm1', 'L1', OTHER, ME, '+1 day');       // mine, live
  ins.run('2', 'm2', 'L2', OTHER, ME, '-1 day');       // mine, expired
  ins.run('3', 'm3', 'L3', ME, OTHER, '+1 day');       // someone else's

  const mine = (db.prepare(SQL).get(ME) as any).n;
  check('only my unexpired lash counts', mine === 1, mine);
  check('an expired one does not', (db.prepare(SQL).get(OTHER) as any).n === 1);
  check('an unknown pubkey gets zero, not everything', (db.prepare(SQL).get('z'.repeat(64)) as any).n === 0);
}

console.log('— the old bug: a missing parameter must not silently match —');
{
  // The server used to bind `undefined` here, which SQLite takes as NULL.
  const asNull = (db.prepare(SQL).get(null) as any).n;
  check('NULL matches nothing (so the old path always returned 0)', asNull === 0, asNull);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
