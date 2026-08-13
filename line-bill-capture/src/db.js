import fs from 'fs/promises';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_DIR = path.resolve(process.env.CAPTURE_DATA_DIR || DEFAULT_DATA_DIR);
const DB_PATH = process.env.CAPTURE_DB_PATH
  ? path.resolve(process.env.CAPTURE_DB_PATH)
  : path.join(DATA_DIR, 'line-bill-capture.sqlite');

let db = null;
let writeQueue = Promise.resolve();

const bindingsFor = (params) => {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
};

// Preserve the small sql.js statement contract used below while relying on
// Node's native, file-backed SQLite implementation.
class NativeStatement {
  constructor(statement, params) {
    this.statement = statement;
    this.params = bindingsFor(params);
    this.iterator = null;
    this.current = null;
  }

  bind(params) {
    this.iterator?.return?.();
    this.params = bindingsFor(params);
    this.iterator = null;
    this.current = null;
  }

  step() {
    if (!this.iterator) this.iterator = this.statement.iterate(...this.params);
    const next = this.iterator.next();
    this.current = next.done ? null : next.value;
    return !next.done;
  }

  getAsObject() {
    return this.current || {};
  }

  free() {
    this.iterator?.return?.();
    this.iterator = null;
    this.current = null;
  }
}

class NativeDatabase {
  constructor(filename) {
    this.raw = new DatabaseSync(filename);
    this.lastChanges = 0;
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }

  prepare(sql, params) {
    return new NativeStatement(this.raw.prepare(sql), params);
  }

  run(sql, params) {
    if (params === undefined) {
      this.raw.exec(sql);
      this.lastChanges = Number(this.raw.prepare('SELECT changes() AS changes').get()?.changes || 0);
      return;
    }

    const result = this.raw.prepare(sql).run(...bindingsFor(params));
    this.lastChanges = Number(result.changes || 0);
  }

  getRowsModified() {
    return this.lastChanges;
  }
}

export const getDataDir = () => DATA_DIR;
export const getDbPath = () => DB_PATH;
export const getImagesDir = () => path.join(DATA_DIR, 'images');

const nowIso = () => new Date().toISOString();
const normalizeJson = (value) => JSON.stringify(value ?? null);
const parseStoredJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value || '')) ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeIdentityText = (value) => String(value || '')
  .normalize('NFKC')
  .toUpperCase()
  .replace(/[\s.,:;#()\[\]{}\\/_-]+/g, '')
  .trim();

const normalizeTaxId = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 13 ? digits : null;
};

const extractTaxId = (value) => {
  const text = String(value || '');
  const labeled = text.match(/(?:เลขประจำตัวผู้เสียภาษี|เลขผู้เสียภาษี|TAX\s*ID|TAXID)[^\d]{0,24}([\d\s-]{13,20})/i);
  const candidate = labeled?.[1] || text.match(/\b\d[\d\s-]{11,20}\d\b/)?.[0] || '';
  return normalizeTaxId(candidate);
};

const getFirstRow = (statement) => {
  if (!statement.step()) return null;
  return statement.getAsObject();
};

const allRows = (statement) => {
  const rows = [];
  while (statement.step()) {
    rows.push(statement.getAsObject());
  }
  return rows;
};

const tableColumns = (database, table) => {
  const statement = database.prepare(`PRAGMA table_info(${table})`);
  try {
    return new Set(allRows(statement).map((row) => row.name));
  } finally {
    statement.free();
  }
};

const addColumnIfMissing = (database, table, column, definition) => {
  const columns = tableColumns(database, table);
  if (columns.has(column)) return;
  database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

const ensureSchema = () => {
  db.run(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS line_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      text_count INTEGER NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS line_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_event_id TEXT UNIQUE,
      event_type TEXT,
      message_type TEXT,
      source_type TEXT,
      source_id TEXT,
      sender_user_id TEXT,
      line_message_id TEXT,
      event_timestamp_ms INTEGER,
      raw_event_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_group_validation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_event_id TEXT UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      requested_by_user_id TEXT,
      command_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      error_message TEXT,
      checked_at TEXT,
      replied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_event_id TEXT,
      line_message_id TEXT UNIQUE,
      message_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      sender_user_id TEXT,
      text TEXT,
      content_ref TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      event_timestamp_ms INTEGER,
      raw_event_json TEXT NOT NULL,
      unsent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      picture_url TEXT,
      status_message TEXT,
      profile_status TEXT NOT NULL DEFAULT 'unknown',
      last_fetched_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_type, source_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS capture_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_event_id TEXT UNIQUE,
      line_message_id TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      sender_user_id TEXT,
      category TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'received',
      content_type TEXT,
      file_extension TEXT,
      file_size_bytes INTEGER,
      file_sha256 TEXT,
      storage_path TEXT,
      storage_relative_path TEXT,
      duplicate_of_item_id INTEGER,
      download_error TEXT,
      vendor_name TEXT,
      vendor_tax_id TEXT,
      supplier_name TEXT,
      bill_total_text TEXT,
      bill_total_value REAL,
      announced_amount REAL,
      bill_total_edited_at TEXT,
      bill_total_edited_by TEXT,
      slip_amount_text TEXT,
      slip_amount_value REAL,
      slip_amount_confidence REAL,
      payment_role TEXT,
      reimbursement_related_item_id INTEGER,
      reimbursement_status TEXT NOT NULL DEFAULT 'unmatched',
      reimbursement_reason_json TEXT,
      reimbursement_evidence_mode TEXT,
      reimbursement_review_note TEXT,
      reimbursement_reviewed_at TEXT,
      reimbursement_reviewed_by TEXT,
      ai_status TEXT NOT NULL DEFAULT 'pending',
      ai_provider TEXT,
      ai_model TEXT,
      ai_confidence REAL,
      ai_category_confidence REAL,
      ai_raw_text TEXT,
      ai_summary TEXT,
      ai_result_json TEXT,
      ai_error TEXT,
      ai_processed_at TEXT,
      ai_attempt_count INTEGER NOT NULL DEFAULT 0,
      ai_input_tokens INTEGER,
      ai_cached_input_tokens INTEGER,
      ai_output_tokens INTEGER,
      ai_reasoning_tokens INTEGER,
      ai_total_tokens INTEGER,
      matched_item_id INTEGER,
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      generated_document_type TEXT,
      generated_document_json TEXT,
      generated_from_item_id INTEGER,
      notes TEXT,
      category_edit_reason TEXT,
      raw_event_json TEXT NOT NULL,
      event_timestamp_ms INTEGER,
      downloaded_at TEXT,
      unsent_at TEXT,
      flag_resolved_at TEXT,
      flag_resolved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capture_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_item_id INTEGER NOT NULL,
      slip_item_id INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reason_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      review_note TEXT,
      ai_learning_approved INTEGER NOT NULL DEFAULT 0,
      reviewed_by TEXT,
      reviewed_at TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bill_item_id, slip_item_id)
    );

    CREATE TABLE IF NOT EXISTS ai_learning_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL UNIQUE,
      outcome TEXT NOT NULL,
      review_note TEXT NOT NULL,
      example_json TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_transfer_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT,
      error_message TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capture_daily_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_date TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'group',
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'closed',
      summary_json TEXT,
      closed_by TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_date, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_line_events_source_created
      ON line_events(source_type, source_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_line_group_validation_requests_status
      ON line_group_validation_requests(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_line_messages_source_timestamp
      ON line_messages(source_type, source_id, event_timestamp_ms);
    CREATE INDEX IF NOT EXISTS idx_line_messages_type_status
      ON line_messages(message_type, status);
    CREATE INDEX IF NOT EXISTS idx_line_senders_source
      ON line_senders(source_type, source_id, display_name);
    CREATE INDEX IF NOT EXISTS idx_capture_items_source_created
      ON capture_items(source_type, source_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_capture_items_status_category
      ON capture_items(status, category);
    CREATE INDEX IF NOT EXISTS idx_capture_items_match_status
      ON capture_items(match_status, matched_item_id);
  `);

  addColumnIfMissing(db, 'line_groups', 'message_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'line_groups', 'text_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_items', 'vendor_name', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'vendor_tax_id', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'supplier_name', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'bill_total_text', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'bill_total_value', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'announced_amount', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'bill_total_edited_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'bill_total_edited_by', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'category_edited_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'category_edited_by', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'category_edit_reason', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'slip_amount_text', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'slip_amount_value', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'slip_amount_confidence', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'payment_role', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_related_item_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_status', "TEXT NOT NULL DEFAULT 'unmatched'");
  addColumnIfMissing(db, 'capture_items', 'reimbursement_reason_json', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_evidence_mode', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_review_note', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_reviewed_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'reimbursement_reviewed_by', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_status', "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing(db, 'capture_items', 'ai_provider', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_model', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_confidence', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'ai_category_confidence', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'ai_raw_text', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_summary', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_result_json', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_error', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_processed_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_attempt_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_items', 'ai_input_tokens', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'ai_cached_input_tokens', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'ai_output_tokens', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'ai_reasoning_tokens', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'ai_total_tokens', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'matched_item_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'match_status', "TEXT NOT NULL DEFAULT 'unmatched'");
  addColumnIfMissing(db, 'capture_items', 'duplicate_of_item_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'notes', 'TEXT');
  // Set when the AI finds the typed amount and the amount on the document
  // disagree; such pairs are never auto-confirmed and wait for a human review.
  addColumnIfMissing(db, 'capture_items', 'amount_review_flag', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_items', 'flag_resolved_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'flag_resolved_by', 'TEXT');
  // What the bill is for, as announced in the LINE chat (e.g. "ค่าเนื้อ", "ค่าผัก").
  addColumnIfMissing(db, 'capture_items', 'bill_purpose', 'TEXT');
  // Multi-page invoices: doc_ref (tax invoice no) is identical on every page and groups them.
  addColumnIfMissing(db, 'capture_items', 'doc_ref', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'page_no', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'page_count', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'generated_document_type', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'generated_document_json', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'generated_from_item_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_matches', 'review_note', 'TEXT');
  addColumnIfMissing(db, 'capture_matches', 'ai_learning_approved', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_matches', 'reviewed_by', 'TEXT');
  addColumnIfMissing(db, 'capture_matches', 'reviewed_at', 'TEXT');
  // One transaction may contain several bills and/or several transfer slips.
  // Rows sharing this key are presented and reviewed as one aggregate match.
  addColumnIfMissing(db, 'capture_matches', 'match_group_key', 'TEXT');
  addColumnIfMissing(db, 'capture_daily_closings', 'reopened_at', 'TEXT');
  addColumnIfMissing(db, 'capture_daily_closings', 'reopened_reason', 'TEXT');
};

export const initDatabase = async () => {
  if (db) return db;

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(getImagesDir(), { recursive: true });
  db = new NativeDatabase(DB_PATH);

  ensureSchema();
  return db;
};

const runWrite = async (operation) => {
  const previous = writeQueue;
  let release;
  writeQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    await initDatabase();
    return operation(db);
  } finally {
    release();
  }
};

const runRead = async (operation) => {
  await writeQueue;
  await initDatabase();
  return operation(db);
};

const toLineSource = (source = {}) => {
  const sourceType = String(source?.type || '').trim().toLowerCase();
  const sourceId = String(source?.groupId || source?.roomId || '').trim();
  if (!['group', 'room'].includes(sourceType) || !sourceId) return null;
  return {
    sourceType,
    sourceId,
    sourceKey: `${sourceType}:${sourceId}`,
    senderUserId: String(source?.userId || '').trim() || null
  };
};

const rowsModified = (database) => {
  try {
    return Number(database.getRowsModified?.() || 0);
  } catch {
    return 0;
  }
};

const textForMessage = (message = {}) => {
  if (message.type === 'text') return String(message.text || '');
  if (message.type === 'sticker') return `[sticker:${message.packageId || ''}/${message.stickerId || ''}]`;
  if (message.type === 'image') return '[image]';
  if (message.type === 'file') return String(message.fileName || '[file]');
  return '';
};

export const recordLineEvent = async (event) => {
  const source = toLineSource(event?.source || {});
  if (!source) return null;

  return runWrite((database) => {
    const seenAt = nowIso();
    const messageType = String(event?.message?.type || '').trim() || null;
    const lineMessageId = String(event?.message?.id || event?.unsend?.messageId || '').trim() || null;
    const webhookEventId = String(event?.webhookEventId || '').trim() || null;

    database.run(
      `INSERT OR IGNORE INTO line_events
        (
          webhook_event_id,
          event_type,
          message_type,
          source_type,
          source_id,
          sender_user_id,
          line_message_id,
          event_timestamp_ms,
          raw_event_json,
          created_at
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        webhookEventId,
        String(event?.type || '').trim() || null,
        messageType,
        source.sourceType,
        source.sourceId,
        source.senderUserId,
        lineMessageId,
        Number(event?.timestamp || 0) || null,
        normalizeJson(event),
        seenAt
      ]
    );
    const eventInserted = rowsModified(database) > 0;

    if (eventInserted) {
      database.run(
        `INSERT INTO line_groups
          (source_type, source_id, source_key, first_seen_at, last_seen_at, event_count, message_count, text_count, image_count)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(source_key) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           event_count = event_count + 1,
           message_count = message_count + excluded.message_count,
           text_count = text_count + excluded.text_count,
           image_count = image_count + excluded.image_count`,
        [
          source.sourceType,
          source.sourceId,
          source.sourceKey,
          seenAt,
          seenAt,
          event?.type === 'message' ? 1 : 0,
          event?.type === 'message' && messageType === 'text' ? 1 : 0,
          event?.type === 'message' && messageType === 'image' ? 1 : 0
        ]
      );
    }

    if (event?.type === 'message' && lineMessageId && eventInserted) {
      database.run(
        `INSERT OR IGNORE INTO line_messages
          (
            webhook_event_id,
            line_message_id,
            message_type,
            source_type,
            source_id,
            sender_user_id,
            text,
            content_ref,
            status,
            event_timestamp_ms,
            raw_event_json,
            created_at,
            updated_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        [
          webhookEventId,
          lineMessageId,
          messageType || 'unknown',
          source.sourceType,
          source.sourceId,
          source.senderUserId,
          textForMessage(event.message),
          messageType === 'image' ? lineMessageId : null,
          Number(event?.timestamp || 0) || null,
          normalizeJson(event),
          seenAt,
          seenAt
        ]
      );
    }

    return source;
  });
};

export const recordGroupValidationRequest = async ({
  webhookEventId,
  sourceType,
  sourceId,
  requestedByUserId,
  commandText
} = {}) =>
  runWrite((database) => {
    const eventId = String(webhookEventId || '').trim() || null;
    const type = String(sourceType || '').trim();
    const source = String(sourceId || '').trim();
    const command = String(commandText || '').trim();
    if (!type || !source || command !== 'ตรวจบิล') return null;

    const now = nowIso();
    database.run(
      `INSERT OR IGNORE INTO line_group_validation_requests
        (webhook_event_id, source_type, source_id, requested_by_user_id, command_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [eventId, type, source, String(requestedByUserId || '').trim() || null, command, now, now]
    );
    const statement = database.prepare(
      `SELECT * FROM line_group_validation_requests
       WHERE (webhook_event_id = ? AND ? IS NOT NULL)
          OR (source_type = ? AND source_id = ? AND command_text = ? AND created_at = ?)
       ORDER BY id DESC LIMIT 1`,
      [eventId, eventId, type, source, command, now]
    );
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

export const claimPendingGroupValidationRequests = async ({ limit = 20, staleMs = 60 * 1000 } = {}) =>
  runWrite((database) => {
    const staleBefore = new Date(Date.now() - Math.max(10 * 1000, Number(staleMs || 0))).toISOString();
    const statement = database.prepare(
      `SELECT * FROM line_group_validation_requests
       WHERE status = 'pending'
          OR (status = 'checking' AND updated_at < ?)
       ORDER BY id ASC
       LIMIT ?`,
      [staleBefore, Math.max(1, Math.min(100, Number(limit || 20)))]
    );
    const rows = allRows(statement);
    statement.free();
    const now = nowIso();
    for (const row of rows) {
      database.run(
        `UPDATE line_group_validation_requests
         SET status = 'checking', error_message = NULL, updated_at = ?
         WHERE id = ?`,
        [now, Number(row.id)]
      );
    }
    return rows;
  });

export const finishGroupValidationRequest = async ({ id, status, result, errorMessage } = {}) =>
  runWrite((database) => {
    const nextStatus = ['pending', 'checking', 'replied', 'mismatch'].includes(String(status || '').trim())
      ? String(status).trim()
      : 'pending';
    const now = nowIso();
    const repliedAt = nextStatus === 'replied' ? now : null;
    database.run(
      `UPDATE line_group_validation_requests
       SET status = ?, result_json = ?, error_message = ?, checked_at = ?, replied_at = COALESCE(?, replied_at), updated_at = ?
       WHERE id = ?`,
      [nextStatus, normalizeJson(result || null), String(errorMessage || '').slice(0, 5000) || null, now, repliedAt, now, Number(id || 0)]
    );
    const statement = database.prepare(
      `SELECT * FROM line_group_validation_requests WHERE id = ? LIMIT 1`,
      [Number(id || 0)]
    );
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

const getItemByMessageIdSync = (database, lineMessageId) => {
  const statement = database.prepare(
    `SELECT * FROM capture_items WHERE line_message_id = ? LIMIT 1`,
    [lineMessageId]
  );
  try {
    return getFirstRow(statement);
  } finally {
    statement.free();
  }
};

const getItemByIdSync = (database, id) => {
  const statement = database.prepare(
    `SELECT * FROM capture_items WHERE id = ? LIMIT 1`,
    [Number(id || 0)]
  );
  try {
    return getFirstRow(statement);
  } finally {
    statement.free();
  }
};

const findSemanticDuplicateBillSync = (database, input = {}) => {
  const id = input.id;
  const sourceId = input.sourceId ?? input.source_id;
  const docRef = input.docRef ?? input.doc_ref;
  const billTotalValue = input.billTotalValue ?? input.bill_total_value;
  const vendorName = input.vendorName ?? input.vendor_name;
  const vendorTaxId = input.vendorTaxId ?? input.vendor_tax_id;
  const rawText = input.rawText ?? input.ai_raw_text;
  const normalizedDocRef = normalizeIdentityText(docRef);
  const amount = Number(billTotalValue);
  if (!sourceId || !normalizedDocRef || !Number.isFinite(amount) || amount <= 0) return null;

  const statement = database.prepare(
    `SELECT *
     FROM capture_items
     WHERE id < ?
       AND source_id = ?
       AND category = 'bill'
       AND status NOT IN ('unsent', 'duplicate')
     ORDER BY id ASC`,
    [Number(id || 0), sourceId]
  );
  try {
    const currentTaxId = normalizeTaxId(vendorTaxId) || extractTaxId(rawText);
    const currentVendor = normalizeIdentityText(vendorName);
    for (const candidate of allRows(statement)) {
      if (normalizeIdentityText(candidate.doc_ref) !== normalizedDocRef) continue;
      if (Math.abs(Number(candidate.bill_total_value) - amount) > 0.01) continue;
      const candidateTaxId = normalizeTaxId(candidate.vendor_tax_id) || extractTaxId(candidate.ai_raw_text);
      const candidateVendor = normalizeIdentityText(candidate.vendor_name);
      if (currentTaxId && candidateTaxId && currentTaxId === candidateTaxId) {
        return { item: candidate, reason: 'เลขที่บิล ยอด และเลขผู้เสียภาษีตรงกับบิลเดิม' };
      }
      if (currentVendor && candidateVendor && currentVendor === candidateVendor) {
        return { item: candidate, reason: 'เลขที่บิล ยอด และชื่อผู้ขายตรงกับบิลเดิม' };
      }
      if (!currentTaxId && !candidateTaxId && !currentVendor && !candidateVendor) {
        return { item: candidate, reason: 'เลขที่บิลและยอดตรงกับบิลเดิมในกลุ่มเดียวกัน' };
      }
    }
    return null;
  } finally {
    statement.free();
  }
};

const markBillSemanticDuplicateSync = (database, itemId, duplicateOfItemId, reason) => {
  const now = nowIso();
  const matchesStmt = database.prepare(
    `SELECT slip_item_id
     FROM capture_matches
     WHERE bill_item_id = ?
       AND status IN ('pending', 'confirmed', 'manual_review')`,
    [Number(itemId || 0)]
  );
  let slipIds = [];
  try {
    slipIds = allRows(matchesStmt).map((row) => Number(row.slip_item_id || 0)).filter(Boolean);
  } finally {
    matchesStmt.free();
  }

  if (slipIds.length) {
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected',
           reason_json = ?,
           confirmed_at = NULL,
           updated_at = ?
       WHERE bill_item_id = ?
         AND status IN ('pending', 'confirmed', 'manual_review')`,
      [normalizeJson(['เอกสารซ้ำกับบิลเดิม ไม่ใช้จับคู่โอนซ้ำ', `duplicate_of ${duplicateOfItemId}`]), now, Number(itemId || 0)]
    );
    for (const slipId of slipIds) {
      database.run(
        `UPDATE capture_items
         SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
         WHERE id = ? AND matched_item_id = ?`,
        [now, slipId, Number(itemId || 0)]
      );
    }
  }

  database.run(
    `UPDATE capture_items
     SET status = 'duplicate',
         duplicate_of_item_id = ?,
         matched_item_id = NULL,
         match_status = 'unmatched',
         notes = ?,
         updated_at = ?
     WHERE id = ?`,
    [Number(duplicateOfItemId || 0), String(reason || 'พบเอกสารซ้ำ'), now, Number(itemId || 0)]
  );
};

export const markSemanticDuplicateBills = async () =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT *
       FROM capture_items
       WHERE status <> 'unsent'
         AND ai_status = 'done'
         AND category = 'bill'
         AND doc_ref IS NOT NULL
         AND bill_total_value IS NOT NULL
       ORDER BY id ASC`
    );
    let items = [];
    try {
      items = allRows(statement);
    } finally {
      statement.free();
    }

    // Keep the earliest received bill as canonical if an older migration ever
    // pointed it at a newer duplicate.
    for (const item of items) {
      if (item.status !== 'duplicate' || Number(item.duplicate_of_item_id || 0) <= Number(item.id || 0)) continue;
      database.run(
        `UPDATE capture_items
         SET status = 'downloaded', duplicate_of_item_id = NULL,
             matched_item_id = NULL, match_status = 'unmatched', notes = NULL, updated_at = ?
         WHERE id = ?`,
        [nowIso(), Number(item.id || 0)]
      );
      item.status = 'downloaded';
      item.duplicate_of_item_id = null;
      item.matched_item_id = null;
      item.match_status = 'unmatched';
      item.notes = null;
    }

    const duplicates = [];
    for (const item of items) {
      const duplicate = findSemanticDuplicateBillSync(database, item);
      if (!duplicate) continue;
      if (item.status === 'duplicate' && Number(item.duplicate_of_item_id || 0) === Number(duplicate.item.id || 0)) continue;
      markBillSemanticDuplicateSync(database, item.id, duplicate.item.id, duplicate.reason);
      duplicates.push({ item_id: item.id, duplicate_of_item_id: duplicate.item.id, reason: duplicate.reason });
    }
    return duplicates;
  });

export const getItemById = async (id) =>
  runRead((database) => {
    return getItemByIdSync(database, id);
  });

export const upsertReceivedImage = async ({ event, source }) =>
  runWrite((database) => {
    const now = nowIso();
    const messageId = String(event?.message?.id || '').trim();
    database.run(
      `INSERT INTO capture_items
        (
          webhook_event_id,
          line_message_id,
          source_type,
          source_id,
          sender_user_id,
          category,
          status,
          raw_event_json,
          event_timestamp_ms,
          created_at,
          updated_at
        )
       VALUES (?, ?, ?, ?, ?, 'pending', 'received', ?, ?, ?, ?)
       ON CONFLICT(line_message_id) DO UPDATE SET
         webhook_event_id = COALESCE(excluded.webhook_event_id, webhook_event_id),
         raw_event_json = excluded.raw_event_json,
         updated_at = excluded.updated_at`,
      [
        String(event?.webhookEventId || '').trim() || null,
        messageId,
        source.sourceType,
        source.sourceId,
        source.senderUserId,
        normalizeJson(event),
        Number(event?.timestamp || 0) || null,
        now,
        now
      ]
    );

    return getItemByMessageIdSync(database, messageId);
  });

export const listPendingImageDownloads = async ({ limit = 200 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT id, line_message_id, source_type, source_id, sender_user_id,
              raw_event_json, event_timestamp_ms, created_at
       FROM capture_items
       WHERE status = 'received'
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, id ASC
       LIMIT ?`,
      [clampLimit(limit, 200, 1000)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const getIngestHealth = async () =>
  runRead((database) => {
    const event = database.prepare(
      `SELECT MAX(created_at) AS last_event_at,
              COUNT(*) AS event_count
       FROM line_events`
    );
    const items = database.prepare(
      `SELECT
         SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS pending_downloads,
         SUM(CASE WHEN status = 'download_failed' THEN 1 ELSE 0 END) AS failed_downloads
       FROM capture_items`
    );
    try {
      const eventRow = getFirstRow(event) || {};
      const itemRow = getFirstRow(items) || {};
      return {
        last_event_at: eventRow.last_event_at || null,
        event_count: Number(eventRow.event_count || 0),
        pending_downloads: Number(itemRow.pending_downloads || 0),
        failed_downloads: Number(itemRow.failed_downloads || 0)
      };
    } finally {
      event.free();
      items.free();
    }
  });

export const markDownloaded = async ({
  lineMessageId,
  contentType,
  fileExtension,
  fileSizeBytes,
  fileSha256,
  storagePath,
  storageRelativePath
}) =>
  runWrite((database) => {
    const duplicateStmt = database.prepare(
      `SELECT id
       FROM capture_items
       WHERE file_sha256 = ?
         AND line_message_id <> ?
         AND status IN ('downloaded', 'duplicate')
       ORDER BY id ASC
       LIMIT 1`,
      [fileSha256, lineMessageId]
    );
    let duplicateOfItemId = null;
    try {
      duplicateOfItemId = Number(getFirstRow(duplicateStmt)?.id || 0) || null;
    } finally {
      duplicateStmt.free();
    }

    const duplicate = Boolean(duplicateOfItemId);
    database.run(
      `UPDATE capture_items
       SET status = ?,
           content_type = ?,
           file_extension = ?,
           file_size_bytes = ?,
           file_sha256 = ?,
           storage_path = ?,
           storage_relative_path = ?,
           duplicate_of_item_id = ?,
           download_error = NULL,
           downloaded_at = ?,
           updated_at = ?
       WHERE line_message_id = ?`,
      [
        duplicate ? 'duplicate' : 'downloaded',
        contentType,
        fileExtension,
        fileSizeBytes,
        fileSha256,
        duplicate ? null : storagePath,
        duplicate ? null : storageRelativePath,
        duplicateOfItemId,
        nowIso(),
        nowIso(),
        lineMessageId
      ]
    );
    return { duplicate, duplicateOfItemId };
  });

export const markDownloadFailed = async ({ lineMessageId, errorMessage }) =>
  runWrite((database) => {
    database.run(
      `UPDATE capture_items
       SET status = 'download_failed',
           download_error = ?,
           updated_at = ?
       WHERE line_message_id = ?`,
      [String(errorMessage || 'unknown error').slice(0, 5000), nowIso(), lineMessageId]
    );
  });

export const deduplicateImages = async () =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT id, file_sha256, status, storage_path, duplicate_of_item_id
       FROM capture_items
       WHERE file_sha256 IS NOT NULL
         AND status IN ('downloaded', 'duplicate')
       ORDER BY id ASC`
    );
    const seen = new Map();
    const duplicates = [];
    try {
      for (const row of allRows(statement)) {
        const hash = String(row.file_sha256 || '').trim();
        if (!hash) continue;
        const original = seen.get(hash);
        if (!original) {
          seen.set(hash, row);
          continue;
        }
        duplicates.push({
          itemId: Number(row.id),
          duplicateOfItemId: Number(original.id),
          storagePath: row.storage_path || null
        });
      }
    } finally {
      statement.free();
    }

    if (!duplicates.length) return { duplicates: [] };

    const now = nowIso();
    for (const duplicate of duplicates) {
      database.run(
        `UPDATE capture_items
         SET status = 'duplicate',
             duplicate_of_item_id = ?,
             storage_path = NULL,
             storage_relative_path = NULL,
             matched_item_id = NULL,
             match_status = 'unmatched',
             updated_at = ?
         WHERE id = ?`,
        [duplicate.duplicateOfItemId, now, duplicate.itemId]
      );
    }
    return { duplicates };
  });

export const markUnsent = async (lineMessageId) =>
  runWrite((database) => {
    const previous = getItemByMessageIdSync(database, lineMessageId);
    const now = nowIso();
    database.run(
      `UPDATE capture_items
       SET status = 'unsent',
           unsent_at = ?,
           updated_at = ?
       WHERE line_message_id = ?`,
      [now, now, lineMessageId]
    );
    database.run(
      `UPDATE line_messages
       SET status = 'unsent',
           unsent_at = ?,
           updated_at = ?
       WHERE line_message_id = ?`,
      [now, now, lineMessageId]
    );
    return previous;
  });

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

// Bangkok business date derived from the LINE event time (falling back to the
// row creation date), matching the admin UI's dateOf() and the day board so
// date filters group items by the day the bill/slip was sent, not the UTC row time.
const matchBusinessDateSql = (prefix = '') => {
  const col = prefix ? `${prefix}.` : '';
  return `CASE
    WHEN ${col}event_timestamp_ms IS NOT NULL AND ${col}event_timestamp_ms > 0
      THEN date((${col}event_timestamp_ms / 1000) + 25200, 'unixepoch')
    ELSE substr(${col}created_at, 1, 10)
  END`;
};
const ITEM_BUSINESS_DATE_SQL = matchBusinessDateSql('');

const buildItemWhere = (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.matchStatus) {
    where.push('match_status = ?');
    params.push(filters.matchStatus);
  }
  if (filters.sourceId) {
    where.push('source_id = ?');
    params.push(filters.sourceId);
  }
  if (filters.flagged) {
    where.push("amount_review_flag = 1 AND status NOT IN ('unsent', 'duplicate')");
  }
  if (validDate(filters.start)) {
    where.push(`(${ITEM_BUSINESS_DATE_SQL}) >= ?`);
    params.push(filters.start);
  }
  if (validDate(filters.end)) {
    where.push(`(${ITEM_BUSINESS_DATE_SQL}) <= ?`);
    params.push(filters.end);
  }
  if (filters.search) {
    where.push(`(
      CAST(id AS TEXT) LIKE ?
      OR line_message_id LIKE ?
      OR source_id LIKE ?
      OR sender_user_id LIKE ?
      OR storage_relative_path LIKE ?
      OR file_sha256 LIKE ?
      OR vendor_name LIKE ?
      OR supplier_name LIKE ?
      OR bill_purpose LIKE ?
      OR doc_ref LIKE ?
      OR vendor_tax_id LIKE ?
      OR notes LIKE ?
      OR bill_total_text LIKE ?
      OR slip_amount_text LIKE ?
      OR REPLACE(COALESCE(bill_total_text, ''), ',', '') LIKE ?
      OR REPLACE(COALESCE(slip_amount_text, ''), ',', '') LIKE ?
      OR CAST(bill_total_value AS TEXT) LIKE ?
      OR CAST(announced_amount AS TEXT) LIKE ?
      OR CAST(slip_amount_value AS TEXT) LIKE ?
      OR ai_raw_text LIKE ?
      OR ai_summary LIKE ?
      OR EXISTS (
        SELECT 1 FROM line_senders search_sender
        WHERE search_sender.source_type = capture_items.source_type
          AND search_sender.source_id = capture_items.source_id
          AND search_sender.user_id = capture_items.sender_user_id
          AND search_sender.display_name LIKE ?
      )
    )`);
    const like = `%${filters.search}%`;
    const normalizedLike = `%${String(filters.search || '').replace(/,/g, '')}%`;
    params.push(
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      normalizedLike,
      normalizedLike,
      like,
      like,
      like,
      like,
      like,
      like
    );
  }

  return {
    sql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
};

const clampLimit = (value, fallback = 40, max = 200) => {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
};

const clampOffset = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const clampConfidence = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeCategoryForAi = (value) => {
  const category = String(value || '').trim().toLowerCase();
  if (category === 'slip') return 'transfer';
  if (['bill', 'bill_page', 'transfer', 'transfer_notice', 'other'].includes(category)) return category;
  return 'other';
};

export const listItems = async (filters = {}) =>
  runRead((database) => {
    const limit = clampLimit(filters.limit, 40, 1000);
    const offset = clampOffset(filters.offset);
    const where = buildItemWhere(filters);

    const itemStmt = database.prepare(
      `SELECT
         id,
         webhook_event_id,
         line_message_id,
         source_type,
         source_id,
         sender_user_id,
         (SELECT display_name FROM line_senders ls WHERE ls.source_type = capture_items.source_type AND ls.source_id = capture_items.source_id AND ls.user_id = capture_items.sender_user_id LIMIT 1) AS sender_display_name,
         (SELECT picture_url FROM line_senders ls WHERE ls.source_type = capture_items.source_type AND ls.source_id = capture_items.source_id AND ls.user_id = capture_items.sender_user_id LIMIT 1) AS sender_picture_url,
         category,
         status,
         content_type,
         file_extension,
         file_size_bytes,
         file_sha256,
         storage_relative_path,
         download_error,
         vendor_name,
         vendor_tax_id,
         supplier_name,
         bill_total_text,
         bill_total_value,
         announced_amount,
         bill_total_edited_at,
         bill_total_edited_by,
         slip_amount_text,
         slip_amount_value,
         slip_amount_confidence,
         payment_role,
         reimbursement_related_item_id,
         reimbursement_status,
         reimbursement_reason_json,
         reimbursement_evidence_mode,
         reimbursement_review_note,
         reimbursement_reviewed_at,
         reimbursement_reviewed_by,
         ai_status,
         ai_provider,
         ai_model,
         ai_confidence,
         ai_category_confidence,
         ai_raw_text,
         ai_summary,
         ai_result_json,
         ai_error,
         ai_processed_at,
         ai_attempt_count,
         ai_input_tokens,
         ai_cached_input_tokens,
         ai_output_tokens,
         ai_reasoning_tokens,
         ai_total_tokens,
         matched_item_id,
         match_status,
         duplicate_of_item_id,
         amount_review_flag,
         bill_purpose,
         doc_ref,
         page_no,
         page_count,
         generated_document_type,
         generated_document_json,
         generated_from_item_id,
         notes,
         event_timestamp_ms,
         downloaded_at,
         unsent_at,
         flag_resolved_at,
         flag_resolved_by,
         created_at,
         updated_at
       FROM capture_items
       ${where.sql}
       ORDER BY COALESCE(event_timestamp_ms, 0) DESC, datetime(created_at) DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...where.params, limit, offset]
    );
    const countStmt = database.prepare(
      `SELECT COUNT(*) AS total FROM capture_items ${where.sql}`,
      where.params
    );
    const summaryStmt = database.prepare(
      `SELECT category, status, match_status, COUNT(*) AS count
       FROM capture_items
       ${where.sql}
       GROUP BY category, status, match_status
       ORDER BY category, status, match_status`,
      where.params
    );
    const flaggedWhere = buildItemWhere({ ...filters, flagged: true });
    const flaggedStmt = database.prepare(
      `SELECT COUNT(*) AS count FROM capture_items ${flaggedWhere.sql}`,
      flaggedWhere.params
    );

    try {
      const rows = allRows(itemStmt);
      const count = getFirstRow(countStmt);
      const summary = allRows(summaryStmt);
      const flaggedCount = Number(getFirstRow(flaggedStmt)?.count || 0);
      return {
        rows,
        summary,
        flagged_count: flaggedCount,
        total: Number(count?.total || 0),
        limit,
        offset
      };
    } finally {
      itemStmt.free();
      countStmt.free();
      summaryStmt.free();
      flaggedStmt.free();
    }
  });

export const listGroups = async () =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT
         g.id,
         g.source_type,
         g.source_id,
         g.source_key,
         g.first_seen_at,
         g.last_seen_at,
         g.event_count,
         g.message_count,
         g.text_count,
         g.image_count,
         COALESCE(stats.item_count, 0) AS item_count,
         stats.last_item_at
       FROM line_groups g
       LEFT JOIN (
         SELECT source_type, source_id, COUNT(*) AS item_count, MAX(created_at) AS last_item_at
         FROM capture_items
         GROUP BY source_type, source_id
       ) stats
         ON stats.source_type = g.source_type
        AND stats.source_id = g.source_id
       ORDER BY datetime(g.last_seen_at) DESC
       LIMIT 500`
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const listMessages = async (filters = {}) =>
  runRead((database) => {
    const where = [];
    const params = [];
    if (filters.sourceId) {
      where.push('lm.source_id = ?');
      params.push(filters.sourceId);
    }
    if (filters.messageType) {
      where.push('lm.message_type = ?');
      params.push(filters.messageType);
    }
    if (filters.senderUserId) {
      where.push('lm.sender_user_id = ?');
      params.push(filters.senderUserId);
    }
    if (validDate(filters.start)) {
      where.push(`(${matchBusinessDateSql('lm')}) >= ?`);
      params.push(filters.start);
    }
    if (validDate(filters.end)) {
      where.push(`(${matchBusinessDateSql('lm')}) <= ?`);
      params.push(filters.end);
    }
    if (filters.search) {
      where.push('(lm.text LIKE ? OR lm.line_message_id LIKE ? OR lm.source_id LIKE ? OR lm.sender_user_id LIKE ? OR ls.display_name LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like, like, like);
    }
    const limit = clampLimit(filters.limit, 80, 500);
    const offset = clampOffset(filters.offset);
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const statement = database.prepare(
       `SELECT
         lm.*,
         ci.id AS capture_item_id,
         ci.category AS capture_category,
         ci.ai_status AS capture_ai_status,
         ci.match_status AS capture_match_status,
         ci.matched_item_id AS capture_matched_item_id,
         ls.display_name AS sender_display_name,
         ls.picture_url AS sender_picture_url,
         ls.status_message AS sender_status_message
       FROM line_messages lm
       LEFT JOIN capture_items ci
         ON ci.source_type = lm.source_type
        AND ci.source_id = lm.source_id
        AND ci.line_message_id = lm.line_message_id
       LEFT JOIN line_senders ls
         ON ls.source_type = lm.source_type
        AND ls.source_id = lm.source_id
        AND ls.user_id = lm.sender_user_id
       ${sqlWhere}
       ORDER BY COALESCE(lm.event_timestamp_ms, 0) DESC, datetime(lm.created_at) DESC, lm.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const getSenderProfile = async ({ sourceType, sourceId, userId }) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT * FROM line_senders
       WHERE source_type = ? AND source_id = ? AND user_id = ?
       LIMIT 1`,
      [sourceType, sourceId, userId]
    );
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

export const upsertSenderProfile = async ({
  sourceType,
  sourceId,
  userId,
  displayName,
  pictureUrl,
  statusMessage,
  profileStatus = 'unknown'
}) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `INSERT INTO line_senders
        (source_type, source_id, user_id, display_name, picture_url, status_message, profile_status, last_fetched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id, user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, line_senders.display_name),
         picture_url = COALESCE(excluded.picture_url, line_senders.picture_url),
         status_message = COALESCE(excluded.status_message, line_senders.status_message),
         profile_status = excluded.profile_status,
         last_fetched_at = excluded.last_fetched_at,
         updated_at = excluded.updated_at`,
      [
        sourceType,
        sourceId,
        userId,
        String(displayName || '').trim() || null,
        String(pictureUrl || '').trim() || null,
        String(statusMessage || '').trim() || null,
        String(profileStatus || 'unknown').trim() || 'unknown',
        now,
        now,
        now
      ]
    );
    return getSenderProfileSync(database, { sourceType, sourceId, userId });
  });

const getSenderProfileSync = (database, { sourceType, sourceId, userId }) => {
  const statement = database.prepare(
    `SELECT * FROM line_senders
     WHERE source_type = ? AND source_id = ? AND user_id = ?
     LIMIT 1`,
    [sourceType, sourceId, userId]
  );
  try {
    return getFirstRow(statement);
  } finally {
    statement.free();
  }
};

export const listSenders = async ({ sourceId, search, limit = 200, offset = 0 } = {}) =>
  runRead((database) => {
    const where = [];
    const params = [];
    if (sourceId) {
      where.push('identities.source_id = ?');
      params.push(sourceId);
    }
    if (search) {
      const like = `%${String(search).trim()}%`;
      where.push('(COALESCE(ls.display_name, \'\') LIKE ? OR identities.user_id LIKE ? OR identities.source_id LIKE ?)');
      params.push(like, like, like);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const statement = database.prepare(
      `SELECT
         ls.id,
         identities.source_type,
         identities.source_id,
         identities.user_id,
         ls.display_name,
         ls.picture_url,
         ls.status_message,
         COALESCE(ls.profile_status, 'unknown') AS profile_status,
         ls.last_fetched_at,
         COUNT(lm.id) AS message_count,
         SUM(CASE WHEN lm.message_type = 'image' THEN 1 ELSE 0 END) AS image_count,
         MAX(COALESCE(lm.event_timestamp_ms, 0)) AS last_message_timestamp_ms
       FROM (
         SELECT DISTINCT source_type, source_id, sender_user_id AS user_id
         FROM line_messages
         WHERE sender_user_id IS NOT NULL AND sender_user_id <> ''
         UNION
         SELECT source_type, source_id, user_id
         FROM line_senders
       ) identities
       LEFT JOIN line_senders ls
         ON ls.source_type = identities.source_type
        AND ls.source_id = identities.source_id
        AND ls.user_id = identities.user_id
       LEFT JOIN line_messages lm
         ON lm.source_type = identities.source_type
        AND lm.source_id = identities.source_id
        AND lm.sender_user_id = identities.user_id
       ${sqlWhere}
       GROUP BY identities.source_type, identities.source_id, identities.user_id,
         ls.id, ls.display_name, ls.picture_url, ls.status_message, ls.profile_status, ls.last_fetched_at
       ORDER BY COALESCE(last_message_timestamp_ms, 0) DESC, ls.display_name ASC, identities.user_id ASC
       LIMIT ? OFFSET ?`,
      [...params, clampLimit(limit, 200, 500), clampOffset(offset)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const listAiQueueItems = async ({ limit = 10, maxAttempts = 3, staleBeforeIso } = {}) =>
  runRead((database) => {
    const staleCutoff = String(staleBeforeIso || '').trim() || '1970-01-01T00:00:00.000Z';
    const statement = database.prepare(
      `SELECT *
       FROM capture_items
       WHERE status = 'downloaded'
         AND storage_path IS NOT NULL
         AND (
           ai_status IN ('pending', 'failed')
           OR (ai_status = 'processing' AND updated_at < ?)
         )
         AND COALESCE(ai_attempt_count, 0) < ?
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [staleCutoff, Math.max(1, Number(maxAttempts || 3)), clampLimit(limit, 10, 50)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const getAiQueueStats = async ({ maxAttempts = 3, staleBeforeIso } = {}) =>
  runRead((database) => {
    const staleCutoff = String(staleBeforeIso || '').trim() || '1970-01-01T00:00:00.000Z';
    const statusStmt = database.prepare(
      `SELECT ai_status, COUNT(*) AS count
       FROM capture_items
       WHERE status = 'downloaded'
       GROUP BY ai_status
       ORDER BY ai_status`
    );
    const categoryStmt = database.prepare(
      `SELECT category, COUNT(*) AS count
       FROM capture_items
       WHERE status = 'downloaded'
       GROUP BY category
       ORDER BY category`
    );
    const matchStmt = database.prepare(
      `SELECT match_status, COUNT(*) AS count
       FROM capture_items
       WHERE status = 'downloaded'
       GROUP BY match_status
       ORDER BY match_status`
    );
    const pendingStmt = database.prepare(
      `SELECT COUNT(*) AS count
       FROM capture_items
       WHERE status = 'downloaded'
         AND storage_path IS NOT NULL
         AND (
           ai_status IN ('pending', 'failed')
           OR (ai_status = 'processing' AND updated_at < ?)
         )
         AND COALESCE(ai_attempt_count, 0) < ?`,
      [staleCutoff, Math.max(1, Number(maxAttempts || 3))]
    );
    const usageStmt = database.prepare(
      `SELECT
         COUNT(CASE WHEN ai_total_tokens IS NOT NULL THEN 1 END) AS tracked_items,
         COALESCE(SUM(ai_input_tokens), 0) AS input_tokens,
         COALESCE(SUM(ai_cached_input_tokens), 0) AS cached_input_tokens,
         COALESCE(SUM(ai_output_tokens), 0) AS output_tokens,
         COALESCE(SUM(ai_reasoning_tokens), 0) AS reasoning_tokens,
         COALESCE(SUM(ai_total_tokens), 0) AS total_tokens
       FROM capture_items`
    );
    try {
      return {
        by_ai_status: allRows(statusStmt),
        by_category: allRows(categoryStmt),
        by_match_status: allRows(matchStmt),
        pending_retryable: Number(getFirstRow(pendingStmt)?.count || 0),
        token_usage: getFirstRow(usageStmt) || {}
      };
    } finally {
      statusStmt.free();
      categoryStmt.free();
      matchStmt.free();
      pendingStmt.free();
      usageStmt.free();
    }
  });

export const listAutoMatchItems = async ({ limit = 500 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT *
       FROM capture_items
       WHERE status = 'downloaded'
         AND ai_status = 'done'
         AND category IN ('bill', 'transfer', 'transfer_notice')
         AND match_status = 'unmatched'
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [clampLimit(limit, 500, 1000)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const listReimbursementCandidates = async ({ limit = 1000 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT *
       FROM capture_items
       WHERE status = 'downloaded'
         AND ai_status = 'done'
         AND category IN ('transfer', 'transfer_notice')
         AND reimbursement_related_item_id IS NULL
         AND match_status <> 'confirmed'
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, id ASC
       LIMIT ?`,
      [clampLimit(limit, 1000, 2000)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const setReimbursementLink = async ({ advanceItemId, reimbursementItemId, reasons = [] }) =>
  runWrite((database) => {
    const advanceId = Number(advanceItemId || 0);
    const reimbursementId = Number(reimbursementItemId || 0);
    if (!advanceId || !reimbursementId || advanceId === reimbursementId) return null;
    const advance = getItemByIdSync(database, advanceId);
    const reimbursement = getItemByIdSync(database, reimbursementId);
    if (!advance || !reimbursement) return null;
    if (!['transfer', 'transfer_notice'].includes(advance.category)
      || !['transfer', 'transfer_notice'].includes(reimbursement.category)) return null;

    const now = nowIso();
    const ids = [advanceId, reimbursementId];
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected', reason_json = ?, confirmed_at = NULL, updated_at = ?
       WHERE created_by = 'ai-worker' AND status = 'pending'
         AND (bill_item_id IN (?, ?) OR slip_item_id IN (?, ?))`,
      [normalizeJson(['จัดเป็นธุรกรรมสำรองจ่ายและคืนเงินสำรอง']), now, ...ids, ...ids]
    );
    database.run(
      `UPDATE capture_items
       SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
       WHERE id IN (?, ?) AND match_status IN ('unmatched', 'pending', 'rejected')`,
      [now, ...ids]
    );
    const reasonJson = normalizeJson(reasons);
    database.run(
      `UPDATE capture_items
       SET payment_role = 'advance_payment', reimbursement_related_item_id = ?,
           reimbursement_status = 'pending', reimbursement_reason_json = ?,
           reimbursement_evidence_mode = NULL, reimbursement_review_note = NULL,
           reimbursement_reviewed_at = NULL, reimbursement_reviewed_by = NULL, updated_at = ?
       WHERE id = ?`,
      [reimbursementId, reasonJson, now, advanceId]
    );
    database.run(
      `UPDATE capture_items
       SET payment_role = 'reimbursement', reimbursement_related_item_id = ?,
           reimbursement_status = 'pending', reimbursement_reason_json = ?,
           reimbursement_evidence_mode = NULL, reimbursement_review_note = NULL,
           reimbursement_reviewed_at = NULL, reimbursement_reviewed_by = NULL, updated_at = ?
       WHERE id = ?`,
      [advanceId, reasonJson, now, reimbursementId]
    );
    return {
      advance: getItemByIdSync(database, advanceId),
      reimbursement: getItemByIdSync(database, reimbursementId)
    };
  });

export const reviewReimbursement = async ({
  reimbursementItemId,
  status,
  evidenceMode,
  reviewNote = '',
  reviewedBy = 'admin-web'
}) => runWrite((database) => {
  const reimbursementId = Number(reimbursementItemId || 0);
  const reimbursement = getItemByIdSync(database, reimbursementId);
  if (!reimbursement || reimbursement.payment_role !== 'reimbursement') return { error: 'reimbursement_not_found' };
  const advanceId = Number(reimbursement.reimbursement_related_item_id || 0);
  const advance = getItemByIdSync(database, advanceId);
  if (!advance || Number(advance.reimbursement_related_item_id || 0) !== reimbursementId) return { error: 'advance_not_found' };

  const decision = String(status || '').trim();
  const mode = String(evidenceMode || '').trim();
  const note = String(reviewNote || '').trim().slice(0, 2000);
  const now = nowIso();
  if (decision === 'rejected') {
    database.run(
      `UPDATE capture_items
       SET payment_role = 'ordinary_payment', reimbursement_related_item_id = NULL,
           reimbursement_status = 'unmatched', reimbursement_reason_json = NULL,
           reimbursement_evidence_mode = NULL, reimbursement_review_note = ?,
           reimbursement_reviewed_at = ?, reimbursement_reviewed_by = ?, updated_at = ?
       WHERE id IN (?, ?)`,
      [note || null, now, String(reviewedBy || 'admin-web'), now, advanceId, reimbursementId]
    );
    return { status: 'rejected', advance: getItemByIdSync(database, advanceId), reimbursement: getItemByIdSync(database, reimbursementId) };
  }
  if (decision !== 'confirmed') return { error: 'invalid_status' };
  if (!['existing_receipt', 'receipt_substitute', 'not_required'].includes(mode)) return { error: 'invalid_evidence_mode' };
  if (mode === 'not_required' && !note) return { error: 'review_note_required' };
  if (mode === 'existing_receipt' && !(advance.match_status === 'confirmed' && Number(advance.matched_item_id || 0))) {
    return { error: 'existing_receipt_not_confirmed' };
  }
  if (mode === 'receipt_substitute') {
    const statement = database.prepare(
      `SELECT id FROM capture_items
       WHERE generated_document_type = 'receipt_substitute'
         AND generated_from_item_id = ? AND match_status = 'confirmed'
       LIMIT 1`,
      [advanceId]
    );
    try {
      if (!getFirstRow(statement)?.id) return { error: 'receipt_substitute_missing' };
    } finally {
      statement.free();
    }
  }
  database.run(
    `UPDATE capture_items
     SET reimbursement_status = 'confirmed', reimbursement_evidence_mode = ?,
         reimbursement_review_note = ?, reimbursement_reviewed_at = ?,
         reimbursement_reviewed_by = ?, updated_at = ?
     WHERE id IN (?, ?)`,
    [mode, note || null, now, String(reviewedBy || 'admin-web'), now, advanceId, reimbursementId]
  );
  return { status: 'confirmed', evidence_mode: mode, advance: getItemByIdSync(database, advanceId), reimbursement: getItemByIdSync(database, reimbursementId) };
});

export const markAiProcessing = async ({ id, provider, model, staleBeforeIso }) =>
  runWrite((database) => {
    const now = nowIso();
    const staleCutoff = String(staleBeforeIso || '').trim() || '1970-01-01T00:00:00.000Z';
    database.run(
      `UPDATE capture_items
       SET ai_status = 'processing',
           ai_provider = ?,
           ai_model = ?,
           ai_error = NULL,
           ai_attempt_count = COALESCE(ai_attempt_count, 0) + 1,
           updated_at = ?
       WHERE id = ?
         AND status = 'downloaded'
         AND (
           ai_status IN ('pending', 'failed')
           OR (ai_status = 'processing' AND updated_at < ?)
         )`,
      [provider || null, model || null, now, Number(id || 0), staleCutoff]
    );
    return getItemByIdSync(database, id);
  });

export const markAiFailed = async ({ id, provider, model, errorMessage }) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `UPDATE capture_items
       SET ai_status = 'failed',
           ai_provider = ?,
           ai_model = ?,
           ai_error = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        provider || null,
        model || null,
        String(errorMessage || 'unknown AI error').slice(0, 5000),
        now,
        Number(id || 0)
      ]
    );
    return getItemByIdSync(database, id);
  });

export const applyAiAnalysis = async ({ id, provider, model, analysis }) =>
  runWrite((database) => {
    const current = getItemByIdSync(database, id);
    if (!current) return null;

    const now = nowIso();
    const rawCategory = normalizeCategoryForAi(analysis?.category || analysis?.document_type);
    const pageNo = Number(analysis?.page_no);
    const pageCount = Number(analysis?.page_count);
    const readTotal = analysis?.bill_total_value == null ? null : Number(analysis.bill_total_value);
    // A page of a multi-page invoice that carries no payable total is not a bill on its own:
    // it can never be matched and has no amount to enter, so keep it out of the work queues.
    const isContinuationPage = rawCategory === 'bill'
      && Number.isFinite(pageCount) && pageCount > 1
      && !(Number.isFinite(readTotal) && readTotal > 0);
    const category = isContinuationPage ? 'bill_page' : rawCategory;
    const confidence = clampConfidence(analysis?.confidence);
    const categoryConfidence = clampConfidence(analysis?.category_confidence ?? analysis?.document_type_confidence ?? confidence);
    const slipAmountConfidence = clampConfidence(analysis?.slip_amount_confidence ?? analysis?.amount_confidence);
    const billTotalValue = analysis?.bill_total_value == null ? null : Number(analysis.bill_total_value);
    const slipAmountValue = analysis?.slip_amount_value == null ? null : Number(analysis.slip_amount_value);
    const usage = analysis?._usage && typeof analysis._usage === 'object' ? analysis._usage : {};
    const storedAnalysis = { ...(analysis || {}) };
    delete storedAnalysis._usage;
    const updates = [
      'ai_status = ?',
      'ai_provider = ?',
      'ai_model = ?',
      'ai_confidence = ?',
      'ai_category_confidence = ?',
      'ai_raw_text = ?',
      'ai_summary = ?',
      'ai_result_json = ?',
      'ai_input_tokens = ?',
      'ai_cached_input_tokens = ?',
      'ai_output_tokens = ?',
      'ai_reasoning_tokens = ?',
      'ai_total_tokens = ?',
      'ai_error = NULL',
      'ai_processed_at = ?',
      'updated_at = ?'
    ];
    const params = [
      'done',
      provider || null,
      model || null,
      confidence,
      categoryConfidence,
      String(analysis?.raw_text || '').trim() || null,
      String(analysis?.summary || '').trim() || null,
      normalizeJson(storedAnalysis),
      Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
      Number.isFinite(Number(usage.cached_input_tokens)) ? Number(usage.cached_input_tokens) : null,
      Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
      Number.isFinite(Number(usage.reasoning_tokens)) ? Number(usage.reasoning_tokens) : null,
      Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
      now,
      now
    ];

    // The category is normally only set once, so a manual correction is never overwritten.
    // The one exception is demoting bill -> bill_page: that is a strict refinement (the page
    // has no payable total), and re-analysis must be able to apply it to already-classified rows.
    if (current.category === 'pending' || (isContinuationPage && current.category === 'bill')) {
      updates.push('category = ?');
      params.push(category);
    }
    if (analysis?.vendor_name !== undefined && !current.vendor_name) {
      updates.push('vendor_name = ?');
      params.push(String(analysis.vendor_name || '').trim() || null);
    }
    const vendorTaxId = normalizeTaxId(analysis?.vendor_tax_id) || extractTaxId(analysis?.raw_text);
    if (category === 'bill' && !current.vendor_tax_id && vendorTaxId) {
      updates.push('vendor_tax_id = ?');
      params.push(vendorTaxId);
    }
    if (analysis?.supplier_name !== undefined && !current.supplier_name) {
      updates.push('supplier_name = ?');
      params.push(String(analysis.supplier_name || '').trim() || null);
    }
    if (!current.bill_total_edited_at && category === 'bill') {
      updates.push('bill_total_text = ?', 'bill_total_value = ?');
      params.push(
        String(analysis?.bill_total_text || '').trim() || null,
        Number.isFinite(billTotalValue) ? billTotalValue : null
      );
    }
    if (category === 'bill') {
      const announcedAmount = Number(analysis?.announced_amount);
      updates.push('announced_amount = ?');
      params.push(Number.isFinite(announcedAmount) && announcedAmount > 0 ? announcedAmount : null);
    }
    updates.push('doc_ref = ?', 'page_no = ?', 'page_count = ?');
    params.push(
      String(analysis?.doc_ref || '').trim() || null,
      Number.isFinite(pageNo) ? pageNo : null,
      Number.isFinite(pageCount) ? pageCount : null
    );

    if (['bill', 'transfer', 'transfer_notice'].includes(category) && !current.bill_purpose) {
      updates.push('bill_purpose = ?');
      params.push(String(analysis?.bill_purpose || '').trim() || null);
    }
    if (category === 'bill') {
      updates.push('amount_review_flag = ?');
      params.push(Boolean(analysis?.amount_conflict) ? 1 : 0);
      if (analysis?.amount_conflict) {
        updates.push('flag_resolved_at = NULL', 'flag_resolved_by = NULL');
      }
    }
    if (category === 'bill_page' && current.match_status === 'needs_amount') {
      // it has no amount to enter, so it is not "waiting for an amount" any more
      updates.push('match_status = ?');
      params.push('unmatched');
    }
    if (category === 'bill' && (current.match_status === 'unmatched' || current.match_status === 'needs_amount')) {
      updates.push('match_status = ?');
      params.push(Number.isFinite(billTotalValue) && billTotalValue > 0 ? 'unmatched' : 'needs_amount');
    }
    if (category === 'transfer' || category === 'transfer_notice') {
      const amountConflict = Boolean(analysis?.amount_conflict);
      updates.push('slip_amount_text = ?', 'slip_amount_value = ?', 'slip_amount_confidence = ?', 'amount_review_flag = ?', 'payment_role = ?');
      params.push(
        String(analysis?.slip_amount_text || '').trim() || null,
        Number.isFinite(slipAmountValue) ? slipAmountValue : null,
        amountConflict ? Math.min(Number(slipAmountConfidence ?? 0.3), 0.3) : slipAmountConfidence,
        amountConflict ? 1 : 0,
        ['ordinary_payment', 'advance_payment', 'reimbursement'].includes(String(analysis?.payment_role || ''))
          ? String(analysis.payment_role)
          : 'ordinary_payment'
      );
    }

    params.push(Number(id || 0));
    database.run(
      `UPDATE capture_items
       SET ${updates.join(', ')}
       WHERE id = ?`,
      params
    );

    const analyzed = getItemByIdSync(database, id);
    if (analyzed?.category === 'bill' && analyzed.status === 'downloaded') {
      const duplicate = findSemanticDuplicateBillSync(database, analyzed);
      if (duplicate) {
        markBillSemanticDuplicateSync(database, analyzed.id, duplicate.item.id, duplicate.reason);
      }
    }
    return getItemByIdSync(database, id);
  });

export const getItemContext = async ({ id, windowMs = 2 * 60 * 60 * 1000, limit = 80 }) =>
  runRead((database) => {
    const itemStmt = database.prepare(`SELECT * FROM capture_items WHERE id = ? LIMIT 1`, [Number(id || 0)]);
    try {
      const item = getFirstRow(itemStmt);
      if (!item) return null;

      const center = Number(item.event_timestamp_ms || 0);
      const params = [item.source_type, item.source_id];
      let timeWhere = '';
      if (Number.isFinite(center) && center > 0) {
        timeWhere = 'AND lm.event_timestamp_ms BETWEEN ? AND ?';
        params.push(center - windowMs, center + windowMs);
      }
      params.push(clampLimit(limit, 80, 300));

      const messageStmt = database.prepare(
        `SELECT
           lm.*,
           ci.id AS capture_item_id,
           ls.display_name AS sender_display_name,
           ls.picture_url AS sender_picture_url,
           ls.status_message AS sender_status_message
         FROM line_messages lm
         LEFT JOIN capture_items ci
           ON ci.source_type = lm.source_type
          AND ci.source_id = lm.source_id
          AND ci.line_message_id = lm.line_message_id
         LEFT JOIN line_senders ls
           ON ls.source_type = lm.source_type
          AND ls.source_id = lm.source_id
          AND ls.user_id = lm.sender_user_id
         WHERE lm.source_type = ?
           AND lm.source_id = ?
           ${timeWhere}
         ORDER BY COALESCE(lm.event_timestamp_ms, 0) ASC, datetime(lm.created_at) ASC, lm.id ASC
           LIMIT ?`,
        params
      );
      try {
        return {
          item,
          messages: allRows(messageStmt)
        };
      } finally {
        messageStmt.free();
      }
    } finally {
      itemStmt.free();
    }
  });

// Typed text messages near a captured image (same LINE group, optionally the
// same sender, within a time window). Used to read the transfer amount the
// sender typed to accompany a slip when the image OCR is unreliable.
export const listNearbyText = async ({ sourceType, sourceId, senderUserId, centerMs, windowMs = 30 * 60 * 1000, limit = 15 } = {}) =>
  runRead((database) => {
    const type = String(sourceType || '').trim();
    const source = String(sourceId || '').trim();
    if (!type || !source) return [];

    const where = [
      'lm.source_type = ?',
      'lm.source_id = ?',
      "lm.message_type = 'text'",
      "lm.status = 'active'",
      'lm.text IS NOT NULL',
      "TRIM(lm.text) != ''"
    ];
    const params = [type, source];
    const center = Number(centerMs || 0);
    if (Number.isFinite(center) && center > 0 && windowMs > 0) {
      where.push('lm.event_timestamp_ms BETWEEN ? AND ?');
      params.push(center - windowMs, center + windowMs);
    }
    const sender = String(senderUserId || '').trim();
    if (sender) {
      where.push('lm.sender_user_id = ?');
      params.push(sender);
    }
    params.push(clampLimit(limit, 15, 100));

    const statement = database.prepare(
      `SELECT lm.text, lm.sender_user_id, lm.event_timestamp_ms
       FROM line_messages lm
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(lm.event_timestamp_ms, 0) ASC, lm.id ASC
       LIMIT ?`,
      params
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const listNearbyConversation = async ({ sourceType, sourceId, centerMs, windowMs = 6 * 60 * 60 * 1000, limit = 40 } = {}) =>
  runRead((database) => {
    const type = String(sourceType || '').trim();
    const source = String(sourceId || '').trim();
    const center = Number(centerMs || 0);
    if (!type || !source || !Number.isFinite(center) || center <= 0) return [];
    const radius = Math.max(0, Number(windowMs || 0));
    const statement = database.prepare(
      `SELECT * FROM (
         SELECT
           lm.id,
           lm.line_message_id,
           lm.message_type,
           lm.sender_user_id,
           lm.text,
           lm.event_timestamp_ms,
           COALESCE(ls.display_name, lm.sender_user_id, 'unknown') AS sender_display_name,
           ci.id AS capture_item_id,
           ci.category AS capture_category,
           ci.ai_status AS capture_ai_status,
           ci.ai_summary AS capture_ai_summary,
           ci.bill_total_value AS capture_bill_total,
           ci.slip_amount_value AS capture_slip_amount
         FROM line_messages lm
         LEFT JOIN line_senders ls
           ON ls.source_type = lm.source_type
          AND ls.source_id = lm.source_id
          AND ls.user_id = lm.sender_user_id
         LEFT JOIN capture_items ci
           ON ci.source_type = lm.source_type
          AND ci.source_id = lm.source_id
          AND ci.line_message_id = lm.line_message_id
         WHERE lm.source_type = ?
           AND lm.source_id = ?
           AND lm.status = 'active'
           AND lm.event_timestamp_ms BETWEEN ? AND ?
         ORDER BY ABS(lm.event_timestamp_ms - ?) ASC, lm.id ASC
         LIMIT ?
       ) nearby
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, id ASC`,
      [type, source, center - radius, center + radius, center, clampLimit(limit, 40, 120)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const listAiLearningExamples = async ({ limit = 20 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT outcome, review_note, example_json, approved_by, created_at
       FROM ai_learning_examples
       ORDER BY datetime(updated_at) DESC, id DESC
       LIMIT ?`,
      [clampLimit(limit, 20, 100)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const recordLineTransferRequest = async ({
  itemId,
  sourceType,
  sourceId,
  messageText,
  status,
  requestedBy = 'admin-web',
  errorMessage = ''
}) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `INSERT INTO line_transfer_requests
        (item_id, source_type, source_id, message_text, status, requested_by, error_message, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(itemId || 0),
        String(sourceType || ''),
        String(sourceId || ''),
        String(messageText || ''),
        String(status || 'failed'),
        String(requestedBy || 'admin-web'),
        String(errorMessage || '').slice(0, 2000) || null,
        ['sent', 'mock_sent'].includes(status) ? now : null,
        now
      ]
    );
    const statement = database.prepare('SELECT * FROM line_transfer_requests ORDER BY id DESC LIMIT 1');
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

const MATCHABLE_CATEGORIES = new Set(['bill', 'transfer', 'transfer_notice']);

const detachItemFromActiveMatchesSync = (database, itemId, reason) => {
  const id = Number(itemId || 0);
  const now = nowIso();
  const statement = database.prepare(
    `SELECT bill_item_id, slip_item_id
     FROM capture_matches
     WHERE status IN ('pending', 'confirmed', 'manual_review')
       AND (bill_item_id = ? OR slip_item_id = ?)`,
    [id, id]
  );
  let matches = [];
  try {
    matches = allRows(statement);
  } finally {
    statement.free();
  }

  if (matches.length) {
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected', reason_json = ?, confirmed_at = NULL, updated_at = ?
       WHERE status IN ('pending', 'confirmed', 'manual_review')
         AND (bill_item_id = ? OR slip_item_id = ?)`,
      [normalizeJson([reason]), now, id, id]
    );
    const counterpartIds = [...new Set(matches.flatMap((match) => [
      Number(match.bill_item_id || 0),
      Number(match.slip_item_id || 0)
    ]).filter((matchId) => matchId && matchId !== id))];
    for (const counterpartId of counterpartIds) {
      database.run(
        `UPDATE capture_items
         SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
         WHERE id = ? AND matched_item_id = ?`,
        [now, counterpartId, id]
      );
    }
  }

  database.run(
    `UPDATE capture_items
     SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
     WHERE id = ?`,
    [now, id]
  );
};

export const updateItemMetadata = async ({ id, category, categoryEditedBy, categoryEditReason, vendorName, supplierName, billPurpose, billTotalText, billTotalValue, notes, editedBy }) =>
  runWrite((database) => {
    const current = getItemByIdSync(database, id);
    if (!current) return null;
    const updates = ['updated_at = ?'];
    const params = [nowIso()];

    if (category !== undefined) {
      updates.push('category = ?', 'category_edited_at = ?', 'category_edited_by = ?', 'category_edit_reason = ?');
      params.push(category, nowIso(), categoryEditedBy || editedBy || 'admin-web', String(categoryEditReason || '').trim() || null);
    }
    if (vendorName !== undefined) {
      updates.push('vendor_name = ?');
      params.push(String(vendorName || '').trim() || null);
    }
    if (supplierName !== undefined) {
      updates.push('supplier_name = ?');
      params.push(String(supplierName || '').trim() || null);
    }
    if (billPurpose !== undefined) {
      updates.push('bill_purpose = ?');
      params.push(String(billPurpose || '').trim() || null);
    }
    if (billTotalText !== undefined) {
      updates.push('bill_total_text = ?', 'bill_total_value = ?', 'bill_total_edited_at = ?', 'bill_total_edited_by = ?');
      params.push(String(billTotalText || '').trim() || null, billTotalValue ?? null, nowIso(), editedBy || null);
      if (current.match_status === 'needs_amount' && Number(billTotalValue) > 0) {
        updates.push('match_status = ?');
        params.push('unmatched');
      }
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(String(notes || '').trim() || null);
    }

    params.push(Number(id || 0));
    database.run(
      `UPDATE capture_items
       SET ${updates.join(', ')}
       WHERE id = ?`,
      params
    );

    if (category !== undefined && !MATCHABLE_CATEGORIES.has(category)) {
      detachItemFromActiveMatchesSync(database, id, 'ผู้ดูแลจัดเอกสารเป็นประเภทที่ไม่ใช้จับคู่');
    }

    const statement = database.prepare(`SELECT * FROM capture_items WHERE id = ? LIMIT 1`, [Number(id || 0)]);
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

export const updateCategory = async ({ id, category, editedBy, reason }) =>
  updateItemMetadata({ id, category, categoryEditedBy: editedBy, categoryEditReason: reason });

export const resolveAmountFlag = async ({
  id,
  useAnnounced = false,
  billTotalText,
  billTotalValue,
  resolvedBy = 'admin'
}) =>
  runWrite((database) => {
    const current = getItemByIdSync(database, id);
    if (!current) return null;

    const now = nowIso();
    const updates = [
      'amount_review_flag = 0',
      'flag_resolved_at = ?',
      'flag_resolved_by = ?',
      'updated_at = ?'
    ];
    const params = [now, resolvedBy || null, now];

    if (useAnnounced) {
      const amount = Number(current.announced_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'announced_amount_missing' };
      }
      updates.push('bill_total_text = ?', 'bill_total_value = ?', 'bill_total_edited_at = ?', 'bill_total_edited_by = ?');
      params.push(amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount, now, resolvedBy || null);
    } else if (billTotalText !== undefined) {
      const amount = Number(billTotalValue);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'invalid_bill_total' };
      }
      updates.push('bill_total_text = ?', 'bill_total_value = ?', 'bill_total_edited_at = ?', 'bill_total_edited_by = ?');
      params.push(String(billTotalText || '').trim() || amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount, now, resolvedBy || null);
    }

    if ((useAnnounced || billTotalText !== undefined) && current.match_status === 'needs_amount') {
      updates.push('match_status = ?');
      params.push('unmatched');
    }

    params.push(Number(id || 0));
    database.run(
      `UPDATE capture_items SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return getItemByIdSync(database, id);
  });

// โอนข้ามวัน: ถ้าสลิปมาจับคู่กับบิลของวันที่ปิดรอบไปแล้ว ยอดสรุปที่ snapshot ไว้จะไม่ตรงอีกต่อไป
// จึงเปิดรอบวันนั้นใหม่ พร้อมบันทึกเหตุผล เพื่อให้บอร์ดบอกได้ว่าทำไมวันที่ปิดแล้วกลับมาเปิด
const reopenClosedDayForItem = (database, item, reason) => {
  if (!item) return false;
  const dateStmt = database.prepare(
    `SELECT ${matchBusinessDateSql('ci')} AS business_date FROM capture_items ci WHERE ci.id = ? LIMIT 1`,
    [Number(item.id || 0)]
  );
  let businessDate = '';
  try {
    businessDate = String(getFirstRow(dateStmt)?.business_date || '');
  } finally {
    dateStmt.free();
  }
  if (!businessDate) return false;

  const now = nowIso();
  database.run(
    `UPDATE capture_daily_closings
     SET status = 'open', reopened_at = ?, reopened_reason = ?, updated_at = ?
     WHERE business_date = ? AND source_id = ? AND status = 'closed'`,
    [now, String(reason || '').slice(0, 300) || null, now, businessDate, String(item.source_id || '')]
  );
  return rowsModified(database) > 0;
};

// Re-queue specific items for AI analysis (e.g. after an analyser upgrade such as
// multi-page invoice support). Only touches downloaded, still-present images.
export const requeueAiItems = async ({ ids = [], matchStatus = '' } = {}) =>
  runWrite((database) => {
    const now = nowIso();
    const wanted = ids.map((id) => Number(id)).filter(Number.isFinite);
    const where = ["status = 'downloaded'"];
    const params = [];
    if (wanted.length) {
      where.push(`id IN (${wanted.map(() => '?').join(',')})`);
      params.push(...wanted);
    }
    if (matchStatus) {
      where.push('match_status = ?');
      params.push(matchStatus);
    }
    if (!wanted.length && !matchStatus) return { requeued: 0 };

    database.run(
      `UPDATE capture_items
       SET ai_status = 'pending', ai_attempt_count = 0, ai_error = NULL, updated_at = ?
       WHERE ${where.join(' AND ')}`,
      [now, ...params]
    );
    return { requeued: rowsModified(database) };
  });

// Re-read every non-manually-classified image after the vision instructions change.
// Keep owner corrections and admin-created matches intact, but discard AI-derived pairing and OCR.
export const resetAllAiAnalysis = async ({ start = '', end = '' } = {}) =>
  runWrite((database) => {
    const now = nowIso();
    const scopeParts = [];
    const scopeParams = [];
    if (validDate(start)) {
      scopeParts.push(`(${matchBusinessDateSql('capture_items')}) >= ?`);
      scopeParams.push(start);
    }
    if (validDate(end)) {
      scopeParts.push(`(${matchBusinessDateSql('capture_items')}) <= ?`);
      scopeParams.push(end);
    }
    const scopeSql = scopeParts.length ? ` AND ${scopeParts.join(' AND ')}` : '';
    const preserveStmt = database.prepare(
      `SELECT COUNT(*) AS count
       FROM capture_items
       WHERE status = 'downloaded' AND category_edited_at IS NOT NULL${scopeSql}`,
      scopeParams
    );
    let preservedManualCategories = 0;
    try {
      preservedManualCategories = Number(getFirstRow(preserveStmt)?.count || 0);
    } finally {
      preserveStmt.free();
    }

    const matchStmt = database.prepare(
      `SELECT m.id, m.bill_item_id, m.slip_item_id
       FROM capture_matches m
       JOIN capture_items b ON b.id = m.bill_item_id
       JOIN capture_items s ON s.id = m.slip_item_id
       WHERE m.created_by = 'ai-worker'
         AND m.status IN ('pending', 'confirmed', 'manual_review')
         ${scopeParts.length ? `AND (((${matchBusinessDateSql('b')}) BETWEEN ? AND ?) OR ((${matchBusinessDateSql('s')}) BETWEEN ? AND ?))` : ''}`,
      scopeParts.length
        ? [validDate(start) ? start : '0001-01-01', validDate(end) ? end : '9999-12-31', validDate(start) ? start : '0001-01-01', validDate(end) ? end : '9999-12-31']
        : []
    );
    let aiPairs = [];
    try {
      aiPairs = allRows(matchStmt).map((row) => ({
        id: Number(row.id || 0),
        billItemId: Number(row.bill_item_id || 0),
        slipItemId: Number(row.slip_item_id || 0)
      })).filter((pair) => pair.billItemId && pair.slipItemId);
    } finally {
      matchStmt.free();
    }

    if (aiPairs.length) {
      const matchIds = aiPairs.map((pair) => pair.id).filter(Boolean);
      database.run(
        `UPDATE capture_matches
         SET status = 'rejected', reason_json = ?, confirmed_at = NULL, updated_at = ?
         WHERE id IN (${matchIds.map(() => '?').join(',')})`,
        [normalizeJson(['รีเซ็ตเพื่ออ่านรูปใหม่ตามกติกา AI']), now, ...matchIds]
      );
      const itemIds = [...new Set(aiPairs.flatMap((pair) => [pair.billItemId, pair.slipItemId]))];
      for (const itemId of itemIds) {
        database.run(
          `UPDATE capture_items
           SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
           WHERE id = ? AND match_status IN ('pending', 'confirmed', 'manual_review')`,
          [now, itemId]
        );
      }
    }

    database.run(
      `UPDATE capture_items
       SET category = 'pending',
           vendor_name = NULL,
           vendor_tax_id = NULL,
           supplier_name = NULL,
           bill_purpose = NULL,
           bill_total_text = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_text END,
           bill_total_value = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_value END,
           announced_amount = NULL,
           slip_amount_text = NULL,
           slip_amount_value = NULL,
           slip_amount_confidence = NULL,
           payment_role = NULL,
           reimbursement_related_item_id = NULL,
           reimbursement_status = 'unmatched',
           reimbursement_reason_json = NULL,
           reimbursement_evidence_mode = NULL,
           reimbursement_review_note = NULL,
           reimbursement_reviewed_at = NULL,
           reimbursement_reviewed_by = NULL,
           ai_status = 'pending',
           ai_provider = NULL,
           ai_model = NULL,
           ai_confidence = NULL,
           ai_category_confidence = NULL,
           ai_raw_text = NULL,
           ai_summary = NULL,
           ai_result_json = NULL,
           ai_error = NULL,
           ai_processed_at = NULL,
           ai_attempt_count = 0,
           ai_input_tokens = NULL,
           ai_cached_input_tokens = NULL,
           ai_output_tokens = NULL,
           ai_reasoning_tokens = NULL,
           ai_total_tokens = NULL,
           amount_review_flag = 0,
           flag_resolved_at = NULL,
           flag_resolved_by = NULL,
           doc_ref = NULL,
           page_no = NULL,
           page_count = NULL,
           updated_at = ?
       WHERE status = 'downloaded' AND category_edited_at IS NULL${scopeSql}`,
      [now, ...scopeParams]
    );

    return {
      requeued: rowsModified(database),
      reset_ai_matches: aiPairs.length,
      preserved_manual_categories: preservedManualCategories,
      start: validDate(start) ? start : null,
      end: validDate(end) ? end : null
    };
  });

export const createReceiptSubstitute = async ({
  slipItemId,
  documentDate,
  payerName = 'บริษัท โซลาว จำกัด',
  payeeName,
  payeeAccount,
  description,
  createdBy = 'admin-web'
}) =>
  runWrite((database) => {
    const slipId = Number(slipItemId || 0);
    const slip = getItemByIdSync(database, slipId);
    if (!slip) return { error: 'slip_not_found' };
    if (!['transfer', 'transfer_notice'].includes(slip.category)) return { error: 'not_a_slip' };
    if (slip.status === 'unsent' || slip.status === 'duplicate') return { error: 'slip_unavailable' };
    const messageId = `receipt-substitute:${slipId}`;
    const existing = getItemByMessageIdSync(database, messageId);
    if (existing) return { item: existing, created: false };
    if (['pending', 'confirmed', 'manual_review'].includes(slip.match_status) && Number(slip.matched_item_id || 0)) {
      return { error: 'slip_already_matched', matchedItemId: Number(slip.matched_item_id) };
    }

    const amount = Number(slip.slip_amount_value || 0);
    const receiver = String(payeeName || '').trim();
    const detail = String(description || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'slip_amount_missing' };
    if (!receiver) return { error: 'payee_required' };
    if (!detail) return { error: 'description_required' };

    const now = nowIso();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(documentDate || ''))
      ? String(documentDate)
      : now.slice(0, 10);
    const documentNo = `RS-${date.replaceAll('-', '')}-${String(slipId).padStart(6, '0')}`;
    const document = {
      document_type: 'receipt_substitute',
      document_no: documentNo,
      document_date: date,
      payer_name: String(payerName || '').trim() || 'บริษัท โซลาว จำกัด',
      payee_name: receiver,
      payee_account: String(payeeAccount || '').trim() || null,
      description: detail,
      amount,
      source_slip_item_id: slipId,
      created_by: String(createdBy || 'admin-web'),
      created_at: now
    };
    const summary = `ใบแทนใบเสร็จรับเงิน ${detail} จ่ายให้ ${receiver} จำนวน ${amount.toFixed(2)} บาท`;

    database.run(
      `INSERT INTO capture_items
        (webhook_event_id, line_message_id, source_type, source_id, sender_user_id,
         category, status, vendor_name, bill_total_text, bill_total_value,
         bill_total_edited_at, bill_total_edited_by, category_edited_at, category_edited_by,
         ai_status, ai_provider, ai_confidence, ai_category_confidence, ai_summary, ai_result_json,
         bill_purpose, doc_ref, generated_document_type, generated_document_json,
         generated_from_item_id, raw_event_json, event_timestamp_ms, downloaded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'bill', 'downloaded', ?, ?, ?, ?, ?, ?, ?,
               'done', 'manual', 1, 1, ?, ?, ?, ?, 'receipt_substitute', ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        messageId,
        slip.source_type,
        slip.source_id,
        slip.sender_user_id,
        receiver,
        amount.toFixed(2),
        amount,
        now,
        String(createdBy || 'admin-web'),
        now,
        String(createdBy || 'admin-web'),
        summary,
        normalizeJson({ category: 'bill', confidence: 1, document }),
        detail,
        documentNo,
        normalizeJson(document),
        slipId,
        normalizeJson({ type: 'generated_document', document }),
        slip.event_timestamp_ms,
        now,
        now,
        now
      ]
    );

    return { item: getItemByMessageIdSync(database, messageId), created: true };
  });

export const setItemMatch = async ({
  billItemId,
  slipItemId,
  score = 0,
  status = 'pending',
  reasons = [],
  createdBy = 'admin',
  reviewNote = '',
  aiLearningApproved = false
}) =>
  runWrite((database) => {
    const billId = Number(billItemId || 0);
    const slipId = Number(slipItemId || 0);
    const bill = getItemByIdSync(database, billId);
    const slip = getItemByIdSync(database, slipId);
    if (!bill || !slip) return null;

    const now = nowIso();
    if (['pending', 'confirmed'].includes(status)) {
      const conflictStmt = database.prepare(
        `SELECT bill_item_id, slip_item_id
         FROM capture_matches
         WHERE status IN ('pending', 'confirmed', 'manual_review')
           AND (bill_item_id IN (?, ?) OR slip_item_id IN (?, ?))
           AND NOT (bill_item_id = ? AND slip_item_id = ?)`,
        [billId, slipId, billId, slipId, billId, slipId]
      );
      let conflictedItemIds = [];
      try {
        const conflicts = allRows(conflictStmt);
        conflictedItemIds = [...new Set(conflicts.flatMap((match) => [
          Number(match.bill_item_id || 0),
          Number(match.slip_item_id || 0)
        ]).filter(Boolean))];
      } finally {
        conflictStmt.free();
      }

      database.run(
        `UPDATE capture_matches
         SET status = 'rejected',
             reason_json = ?,
             confirmed_at = NULL,
             updated_at = ?
         WHERE status IN ('pending', 'confirmed', 'manual_review')
           AND (bill_item_id IN (?, ?) OR slip_item_id IN (?, ?))
           AND NOT (bill_item_id = ? AND slip_item_id = ?)`,
        [
          normalizeJson(['reassigned by newer match', `new bill ${billId}`, `new slip ${slipId}`]),
          now,
          billId,
          slipId,
          billId,
          slipId,
          billId,
          slipId
        ]
      );

      for (const itemId of conflictedItemIds) {
        if (itemId === billId || itemId === slipId) continue;
        database.run(
          `UPDATE capture_items
           SET matched_item_id = NULL,
               match_status = 'unmatched',
               updated_at = ?
           WHERE id = ?`,
          [now, itemId]
        );
      }
    }

    database.run(
      `INSERT INTO capture_matches
        (bill_item_id, slip_item_id, score, status, reason_json, created_by,
         review_note, ai_learning_approved, reviewed_by, reviewed_at,
         confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bill_item_id, slip_item_id) DO UPDATE SET
         score = excluded.score,
         status = excluded.status,
         reason_json = excluded.reason_json,
         review_note = excluded.review_note,
         ai_learning_approved = excluded.ai_learning_approved,
         reviewed_by = excluded.reviewed_by,
         reviewed_at = excluded.reviewed_at,
         confirmed_at = excluded.confirmed_at,
         updated_at = excluded.updated_at`,
      [
        billId,
        slipId,
        Number(score || 0),
        status,
        normalizeJson(reasons),
        createdBy,
        String(reviewNote || '').trim() || null,
        aiLearningApproved ? 1 : 0,
        ['confirmed', 'rejected'].includes(status) ? createdBy : null,
        ['confirmed', 'rejected'].includes(status) ? now : null,
        status === 'confirmed' ? now : null,
        now,
        now
      ]
    );
    if (status === 'rejected') {
      database.run(
        `UPDATE capture_items
         SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
         WHERE id = ? AND matched_item_id = ?`,
        [now, billId, slipId]
      );
      database.run(
        `UPDATE capture_items
         SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ?
         WHERE id = ? AND matched_item_id = ?`,
        [now, slipId, billId]
      );
    } else {
      database.run(
        `UPDATE capture_items SET matched_item_id = ?, match_status = ?, updated_at = ? WHERE id = ?`,
        [slipId, status, now, billId]
      );
      database.run(
        `UPDATE capture_items SET matched_item_id = ?, match_status = ?, updated_at = ? WHERE id = ?`,
        [billId, status, now, slipId]
      );
    }

    // A pair belongs to the bill's day; pairing it after that day was closed invalidates the close.
    if (['pending', 'confirmed'].includes(status)) {
      reopenClosedDayForItem(database, bill, 'มีสลิปมาจับคู่หลังปิดรอบ');
    }

    const statement = database.prepare(
      `SELECT * FROM capture_matches WHERE bill_item_id = ? AND slip_item_id = ? LIMIT 1`,
      [billId, slipId]
    );
    try {
      const match = getFirstRow(statement);
      if (match && aiLearningApproved && String(reviewNote || '').trim() && ['confirmed', 'rejected'].includes(status)) {
        const example = {
          outcome: status,
          review_note: String(reviewNote).trim(),
          bill: {
            category: bill.category,
            vendor_name: bill.vendor_name,
            bill_purpose: bill.bill_purpose,
            amount: bill.bill_total_value,
            ai_summary: bill.ai_summary
          },
          slip: {
            category: slip.category,
            amount: slip.slip_amount_value,
            ai_summary: slip.ai_summary
          }
        };
        database.run(
          `INSERT INTO ai_learning_examples
            (match_id, outcome, review_note, example_json, approved_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET
             outcome = excluded.outcome,
             review_note = excluded.review_note,
             example_json = excluded.example_json,
             approved_by = excluded.approved_by,
             updated_at = excluded.updated_at`,
          [match.id, status, String(reviewNote).trim(), normalizeJson(example), createdBy, now, now]
        );
      }
      return match;
    } finally {
      statement.free();
    }
  });

export const setItemMatchGroup = async ({
  billItemIds = [],
  slipItemIds = [],
  status = 'pending',
  reasons = [],
  createdBy = 'admin'
}) =>
  runWrite((database) => {
    const bills = [...new Set(billItemIds.map(Number).filter(Number.isInteger))].slice(0, 20);
    const slips = [...new Set(slipItemIds.map(Number).filter(Number.isInteger))].slice(0, 20);
    if (!bills.length || !slips.length) return { error: 'members_required' };
    if (!['pending', 'confirmed', 'rejected'].includes(status)) return { error: 'invalid_status' };

    const billRows = bills.map((id) => getItemByIdSync(database, id));
    const slipRows = slips.map((id) => getItemByIdSync(database, id));
    if (billRows.some((row) => !row) || slipRows.some((row) => !row)) return { error: 'item_not_found' };
    if (billRows.some((row) => row.category !== 'bill')) return { error: 'invalid_bill' };
    if (slipRows.some((row) => !['transfer', 'transfer_notice'].includes(row.category))) return { error: 'invalid_slip' };
    if ([...billRows, ...slipRows].some((row) => ['unsent', 'duplicate'].includes(row.status))) {
      return { error: 'item_unavailable' };
    }
    const billTotal = billRows.reduce((sum, row) => sum + Number(row.bill_total_value || 0), 0);
    const slipTotal = slipRows.reduce((sum, row) => sum + Number(row.slip_amount_value || 0), 0);
    if (status === 'confirmed' && Math.abs(billTotal - slipTotal) >= 0.01) return { error: 'amount_mismatch' };

    const now = nowIso();
    const selectedIds = [...bills, ...slips];
    const placeholders = selectedIds.map(() => '?').join(',');
    const conflictStmt = database.prepare(
      `SELECT DISTINCT bill_item_id, slip_item_id
       FROM capture_matches
       WHERE status IN ('pending', 'confirmed', 'manual_review')
         AND (bill_item_id IN (${placeholders}) OR slip_item_id IN (${placeholders}))`,
      [...selectedIds, ...selectedIds]
    );
    let conflictIds = [];
    try {
      conflictIds = [...new Set(allRows(conflictStmt).flatMap((row) => [
        Number(row.bill_item_id || 0), Number(row.slip_item_id || 0)
      ]).filter(Boolean))];
    } finally {
      conflictStmt.free();
    }
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected', confirmed_at = NULL, updated_at = ?,
           reason_json = ?
       WHERE status IN ('pending', 'confirmed', 'manual_review')
         AND (bill_item_id IN (${placeholders}) OR slip_item_id IN (${placeholders}))`,
      [now, normalizeJson(['จัดเอกสารใหม่เป็นชุดหลายบิล/หลายสลิป']), ...selectedIds, ...selectedIds]
    );
    for (const id of conflictIds) {
      if (selectedIds.includes(id)) continue;
      database.run(
        `UPDATE capture_items SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ? WHERE id = ?`,
        [now, id]
      );
    }

    const groupKey = `mg-${Date.now()}-${bills.join('_')}-${slips.join('_')}`;
    const edges = [
      ...slips.map((slipId) => [bills[0], slipId]),
      ...bills.slice(1).map((billId) => [billId, slips[0]])
    ];
    const reasonJson = normalizeJson([
      ...reasons,
      `รวม ${bills.length} บิล ยอด ${billTotal.toFixed(2)}`,
      `รวม ${slips.length} สลิป ยอด ${slipTotal.toFixed(2)}`
    ]);
    for (const [billId, slipId] of edges) {
      database.run(
        `INSERT INTO capture_matches
          (bill_item_id, slip_item_id, score, status, reason_json, created_by,
           match_group_key, reviewed_by, reviewed_at, confirmed_at, created_at, updated_at)
         VALUES (?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bill_item_id, slip_item_id) DO UPDATE SET
           score = 100, status = excluded.status, reason_json = excluded.reason_json,
           created_by = excluded.created_by, match_group_key = excluded.match_group_key,
           reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
           confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at`,
        [billId, slipId, status, reasonJson, createdBy, groupKey,
          ['confirmed', 'rejected'].includes(status) ? createdBy : null,
          ['confirmed', 'rejected'].includes(status) ? now : null,
          status === 'confirmed' ? now : null, now, now]
      );
    }

    if (status === 'rejected') {
      for (const id of selectedIds) {
        database.run(
          `UPDATE capture_items SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ? WHERE id = ?`,
          [now, id]
        );
      }
    } else {
      for (const id of bills) {
        database.run(
          `UPDATE capture_items SET matched_item_id = ?, match_status = ?, updated_at = ? WHERE id = ?`,
          [slips[0], status, now, id]
        );
      }
      for (const id of slips) {
        database.run(
          `UPDATE capture_items SET matched_item_id = ?, match_status = ?, updated_at = ? WHERE id = ?`,
          [bills[0], status, now, id]
        );
      }
      for (const bill of billRows) reopenClosedDayForItem(database, bill, 'มีการรวมเอกสารหลังปิดรอบ');
    }

    return {
      match_group_key: groupKey,
      status,
      bill_item_ids: bills,
      slip_item_ids: slips,
      bill_total: billTotal,
      slip_total: slipTotal
    };
  });

export const resetAiPendingMatches = async () =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT bill_item_id, slip_item_id
       FROM capture_matches
       WHERE status = 'pending' AND created_by = 'ai-worker'`
    );
    let pairs = [];
    try {
      pairs = allRows(statement).map((row) => ({
        billItemId: Number(row.bill_item_id || 0),
        slipItemId: Number(row.slip_item_id || 0)
      })).filter((pair) => pair.billItemId && pair.slipItemId);
    } finally {
      statement.free();
    }

    if (!pairs.length) return { reset: 0 };

    const now = nowIso();
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected',
           reason_json = ?,
           confirmed_at = NULL,
           updated_at = ?
       WHERE status = 'pending' AND created_by = 'ai-worker'`,
      [normalizeJson(['จัดคู่ใหม่ตามกติกา AI']), now]
    );

    const itemIds = [...new Set(pairs.flatMap((pair) => [pair.billItemId, pair.slipItemId]))];
    for (const itemId of itemIds) {
      database.run(
        `UPDATE capture_items
         SET matched_item_id = NULL,
             match_status = 'unmatched',
             updated_at = ?
         WHERE id = ? AND match_status = 'pending'`,
        [now, itemId]
      );
    }

    return { reset: pairs.length };
  });

export const markBillsMissingAmount = async () =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `UPDATE capture_items
       SET match_status = 'needs_amount',
           updated_at = ?
       WHERE status = 'downloaded'
         AND ai_status = 'done'
         AND category = 'bill'
         AND match_status = 'unmatched'
         AND (bill_total_value IS NULL OR bill_total_value <= 0)`,
      [now]
    );
    return rowsModified(database);
  });

// Reuses matchBusinessDateSql (defined above) so the day board and the scoped
// item/match queries always compute the same Bangkok business date.
const BUSINESS_DATE_SQL = matchBusinessDateSql('ci');

const computeDaySummary = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT
       SUM(CASE WHEN day.category = 'bill' THEN 1 ELSE 0 END) AS bill_count,
       SUM(CASE WHEN day.category IN ('transfer', 'transfer_notice') THEN 1 ELSE 0 END) AS slip_count,
       SUM(CASE WHEN day.match_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
       SUM(CASE WHEN day.match_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN day.match_status = 'unmatched'
         AND day.category IN ('bill', 'transfer', 'transfer_notice')
         AND NOT (COALESCE(day.payment_role, '') = 'reimbursement' AND day.reimbursement_status = 'confirmed')
         THEN 1 ELSE 0 END) AS unmatched_count,
       SUM(CASE WHEN day.match_status = 'needs_amount' THEN 1 ELSE 0 END) AS needs_amount_count,
       SUM(CASE WHEN day.category = 'bill' AND day.match_status = 'confirmed' THEN COALESCE(day.bill_total_value, 0) ELSE 0 END) AS confirmed_bill_amount,
       SUM(CASE WHEN day.category IN ('transfer', 'transfer_notice') AND day.match_status = 'confirmed' THEN COALESCE(day.slip_amount_value, 0) ELSE 0 END) AS confirmed_slip_amount
     FROM (
       SELECT ci.category, ci.match_status, ci.bill_total_value, ci.slip_amount_value,
         ci.payment_role, ci.reimbursement_status,
         ${BUSINESS_DATE_SQL} AS business_date
       FROM capture_items ci
       WHERE ci.status != 'unsent' AND ci.source_id = ?
     ) day
     WHERE day.business_date = ?`
  );
  try {
    statement.bind([sourceId, businessDate]);
    return getFirstRow(statement) || {};
  } finally {
    statement.free();
  }
};

export const listDays = async ({ start = '', end = '', sourceId = '' } = {}) =>
  runRead((database) => {
    const where = ["ci.status != 'unsent'"];
    const params = [];
    if (sourceId) {
      where.push('ci.source_id = ?');
      params.push(sourceId);
    }
    const having = ['item_count > 0'];
    if (start) {
      having.push('day.business_date >= ?');
    }
    if (end) {
      having.push('day.business_date <= ?');
    }
    const statement = database.prepare(
      `SELECT
         day.business_date,
         day.source_type,
         day.source_id,
         COUNT(*) AS item_count,
         SUM(CASE WHEN day.is_line_export = 1 THEN 1 ELSE 0 END) AS imported_item_count,
         SUM(CASE WHEN day.category = 'bill' THEN 1 ELSE 0 END) AS bill_count,
         SUM(CASE WHEN day.category IN ('transfer', 'transfer_notice') THEN 1 ELSE 0 END) AS slip_count,
         SUM(CASE WHEN day.category = 'bill' AND day.match_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
         SUM(CASE WHEN day.category = 'bill' AND day.match_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN day.match_status = 'unmatched'
           AND day.category IN ('bill', 'transfer', 'transfer_notice')
           AND NOT (COALESCE(day.payment_role, '') = 'reimbursement' AND day.reimbursement_status = 'confirmed')
           THEN 1 ELSE 0 END) AS unmatched_count,
         SUM(CASE WHEN day.match_status = 'needs_amount' THEN 1 ELSE 0 END) AS needs_amount_count,
         c.status AS closing_status,
         c.closed_at,
         c.closed_by,
         c.reopened_at,
         c.reopened_reason,
         c.summary_json
       FROM (
         SELECT ci.source_type, ci.source_id, ci.category, ci.match_status,
           ci.payment_role, ci.reimbursement_status,
           CASE WHEN ci.raw_event_json LIKE '%"format":"line_chat_text_export"%' THEN 1 ELSE 0 END AS is_line_export,
           ${BUSINESS_DATE_SQL} AS business_date
         FROM capture_items ci
         WHERE ${where.join(' AND ')}
       ) day
       LEFT JOIN capture_daily_closings c
         ON c.business_date = day.business_date
        AND c.source_id = day.source_id
       GROUP BY day.business_date, day.source_id
       HAVING ${having.join(' AND ')}
       ORDER BY day.business_date DESC, day.source_id ASC
       LIMIT 400`
    );
    const bindParams = [...params];
    if (start) bindParams.push(start);
    if (end) bindParams.push(end);
    try {
      statement.bind(bindParams);
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const closeDay = async ({ businessDate, sourceId, sourceType = 'group', closedBy = 'admin-web' } = {}) =>
  runWrite((database) => {
    const date = String(businessDate || '').trim();
    const source = String(sourceId || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !source) return null;

    const summary = computeDaySummary(database, date, source);
    const now = nowIso();
    database.run(
      `INSERT INTO capture_daily_closings
         (business_date, source_type, source_id, status, summary_json, closed_by, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'closed', ?, ?, ?, ?, ?)
       ON CONFLICT(business_date, source_id) DO UPDATE SET
         status = 'closed',
         source_type = excluded.source_type,
         summary_json = excluded.summary_json,
         closed_by = excluded.closed_by,
         closed_at = excluded.closed_at,
         reopened_at = NULL,
         reopened_reason = NULL,
         updated_at = excluded.updated_at`,
      [date, sourceType || 'group', source, normalizeJson(summary), closedBy, now, now, now]
    );

    return { business_date: date, source_id: source, status: 'closed', closed_at: now, closed_by: closedBy, summary };
  });

export const reopenDay = async ({ businessDate, sourceId } = {}) =>
  runWrite((database) => {
    const date = String(businessDate || '').trim();
    const source = String(sourceId || '').trim();
    if (!date || !source) return null;

    const now = nowIso();
    database.run(
      `UPDATE capture_daily_closings
       SET status = 'open', updated_at = ?
       WHERE business_date = ? AND source_id = ?`,
      [now, date, source]
    );
    return { business_date: date, source_id: source, status: 'open' };
  });

export const getDayReport = async ({ businessDate, sourceId } = {}) =>
  runRead((database) => {
    const date = String(businessDate || '').trim();
    const source = String(sourceId || '').trim();
    if (!validDate(date) || !source) return null;

    const closingStmt = database.prepare(
      `SELECT * FROM capture_daily_closings WHERE business_date = ? AND source_id = ? LIMIT 1`,
      [date, source]
    );
    let closing;
    try {
      closing = getFirstRow(closingStmt);
    } finally {
      closingStmt.free();
    }
    if (!closing) return { business_date: date, source_id: source, closing: null, transactions: [], reimbursements: [] };

    const transactionStmt = database.prepare(
      `SELECT
         m.id AS match_id, m.match_group_key, m.score, m.confirmed_at, m.review_note,
         b.id AS bill_id, b.vendor_name, b.supplier_name, b.bill_purpose, b.bill_total_value,
         b.doc_ref, b.generated_document_type, b.generated_document_json,
         b.event_timestamp_ms AS bill_timestamp_ms,
         (SELECT display_name FROM line_senders ls WHERE ls.source_type = b.source_type AND ls.source_id = b.source_id AND ls.user_id = b.sender_user_id LIMIT 1) AS bill_sender,
         s.id AS slip_id, s.slip_amount_value, s.event_timestamp_ms AS slip_timestamp_ms,
         (SELECT display_name FROM line_senders ls WHERE ls.source_type = s.source_type AND ls.source_id = s.source_id AND ls.user_id = s.sender_user_id LIMIT 1) AS slip_sender
       FROM capture_matches m
       JOIN capture_items b ON b.id = m.bill_item_id
       JOIN capture_items s ON s.id = m.slip_item_id
       WHERE m.status = 'confirmed'
         AND b.status NOT IN ('unsent', 'duplicate')
         AND s.status NOT IN ('unsent', 'duplicate')
         AND (CASE WHEN m.match_group_key IS NULL THEN b.source_id ELSE (
           SELECT gb.source_id
           FROM capture_matches gm
           JOIN capture_items gb ON gb.id = gm.bill_item_id
           WHERE gm.match_group_key = m.match_group_key
           ORDER BY COALESCE(gb.event_timestamp_ms, 0), gb.id
           LIMIT 1
         ) END) = ?
         AND (CASE WHEN m.match_group_key IS NULL THEN (${matchBusinessDateSql('b')}) ELSE (
           SELECT (${matchBusinessDateSql('gb')})
           FROM capture_matches gm
           JOIN capture_items gb ON gb.id = gm.bill_item_id
           WHERE gm.match_group_key = m.match_group_key
           ORDER BY COALESCE(gb.event_timestamp_ms, 0), gb.id
           LIMIT 1
         ) END) = ?
       ORDER BY COALESCE(b.event_timestamp_ms, 0), b.id`,
      [source, date]
    );
    let transactions;
    try {
      transactions = allRows(transactionStmt);
    } finally {
      transactionStmt.free();
    }

    const groupedTransactions = new Map();
    for (const row of transactions) {
      const key = row.match_group_key || `match-${row.match_id}`;
      if (!groupedTransactions.has(key)) {
        groupedTransactions.set(key, { ...row, bill_members: [], slip_members: [], is_group: Boolean(row.match_group_key) });
      }
      const group = groupedTransactions.get(key);
      if (!group.bill_members.some((member) => Number(member.bill_id) === Number(row.bill_id))) {
        group.bill_members.push({
          bill_id: row.bill_id, vendor_name: row.vendor_name, supplier_name: row.supplier_name,
          bill_purpose: row.bill_purpose, bill_total_value: row.bill_total_value,
          doc_ref: row.doc_ref, generated_document_type: row.generated_document_type,
          generated_document_json: row.generated_document_json,
          bill_timestamp_ms: row.bill_timestamp_ms, bill_sender: row.bill_sender
        });
      }
      if (!group.slip_members.some((member) => Number(member.slip_id) === Number(row.slip_id))) {
        group.slip_members.push({
          slip_id: row.slip_id, slip_amount_value: row.slip_amount_value,
          slip_timestamp_ms: row.slip_timestamp_ms, slip_sender: row.slip_sender
        });
      }
    }
    transactions = [...groupedTransactions.values()].map((group) => ({
      ...group,
      bill_total_value: group.bill_members.reduce((sum, member) => sum + Number(member.bill_total_value || 0), 0),
      slip_amount_value: group.slip_members.reduce((sum, member) => sum + Number(member.slip_amount_value || 0), 0),
      vendor_name: group.is_group ? `ชุดรวม ${group.bill_members.length} บิล · ${group.slip_members.length} สลิป` : group.vendor_name
    }));

    for (const transaction of transactions) {
      transaction.attachments = [];
      for (const bill of transaction.bill_members) {
        if (!bill.doc_ref) continue;
        const attachmentStmt = database.prepare(
          `SELECT id, category, page_no, page_count
           FROM capture_items
           WHERE source_id = ? AND doc_ref = ? AND category = 'bill_page'
             AND status NOT IN ('unsent', 'duplicate')
           ORDER BY COALESCE(page_no, 999), id`,
          [source, bill.doc_ref]
        );
        try {
          transaction.attachments.push(...allRows(attachmentStmt));
        } finally {
          attachmentStmt.free();
        }
      }
    }

    const reimbursementStmt = database.prepare(
      `SELECT
         r.id AS reimbursement_id, r.slip_amount_value AS reimbursement_amount,
         r.bill_purpose, r.reimbursement_evidence_mode, r.reimbursement_review_note,
         r.event_timestamp_ms AS reimbursement_timestamp_ms,
         (SELECT display_name FROM line_senders ls WHERE ls.source_type = r.source_type AND ls.source_id = r.source_id AND ls.user_id = r.sender_user_id LIMIT 1) AS reimbursement_sender,
         a.id AS advance_id, a.slip_amount_value AS advance_amount,
         a.event_timestamp_ms AS advance_timestamp_ms,
         (SELECT display_name FROM line_senders ls WHERE ls.source_type = a.source_type AND ls.source_id = a.source_id AND ls.user_id = a.sender_user_id LIMIT 1) AS advance_sender
       FROM capture_items r
       JOIN capture_items a ON a.id = r.reimbursement_related_item_id
       WHERE r.source_id = ?
         AND (${matchBusinessDateSql('r')}) = ?
         AND r.payment_role = 'reimbursement'
         AND r.reimbursement_status = 'confirmed'
         AND r.status NOT IN ('unsent', 'duplicate')
       ORDER BY COALESCE(r.event_timestamp_ms, 0), r.id`,
      [source, date]
    );
    let reimbursements;
    try {
      reimbursements = allRows(reimbursementStmt);
    } finally {
      reimbursementStmt.free();
    }

    return {
      business_date: date,
      source_id: source,
      closing: { ...closing, summary: parseStoredJson(closing.summary_json, {}) },
      transactions,
      reimbursements
    };
  });

export const listMatches = async ({ status, sourceId, start, end, limit = 100, offset = 0 } = {}) =>
  runRead((database) => {
    const where = [];
    const params = [];
    if (status) {
      where.push('m.status = ?');
      params.push(status);
    }
    if (sourceId) {
      where.push('b.source_id = ?');
      params.push(sourceId);
    }
    if (validDate(start)) {
      where.push(`(${matchBusinessDateSql('b')}) >= ?`);
      params.push(start);
    }
    if (validDate(end)) {
      where.push(`(${matchBusinessDateSql('b')}) <= ?`);
      params.push(end);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const statement = database.prepare(
      `SELECT
         m.*,
         b.line_message_id AS bill_line_message_id,
         b.source_id AS bill_source_id,
         b.vendor_name AS bill_vendor_name,
         b.bill_total_value AS bill_total_value,
         b.bill_total_text AS bill_total_text,
         b.ai_confidence AS bill_ai_confidence,
         b.event_timestamp_ms AS bill_event_timestamp_ms,
         s.line_message_id AS slip_line_message_id,
         s.source_id AS slip_source_id,
         s.slip_amount_value AS slip_amount_value,
         s.slip_amount_text AS slip_amount_text,
         s.slip_amount_confidence AS slip_amount_confidence,
         s.ai_confidence AS slip_ai_confidence,
         s.event_timestamp_ms AS slip_event_timestamp_ms
       FROM capture_matches m
       JOIN capture_items b ON b.id = m.bill_item_id
       JOIN capture_items s ON s.id = m.slip_item_id
       ${sqlWhere}
       ORDER BY datetime(m.updated_at) DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [...params, clampLimit(limit, 100, 500), clampOffset(offset)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });
