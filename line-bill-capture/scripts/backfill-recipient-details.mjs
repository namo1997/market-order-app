import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith('--')) return null;
  const next = all[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : '1'];
}).filter(Boolean));
const start = String(args.from || '2026-08-25').trim();
const end = String(args.to || '2026-08-31').trim();
const sourceId = String(args.source || '').trim();
const apply = args.apply === '1' || args.apply === 'true';

if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
  throw new Error('Usage: node scripts/backfill-recipient-details.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--source SOURCE_ID] [--apply]');
}

if (apply && !process.env.CAPTURE_DB_PATH && !process.env.CAPTURE_DATA_DIR) {
  throw new Error('RECIPIENT_BACKFILL_EXPLICIT_LOCAL_PATH_REQUIRED');
}

const sourceDataDir = path.resolve(process.env.CAPTURE_DATA_DIR || path.join(process.cwd(), 'data'));
const sourceDbPath = path.resolve(process.env.CAPTURE_DB_PATH || path.join(sourceDataDir, 'line-bill-capture.sqlite'));
let previewRoot = null;
if (!apply) {
  // initDatabase performs legacy repairs on startup. Preview against a SQLite
  // VACUUM copy so even those startup checks cannot touch the selected source.
  previewRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-recipient-preview-'));
  const previewDbPath = path.join(previewRoot, 'line-bill-capture.sqlite');
  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  try {
    sourceDb.exec(`VACUUM INTO '${previewDbPath.replaceAll("'", "''")}'`);
  } finally {
    sourceDb.close();
  }
  process.env.CAPTURE_DATA_DIR = previewRoot;
  process.env.CAPTURE_DB_PATH = previewDbPath;
}

// Dynamic import keeps CAPTURE_DATA_DIR/CAPTURE_DB_PATH explicit in the shell
// before db.js resolves its immutable local path.
const { getDbPath, backfillRecipientDetails } = await import('../src/db.js');
const dbPath = getDbPath();
let backupPath = null;
if (apply) {
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  backupPath = path.join(backupDir, `before-recipient-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  const backupDb = new DatabaseSync(dbPath);
  try {
    backupDb.exec(`PRAGMA wal_checkpoint(FULL); VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  } finally {
    backupDb.close();
  }
}

const result = await backfillRecipientDetails({ start, end, sourceId, apply });
console.log(JSON.stringify({ ...result, source_db_path: sourceDbPath, db_path: apply ? dbPath : sourceDbPath, backup_path: backupPath, mode: apply ? 'APPLY_LOCAL' : 'PREVIEW_LOCAL' }, null, 2));
if (!apply) console.log('Preview only: no capture_items or financial rows were changed. Add --apply only for the explicitly selected Local database.');
if (previewRoot) await fs.rm(previewRoot, { recursive: true, force: true });
