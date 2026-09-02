import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { summarizeCompleteness } from './ingest-completeness.js';
import {
  cpAxtraReferenceForItem,
  isCpAxtraBill,
  isCpAxtraSlip
} from './cp-axtra.js';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_DIR = path.resolve(process.env.CAPTURE_DATA_DIR || DEFAULT_DATA_DIR);
const DB_PATH = process.env.CAPTURE_DB_PATH
  ? path.resolve(process.env.CAPTURE_DB_PATH)
  : path.join(DATA_DIR, 'line-bill-capture.sqlite');

let db = null;
let writeQueue = Promise.resolve();
const writeContext = new AsyncLocalStorage();
let savepointSequence = 0;

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
      canonical_user_id TEXT,
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
      download_attempt_count INTEGER NOT NULL DEFAULT 0,
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
      slip_amount_edited_at TEXT,
      slip_amount_edited_by TEXT,
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
      ai_error_kind TEXT,
      ai_next_retry_at TEXT,
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
      context_message_id INTEGER,
      context_link_method TEXT,
      context_link_confidence REAL,
      context_link_reason TEXT,
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

    CREATE TABLE IF NOT EXISTS capture_cash_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_item_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      business_date TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_by TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      voided_by TEXT,
      voided_at TEXT,
      void_reason TEXT
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

    CREATE TABLE IF NOT EXISTS ai_category_learning_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL UNIQUE,
      original_category TEXT NOT NULL,
      corrected_category TEXT NOT NULL,
      reason TEXT NOT NULL,
      ai_response TEXT NOT NULL,
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
      includes_image INTEGER NOT NULL DEFAULT 0,
      image_item_id INTEGER,
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

    CREATE TABLE IF NOT EXISTS decision_events (
      id TEXT PRIMARY KEY,
      action_key TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      actor TEXT,
      route TEXT,
      method TEXT,
      page_url TEXT,
      reason_code TEXT,
      reason_text TEXT,
      evidence_json TEXT,
      context_snapshot TEXT,
      request_payload TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      result_summary TEXT,
      committed_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shadow_predictions (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      model TEXT,
      predicted_action TEXT,
      confidence REAL,
      rationale TEXT,
      risk_flags TEXT,
      comparison_status TEXT,
      usage_payload TEXT,
      input_snapshot TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decision_followups (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      answered_by TEXT,
      answered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_capture_cash_payments_bill
      ON capture_cash_payments(bill_item_id, status);
    CREATE INDEX IF NOT EXISTS idx_capture_cash_payments_date
      ON capture_cash_payments(business_date, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_cash_payments_active_bill
      ON capture_cash_payments(bill_item_id) WHERE status = 'confirmed';
    CREATE INDEX IF NOT EXISTS idx_decision_events_created
      ON decision_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_events_action
      ON decision_events(action_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_shadow_predictions_status
      ON shadow_predictions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_followups_status
      ON decision_followups(status, created_at DESC);
  `);

  addColumnIfMissing(db, 'line_groups', 'message_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'line_groups', 'text_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'line_senders', 'canonical_user_id', 'TEXT');
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
  addColumnIfMissing(db, 'capture_items', 'slip_amount_edited_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'slip_amount_edited_by', 'TEXT');
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
  addColumnIfMissing(db, 'capture_items', 'ai_error_kind', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'ai_next_retry_at', 'TEXT');
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
  addColumnIfMissing(db, 'capture_items', 'download_attempt_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_items', 'notes', 'TEXT');
  // Set when the AI finds the typed amount and the amount on the document
  // disagree; such pairs are never auto-confirmed and wait for a human review.
  addColumnIfMissing(db, 'capture_items', 'amount_review_flag', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_items', 'flag_resolved_at', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'flag_resolved_by', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'context_message_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_items', 'context_link_method', 'TEXT');
  addColumnIfMissing(db, 'capture_items', 'context_link_confidence', 'REAL');
  addColumnIfMissing(db, 'capture_items', 'context_link_reason', 'TEXT');
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
  addColumnIfMissing(db, 'decision_events', 'evidence_json', 'TEXT');
  addColumnIfMissing(db, 'line_transfer_requests', 'includes_image', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'line_transfer_requests', 'image_item_id', 'INTEGER');
  addColumnIfMissing(db, 'capture_matches', 'ai_learning_approved', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'capture_matches', 'reviewed_by', 'TEXT');
  addColumnIfMissing(db, 'capture_matches', 'reviewed_at', 'TEXT');
  // One transaction may contain several bills and/or several transfer slips.
  // Rows sharing this key are presented and reviewed as one aggregate match.
  addColumnIfMissing(db, 'capture_matches', 'match_group_key', 'TEXT');
  addColumnIfMissing(db, 'capture_daily_closings', 'reopened_at', 'TEXT');
  addColumnIfMissing(db, 'capture_daily_closings', 'reopened_reason', 'TEXT');
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_capture_items_ai_retry
      ON capture_items(status, ai_status, ai_next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_line_senders_canonical
      ON line_senders(source_type, source_id, canonical_user_id);
  `);
};

function repairSenderCanonicalAliasesSync(database) {
  database.run(
    `UPDATE line_senders AS imported
     SET canonical_user_id = (
       SELECT MIN(live.user_id)
       FROM line_senders live
       WHERE live.source_type = imported.source_type
         AND live.source_id = imported.source_id
         AND live.display_name = imported.display_name
         AND live.user_id NOT LIKE 'line-export-user-%'
     )
     WHERE imported.user_id LIKE 'line-export-user-%'
       AND imported.canonical_user_id IS NULL
       AND (
         SELECT COUNT(DISTINCT live.user_id)
         FROM line_senders live
         WHERE live.source_type = imported.source_type
           AND live.source_id = imported.source_id
           AND live.display_name = imported.display_name
           AND live.user_id NOT LIKE 'line-export-user-%'
       ) = 1`
  );
}

function repairLegacyAiRetriesSync(database) {
  const now = nowIso();
  database.run(
    `UPDATE capture_items
     SET ai_error_kind = 'storage_missing', ai_next_retry_at = NULL, updated_at = ?
     WHERE ai_status = 'failed' AND ai_error LIKE '%ENOENT%'`,
    [now]
  );
  database.run(
    `UPDATE capture_items
     SET ai_error_kind = 'transient', ai_next_retry_at = ?, updated_at = ?
     WHERE ai_status = 'failed'
       AND ai_next_retry_at IS NULL
       AND ai_error NOT LIKE '%ENOENT%'
       AND (ai_error LIKE '%OpenAI vision request failed%'
         OR ai_error LIKE '%fetch failed%'
         OR ai_error LIKE '%timeout%'
         OR ai_error LIKE '%ECONN%')`,
    [now, now]
  );
}

function repairGeneratedDocumentAiStateSync(database) {
  const now = nowIso();
  database.run(
    `UPDATE capture_items
     SET ai_status = 'done',
         ai_provider = COALESCE(ai_provider, 'manual'),
         ai_error = NULL,
         ai_error_kind = NULL,
         ai_next_retry_at = NULL,
         ai_processed_at = COALESCE(ai_processed_at, updated_at, created_at, ?),
         ai_attempt_count = 0,
         updated_at = ?
     WHERE generated_document_type IS NOT NULL
       AND trim(generated_document_type) <> ''
       AND ai_status <> 'done'`,
    [now, now]
  );
}

function repairLegacyAiConfirmedMatchesSync(database) {
  const statement = database.prepare(
    `SELECT * FROM capture_matches
     WHERE status = 'confirmed'
       AND COALESCE(created_by, '') = 'ai-worker'
       AND COALESCE(reviewed_by, '') IN ('', 'ai-worker')`
  );
  let matches;
  try {
    matches = allRows(statement);
  } finally {
    statement.free();
  }
  if (!matches.length) return 0;
  const now = nowIso();
  const itemIds = new Set();
  for (const match of matches) {
    const storedReasons = parseStoredJson(match.reason_json, []);
    const nextReasons = [
      ...(Array.isArray(storedReasons) ? storedReasons : []),
      'ย้ายกลับมารอตรวจ: AI ห้ามยืนยันรายการเสร็จแทนผู้ใช้งาน'
    ];
    database.run(
      `UPDATE capture_matches
       SET status = 'pending', reason_json = ?, reviewed_by = NULL,
           reviewed_at = NULL, confirmed_at = NULL, updated_at = ?
       WHERE id = ?`,
      [normalizeJson(nextReasons), now, Number(match.id)]
    );
    itemIds.add(Number(match.bill_item_id));
    itemIds.add(Number(match.slip_item_id));
  }
  for (const itemId of [...itemIds].filter(Boolean)) {
    syncItemMatchStateSync(database, itemId, now);
    reopenClosedDayForItem(
      database,
      getItemByIdSync(database, itemId),
      'พบคู่เดิมที่ AI ยืนยันเอง จึงเปิดรอบกลับมาให้คนตรวจ'
    );
  }
  return matches.length;
}

function repairLegacyClosingTransactionDatesSync(database) {
  const statement = database.prepare(
    `SELECT business_date, source_id, summary_json
     FROM capture_daily_closings
     WHERE status = 'closed'`
  );
  let closings;
  try {
    closings = allRows(statement);
  } finally {
    statement.free();
  }

  const affected = new Map();
  const addAffected = (businessDate, sourceId) => {
    if (validDate(businessDate) && sourceId) affected.set(`${businessDate}|${sourceId}`, { businessDate, sourceId });
  };
  for (const closing of closings) {
    const snapshot = parseStoredJson(closing.summary_json, {});
    if (Number(snapshot?.snapshot_version || 0) >= 5 || !Array.isArray(snapshot?.transactions)) continue;
    for (const transaction of snapshot.transactions) {
      if (transaction?.payment_method === 'cash') continue;
      const timestamps = (transaction?.slip_members || [])
        .map((member) => Number(member?.slip_timestamp_ms || 0))
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      if (!timestamps.length) continue;
      const transferDate = new Date(timestamps[0] + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      if (transferDate === closing.business_date) continue;
      addAffected(closing.business_date, closing.source_id);
      addAffected(transferDate, closing.source_id);
    }
  }

  const now = nowIso();
  for (const { businessDate, sourceId } of affected.values()) {
    const closing = database.prepare(
      `SELECT status FROM capture_daily_closings WHERE business_date = ? AND source_id = ? LIMIT 1`,
      [businessDate, sourceId]
    );
    let exists;
    try {
      exists = getFirstRow(closing)?.status === 'closed';
    } finally {
      closing.free();
    }
    if (!exists) continue;
    const summary = buildDayClosingSnapshotSync(database, businessDate, sourceId);
    database.run(
      `UPDATE capture_daily_closings SET summary_json = ?, updated_at = ?
       WHERE business_date = ? AND source_id = ? AND status = 'closed'`,
      [normalizeJson(summary), now, businessDate, sourceId]
    );
  }
  return affected.size;
}

export const initDatabase = async () => {
  if (db) return db;

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(getImagesDir(), { recursive: true });
  db = new NativeDatabase(DB_PATH);

  ensureSchema();
  let staleUnsentPaths = [];
  db.run('BEGIN IMMEDIATE');
  try {
    repairLegacyDuplicateCanonicalsSync(db);
    repairSenderCanonicalAliasesSync(db);
    repairLegacyAiRetriesSync(db);
    repairGeneratedDocumentAiStateSync(db);
    repairMarketAnnouncementsSync(db);
    repairPaymentVoucherBillsSync(db);
    repairLegacyAiConfirmedMatchesSync(db);
    repairInvalidActiveMatchesSync(db);
    repairLegacyClosingTransactionDatesSync(db);
    staleUnsentPaths = clearLegacyUnsentStoragePathsSync(db);
    reconcileCaptureItemMatchStateSync(db);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  await Promise.all(staleUnsentPaths.map(async (storagePath) => {
    const absolutePath = path.resolve(String(storagePath || ''));
    const dataRoot = `${path.resolve(DATA_DIR)}${path.sep}`;
    if (!absolutePath.startsWith(dataRoot)) return;
    await fs.unlink(absolutePath).catch((error) => {
      if (error?.code !== 'ENOENT') console.warn(`[LINE CAPTURE] unable to remove unsent image ${absolutePath}:`, error?.message || error);
    });
  }));
  return db;
};

const runWrite = async (operation) => {
  const active = writeContext.getStore();
  if (active?.database === db) {
    const savepoint = `nested_write_${++savepointSequence}`;
    db.run(`SAVEPOINT ${savepoint}`);
    try {
      const result = await operation(db);
      db.run(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.run(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  const previous = writeQueue;
  let release;
  writeQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    await initDatabase();
    db.run('BEGIN IMMEDIATE');
    try {
      const result = await writeContext.run({ database: db }, () => operation(db));
      db.run('COMMIT');
      return result;
    } catch (error) {
      try {
        db.run('ROLLBACK');
      } catch {
        // Preserve the original operation error if SQLite already rolled back.
      }
      throw error;
    }
  } finally {
    release();
  }
};

const runRead = async (operation) => {
  await writeQueue;
  await initDatabase();
  return operation(db);
};

const SHADOW_SENSITIVE_KEY = /(password|secret|token|authorization|api[_-]?key|account[_-]?(number|no)?|promptpay|เลขบัญชี)/i;
const redactDecisionForShadow = (value, key = '', depth = 0) => {
  if (depth > 8) return '[MAX_DEPTH]';
  if (SHADOW_SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactDecisionForShadow(entry, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDecisionForShadow(entryValue, entryKey, depth + 1)]));
  }
  if (typeof value === 'string') return value
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/\b\d[\d -]{7,}\d\b/g, '[REDACTED_NUMBER]')
    .slice(0, 4000);
  return value;
};

export const createDecisionEvent = async ({
  actionKey,
  entityType = '',
  entityId = '',
  actor = 'admin-web',
  pageUrl = '',
  contextSnapshot = {}
} = {}) => runWrite((database) => {
  const id = crypto.randomUUID();
  const shadowId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const now = nowIso();
  const frozen = {
    captured_at: now,
    action_key: String(actionKey || '').trim(),
    entity_type: String(entityType || '').trim() || null,
    entity_id: entityId == null ? null : String(entityId),
    page_url: String(pageUrl || '').slice(0, 500) || null,
    context: contextSnapshot && typeof contextSnapshot === 'object' ? contextSnapshot : {}
  };
  const shadowFrozen = { ...frozen, context: redactDecisionForShadow(frozen.context) };
  database.run(
    `INSERT INTO decision_events
       (id, action_key, entity_type, entity_id, actor, page_url, context_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, frozen.action_key, frozen.entity_type, frozen.entity_id, actor, frozen.page_url, normalizeJson(frozen), now, now]
  );
  database.run(
    `INSERT INTO shadow_predictions
       (id, decision_id, run_id, status, input_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    [shadowId, id, runId, normalizeJson(shadowFrozen), now, now]
  );
  return { id, shadow_run_id: runId, shadow_status: 'queued', frozen };
});

export const cancelDecisionEvent = async ({ id, actor = 'admin-web' } = {}) => runWrite((database) => {
  const now = nowIso();
  database.run(
    `UPDATE decision_events
     SET status = 'cancelled', result_summary = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND actor = ? AND status = 'created'`,
    [normalizeJson({ cancelled_before_commit: true }), now, now, id, actor]
  );
  return { id, cancelled: database.getRowsModified() > 0 };
});

export const commitDecisionEvent = async ({
  id,
  actionKey,
  route,
  method,
  reasonCode,
  reasonText,
  evidenceMessageIds = [],
  requestPayload
} = {}) => runWrite((database) => {
  const row = getFirstRow(database.prepare(`SELECT * FROM decision_events WHERE id = ? LIMIT 1`, [id]));
  if (!row) return { error: 'decision_not_found' };
  if (!['created', 'committed'].includes(String(row.status || ''))) return { error: 'decision_already_used' };
  const selectedIds = [...new Set((Array.isArray(evidenceMessageIds) ? evidenceMessageIds : [])
    .map((value) => Number(value || 0)).filter((value) => Number.isInteger(value) && value > 0))].slice(0, 12);
  let evidence = [];
  if (selectedIds.length) {
    const placeholders = selectedIds.map(() => '?').join(', ');
    const evidenceStmt = database.prepare(
      `SELECT lm.id, lm.line_message_id, lm.message_type, lm.source_type, lm.source_id,
              lm.sender_user_id, lm.text, lm.event_timestamp_ms, lm.status,
              ci.id AS capture_item_id, ls.display_name AS sender_display_name
       FROM line_messages lm
       LEFT JOIN capture_items ci
         ON ci.source_type = lm.source_type AND ci.source_id = lm.source_id
        AND ci.line_message_id = lm.line_message_id
       LEFT JOIN line_senders ls
         ON ls.source_type = lm.source_type AND ls.source_id = lm.source_id
        AND ls.user_id = lm.sender_user_id
       WHERE lm.id IN (${placeholders}) AND lm.status = 'active'
       ORDER BY COALESCE(lm.event_timestamp_ms, 0), lm.id`,
      selectedIds
    );
    try {
      evidence = allRows(evidenceStmt).map((message) => ({
        id: Number(message.id),
        line_message_id: message.line_message_id || null,
        message_type: message.message_type || 'unknown',
        source_type: message.source_type || null,
        source_id: message.source_id || null,
        sender_user_id: message.sender_user_id || null,
        sender_display_name: message.sender_display_name || null,
        text: String(message.text || '').slice(0, 2000) || null,
        event_timestamp_ms: Number(message.event_timestamp_ms || 0) || null,
        capture_item_id: Number(message.capture_item_id || 0) || null
      }));
    } finally {
      evidenceStmt.free();
    }
  }
  const now = nowIso();
  database.run(
    `UPDATE decision_events
     SET action_key = ?, route = ?, method = ?, reason_code = ?, reason_text = ?, evidence_json = ?, request_payload = ?,
         status = 'committed', committed_at = ?, updated_at = ?
     WHERE id = ?`,
    [actionKey, route, method, reasonCode, reasonText || null, normalizeJson(evidence), normalizeJson(requestPayload || {}), now, now, id]
  );
  return { id, status: 'committed', evidence_count: evidence.length };
});

const reconcileDecisionComparisonSync = (database, id, now = nowIso()) => {
  const shadow = getFirstRow(database.prepare(
    `SELECT predicted_action, status, risk_flags FROM shadow_predictions WHERE decision_id = ? LIMIT 1`,
    [id]
  ));
  if (shadow?.status === 'completed') {
    const decision = getFirstRow(database.prepare(`SELECT action_key, status FROM decision_events WHERE id = ?`, [id]));
    if (!['committed', 'completed', 'failed'].includes(String(decision?.status || ''))) return;
    const predicted = String(shadow.predicted_action || '').trim();
    const actual = String(decision?.action_key || '').trim();
    const comparison = predicted === 'insufficient_evidence' ? 'insufficient' : predicted === actual ? 'agree' : 'disagree';
    database.run(`UPDATE shadow_predictions SET comparison_status = ?, updated_at = ? WHERE decision_id = ?`, [comparison, now, id]);
    const risks = parseStoredJson(shadow.risk_flags, []);
    if (comparison === 'disagree' || risks.length > 0) {
      const exists = getFirstRow(database.prepare(
        `SELECT id FROM decision_followups WHERE decision_id = ? AND status = 'open' LIMIT 1`, [id]
      ));
      if (!exists) {
        const question = comparison === 'disagree'
          ? `Shadow AI เสนอ “${predicted}” แต่ผู้ใช้เลือก “${actual}” มีหลักฐานหรือบริบทอะไรที่ AI ยังไม่เห็น?`
          : `รายการนี้มีความเสี่ยง ${risks.join(', ')} โปรดระบุหลักฐานสำคัญที่ใช้ยืนยันเพิ่มเติม`;
        database.run(
          `INSERT INTO decision_followups (id, decision_id, question, status, created_at, updated_at)
           VALUES (?, ?, ?, 'open', ?, ?)`,
          [crypto.randomUUID(), id, question, now, now]
        );
      }
    }
  }
};

export const finishDecisionEvent = async ({ id, success, httpStatus } = {}) => runWrite((database) => {
  const now = nowIso();
  database.run(
    `UPDATE decision_events SET status = ?, result_summary = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [success ? 'completed' : 'failed', normalizeJson({ http_status: Number(httpStatus || 0) }), now, now, id]
  );
  reconcileDecisionComparisonSync(database, id, now);
  return { id };
});

export const reconcileDecisionComparison = async (id) => runWrite((database) => {
  reconcileDecisionComparisonSync(database, id);
  return { id };
});

export const updateShadowPrediction = async ({ decisionId, values = {} } = {}) => runWrite((database) => {
  const allowed = new Map([
    ['status', 'status'], ['model', 'model'], ['predictedAction', 'predicted_action'],
    ['confidence', 'confidence'], ['rationale', 'rationale'], ['riskFlags', 'risk_flags'],
    ['usagePayload', 'usage_payload'], ['errorMessage', 'error_message'],
    ['startedAt', 'started_at'], ['completedAt', 'completed_at']
  ]);
  const sets = [];
  const params = [];
  for (const [key, column] of allowed.entries()) {
    if (!(key in values)) continue;
    sets.push(`${column} = ?`);
    params.push(['riskFlags', 'usagePayload'].includes(key) ? normalizeJson(values[key]) : values[key]);
  }
  if (!sets.length) return null;
  sets.push('updated_at = ?');
  params.push(nowIso(), decisionId);
  database.run(`UPDATE shadow_predictions SET ${sets.join(', ')} WHERE decision_id = ?`, params);
  if (values.status === 'completed') reconcileDecisionComparisonSync(database, decisionId);
  return { decision_id: decisionId };
});

export const getDecisionEvent = async (id) => runRead((database) => {
  const row = getFirstRow(database.prepare(
    `SELECT d.*, s.run_id, s.status AS shadow_status, s.model AS shadow_model, s.input_snapshot,
            s.predicted_action, s.confidence, s.rationale, s.risk_flags, s.comparison_status,
            s.usage_payload, s.error_message
     FROM decision_events d LEFT JOIN shadow_predictions s ON s.decision_id = d.id WHERE d.id = ? LIMIT 1`,
    [id]
  ));
  if (!row) return null;
  return {
    ...row,
    context_snapshot: parseStoredJson(row.context_snapshot, {}),
    evidence: parseStoredJson(row.evidence_json, []),
    input_snapshot: parseStoredJson(row.input_snapshot, {}),
    request_payload: parseStoredJson(row.request_payload, {}),
    risk_flags: parseStoredJson(row.risk_flags, []),
    usage_payload: parseStoredJson(row.usage_payload, {})
  };
});

export const listDecisionEvents = async ({ limit = 100, actionKey = '', comparison = '' } = {}) => runRead((database) => {
  const where = [];
  const params = [];
  if (actionKey) { where.push('d.action_key = ?'); params.push(actionKey); }
  if (comparison) { where.push('s.comparison_status = ?'); params.push(comparison); }
  params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
  const statement = database.prepare(
    `SELECT d.*, s.run_id, s.status AS shadow_status, s.model AS shadow_model,
            s.predicted_action, s.confidence, s.rationale, s.risk_flags, s.comparison_status,
            f.id AS followup_id, f.question AS followup_question, f.answer AS followup_answer, f.status AS followup_status
     FROM decision_events d
     LEFT JOIN shadow_predictions s ON s.decision_id = d.id
     LEFT JOIN decision_followups f ON f.decision_id = d.id AND f.status = 'open'
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC LIMIT ?`,
    params
  );
  try {
    return allRows(statement).map((row) => ({
      ...row,
      context_snapshot: parseStoredJson(row.context_snapshot, {}),
      evidence: parseStoredJson(row.evidence_json, []),
      risk_flags: parseStoredJson(row.risk_flags, [])
    }));
  } finally { statement.free(); }
});

export const answerDecisionFollowup = async ({ decisionId, answer, answeredBy = 'admin-web' } = {}) => runWrite((database) => {
  const now = nowIso();
  const existing = getFirstRow(database.prepare(
    `SELECT id FROM decision_followups WHERE decision_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    [decisionId]
  ));
  const id = existing?.id || crypto.randomUUID();
  if (existing) {
    database.run(
      `UPDATE decision_followups SET answer = ?, status = 'answered', answered_by = ?, answered_at = ?, updated_at = ? WHERE id = ?`,
      [answer, answeredBy, now, now, id]
    );
  } else {
    database.run(
      `INSERT INTO decision_followups
         (id, decision_id, question, answer, status, answered_by, answered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'answered', ?, ?, ?, ?)`,
      [id, decisionId, 'เหตุผลเพิ่มเติมจากผู้ใช้งาน', answer, answeredBy, now, now, now]
    );
  }
  return { id, decision_id: decisionId, status: 'answered' };
});

export const getDecisionAgentHealth = async () => runRead((database) => {
  const decision = getFirstRow(database.prepare(
    `SELECT COUNT(*) total, COALESCE(SUM(status = 'completed'), 0) completed,
            COALESCE(SUM(status = 'failed'), 0) failed,
            COALESCE(SUM(status = 'cancelled'), 0) cancelled FROM decision_events`
  )) || {};
  const shadow = getFirstRow(database.prepare(
    `SELECT COALESCE(SUM(status = 'completed'), 0) completed,
            COALESCE(SUM(status = 'failed'), 0) failed,
            COALESCE(SUM(status = 'skipped'), 0) skipped,
            COALESCE(SUM(comparison_status = 'agree'), 0) agreed,
            COALESCE(SUM(comparison_status = 'disagree'), 0) disagreed
     FROM shadow_predictions WHERE created_at >= datetime('now', '-7 days')`
  )) || {};
  const statement = database.prepare(
    `SELECT run_id, decision_id, status, model, predicted_action, confidence, comparison_status, error_message, created_at, completed_at
     FROM shadow_predictions ORDER BY created_at DESC LIMIT 30`
  );
  try {
    return { decisions: decision, last_7_days: shadow, recent_runs: allRows(statement) };
  } finally { statement.free(); }
});

export const getDecisionAgentRun = async (runId) => runRead((database) => {
  const row = getFirstRow(database.prepare(
    `SELECT s.*, d.action_key, d.entity_type, d.entity_id, d.reason_code, d.reason_text, d.status AS decision_status
     FROM shadow_predictions s JOIN decision_events d ON d.id = s.decision_id WHERE s.run_id = ? LIMIT 1`,
    [runId]
  ));
  return row ? { ...row, risk_flags: parseStoredJson(row.risk_flags, []), input_snapshot: parseStoredJson(row.input_snapshot, {}) } : null;
});

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
  voidActiveCashPaymentSync(database, itemId, 'บิลเงินสดถูกตรวจพบว่าเป็นเอกสารซ้ำ', 'system');
  detachItemFromActiveMatchesSync(
    database,
    itemId,
    `${String(reason || 'เอกสารซ้ำกับบิลเดิม')} (duplicate_of ${duplicateOfItemId})`
  );
  clearReimbursementLinksSync(database, [itemId], 'เอกสารถูกจัดเป็นรายการซ้ำ');

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

export const listPendingImageDownloads = async ({ limit = 200, maxAttempts = 5 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT id, line_message_id, source_type, source_id, sender_user_id,
              raw_event_json, event_timestamp_ms, created_at, download_attempt_count
       FROM capture_items
       WHERE status = 'received'
          OR (status = 'download_failed' AND download_attempt_count < ?)
       ORDER BY COALESCE(event_timestamp_ms, 0) ASC, id ASC
       LIMIT ?`,
      [Math.max(1, Math.min(20, Number(maxAttempts || 5))), clampLimit(limit, 200, 1000)]
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
    const daily = database.prepare(
      `WITH latest AS (
         SELECT MAX(event_timestamp_ms) AS timestamp_ms FROM line_messages
       )
       SELECT source_id,
              date(event_timestamp_ms / 1000, 'unixepoch', '+7 hours') AS business_date,
              COUNT(*) AS message_count,
              SUM(CASE WHEN message_type = 'image' THEN 1 ELSE 0 END) AS image_count
       FROM line_messages, latest
       WHERE status <> 'unsent'
         AND event_timestamp_ms IS NOT NULL
         AND event_timestamp_ms >= latest.timestamp_ms - (60 * 86400000)
       GROUP BY source_id, business_date
       ORDER BY business_date, source_id`
    );
    try {
      const eventRow = getFirstRow(event) || {};
      const itemRow = getFirstRow(items) || {};
      const completeness = summarizeCompleteness(allRows(daily));
      return {
        last_event_at: eventRow.last_event_at || null,
        event_count: Number(eventRow.event_count || 0),
        pending_downloads: Number(itemRow.pending_downloads || 0),
        failed_downloads: Number(itemRow.failed_downloads || 0),
        completeness: {
          ...completeness,
          lookback_days: 60,
          checked_at: nowIso()
        }
      };
    } finally {
      event.free();
      items.free();
      daily.free();
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
      `SELECT existing.id
       FROM capture_items current
       JOIN capture_items existing
         ON existing.source_type = current.source_type
        AND existing.source_id = current.source_id
        AND existing.file_sha256 = ?
        AND existing.line_message_id <> current.line_message_id
        AND existing.status = 'downloaded'
       WHERE current.line_message_id = ?
       ORDER BY existing.id ASC
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
           download_attempt_count = 0,
           downloaded_at = ?,
           updated_at = ?
       WHERE line_message_id = ? AND status <> 'unsent'`,
      [
        duplicate ? 'duplicate' : 'downloaded',
        contentType,
        fileExtension,
        fileSizeBytes,
        fileSha256,
        storagePath,
        storageRelativePath,
        duplicateOfItemId,
        nowIso(),
        nowIso(),
        lineMessageId
      ]
    );
    const saved = rowsModified(database) > 0;
    return { saved, duplicate: saved && duplicate, duplicateOfItemId: saved ? duplicateOfItemId : null };
  });

export const markDownloadFailed = async ({ lineMessageId, errorMessage }) =>
  runWrite((database) => {
    database.run(
      `UPDATE capture_items
       SET status = 'download_failed',
           download_error = ?,
           download_attempt_count = download_attempt_count + 1,
           updated_at = ?
       WHERE line_message_id = ? AND status <> 'unsent'`,
      [String(errorMessage || 'unknown error').slice(0, 5000), nowIso(), lineMessageId]
    );
  });

export const deduplicateImages = async () =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT id, source_type, source_id, file_sha256, status, storage_path, duplicate_of_item_id
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
        const identity = `${row.source_type}:${row.source_id}:${hash}`;
        const original = seen.get(identity);
        if (!original) {
          seen.set(identity, row);
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
      voidActiveCashPaymentSync(database, duplicate.itemId, 'รูปเงินสดถูกตรวจพบว่าเป็นรูปซ้ำ', 'system');
      detachItemFromActiveMatchesSync(database, duplicate.itemId, 'รูปซ้ำ ไม่ใช้จับคู่เอกสาร');
      clearReimbursementLinksSync(database, [duplicate.itemId], 'รูปซ้ำ ไม่ใช้เป็นหลักฐานคืนเงิน');
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

const promoteDuplicateForCanonicalSync = (database, canonical, now = nowIso()) => {
  if (!canonical?.id) return null;
  const statement = database.prepare(
    `SELECT id, file_sha256, storage_path, storage_relative_path
     FROM capture_items
     WHERE status = 'duplicate' AND duplicate_of_item_id = ?
     ORDER BY CASE WHEN file_sha256 = ? THEN 0 ELSE 1 END,
              CASE WHEN storage_path IS NOT NULL THEN 0 ELSE 1 END,
              id ASC`,
    [Number(canonical.id), String(canonical.file_sha256 || '')]
  );
  let candidates;
  try {
    candidates = allRows(statement);
  } finally {
    statement.free();
  }
  const replacement = candidates.find((candidate) => candidate.storage_path || (
    canonical.storage_path
    && String(candidate.file_sha256 || '') === String(canonical.file_sha256 || '')
  ));
  if (!replacement) return null;

  const transferredStorage = !replacement.storage_path && Boolean(canonical.storage_path);
  const promotedPath = replacement.storage_path || canonical.storage_path;
  const promotedRelativePath = replacement.storage_relative_path || canonical.storage_relative_path;
  database.run(
    `UPDATE capture_items
     SET status = 'downloaded', duplicate_of_item_id = NULL,
         storage_path = ?, storage_relative_path = ?, download_error = NULL,
         matched_item_id = NULL, match_status = 'unmatched', notes = NULL, updated_at = ?
     WHERE id = ?`,
    [promotedPath, promotedRelativePath, now, Number(replacement.id)]
  );
  database.run(
    `UPDATE capture_items SET duplicate_of_item_id = ?, updated_at = ?
     WHERE status = 'duplicate' AND duplicate_of_item_id = ? AND id <> ?`,
    [Number(replacement.id), now, Number(canonical.id), Number(replacement.id)]
  );
  if (transferredStorage) {
    database.run(
      `UPDATE capture_items SET storage_path = NULL, storage_relative_path = NULL, updated_at = ? WHERE id = ?`,
      [now, Number(canonical.id)]
    );
  }
  return { replacementId: Number(replacement.id), transferredStorage };
};

function repairLegacyDuplicateCanonicalsSync(database) {
  const statement = database.prepare(
    `SELECT d.id
     FROM capture_items d
     LEFT JOIN capture_items c ON c.id = d.duplicate_of_item_id
     WHERE d.status = 'duplicate' AND (c.id IS NULL OR c.status <> 'downloaded')
     ORDER BY d.id`
  );
  let ids;
  try {
    ids = allRows(statement).map((row) => Number(row.id || 0)).filter(Boolean);
  } finally {
    statement.free();
  }
  const now = nowIso();
  for (const id of ids) {
    const duplicate = getItemByIdSync(database, id);
    if (!duplicate || duplicate.status !== 'duplicate') continue;
    const canonical = getItemByIdSync(database, duplicate.duplicate_of_item_id);
    if (canonical?.status === 'downloaded') continue;
    if (canonical && promoteDuplicateForCanonicalSync(database, canonical, now)) continue;
    if (duplicate.storage_path) {
      database.run(
        `UPDATE capture_items
         SET status = 'downloaded', duplicate_of_item_id = NULL,
             matched_item_id = NULL, match_status = 'unmatched', notes = NULL, updated_at = ?
         WHERE id = ?`,
        [now, id]
      );
      continue;
    }
    database.run(
      `UPDATE capture_items
       SET status = 'download_failed', duplicate_of_item_id = NULL,
           download_error = 'duplicate canonical is unavailable', updated_at = ?
       WHERE id = ?`,
      [now, id]
    );
  }
}

function clearLegacyUnsentStoragePathsSync(database) {
  const statement = database.prepare(
    `SELECT DISTINCT unsent.storage_path
     FROM capture_items unsent
     WHERE unsent.status = 'unsent' AND unsent.storage_path IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM capture_items live
         WHERE live.storage_path = unsent.storage_path AND live.status <> 'unsent'
       )`
  );
  let storagePaths;
  try {
    storagePaths = allRows(statement).map((row) => row.storage_path).filter(Boolean);
  } finally {
    statement.free();
  }
  if (storagePaths.length) {
    database.run(
      `UPDATE capture_items
       SET storage_path = NULL, storage_relative_path = NULL, updated_at = ?
       WHERE status = 'unsent' AND (storage_path IS NOT NULL OR storage_relative_path IS NOT NULL)`,
      [nowIso()]
    );
  }
  return storagePaths;
}

export const markUnsent = async (lineMessageId) =>
  runWrite((database) => {
    const previous = getItemByMessageIdSync(database, lineMessageId);
    const now = nowIso();
    if (previous) {
      voidActiveCashPaymentSync(database, previous.id, 'LINE unsend ลบรูปบิลที่ชำระเงินสด', 'system');
      detachItemFromActiveMatchesSync(database, previous.id, 'LINE unsend ลบหลักฐานที่ใช้จับคู่');
      clearReimbursementLinksSync(database, [previous.id], 'LINE unsend ลบหลักฐานคืนเงิน');
      reopenClosedDayForItem(database, previous, 'มีการยกเลิกข้อความหรือรูปหลังปิดรอบ');

      const promotion = promoteDuplicateForCanonicalSync(database, previous, now);
      if (promotion?.transferredStorage) {
        previous.storage_path = null;
        previous.storage_relative_path = null;
      }
    }
    const previousPath = previous?.storage_path || null;
    database.run(
      `UPDATE capture_items
       SET status = 'unsent',
           unsent_at = ?,
           storage_path = NULL,
           storage_relative_path = NULL,
           matched_item_id = NULL,
           match_status = 'unmatched',
           reimbursement_related_item_id = NULL,
           reimbursement_status = 'unmatched',
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
    let deleteStoragePath = null;
    if (previousPath) {
      const referenceStmt = database.prepare(
        `SELECT COUNT(*) AS count FROM capture_items
         WHERE storage_path = ? AND status <> 'unsent'`,
        [previousPath]
      );
      try {
        if (Number(getFirstRow(referenceStmt)?.count || 0) === 0) deleteStoragePath = previousPath;
      } finally {
        referenceStmt.free();
      }
    }
    return previous ? { ...previous, storage_path: deleteStoragePath } : null;
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
// Once documents are paired, the accounting transaction belongs to the transfer date.
// Aggregate matches use the earliest slip in the group as their single anchor date.
const matchTransactionDateSql = (matchAlias = 'm', slipAlias = 's') => `(CASE
  WHEN ${matchAlias}.match_group_key IS NULL THEN (${matchBusinessDateSql(slipAlias)})
  ELSE (
    SELECT (${matchBusinessDateSql('anchor_slip')})
    FROM capture_matches anchor_match
    JOIN capture_items anchor_slip ON anchor_slip.id = anchor_match.slip_item_id
    WHERE anchor_match.match_group_key = ${matchAlias}.match_group_key
      AND anchor_match.status = ${matchAlias}.status
      AND anchor_slip.status NOT IN ('unsent', 'duplicate')
    ORDER BY COALESCE(anchor_slip.event_timestamp_ms, 0), anchor_slip.id
    LIMIT 1
  ) END)`;
const ITEM_BUSINESS_DATE_SQL = matchBusinessDateSql('');

const ACTIVE_MATCH_STATUSES = new Set(['pending', 'confirmed', 'manual_review']);
const ACTIVE_MATCH_STATUS_SQL = "'pending', 'confirmed', 'manual_review'";
const BILL_CATEGORIES = new Set(['bill']);
const SLIP_CATEGORIES = new Set(['transfer', 'transfer_notice']);

const isMarketBill = (item) => {
  const purpose = String(item?.bill_purpose || '').trim();
  if (/^บิลตลาด/.test(purpose) || /^ตลาด$/.test(purpose) || /ตลาดสด/.test(purpose)) return true;
  // Older analyses called the daily market sheet a closing summary and left
  // bill_purpose empty. Keep recognizing those rows so the deterministic chat
  // repair can recover their payable and transfer amounts on startup.
  return /ซื้อของตลาด|รายการซื้อของตลาด|ของตลาดวันที่|ตลาดสด|สรุปยอดปิดตลาด|แบบสรุปยอด.*ตลาด/.test(String(item?.ai_summary || ''));
};

const thaiDateKey = (value) => {
  const match = String(value || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2500;
  else if (year < 2400) year += 543;
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseMarketAnnouncement = (value) => {
  const text = String(value || '').replace(/\u00a0/g, ' ').trim();
  const date = text.match(/ตลาด\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4})/i)?.[1] || '';
  const billText = text.match(/จ่าย\s*([0-9][0-9,]*(?:\.\d+)?)/i)?.[1] || '';
  const transferText = text.match(/โอนเพิ่ม\s*([0-9][0-9,]*(?:\.\d+)?)/i)?.[1] || '';
  const billTotal = Number(billText.replaceAll(',', ''));
  const transferTotal = Number(transferText.replaceAll(',', ''));
  if (!date || !Number.isFinite(billTotal) || billTotal <= 0 || !Number.isFinite(transferTotal) || transferTotal <= 0) {
    return null;
  }
  return { text, date: date.replace(/\s+/g, ''), dateKey: thaiDateKey(date), billTotal, transferTotal };
};

const paymentVoucherAmount = (item, result = {}) => {
  const structured = Number(item?.bill_total_value ?? result?.bill_total_value);
  if (Number.isFinite(structured) && structured > 0) return structured;
  const text = `${item?.ai_raw_text || ''} ${item?.ai_summary || ''}`;
  const totalMatches = [...text.matchAll(
    /(?:รวม(?:เงิน|ทั้งสิ้น)?|ยอดรวม|GRAND\s+TOTAL|TOTAL(?:\s+AMOUNT)?)[^0-9]{0,30}([0-9][0-9,]*(?:\.\d+)?)/gi
  )];
  const amountMatch = text.match(/(?:จำนวนเงิน|AMOUNT)[^0-9]{0,30}([0-9][0-9,]*(?:\.\d+)?)/i);
  const value = String(totalMatches.at(-1)?.[1] || amountMatch?.[1] || '').replaceAll(',', '');
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function repairPaymentVoucherBillsSync(database) {
  const statement = database.prepare(
    `SELECT * FROM capture_items
     WHERE category IN ('other', 'payment_voucher')
       AND category_edited_at IS NULL
       AND status = 'downloaded'
       AND (ai_raw_text LIKE '%ใบสำคัญจ่าย%'
         OR ai_raw_text LIKE '%PAYMENT VOUCHER%'
         OR ai_summary LIKE '%ใบสำคัญจ่าย%')
     ORDER BY id`
  );
  let rows;
  try {
    rows = allRows(statement);
  } finally {
    statement.free();
  }

  const now = nowIso();
  let repaired = 0;
  for (const item of rows) {
    const result = parseStoredJson(item.ai_result_json, {}) || {};
    const amount = paymentVoucherAmount(item, result);
    const purpose = String(item.bill_purpose || result.bill_purpose || '').trim() || null;
    const summary = `ใบสำคัญจ่าย${purpose ? ` ${purpose}` : ''}${amount ? ` ยอด ${amount.toLocaleString('en-US')} บาท` : ''} ใช้เป็นบิลสำหรับจับคู่หลักฐานการจ่าย`;
    const storedResult = {
      ...result,
      category: 'bill',
      document_type: 'bill',
      document_class: 'payment_voucher',
      bill_total_text: amount ? amount.toFixed(2) : null,
      bill_total_value: amount,
      amount_conflict: false,
      needs_review: !(amount > 0),
      summary,
      evidence: [
        ...(Array.isArray(result.evidence) ? result.evidence : []),
        'หัวเอกสารระบุ ใบสำคัญจ่าย / PAYMENT VOUCHER จึงใช้เป็นหลักฐานฝั่งบิล'
      ].slice(0, 20)
    };
    database.run(
      `UPDATE capture_items
       SET category = 'bill', bill_total_text = ?, bill_total_value = ?,
           bill_purpose = COALESCE(NULLIF(bill_purpose, ''), ?),
           match_status = CASE
             WHEN match_status IN ('unmatched', 'needs_amount') THEN ?
             ELSE match_status END,
           amount_review_flag = 0, ai_summary = ?, ai_result_json = ?, updated_at = ?
       WHERE id = ? AND category_edited_at IS NULL`,
      [
        amount ? amount.toFixed(2) : null,
        amount,
        purpose,
        amount ? 'unmatched' : 'needs_amount',
        summary,
        normalizeJson(storedResult),
        now,
        Number(item.id)
      ]
    );
    if (database.getRowsModified()) {
      repaired += 1;
      reopenClosedDayForItem(database, item, 'ระบบแก้ใบสำคัญจ่ายให้เป็นบิลสำหรับจับคู่หลักฐานการจ่าย');
    }
  }
  return repaired;
}

function repairMarketAnnouncementsSync(database) {
  const statement = database.prepare(
    `SELECT * FROM capture_items
     WHERE category = 'bill' AND status = 'downloaded'
       AND (bill_purpose LIKE '%ตลาด%' OR ai_summary LIKE '%ตลาด%' OR ai_raw_text LIKE '%ตลาด%')
     ORDER BY id`
  );
  let bills;
  try {
    bills = allRows(statement);
  } finally {
    statement.free();
  }

  let repaired = 0;
  const now = nowIso();
  for (const bill of bills) {
    if (!isMarketBill(bill)) continue;
    const itemTime = Number(bill.event_timestamp_ms || 0);
    const contextStmt = database.prepare(
      `SELECT text, sender_user_id, event_timestamp_ms
       FROM line_messages
       WHERE source_type = ? AND source_id = ? AND message_type = 'text' AND status = 'active'
         AND (? <= 0 OR event_timestamp_ms BETWEEN ? AND ?)
       ORDER BY event_timestamp_ms`,
      [bill.source_type, bill.source_id, itemTime, itemTime - (6 * 60 * 60 * 1000), itemTime + (6 * 60 * 60 * 1000)]
    );
    let messages;
    try {
      messages = allRows(contextStmt);
    } finally {
      contextStmt.free();
    }
    const documentDateKey = thaiDateKey(`${bill.bill_purpose || ''} ${bill.ai_raw_text || ''} ${bill.ai_summary || ''}`);
    const candidates = messages.map((message) => {
      const announcement = parseMarketAnnouncement(message.text);
      if (!announcement) return null;
      return {
        ...announcement,
        sameSender: Boolean(bill.sender_user_id && message.sender_user_id === bill.sender_user_id),
        exactDate: Boolean(documentDateKey && announcement.dateKey === documentDateKey),
        distance: itemTime > 0 && Number(message.event_timestamp_ms || 0) > 0
          ? Math.abs(Number(message.event_timestamp_ms) - itemTime)
          : Number.POSITIVE_INFINITY
      };
    }).filter(Boolean).sort((left, right) => {
      if (left.exactDate !== right.exactDate) return left.exactDate ? -1 : 1;
      if (left.sameSender !== right.sameSender) return left.sameSender ? -1 : 1;
      return left.distance - right.distance;
    });
    const market = candidates[0];
    if (!market || (documentDateKey && !market.exactDate)) continue;
    const needsRepair = Math.abs(Number(bill.bill_total_value || 0) - market.billTotal) >= 0.01
      || Math.abs(Number(bill.announced_amount || 0) - market.transferTotal) >= 0.01
      || Number(bill.amount_review_flag || 0) !== 0;
    if (!needsRepair) continue;

    const result = parseStoredJson(bill.ai_result_json, {});
    const nextResult = result && typeof result === 'object' && !Array.isArray(result)
      ? {
        ...result,
        bill_total_value: market.billTotal,
        announced_amount: market.transferTotal,
        amount_conflict: false,
        needs_review: false
      }
      : result;
    database.run(
      `UPDATE capture_items
       SET bill_total_value = ?, announced_amount = ?, amount_review_flag = 0,
           bill_purpose = ?, ai_summary = ?, ai_result_json = ?,
           flag_resolved_at = CASE WHEN amount_review_flag = 1 THEN ? ELSE flag_resolved_at END,
           flag_resolved_by = CASE WHEN amount_review_flag = 1 THEN 'deterministic-market-rule' ELSE flag_resolved_by END,
           updated_at = ?
       WHERE id = ?`,
      [
        market.billTotal,
        market.transferTotal,
        `บิลตลาด ${market.date}`,
        `บิลตลาด ${market.date} ยอดซื้อ ${market.billTotal.toLocaleString('en-US')} บาท ยอดโอนตามข้อความ ${market.transferTotal.toLocaleString('en-US')} บาท`,
        normalizeJson(nextResult),
        now,
        now,
        Number(bill.id)
      ]
    );
    repaired += 1;
  }
  return repaired;
}

const effectiveBillAmount = (item) => {
  const announced = Number(item?.announced_amount || 0);
  if (isMarketBill(item) && Number.isFinite(announced) && announced > 0) return announced;
  const documentAmount = Number(item?.bill_total_value || 0);
  return Number.isFinite(documentAmount) ? documentAmount : 0;
};

const getActiveCashPaymentSync = (database, billItemId) => {
  const statement = database.prepare(
    `SELECT * FROM capture_cash_payments
     WHERE bill_item_id = ? AND status = 'confirmed'
     ORDER BY id DESC LIMIT 1`,
    [Number(billItemId || 0)]
  );
  try {
    return getFirstRow(statement);
  } finally {
    statement.free();
  }
};

const voidActiveCashPaymentSync = (database, billItemId, reason, actor = 'system') => {
  const payment = getActiveCashPaymentSync(database, billItemId);
  if (!payment) return null;
  const bill = getItemByIdSync(database, billItemId);
  const now = nowIso();
  database.run(
    `UPDATE capture_cash_payments
     SET status = 'voided', voided_by = ?, voided_at = ?, void_reason = ?,
         updated_by = ?, updated_at = ?
     WHERE id = ? AND status = 'confirmed'`,
    [String(actor || 'system'), now, String(reason || 'ยกเลิกรายการเงินสด').slice(0, 1000),
      String(actor || 'system'), now, Number(payment.id)]
  );
  syncItemMatchStateSync(database, billItemId, now);
  reopenClosedDayForItem(database, bill, reason || 'มีการยกเลิกรายการเงินสดหลังปิดรอบ');
  return { ...payment, status: 'voided', voided_by: actor, voided_at: now, void_reason: reason };
};

const isHumanMatchDecision = (match) => {
  if (!match) return false;
  const creator = String(match.created_by || '').trim();
  const reviewer = String(match.reviewed_by || '').trim();
  return Boolean((creator && creator !== 'ai-worker') || (reviewer && reviewer !== 'ai-worker'));
};

const businessDateForItemSync = (database, itemId) => {
  const statement = database.prepare(
    `SELECT ${matchBusinessDateSql('ci')} AS business_date
     FROM capture_items ci WHERE ci.id = ? LIMIT 1`,
    [Number(itemId || 0)]
  );
  try {
    return String(getFirstRow(statement)?.business_date || '');
  } finally {
    statement.free();
  }
};

function reopenClosedDayForItem(database, item, reason) {
  if (!item) return false;
  const businessDate = businessDateForItemSync(database, item.id);
  if (!businessDate) return false;
  const now = nowIso();
  database.run(
    `UPDATE capture_daily_closings
     SET status = 'open', reopened_at = ?, reopened_reason = ?, updated_at = ?
     WHERE business_date = ? AND source_id = ? AND status = 'closed'`,
    [now, String(reason || '').slice(0, 300) || null, now, businessDate, String(item.source_id || '')]
  );
  return rowsModified(database) > 0;
}

const listActiveMatchesSync = (database) => {
  const statement = database.prepare(
    `SELECT * FROM capture_matches
     WHERE status IN (${ACTIVE_MATCH_STATUS_SQL})`
  );
  try {
    return allRows(statement);
  } finally {
    statement.free();
  }
};

const activeMatchComponentSync = (database, initialItemIds = []) => {
  const itemIds = new Set(initialItemIds.map(Number).filter(Boolean));
  const groupKeys = new Set();
  const selectedMatchIds = new Set();
  const matches = listActiveMatchesSync(database);
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of matches) {
      const matchId = Number(match.id || 0);
      const billId = Number(match.bill_item_id || 0);
      const slipId = Number(match.slip_item_id || 0);
      const groupKey = String(match.match_group_key || '');
      if (!itemIds.has(billId) && !itemIds.has(slipId) && !(groupKey && groupKeys.has(groupKey))) continue;
      if (!selectedMatchIds.has(matchId)) {
        selectedMatchIds.add(matchId);
        changed = true;
      }
      if (billId && !itemIds.has(billId)) {
        itemIds.add(billId);
        changed = true;
      }
      if (slipId && !itemIds.has(slipId)) {
        itemIds.add(slipId);
        changed = true;
      }
      if (groupKey && !groupKeys.has(groupKey)) {
        groupKeys.add(groupKey);
        changed = true;
      }
    }
  }
  return {
    matches: matches.filter((match) => selectedMatchIds.has(Number(match.id || 0))),
    itemIds: [...itemIds],
    groupKeys: [...groupKeys]
  };
};

const syncItemMatchStateSync = (database, itemId, now = nowIso()) => {
  const id = Number(itemId || 0);
  const statement = database.prepare(
    `SELECT bill_item_id, slip_item_id, status
     FROM capture_matches
     WHERE status IN (${ACTIVE_MATCH_STATUS_SQL})
       AND (bill_item_id = ? OR slip_item_id = ?)
     ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'manual_review' THEN 1 ELSE 2 END, id ASC`,
    [id, id]
  );
  let matches;
  try {
    matches = allRows(statement);
  } finally {
    statement.free();
  }
  if (!matches.length) {
    const item = getItemByIdSync(database, id);
    const cashPayment = item?.category === 'bill' ? getActiveCashPaymentSync(database, id) : null;
    const nextStatus = cashPayment
      ? 'confirmed'
      : item?.category === 'bill' && effectiveBillAmount(item) <= 0 ? 'needs_amount' : 'unmatched';
    if (item && (item.matched_item_id != null || String(item.match_status || '') !== nextStatus)) {
      database.run(
        `UPDATE capture_items SET matched_item_id = NULL, match_status = ?, updated_at = ? WHERE id = ?`,
        [nextStatus, now, id]
      );
    }
    return;
  }
  const statuses = matches.map((match) => String(match.status || 'pending'));
  const nextStatus = statuses.every((status) => status === 'confirmed')
    ? 'confirmed'
    : statuses.some((status) => status === 'manual_review') ? 'manual_review' : 'pending';
  const first = matches[0];
  const counterpartId = Number(first.bill_item_id) === id
    ? Number(first.slip_item_id || 0)
    : Number(first.bill_item_id || 0);
  const item = getItemByIdSync(database, id);
  if (item && (Number(item.matched_item_id || 0) !== counterpartId || String(item.match_status || '') !== nextStatus)) {
    database.run(
      `UPDATE capture_items SET matched_item_id = ?, match_status = ?, updated_at = ? WHERE id = ?`,
      [counterpartId || null, nextStatus, now, id]
    );
  }
};

function reconcileCaptureItemMatchStateSync(database) {
  const statement = database.prepare('SELECT id FROM capture_items ORDER BY id');
  let itemIds;
  try {
    itemIds = allRows(statement).map((row) => Number(row.id || 0)).filter(Boolean);
  } finally {
    statement.free();
  }
  const now = nowIso();
  for (const itemId of itemIds) syncItemMatchStateSync(database, itemId, now);
  return itemIds.length;
}

const rejectActiveMatchComponentSync = (database, itemIds, reason) => {
  const component = activeMatchComponentSync(database, itemIds);
  if (!component.matches.length) {
    for (const itemId of component.itemIds) syncItemMatchStateSync(database, itemId);
    return component;
  }
  const now = nowIso();
  const matchIds = component.matches.map((match) => Number(match.id || 0)).filter(Boolean);
  const affectedItems = component.itemIds.map((itemId) => getItemByIdSync(database, itemId)).filter(Boolean);
  database.run(
    `UPDATE capture_matches
     SET status = 'rejected', reason_json = ?, confirmed_at = NULL, updated_at = ?
     WHERE id IN (${matchIds.map(() => '?').join(',')})`,
    [normalizeJson([String(reason || 'ยกเลิกคู่เอกสาร')]), now, ...matchIds]
  );
  for (const item of affectedItems) {
    syncItemMatchStateSync(database, item.id, now);
    if (item.category === 'bill') reopenClosedDayForItem(database, item, reason);
  }
  return component;
};

const clearReimbursementLinksSync = (database, itemIds, reason) => {
  const linkedIds = new Set(itemIds.map(Number).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    const statement = database.prepare(
      `SELECT id, reimbursement_related_item_id
       FROM capture_items
       WHERE reimbursement_related_item_id IS NOT NULL`
    );
    let rows;
    try {
      rows = allRows(statement);
    } finally {
      statement.free();
    }
    for (const row of rows) {
      const id = Number(row.id || 0);
      const relatedId = Number(row.reimbursement_related_item_id || 0);
      if (!linkedIds.has(id) && !linkedIds.has(relatedId)) continue;
      if (id && !linkedIds.has(id)) {
        linkedIds.add(id);
        changed = true;
      }
      if (relatedId && !linkedIds.has(relatedId)) {
        linkedIds.add(relatedId);
        changed = true;
      }
    }
  }
  if (!linkedIds.size) return [];
  const ids = [...linkedIds];
  const rows = ids.map((id) => getItemByIdSync(database, id)).filter(Boolean);
  database.run(
    `UPDATE capture_items
     SET payment_role = CASE WHEN payment_role IN ('advance_payment', 'reimbursement') THEN 'ordinary_payment' ELSE payment_role END,
         reimbursement_related_item_id = NULL,
         reimbursement_status = 'unmatched', reimbursement_reason_json = NULL,
         reimbursement_evidence_mode = NULL, reimbursement_review_note = NULL,
         reimbursement_reviewed_at = NULL, reimbursement_reviewed_by = NULL, updated_at = ?
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    [nowIso(), ...ids]
  );
  for (const item of rows) reopenClosedDayForItem(database, item, reason);
  return ids;
};

const detachItemFromActiveMatchesSync = (database, itemId, reason) =>
  rejectActiveMatchComponentSync(database, [Number(itemId || 0)], reason);

const validateMatchMembers = ({ billRows, slipRows, status }) => {
  if (billRows.some((row) => !row) || slipRows.some((row) => !row)) return 'item_not_found';
  if (billRows.some((row) => !BILL_CATEGORIES.has(row.category))) return 'invalid_bill';
  if (slipRows.some((row) => !SLIP_CATEGORIES.has(row.category))) return 'invalid_slip';
  if ([...billRows, ...slipRows].some((row) => row.status !== 'downloaded')) return 'item_unavailable';
  if ([...billRows, ...slipRows].some((row) => Number(row.id || 0) <= 0)) return 'item_not_found';
  const billTotal = billRows.reduce((sum, row) => sum + effectiveBillAmount(row), 0);
  const slipTotal = slipRows.reduce((sum, row) => sum + Number(row.slip_amount_value || 0), 0);
  if (['pending', 'confirmed', 'manual_review'].includes(status) && (billTotal <= 0 || slipTotal <= 0)) {
    return 'amount_missing';
  }
  if (status === 'confirmed') {
    if ([...billRows, ...slipRows].some((row) => Number(row.amount_review_flag || 0))) return 'amount_review_required';
    if (Math.abs(billTotal - slipTotal) >= 0.01) return 'amount_mismatch';
  }
  return '';
};

function repairInvalidActiveMatchesSync(database) {
  const statement = database.prepare(
    `SELECT * FROM capture_matches
     WHERE status IN (${ACTIVE_MATCH_STATUS_SQL})
     ORDER BY COALESCE(match_group_key, 'm:' || id), id`
  );
  let rows;
  try {
    rows = allRows(statement);
  } finally {
    statement.free();
  }
  const transactions = new Map();
  for (const row of rows) {
    const key = row.match_group_key || `m:${row.id}`;
    if (!transactions.has(key)) transactions.set(key, []);
    transactions.get(key).push(row);
  }

  const now = nowIso();
  for (const edges of transactions.values()) {
    const billRows = [...new Set(edges.map((edge) => Number(edge.bill_item_id || 0)))]
      .map((id) => getItemByIdSync(database, id));
    const slipRows = [...new Set(edges.map((edge) => Number(edge.slip_item_id || 0)))]
      .map((id) => getItemByIdSync(database, id));
    const statuses = [...new Set(edges.map((edge) => String(edge.status || '')))];
    const status = statuses.length === 1 ? statuses[0] : 'invalid';
    const validationError = status === 'invalid'
      ? 'invalid_status'
      : validateMatchMembers({ billRows, slipRows, status });
    if (!validationError) continue;

    const humanDecision = edges.some((edge) => isHumanMatchDecision(edge));
    const canWaitForHumanCorrection = humanDecision
      && ['amount_mismatch', 'amount_review_required'].includes(validationError);
    const nextStatus = canWaitForHumanCorrection ? 'manual_review' : 'rejected';
    const message = validationError === 'amount_mismatch'
      ? 'ตรวจพบคู่เดิมที่ยอดรวมไม่ตรงกัน'
      : validationError === 'amount_review_required'
        ? 'ตรวจพบคู่เดิมที่ยังมีธงตรวจยอด'
        : `ตรวจพบคู่เดิมที่ข้อมูลไม่สมบูรณ์ (${validationError})`;
    for (const edge of edges) {
      const reasons = parseStoredJson(edge.reason_json, []);
      database.run(
        `UPDATE capture_matches
         SET status = ?, reason_json = ?, confirmed_at = NULL, updated_at = ?
         WHERE id = ?`,
        [nextStatus, normalizeJson([...(Array.isArray(reasons) ? reasons : []), message]), now, Number(edge.id)]
      );
    }
    const itemIds = [...new Set([...billRows, ...slipRows].filter(Boolean).map((row) => Number(row.id)))];
    for (const itemId of itemIds) syncItemMatchStateSync(database, itemId, now);
    for (const bill of billRows.filter(Boolean)) reopenClosedDayForItem(database, bill, message);
  }
}

const invalidateIncompatibleMatchesForItemSync = (database, itemId, reason) => {
  const component = activeMatchComponentSync(database, [Number(itemId || 0)]);
  if (!component.matches.length) return false;
  const transactions = new Map();
  for (const match of component.matches) {
    const key = match.match_group_key || `match-${match.id}`;
    if (!transactions.has(key)) transactions.set(key, []);
    transactions.get(key).push(match);
  }
  for (const edges of transactions.values()) {
    const billRows = [...new Set(edges.map((edge) => Number(edge.bill_item_id || 0)))].map((id) => getItemByIdSync(database, id));
    const slipRows = [...new Set(edges.map((edge) => Number(edge.slip_item_id || 0)))].map((id) => getItemByIdSync(database, id));
    const statuses = [...new Set(edges.map((edge) => String(edge.status || '')))].filter(Boolean);
    const status = statuses.length === 1 ? statuses[0] : 'invalid';
    if (status === 'invalid' || validateMatchMembers({ billRows, slipRows, status })) {
      rejectActiveMatchComponentSync(database, component.itemIds, reason);
      return true;
    }
  }
  return false;
};

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
  if (filters.live) {
    where.push("status NOT IN ('unsent', 'duplicate')");
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
  if (['bill', 'bill_page', 'transfer', 'transfer_notice', 'incoming_transfer', 'payment_voucher', 'other'].includes(category)) return category;
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
         (SELECT COALESCE(canonical_user_id, user_id) FROM line_senders ls WHERE ls.source_type = capture_items.source_type AND ls.source_id = capture_items.source_id AND ls.user_id = capture_items.sender_user_id LIMIT 1) AS sender_canonical_user_id,
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
         ai_error_kind,
         ai_next_retry_at,
         ai_processed_at,
         ai_attempt_count,
         ai_input_tokens,
         ai_cached_input_tokens,
         ai_output_tokens,
         ai_reasoning_tokens,
         ai_total_tokens,
         matched_item_id,
         match_status,
         (SELECT cp.id FROM capture_cash_payments cp
           WHERE cp.bill_item_id = capture_items.id AND cp.status = 'confirmed'
           ORDER BY cp.id DESC LIMIT 1) AS cash_payment_id,
         (SELECT cp.amount FROM capture_cash_payments cp
           WHERE cp.bill_item_id = capture_items.id AND cp.status = 'confirmed'
           ORDER BY cp.id DESC LIMIT 1) AS cash_payment_amount,
         (SELECT cp.recipient_name FROM capture_cash_payments cp
           WHERE cp.bill_item_id = capture_items.id AND cp.status = 'confirmed'
           ORDER BY cp.id DESC LIMIT 1) AS cash_recipient_name,
         (SELECT cp.note FROM capture_cash_payments cp
           WHERE cp.bill_item_id = capture_items.id AND cp.status = 'confirmed'
           ORDER BY cp.id DESC LIMIT 1) AS cash_payment_note,
         (SELECT cp.confirmed_at FROM capture_cash_payments cp
           WHERE cp.bill_item_id = capture_items.id AND cp.status = 'confirmed'
           ORDER BY cp.id DESC LIMIT 1) AS cash_confirmed_at,
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
         context_message_id,
         context_link_method,
         context_link_confidence,
         context_link_reason,
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

// Only confirmed payments are useful as suggestions.  Voided rows stay in the
// audit trail but must never make an old recipient look like a current choice.
export const listCashPaymentRecipientHistory = async ({ limit = 24 } = {}) =>
  runRead((database) => {
    const statement = database.prepare(
      `SELECT
         recipient_name,
         COUNT(*) AS payment_count,
         MAX(confirmed_at) AS last_confirmed_at,
         (SELECT recent.note
            FROM capture_cash_payments recent
           WHERE recent.status = 'confirmed'
             AND recent.recipient_name = payment.recipient_name
           ORDER BY datetime(recent.confirmed_at) DESC, recent.id DESC
           LIMIT 1) AS last_note
       FROM capture_cash_payments payment
       WHERE payment.status = 'confirmed'
         AND TRIM(payment.recipient_name) <> ''
       GROUP BY payment.recipient_name
       ORDER BY datetime(last_confirmed_at) DESC, payment_count DESC, recipient_name COLLATE NOCASE ASC
       LIMIT ?`,
      [clampLimit(limit, 24, 100)]
    );
    try {
      return allRows(statement).map((row) => ({
        recipient_name: String(row.recipient_name || ''),
        payment_count: Number(row.payment_count || 0),
        last_confirmed_at: row.last_confirmed_at || null,
        last_note: String(row.last_note || '')
      }));
    } finally {
      statement.free();
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
         COALESCE(ls.canonical_user_id, lm.sender_user_id) AS sender_canonical_user_id,
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
  canonicalUserId,
  profileStatus = 'unknown'
}) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `INSERT INTO line_senders
        (source_type, source_id, user_id, display_name, picture_url, status_message, profile_status, canonical_user_id, last_fetched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id, user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, line_senders.display_name),
         picture_url = COALESCE(excluded.picture_url, line_senders.picture_url),
         status_message = COALESCE(excluded.status_message, line_senders.status_message),
         profile_status = excluded.profile_status,
         canonical_user_id = COALESCE(excluded.canonical_user_id, line_senders.canonical_user_id),
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
        String(canonicalUserId || '').trim() || null,
        now,
        now,
        now
      ]
    );
    repairSenderCanonicalAliasesSync(database);
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
         ls.canonical_user_id,
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

export const listAiQueueItems = async ({ limit = 10, maxAttempts = 8, staleBeforeIso } = {}) =>
  runRead((database) => {
    const staleCutoff = String(staleBeforeIso || '').trim() || '1970-01-01T00:00:00.000Z';
    const statement = database.prepare(
      `SELECT capture_items.*,
         COALESCE(ls.canonical_user_id, capture_items.sender_user_id) AS sender_canonical_user_id
       FROM capture_items
       LEFT JOIN line_senders ls
         ON ls.source_type = capture_items.source_type
        AND ls.source_id = capture_items.source_id
        AND ls.user_id = capture_items.sender_user_id
       WHERE capture_items.status = 'downloaded'
         AND capture_items.storage_path IS NOT NULL
         AND capture_items.generated_document_type IS NULL
         AND (
           capture_items.ai_status = 'pending'
           OR (capture_items.ai_status = 'failed' AND capture_items.ai_next_retry_at IS NOT NULL AND capture_items.ai_next_retry_at <= ?)
           OR (capture_items.ai_status = 'processing' AND capture_items.updated_at < ?)
         )
         AND COALESCE(capture_items.ai_attempt_count, 0) < ?
       ORDER BY COALESCE(capture_items.event_timestamp_ms, 0) ASC, datetime(capture_items.created_at) ASC, capture_items.id ASC
       LIMIT ?`,
      [nowIso(), staleCutoff, Math.max(1, Number(maxAttempts || 8)), clampLimit(limit, 10, 50)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

export const getAiQueueStats = async ({ maxAttempts = 8, staleBeforeIso } = {}) =>
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
         AND generated_document_type IS NULL
         AND (
           ai_status = 'pending'
           OR (ai_status = 'failed' AND ai_next_retry_at IS NOT NULL AND ai_next_retry_at <= ?)
           OR (ai_status = 'processing' AND updated_at < ?)
         )
         AND COALESCE(ai_attempt_count, 0) < ?`,
      [nowIso(), staleCutoff, Math.max(1, Number(maxAttempts || 8))]
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
         AND (
           match_status = 'unmatched'
           OR (
             match_status = 'pending'
             AND EXISTS (
               SELECT 1 FROM capture_matches am
               WHERE am.status = 'pending' AND am.created_by = 'ai-worker'
                 AND am.reviewed_by IS NULL AND am.reviewed_at IS NULL
                 AND (am.bill_item_id = capture_items.id OR am.slip_item_id = capture_items.id)
             )
           )
         )
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
           ai_error_kind = NULL,
           ai_next_retry_at = NULL,
           ai_attempt_count = COALESCE(ai_attempt_count, 0) + 1,
           updated_at = ?
       WHERE id = ?
         AND status = 'downloaded'
         AND (
           ai_status = 'pending'
           OR (ai_status = 'failed' AND ai_next_retry_at IS NOT NULL AND ai_next_retry_at <= ?)
           OR (ai_status = 'processing' AND updated_at < ?)
         )`,
      [provider || null, model || null, now, Number(id || 0), now, staleCutoff]
    );
    return rowsModified(database) === 1 ? getItemByIdSync(database, id) : null;
  });

export const markAiFailed = async ({ id, provider, model, errorMessage, errorKind = 'permanent', nextRetryAt = null }) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `UPDATE capture_items
       SET ai_status = 'failed',
           ai_provider = ?,
           ai_model = ?,
           ai_error = ?,
           ai_error_kind = ?,
           ai_next_retry_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        provider || null,
        model || null,
        String(errorMessage || 'unknown AI error').slice(0, 5000),
        String(errorKind || 'permanent').slice(0, 80),
        nextRetryAt || null,
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
    delete storedAnalysis._context_link;
    const contextLink = analysis?._context_link && typeof analysis._context_link === 'object'
      ? analysis._context_link
      : null;
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
      'ai_error_kind = NULL',
      'ai_next_retry_at = NULL',
      'context_message_id = ?',
      'context_link_method = ?',
      'context_link_confidence = ?',
      'context_link_reason = ?',
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
      Number(contextLink?.messageId || 0) || null,
      contextLink?.method || null,
      Number.isFinite(Number(contextLink?.confidence)) ? Number(contextLink.confidence) : null,
      contextLink?.reason || null,
      now,
      now
    ];

    // Re-analysis must replace an earlier AI category, including a mistaken `other`.
    // Only a category explicitly corrected by an admin is immutable.
    if (!current.category_edited_at) {
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

    if (['bill', 'transfer', 'transfer_notice'].includes(category)
        && (!current.bill_purpose || (category === 'bill' && contextLink?.messageId))) {
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
    // Only a bill can be "waiting for an amount". When the AI (or a human) moves the item to any
    // other category the flag must go, or the board counts it as work forever while the day view
    // never lists it — a task nobody can open, let alone finish.
    if (category !== 'bill' && current.match_status === 'needs_amount') {
      updates.push('match_status = ?');
      params.push('unmatched');
    }
    if (category === 'bill' && (current.match_status === 'unmatched' || current.match_status === 'needs_amount')) {
      updates.push('match_status = ?');
      params.push(Number.isFinite(billTotalValue) && billTotalValue > 0 ? 'unmatched' : 'needs_amount');
    }
    if ((category === 'transfer' || category === 'transfer_notice' || category === 'incoming_transfer') && !current.slip_amount_edited_at) {
      const amountConflict = Boolean(analysis?.amount_conflict);
      updates.push('slip_amount_text = ?', 'slip_amount_value = ?', 'slip_amount_confidence = ?', 'amount_review_flag = ?', 'payment_role = ?');
      params.push(
        String(analysis?.slip_amount_text || '').trim() || null,
        Number.isFinite(slipAmountValue) ? slipAmountValue : null,
        amountConflict ? Math.min(Number(slipAmountConfidence ?? 0.3), 0.3) : slipAmountConfidence,
        amountConflict ? 1 : 0,
        category === 'incoming_transfer'
          ? 'unknown'
          : ['ordinary_payment', 'advance_payment', 'reimbursement'].includes(String(analysis?.payment_role || ''))
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

    let analyzed = getItemByIdSync(database, id);
    if (analyzed?.reimbursement_related_item_id && !SLIP_CATEGORIES.has(analyzed.category)) {
      clearReimbursementLinksSync(database, [analyzed.id], 'AI อ่านประเภทใหม่ซึ่งไม่ใช่หลักฐานการโอน');
      analyzed = getItemByIdSync(database, id);
    }
    invalidateIncompatibleMatchesForItemSync(
      database,
      id,
      'ผลอ่าน AI ใหม่ทำให้ประเภทหรือยอดของคู่เดิมไม่สอดคล้อง'
    );
    analyzed = getItemByIdSync(database, id);
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
           ls.status_message AS sender_status_message,
           COALESCE(ls.canonical_user_id, lm.sender_user_id) AS sender_canonical_user_id
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
      where.push(`COALESCE(
        (SELECT canonical_user_id FROM line_senders identity
         WHERE identity.source_type = lm.source_type AND identity.source_id = lm.source_id
           AND identity.user_id = lm.sender_user_id LIMIT 1), lm.sender_user_id
      ) = COALESCE(
        (SELECT canonical_user_id FROM line_senders target
         WHERE target.source_type = lm.source_type AND target.source_id = lm.source_id
           AND target.user_id = ? LIMIT 1), ?
      )`);
      params.push(sender, sender);
    }
    params.push(clampLimit(limit, 15, 100));

    const statement = database.prepare(
      `SELECT lm.id, lm.text,
         COALESCE(ls.canonical_user_id, lm.sender_user_id) AS sender_user_id,
         lm.sender_user_id AS original_sender_user_id,
         lm.event_timestamp_ms
       FROM line_messages lm
       LEFT JOIN line_senders ls
         ON ls.source_type = lm.source_type AND ls.source_id = lm.source_id
        AND ls.user_id = lm.sender_user_id
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
           COALESCE(ls.canonical_user_id, lm.sender_user_id) AS sender_user_id,
           lm.sender_user_id AS original_sender_user_id,
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
       FROM (
         SELECT id, outcome, review_note, example_json, approved_by, created_at, updated_at,
           review_note AS ai_response
         FROM ai_learning_examples
         UNION ALL
         SELECT id, 'category_correction' AS outcome, reason AS review_note,
           example_json, approved_by, created_at, updated_at, ai_response
         FROM ai_category_learning_examples
       ) examples
       ORDER BY CASE WHEN ai_response IS NOT NULL AND trim(ai_response) <> '' THEN 0 ELSE 1 END,
                datetime(updated_at) DESC, id DESC
       LIMIT ?`,
      [clampLimit(limit, 20, 100)]
    );
    try {
      return allRows(statement);
    } finally {
      statement.free();
    }
  });

const CATEGORY_LABELS = {
  bill: 'บิล',
  bill_page: 'หน้าประกอบบิล',
  transfer: 'สลิปโอน',
  transfer_notice: 'แจ้งโอน',
  incoming_transfer: 'เงินรับเข้า',
  other: 'อื่น ๆ',
  pending: 'รอ AI อ่าน'
};

export const recordCategoryLearningExample = async ({
  item,
  originalCategory,
  correctedCategory,
  reason,
  aiResponse,
  approvedBy = 'admin-web'
}) =>
  runWrite((database) => {
    const itemId = Number(item?.id || 0);
    if (!itemId) return null;
    const note = String(reason || '').trim().slice(0, 1000);
    const response = String(aiResponse || '').trim().slice(0, 2000);
    // สองระดับ:
    //   explained = คนพิมพ์เหตุผล และ AI ทวนความเข้าใจแล้ว → ตัวอย่างคุณภาพสูง
    //   auto      = คนแค่กดแก้ประเภท ไม่ได้พิมพ์อะไร → ยังเป็นสัญญาณที่ใช้สอนได้
    //               (คู่ ประเภทเดิม→ประเภทใหม่ พร้อมรูป ก็เป็น few-shot example ที่ใช้ได้)
    // เก็บ auto ด้วยเพราะการแก้ที่เกิดบ่อยที่สุดคือคนกดเปลี่ยนเฉย ๆ ถ้าไม่เก็บก็ไม่ได้เรียนอะไรเลย
    const teaching = note && response ? 'explained' : 'auto';
    const fallbackNote = note || `ผู้ใช้แก้ประเภทจาก ${CATEGORY_LABELS[String(originalCategory || '')] || originalCategory || 'ไม่ทราบ'} เป็น ${CATEGORY_LABELS[String(correctedCategory || '')] || correctedCategory || 'ไม่ทราบ'} โดยไม่ได้ระบุเหตุผล`;
    const now = nowIso();
    const example = {
      type: 'category_correction',
      item_id: itemId,
      original_category: String(originalCategory || ''),
      corrected_category: String(correctedCategory || ''),
      teaching,
      owner_reason: fallbackNote,
      ai_understanding: response,
      image_summary_before_correction: item.ai_summary || null,
      image_raw_text_before_correction: item.ai_raw_text || null,
      vendor_name: item.vendor_name || null,
      bill_purpose: item.bill_purpose || null
    };
    database.run(
      `INSERT INTO ai_category_learning_examples
        (item_id, original_category, corrected_category, reason, ai_response,
         example_json, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         original_category = excluded.original_category,
         corrected_category = excluded.corrected_category,
         reason = excluded.reason,
         ai_response = excluded.ai_response,
         example_json = excluded.example_json,
         approved_by = excluded.approved_by,
         updated_at = excluded.updated_at`,
      [itemId, String(originalCategory || ''), String(correctedCategory || ''), fallbackNote,
        response, normalizeJson(example), approvedBy, now, now]
    );
    return example;
  });

export const recordLineTransferRequest = async ({
  itemId,
  sourceType,
  sourceId,
  messageText,
  status,
  requestedBy = 'admin-web',
  includesImage = false,
  imageItemId = null,
  errorMessage = ''
}) =>
  runWrite((database) => {
    const now = nowIso();
    database.run(
      `INSERT INTO line_transfer_requests
        (item_id, source_type, source_id, message_text, status, requested_by,
         includes_image, image_item_id, error_message, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(itemId || 0),
        String(sourceType || ''),
        String(sourceId || ''),
        String(messageText || ''),
        String(status || 'failed'),
        String(requestedBy || 'admin-web'),
        includesImage ? 1 : 0,
        Number(imageItemId || 0) || null,
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

export const updateItemMetadata = async ({ id, category, categoryEditedBy, categoryEditReason, vendorName, supplierName, billPurpose, billTotalText, billTotalValue, slipAmountText, slipAmountValue, notes, editedBy }) =>
  runWrite((database) => {
    const current = getItemByIdSync(database, id);
    if (!current) return null;
    const nextAmount = billTotalText !== undefined ? Number(billTotalValue || 0) : effectiveBillAmount(current);
    const invalidatesCash = Boolean(getActiveCashPaymentSync(database, id)) && (
      (category !== undefined && category !== 'bill')
      || (billTotalText !== undefined && Math.abs(nextAmount - effectiveBillAmount(current)) >= 0.01)
    );
    if (invalidatesCash) {
      voidActiveCashPaymentSync(
        database,
        id,
        category !== undefined && category !== 'bill'
          ? 'ผู้ดูแลเปลี่ยนประเภทเอกสารที่ชำระเงินสด'
          : 'ผู้ดูแลแก้ยอดบิลที่ชำระเงินสด',
        editedBy || categoryEditedBy || 'admin-web'
      );
    }
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
    if (slipAmountText !== undefined) {
      updates.push('slip_amount_text = ?', 'slip_amount_value = ?', 'slip_amount_edited_at = ?', 'slip_amount_edited_by = ?');
      params.push(String(slipAmountText || '').trim() || null, slipAmountValue ?? null, nowIso(), editedBy || null);
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

    let updated = getItemByIdSync(database, id);
    if (updated?.reimbursement_related_item_id && !SLIP_CATEGORIES.has(updated.category)) {
      clearReimbursementLinksSync(database, [updated.id], 'ผู้ดูแลเปลี่ยนประเภทหลักฐานคืนเงิน');
      updated = getItemByIdSync(database, id);
    }
    invalidateIncompatibleMatchesForItemSync(database, id, 'ผู้ดูแลแก้ประเภทหรือยอดของเอกสาร');
    syncItemMatchStateSync(database, id, nowIso());

    const statement = database.prepare(`SELECT * FROM capture_items WHERE id = ? LIMIT 1`, [Number(id || 0)]);
    try {
      return getFirstRow(statement);
    } finally {
      statement.free();
    }
  });

export const updateCategory = async ({ id, category, editedBy, reason }) =>
  updateItemMetadata({ id, category, categoryEditedBy: editedBy, categoryEditReason: reason });

// ซ่อมสถานะจับคู่ของรายการเดียวให้ตรงกับแถวจับคู่จริง
//
// match_status บนรายการเป็นค่าที่คัดลอกมาจากแถวใน capture_matches เพื่อความเร็ว
// ถ้ามันเพี้ยน (เช่นค้างเป็น pending ทั้งที่ไม่มีคู่ค้างอยู่แล้ว) รายการจะกลายเป็น
// "งานผี": ปิดรอบไม่ได้ แต่ไม่โผล่ในถังไหน — ฟังก์ชันนี้คำนวณสถานะที่ถูกต้องใหม่จากของจริง
export const repairItemMatchState = async (itemId) =>
  withDatabase((database) => {
    const id = Number(itemId || 0);
    const before = getItemByIdSync(database, id);
    if (!before) return null;
    syncItemMatchStateSync(database, id, nowIso());
    const after = getItemByIdSync(database, id);
    return {
      item: after,
      changed: String(before.match_status || '') !== String(after?.match_status || ''),
      before_match_status: before.match_status || null,
      after_match_status: after?.match_status || null
    };
  });

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
    invalidateIncompatibleMatchesForItemSync(database, id, 'ผู้ดูแลแก้ยอดของเอกสาร');
    return getItemByIdSync(database, id);
  });

// Re-queue specific items for AI analysis (e.g. after an analyser upgrade such as
// multi-page invoice support). Only touches downloaded, still-present images.
export const requeueAiItems = async ({ ids = [], matchStatus = '', aiStatus = '' } = {}) =>
  runWrite((database) => {
    const now = nowIso();
    const wanted = ids.map((id) => Number(id)).filter(Number.isFinite);
    const where = ["status = 'downloaded'", 'storage_path IS NOT NULL', 'generated_document_type IS NULL'];
    const params = [];
    if (wanted.length) {
      where.push(`id IN (${wanted.map(() => '?').join(',')})`);
      params.push(...wanted);
    }
    if (matchStatus) {
      where.push('match_status = ?');
      params.push(matchStatus);
    }
    // ai_status='failed' คือรูปที่ค้างเพราะ vision API พังชั่วคราว
    // ไม่มีอะไรหยิบไปทำต่อเอง จึงต้องเปิดทางให้สั่งลองใหม่ได้
    if (aiStatus) {
      where.push('ai_status = ?');
      params.push(aiStatus);
    }
    if (!wanted.length && !matchStatus && !aiStatus) return { requeued: 0 };

    database.run(
      `UPDATE capture_items
       SET ai_status = 'pending', ai_attempt_count = 0, ai_error = NULL,
           ai_error_kind = NULL, ai_next_retry_at = NULL, updated_at = ?
       WHERE ${where.join(' AND ')}`,
      [now, ...params]
    );
    return { requeued: rowsModified(database) };
  });

export const setAiQueuePaused = async ({ start = '', end = '', sourceId = '', paused = true } = {}) =>
  runWrite((database) => {
    const rawStart = String(start || '').trim();
    const rawEnd = String(end || '').trim();
    const source = String(sourceId || '').trim();
    if ((rawStart && !validDate(rawStart)) || (rawEnd && !validDate(rawEnd)) || (rawStart && rawEnd && rawStart > rawEnd)) {
      return { error: 'invalid_scope' };
    }
    if (!rawStart && !rawEnd && !source) return { error: 'scope_required' };

    const where = ["status = 'downloaded'", 'storage_path IS NOT NULL', 'generated_document_type IS NULL'];
    const params = [];
    if (rawStart) {
      where.push(`(${matchBusinessDateSql('capture_items')}) >= ?`);
      params.push(rawStart);
    }
    if (rawEnd) {
      where.push(`(${matchBusinessDateSql('capture_items')}) <= ?`);
      params.push(rawEnd);
    }
    if (source) {
      where.push('source_id = ?');
      params.push(source);
    }
    const now = nowIso();
    if (paused) {
      database.run(
        `UPDATE capture_items
         SET ai_status = 'paused', ai_error = 'พักคิวโดยผู้ใช้', ai_error_kind = 'paused_by_user',
             ai_next_retry_at = NULL, updated_at = ?
         WHERE ${where.join(' AND ')}
           AND (ai_status = 'pending' OR (ai_status = 'failed' AND ai_next_retry_at IS NOT NULL))`,
        [now, ...params]
      );
    } else {
      database.run(
        `UPDATE capture_items
         SET ai_status = 'pending', ai_error = NULL, ai_error_kind = NULL,
             ai_next_retry_at = NULL, updated_at = ?
         WHERE ${where.join(' AND ')} AND ai_status = 'paused'`,
        [now, ...params]
      );
    }
    const changed = rowsModified(database);
    const processingStmt = database.prepare(
      `SELECT COUNT(*) AS count FROM capture_items WHERE ${where.join(' AND ')} AND ai_status = 'processing'`,
      params
    );
    let processing = 0;
    try {
      processing = Number(getFirstRow(processingStmt)?.count || 0);
    } finally {
      processingStmt.free();
    }
    return {
      paused: Boolean(paused),
      changed,
      processing,
      start: rawStart || null,
      end: rawEnd || null,
      source_id: source || null
    };
  });

// Re-read every non-manually-classified image after the vision instructions change.
// Keep owner corrections and admin-created matches intact, but discard AI-derived pairing and OCR.
export const resetAllAiAnalysis = async ({ start = '', end = '', sourceId = '' } = {}) =>
  runWrite((database) => {
    const rawStart = String(start || '').trim();
    const rawEnd = String(end || '').trim();
    if ((rawStart && !validDate(rawStart)) || (rawEnd && !validDate(rawEnd))) {
      return { error: 'invalid_date_scope' };
    }
    if (rawStart && rawEnd && rawStart > rawEnd) return { error: 'invalid_date_range' };

    const now = nowIso();
    const scopeParts = [];
    const scopeParams = [];
    if (rawStart) {
      scopeParts.push(`(${matchBusinessDateSql('capture_items')}) >= ?`);
      scopeParams.push(rawStart);
    }
    if (rawEnd) {
      scopeParts.push(`(${matchBusinessDateSql('capture_items')}) <= ?`);
      scopeParams.push(rawEnd);
    }
    if (String(sourceId || '').trim()) {
      scopeParts.push('capture_items.source_id = ?');
      scopeParams.push(String(sourceId).trim());
    }
    const scopeSql = scopeParts.length ? ` AND ${scopeParts.join(' AND ')}` : '';
    const scopedStmt = database.prepare(
      `SELECT id FROM capture_items
       WHERE status = 'downloaded'
         AND generated_document_type IS NULL${scopeSql}`,
      scopeParams
    );
    let scopedIds;
    try {
      scopedIds = allRows(scopedStmt).map((row) => Number(row.id || 0)).filter(Boolean);
    } finally {
      scopedStmt.free();
    }
    if (!scopedIds.length) {
      return {
        requeued: 0,
        reset_ai_matches: 0,
        preserved_manual_categories: 0,
        preserved_human_decisions: 0,
        start: rawStart || null,
        end: rawEnd || null,
        source_id: String(sourceId || '').trim() || null
      };
    }

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

    const idPlaceholders = scopedIds.map(() => '?').join(',');
    const protectedStmt = database.prepare(
      `SELECT DISTINCT ci.id
       FROM capture_items ci
       WHERE ci.id IN (${idPlaceholders})
         AND (
           ci.reimbursement_status = 'confirmed'
           OR EXISTS (
             SELECT 1 FROM capture_cash_payments cp
             WHERE cp.bill_item_id = ci.id AND cp.status = 'confirmed'
           )
           OR EXISTS (
             SELECT 1 FROM capture_matches hm
             WHERE hm.status IN (${ACTIVE_MATCH_STATUS_SQL})
               AND (hm.bill_item_id = ci.id OR hm.slip_item_id = ci.id)
               AND (
                 (hm.reviewed_by IS NOT NULL AND hm.reviewed_by <> 'ai-worker')
                 OR COALESCE(hm.created_by, '') <> 'ai-worker'
               )
           )
         )`,
      scopedIds
    );
    let protectedIds;
    try {
      protectedIds = allRows(protectedStmt).map((row) => Number(row.id || 0)).filter(Boolean);
    } finally {
      protectedStmt.free();
    }

    const matchStmt = database.prepare(
      `SELECT m.id, m.bill_item_id, m.slip_item_id
       FROM capture_matches m
       WHERE m.created_by = 'ai-worker'
         AND m.status IN ('pending', 'confirmed', 'manual_review')
         AND COALESCE(m.reviewed_by, '') IN ('', 'ai-worker')
         AND (m.bill_item_id IN (${idPlaceholders}) OR m.slip_item_id IN (${idPlaceholders}))`,
      [...scopedIds, ...scopedIds]
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
        const item = getItemByIdSync(database, itemId);
        syncItemMatchStateSync(database, itemId, now);
        if (item?.category === 'bill') reopenClosedDayForItem(database, item, 'รีเซ็ตคู่ที่ AI สร้างเพื่ออ่านรูปใหม่');
      }
    }

    const pendingReimbursementIds = [];
    for (const itemId of scopedIds) {
      const item = getItemByIdSync(database, itemId);
      if (item?.reimbursement_related_item_id && item.reimbursement_status !== 'confirmed') {
        pendingReimbursementIds.push(itemId);
      }
    }
    if (pendingReimbursementIds.length) {
      clearReimbursementLinksSync(database, pendingReimbursementIds, 'รีเซ็ต AI ของธุรกรรมคืนเงินสำรอง');
    }

    const protectedSet = new Set(protectedIds);
    const resettableIds = scopedIds.filter((id) => {
      const item = getItemByIdSync(database, id);
      return item && !item.category_edited_at && !protectedSet.has(id);
    });

    if (resettableIds.length) database.run(
      `UPDATE capture_items
       SET category = 'pending',
           vendor_name = NULL,
           vendor_tax_id = NULL,
           supplier_name = NULL,
           bill_purpose = NULL,
           bill_total_text = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_text END,
           bill_total_value = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_value END,
           announced_amount = NULL,
           slip_amount_text = CASE WHEN slip_amount_edited_at IS NULL THEN NULL ELSE slip_amount_text END,
           slip_amount_value = CASE WHEN slip_amount_edited_at IS NULL THEN NULL ELSE slip_amount_value END,
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
           ai_error_kind = NULL,
           ai_next_retry_at = NULL,
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
       WHERE id IN (${resettableIds.map(() => '?').join(',')})`,
      [now, ...resettableIds]
    );
    const resetCount = resettableIds.length;

    // Cash confirmation is a human-only terminal decision. Do not queue its bill for AI again:
    // a later vision result must not relabel the document or make a completed cash row look pending.
    const protectedCashIds = new Set(
      protectedIds.filter((itemId) => Boolean(getActiveCashPaymentSync(database, itemId)))
    );
    const manualReanalyzeIds = scopedIds.filter((itemId) => {
      const item = getItemByIdSync(database, itemId);
      return Boolean(item?.category_edited_at) && !protectedCashIds.has(itemId);
    });
    if (manualReanalyzeIds.length) {
      database.run(
        `UPDATE capture_items
         SET vendor_name = NULL, vendor_tax_id = NULL, supplier_name = NULL,
             bill_purpose = NULL,
             bill_total_text = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_text END,
             bill_total_value = CASE WHEN bill_total_edited_at IS NULL THEN NULL ELSE bill_total_value END,
             announced_amount = NULL,
             slip_amount_text = CASE WHEN slip_amount_edited_at IS NULL THEN NULL ELSE slip_amount_text END,
             slip_amount_value = CASE WHEN slip_amount_edited_at IS NULL THEN NULL ELSE slip_amount_value END,
             slip_amount_confidence = NULL,
             payment_role = NULL,
             ai_status = 'pending', ai_provider = NULL, ai_model = NULL,
             ai_confidence = NULL, ai_category_confidence = NULL,
             ai_raw_text = NULL, ai_summary = NULL, ai_result_json = NULL,
             ai_error = NULL, ai_error_kind = NULL, ai_next_retry_at = NULL,
             ai_processed_at = NULL, ai_attempt_count = 0,
             ai_input_tokens = NULL, ai_cached_input_tokens = NULL,
             ai_output_tokens = NULL, ai_reasoning_tokens = NULL, ai_total_tokens = NULL,
             amount_review_flag = 0, flag_resolved_at = NULL, flag_resolved_by = NULL,
             doc_ref = NULL, page_no = NULL, page_count = NULL, updated_at = ?
         WHERE id IN (${manualReanalyzeIds.map(() => '?').join(',')})`,
        [now, ...manualReanalyzeIds]
      );
    }
    const manualReanalyzeSet = new Set(manualReanalyzeIds);
    const reanalyzeProtectedIds = protectedIds.filter(
      (itemId) => !protectedCashIds.has(itemId) && !manualReanalyzeSet.has(itemId)
    );
    if (reanalyzeProtectedIds.length) {
      database.run(
        `UPDATE capture_items
         SET ai_status = 'pending', ai_provider = NULL, ai_model = NULL,
             ai_error = NULL, ai_error_kind = NULL, ai_next_retry_at = NULL,
             ai_processed_at = NULL, ai_attempt_count = 0,
             ai_input_tokens = NULL, ai_cached_input_tokens = NULL,
             ai_output_tokens = NULL, ai_reasoning_tokens = NULL,
             ai_total_tokens = NULL, updated_at = ?
         WHERE id IN (${reanalyzeProtectedIds.map(() => '?').join(',')})`,
        [now, ...reanalyzeProtectedIds]
      );
    }

    return {
      requeued: resetCount + manualReanalyzeIds.length + reanalyzeProtectedIds.length,
      reset_ai_matches: aiPairs.length,
      preserved_manual_categories: preservedManualCategories,
      preserved_human_decisions: protectedIds.length,
      start: rawStart || null,
      end: rawEnd || null,
      source_id: String(sourceId || '').trim() || null
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
  runWrite(async (database) => {
    const slipId = Number(slipItemId || 0);
    const slip = getItemByIdSync(database, slipId);
    if (!slip) return { error: 'slip_not_found' };
    if (!['transfer', 'transfer_notice'].includes(slip.category)) return { error: 'not_a_slip' };
    if (slip.status === 'unsent' || slip.status === 'duplicate') return { error: 'slip_unavailable' };
    const messageId = `receipt-substitute:${slipId}`;
    const existing = getItemByMessageIdSync(database, messageId);
    if (existing) {
      const match = await setItemMatch({
        billItemId: existing.id,
        slipItemId: slipId,
        score: 100,
        status: 'confirmed',
        reasons: ['สร้างใบแทนใบเสร็จรับเงินจากสลิปที่ไม่มีบิล'],
        createdBy
      });
      if (!match || match.error) throw new Error(`receipt_substitute_match_failed:${match?.error || 'unknown'}`);
      return { item: getItemByIdSync(database, existing.id), match, created: false };
    }
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

    const item = getItemByMessageIdSync(database, messageId);
    const match = await setItemMatch({
      billItemId: item.id,
      slipItemId: slipId,
      score: 100,
      status: 'confirmed',
      reasons: ['สร้างใบแทนใบเสร็จรับเงินจากสลิปที่ไม่มีบิล'],
      createdBy
    });
    if (!match || match.error) throw new Error(`receipt_substitute_match_failed:${match?.error || 'unknown'}`);
    return { item: getItemByIdSync(database, item.id), match, created: true };
  });

export const splitBatchPaymentSummary = async ({ parentItemId, lines = [], createdBy = 'admin-web' }) =>
  runWrite((database) => {
    const parentId = Number(parentItemId || 0);
    const parent = getItemByIdSync(database, parentId);
    if (!parent) return { error: 'item_not_found' };
    if (['unsent', 'duplicate'].includes(parent.status)) return { error: 'item_unavailable' };
    const normalized = lines.slice(0, 100).map((line, index) => {
      const amount = Number(String(line?.amount ?? '').replace(/,/g, '').trim());
      return {
        line_no: index + 1,
        supplier_name: String(line?.supplier_name || '').trim().slice(0, 300),
        payee_name: String(line?.payee_name || '').trim().slice(0, 300) || null,
        bank_name: String(line?.bank_name || '').trim().slice(0, 120) || null,
        account_no: String(line?.account_no || '').trim().slice(0, 120) || null,
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        excluded: Boolean(line?.excluded),
        note: String(line?.note || '').trim().slice(0, 1000) || null
      };
    }).filter((line) => line.supplier_name);
    if (!normalized.length) return { error: 'lines_required' };
    if (normalized.some((line) => !line.excluded && !line.amount)) return { error: 'amount_required' };

    const now = nowIso();
    const parentMatchStmt = database.prepare(
      `SELECT bill_item_id, slip_item_id FROM capture_matches
       WHERE status IN ('pending', 'confirmed', 'manual_review')
         AND (bill_item_id = ? OR slip_item_id = ?)`,
      [parentId, parentId]
    );
    let parentCounterparts = [];
    try {
      parentCounterparts = allRows(parentMatchStmt).flatMap((row) => [
        Number(row.bill_item_id || 0), Number(row.slip_item_id || 0)
      ]).filter((id) => id && id !== parentId);
    } finally {
      parentMatchStmt.free();
    }
    database.run(
      `UPDATE capture_matches SET status = 'rejected', confirmed_at = NULL,
         reason_json = ?, updated_at = ?
       WHERE status IN ('pending', 'confirmed', 'manual_review')
         AND (bill_item_id = ? OR slip_item_id = ?)`,
      [normalizeJson(['แยกรูปเป็นใบสรุปรอบจ่ายหลายรายการ']), now, parentId, parentId]
    );
    for (const counterpartId of parentCounterparts) {
      database.run(
        `UPDATE capture_items SET matched_item_id = NULL, match_status = 'unmatched', updated_at = ? WHERE id = ?`,
        [now, counterpartId]
      );
    }
    const existingStmt = database.prepare(
      `SELECT id FROM capture_items WHERE generated_from_item_id = ? AND generated_document_type = 'batch_payment_line'`,
      [parentId]
    );
    let existingIds = [];
    try {
      existingIds = allRows(existingStmt).map((row) => Number(row.id));
    } finally {
      existingStmt.free();
    }
    if (existingIds.length) return { error: 'already_split', child_item_ids: existingIds };

    const payableLines = normalized.filter((line) => !line.excluded);
    const payableTotal = payableLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const parentDocument = {
      document_type: 'batch_payment_summary',
      source_item_id: parentId,
      payable_total: payableTotal,
      line_count: normalized.length,
      payable_count: payableLines.length,
      lines: normalized,
      created_by: createdBy,
      created_at: now
    };
    database.run(
      `UPDATE capture_items
       SET category = 'other', category_edited_at = ?, category_edited_by = ?,
           category_edit_reason = ?, generated_document_type = 'batch_payment_summary',
           generated_document_json = ?, match_status = 'unmatched', matched_item_id = NULL,
           updated_at = ?
       WHERE id = ?`,
      [now, createdBy, 'แยกเป็นใบสรุปรอบจ่ายหลายรายการ', normalizeJson(parentDocument), now, parentId]
    );

    const childIds = [];
    for (const line of payableLines) {
      const messageId = `batch-payment-line:${parentId}:${line.line_no}`;
      const document = { ...line, document_type: 'batch_payment_line', source_item_id: parentId };
      database.run(
        `INSERT INTO capture_items
          (webhook_event_id, line_message_id, source_type, source_id, sender_user_id,
           category, status, vendor_name, supplier_name, bill_purpose,
           bill_total_text, bill_total_value, bill_total_edited_at, bill_total_edited_by,
           category_edited_at, category_edited_by, ai_status, ai_provider,
           ai_confidence, ai_category_confidence, ai_summary, ai_result_json,
           generated_document_type, generated_document_json, generated_from_item_id,
           raw_event_json, event_timestamp_ms, downloaded_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'bill', 'downloaded', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'done', 'manual', 1, 1, ?, ?, 'batch_payment_line', ?, ?, ?, ?, ?, ?, ?)`,
        [
          messageId, messageId, parent.source_type, parent.source_id, parent.sender_user_id,
          line.supplier_name, line.supplier_name, `รายการจ่าย ${line.supplier_name}`,
          line.amount.toFixed(2), line.amount, now, createdBy, now, createdBy,
          `รายการจ่าย ${line.supplier_name} จำนวน ${line.amount.toFixed(2)} บาท จากใบสรุปรอบจ่าย`,
          normalizeJson({ category: 'bill', confidence: 1, document }), normalizeJson(document), parentId,
          normalizeJson({ type: 'generated_batch_payment_line', parent_item_id: parentId, line }),
          Number(parent.event_timestamp_ms || 0) + line.line_no, now, now, now
        ]
      );
      childIds.push(Number(getItemByMessageIdSync(database, messageId)?.id || 0));
    }
    parentDocument.child_item_ids = childIds;
    database.run(
      `UPDATE capture_items SET generated_document_json = ?, updated_at = ? WHERE id = ?`,
      [normalizeJson(parentDocument), now, parentId]
    );
    return { parent_item_id: parentId, child_item_ids: childIds, lines: normalized, payable_total: payableTotal };
  });

export const confirmCashPayment = async ({ billItemId, recipientName, note, confirmedBy = 'admin-web' }) =>
  runWrite((database) => {
    const billId = Number(billItemId || 0);
    const bill = getItemByIdSync(database, billId);
    if (!bill) return { error: 'bill_not_found' };
    if (bill.category !== 'bill') return { error: 'not_a_bill' };
    if (bill.status !== 'downloaded') return { error: 'bill_unavailable' };
    if (Number(bill.amount_review_flag || 0)) return { error: 'amount_review_required' };
    const amount = effectiveBillAmount(bill);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount_missing' };
    if (getActiveCashPaymentSync(database, billId)) return { error: 'cash_payment_exists' };
    if (activeMatchComponentSync(database, [billId]).matches.length) return { error: 'active_match_exists' };
    const recipient = String(recipientName || '').trim().slice(0, 300);
    const paymentNote = String(note || '').trim().slice(0, 1000);
    if (!recipient) return { error: 'recipient_required' };
    if (!paymentNote) return { error: 'note_required' };
    const businessDate = businessDateForItemSync(database, billId);
    if (!businessDate) return { error: 'business_date_missing' };
    const now = nowIso();
    database.run(
      `INSERT INTO capture_cash_payments
        (bill_item_id, amount, business_date, recipient_name, note, status,
         created_by, confirmed_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
      [billId, amount, businessDate, recipient, paymentNote, confirmedBy, now, confirmedBy, now]
    );
    database.run(
      `UPDATE capture_items
       SET matched_item_id = NULL, match_status = 'confirmed', updated_at = ?
       WHERE id = ?`,
      [now, billId]
    );
    reopenClosedDayForItem(database, bill, 'มีการยืนยันชำระเงินสดหลังปิดรอบ');
    return { payment: getActiveCashPaymentSync(database, billId), item: getItemByIdSync(database, billId) };
  });

export const updateCashPayment = async ({ billItemId, recipientName, note, updatedBy = 'admin-web' }) =>
  runWrite((database) => {
    const billId = Number(billItemId || 0);
    const payment = getActiveCashPaymentSync(database, billId);
    if (!payment) return { error: 'cash_payment_not_found' };
    const recipient = String(recipientName || '').trim().slice(0, 300);
    const paymentNote = String(note || '').trim().slice(0, 1000);
    if (!recipient) return { error: 'recipient_required' };
    if (!paymentNote) return { error: 'note_required' };
    const now = nowIso();
    database.run(
      `UPDATE capture_cash_payments
       SET recipient_name = ?, note = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND status = 'confirmed'`,
      [recipient, paymentNote, updatedBy, now, Number(payment.id)]
    );
    reopenClosedDayForItem(database, getItemByIdSync(database, billId), 'มีการแก้ข้อมูลชำระเงินสดหลังปิดรอบ');
    return { payment: getActiveCashPaymentSync(database, billId), item: getItemByIdSync(database, billId) };
  });

export const voidCashPayment = async ({ billItemId, reason, voidedBy = 'admin-web' }) =>
  runWrite((database) => {
    const billId = Number(billItemId || 0);
    if (!getItemByIdSync(database, billId)) return { error: 'bill_not_found' };
    if (!getActiveCashPaymentSync(database, billId)) return { error: 'cash_payment_not_found' };
    const voidReason = String(reason || '').trim().slice(0, 1000);
    if (!voidReason) return { error: 'void_reason_required' };
    const payment = voidActiveCashPaymentSync(database, billId, voidReason, voidedBy);
    return { payment, item: getItemByIdSync(database, billId) };
  });

export const setItemMatch = async ({
  billItemId,
  slipItemId,
  score = 0,
  status = 'pending',
  reasons = [],
  createdBy = 'admin',
  reviewNote = '',
  aiLearningApproved = false,
  replaceExisting = false
}) =>
  runWrite((database) => {
    const billId = Number(billItemId || 0);
    const slipId = Number(slipItemId || 0);
    const aiActor = String(createdBy || '') === 'ai-worker';
    const failure = (error, details = {}) => (aiActor || error === 'item_not_found') ? null : { error, ...details };
    if (!billId || !slipId) return failure('item_not_found');
    if (billId === slipId) return failure('same_item');
    if (!['pending', 'confirmed', 'rejected', 'manual_review'].includes(status)) {
      return failure('invalid_status');
    }
    if (aiActor && status === 'confirmed') {
      status = 'pending';
      reasons = [...reasons, 'AI เสนอคู่นี้ แต่ต้องให้คนตรวจและกดยืนยันเสมอ'];
    }

    const bill = getItemByIdSync(database, billId);
    const slip = getItemByIdSync(database, slipId);
    if (getActiveCashPaymentSync(database, billId)) return failure('cash_payment_conflict');
    const memberError = validateMatchMembers({ billRows: [bill], slipRows: [slip], status });
    if (memberError) {
      if (!(aiActor && status === 'confirmed' && ['amount_mismatch', 'amount_review_required'].includes(memberError))) {
        return failure(memberError);
      }
      status = 'pending';
      reasons = [...reasons, memberError === 'amount_mismatch'
        ? 'ยอดยังไม่ตรง ห้าม AI ยืนยันอัตโนมัติ'
        : 'มีธงตรวจยอด ห้าม AI ยืนยันอัตโนมัติ'];
    }

    const existingStmt = database.prepare(
      `SELECT * FROM capture_matches WHERE bill_item_id = ? AND slip_item_id = ? LIMIT 1`,
      [billId, slipId]
    );
    let existing;
    try {
      existing = getFirstRow(existingStmt);
    } finally {
      existingStmt.free();
    }
    const existingReasons = existing ? parseStoredJson(existing.reason_json, []) : [];
    const effectiveReasons = existing && !aiActor
      ? [...new Set([...existingReasons, ...reasons].map((reason) => String(reason || '').trim()).filter(Boolean))]
      : reasons;
    const effectiveCreatedBy = existing?.created_by || createdBy;
    const humanDecision = isHumanMatchDecision(existing);
    if (aiActor && humanDecision) return null;
    if (aiActor && existing && ACTIVE_MATCH_STATUSES.has(existing.status)) {
      if (existing.status === 'confirmed' || Number(existing.score || 0) >= Number(score || 0)) return null;
    }

    const now = nowIso();
    if (['pending', 'confirmed', 'manual_review'].includes(status)) {
      const conflictMatches = activeMatchComponentSync(database, [billId, slipId]).matches
        .filter((match) => !(Number(match.bill_item_id) === billId && Number(match.slip_item_id) === slipId));
      if (aiActor) {
        if (conflictMatches.some((match) => isHumanMatchDecision(match))) return null;
        if (conflictMatches.some((match) => match.status === 'confirmed')) return null;
        if (conflictMatches.some((match) => Number(match.score || 0) >= Number(score || 0))) return null;
      }
      if (conflictMatches.length) {
        if (!aiActor && !replaceExisting) {
          return failure('document_already_used', {
            conflicts: conflictMatches.map((match) => ({
              match_id: Number(match.id || 0),
              bill_item_id: Number(match.bill_item_id || 0),
              slip_item_id: Number(match.slip_item_id || 0),
              status: String(match.status || ''),
              match_group_key: match.match_group_key || null
            }))
          });
        }
        const conflictItems = [...new Set(conflictMatches.flatMap((match) => [Number(match.bill_item_id), Number(match.slip_item_id)]))];
        rejectActiveMatchComponentSync(
          database,
          conflictItems,
          `จัดคู่ใหม่เป็นบิล ${billId} กับสลิป ${slipId}`
        );
      }
    }

    if (status === 'rejected' && existing && ACTIVE_MATCH_STATUSES.has(existing.status)) {
      rejectActiveMatchComponentSync(database, [billId, slipId], 'ผู้ดูแลยืนยันว่าไม่ใช่คู่นี้');
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
         created_by = excluded.created_by,
         match_group_key = NULL,
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
        normalizeJson(effectiveReasons),
        effectiveCreatedBy,
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
      syncItemMatchStateSync(database, billId, now);
      syncItemMatchStateSync(database, slipId, now);
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

    // The transaction belongs to the slip day. Reopen both source dates because an older
    // bill-day snapshot may also need the transaction removed after this rule takes effect.
    if (['pending', 'confirmed', 'manual_review'].includes(status)) {
      reopenClosedDayForItem(database, bill, 'มีสลิปมาจับคู่หลังปิดรอบ');
      reopenClosedDayForItem(database, slip, 'มีการจับคู่ธุรกรรมตามวันที่โอน');
    }

    const statement = database.prepare(
      `SELECT * FROM capture_matches WHERE bill_item_id = ? AND slip_item_id = ? LIMIT 1`,
      [billId, slipId]
    );
    try {
      const match = getFirstRow(statement);
      const learningOutcome = status === 'pending' && existing?.status === 'confirmed' ? 'rejected' : status;
      if (match && aiLearningApproved && String(reviewNote || '').trim() && ['confirmed', 'rejected'].includes(learningOutcome)) {
        const example = {
          outcome: learningOutcome,
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
          [match.id, learningOutcome, String(reviewNote).trim(), normalizeJson(example), createdBy, now, now]
        );
      }
      return match;
    } finally {
      statement.free();
    }
  });

export const recordMatchLearningFeedback = async ({ matchId, reviewNote, approvedBy = 'admin' }) =>
  runWrite((database) => {
    const id = Number(matchId || 0);
    const note = String(reviewNote || '').trim().slice(0, 2000);
    if (!id) return { error: 'match_not_found' };
    if (!note) return { error: 'review_note_required' };
    const anchorStmt = database.prepare('SELECT * FROM capture_matches WHERE id = ? LIMIT 1', [id]);
    let anchor;
    try {
      anchor = getFirstRow(anchorStmt);
    } finally {
      anchorStmt.free();
    }
    if (!anchor) return { error: 'match_not_found' };
    if (anchor.status !== 'confirmed') return { error: 'match_not_confirmed' };
    const edgeStmt = anchor.match_group_key
      ? database.prepare('SELECT * FROM capture_matches WHERE match_group_key = ? AND status = \'confirmed\'', [anchor.match_group_key])
      : database.prepare('SELECT * FROM capture_matches WHERE id = ? AND status = \'confirmed\'', [id]);
    let edges;
    try {
      edges = allRows(edgeStmt);
    } finally {
      edgeStmt.free();
    }
    if (!edges.length) return { error: 'match_not_confirmed' };
    const now = nowIso();
    for (const edge of edges) {
      const bill = getItemByIdSync(database, edge.bill_item_id);
      const slip = getItemByIdSync(database, edge.slip_item_id);
      if (!bill || !slip) continue;
      const example = {
        outcome: 'confirmed',
        review_note: note,
        correction_type: 'reason_or_ranking_feedback',
        original_score: Number(edge.score || 0),
        original_reasons: parseStoredJson(edge.reason_json, []),
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
        `UPDATE capture_matches
         SET review_note = ?, ai_learning_approved = 1,
             reviewed_by = COALESCE(NULLIF(reviewed_by, ''), ?),
             reviewed_at = COALESCE(reviewed_at, ?), updated_at = ?
         WHERE id = ?`,
        [note, String(approvedBy || 'admin'), now, now, Number(edge.id)]
      );
      database.run(
        `INSERT INTO ai_learning_examples
          (match_id, outcome, review_note, example_json, approved_by, created_at, updated_at)
         VALUES (?, 'confirmed', ?, ?, ?, ?, ?)
         ON CONFLICT(match_id) DO UPDATE SET
           outcome = excluded.outcome,
           review_note = excluded.review_note,
           example_json = excluded.example_json,
           approved_by = excluded.approved_by,
           updated_at = excluded.updated_at`,
        [Number(edge.id), note, normalizeJson(example), String(approvedBy || 'admin'), now, now]
      );
    }
    return { match_id: id, match_group_key: anchor.match_group_key || null, learned_edges: edges.length, review_note: note };
  });

export const setItemMatchGroup = async ({
  billItemIds = [],
  slipItemIds = [],
  status = 'pending',
  reasons = [],
  createdBy = 'admin',
  replaceExisting = false
}) =>
  runWrite((database) => {
    const requestedBills = [...new Set(billItemIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const requestedSlips = [...new Set(slipItemIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!requestedBills.length || !requestedSlips.length) return { error: 'members_required' };
    if (!['pending', 'confirmed', 'rejected'].includes(status)) return { error: 'invalid_status' };
    if (String(createdBy || '') === 'ai-worker' && status === 'confirmed') {
      status = 'pending';
      reasons = [...reasons, 'AI เสนอชุดเอกสาร แต่ต้องให้คนตรวจและกดยืนยันเสมอ'];
    }

    const billRows = requestedBills.map((id) => getItemByIdSync(database, id));
    const slipRows = requestedSlips.map((id) => getItemByIdSync(database, id));
    if (billRows.some((bill) => bill && getActiveCashPaymentSync(database, bill.id))) {
      return { error: 'cash_payment_conflict' };
    }
    const validationError = validateMatchMembers({ billRows, slipRows, status });
    if (validationError) return { error: validationError };
    const documentOrder = (left, right) => Number(left.event_timestamp_ms || 0) - Number(right.event_timestamp_ms || 0)
      || Number(left.id || 0) - Number(right.id || 0);
    billRows.sort(documentOrder);
    slipRows.sort(documentOrder);
    const bills = billRows.map((row) => Number(row.id));
    const slips = slipRows.map((row) => Number(row.id));
    const billTotal = billRows.reduce((sum, row) => sum + effectiveBillAmount(row), 0);
    const slipTotal = slipRows.reduce((sum, row) => sum + Number(row.slip_amount_value || 0), 0);

    const now = nowIso();
    const selectedIds = [...bills, ...slips];
    const activeComponent = activeMatchComponentSync(database, selectedIds);
    const activeBillIds = new Set(activeComponent.matches.map((match) => Number(match.bill_item_id || 0)).filter(Boolean));
    const activeSlipIds = new Set(activeComponent.matches.map((match) => Number(match.slip_item_id || 0)).filter(Boolean));
    const sameMembers = activeComponent.matches.length > 0
      && activeComponent.groupKeys.length === 1
      && activeBillIds.size === bills.length
      && activeSlipIds.size === slips.length
      && bills.every((id) => activeBillIds.has(id))
      && slips.every((id) => activeSlipIds.has(id));
    if (activeComponent.matches.length && !sameMembers && !replaceExisting) {
      return {
        error: 'document_already_used',
        conflicts: activeComponent.matches.map((match) => ({
          match_id: Number(match.id || 0),
          bill_item_id: Number(match.bill_item_id || 0),
          slip_item_id: Number(match.slip_item_id || 0),
          status: String(match.status || ''),
          match_group_key: match.match_group_key || null
        }))
      };
    }
    rejectActiveMatchComponentSync(database, selectedIds, 'จัดเอกสารใหม่เป็นชุดหลายบิล/หลายสลิป');

    const groupKey = `mg-${Date.now()}-${crypto.randomUUID()}`;
    // A connected sparse graph retains every member without creating bill x slip
    // rows. This keeps very large groups practical in every review state.
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
      for (const slip of slipRows) reopenClosedDayForItem(database, slip, 'มีการรวมเอกสารตามวันที่โอน');
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
       WHERE status = 'pending' AND created_by = 'ai-worker'
         AND COALESCE(reviewed_by, '') IN ('', 'ai-worker')`
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
       WHERE status = 'pending' AND created_by = 'ai-worker'
         AND COALESCE(reviewed_by, '') IN ('', 'ai-worker')`,
      [normalizeJson(['จัดคู่ใหม่ตามกติกา AI']), now]
    );

    const itemIds = [...new Set(pairs.flatMap((pair) => [pair.billItemId, pair.slipItemId]))];
    for (const itemId of itemIds) {
      syncItemMatchStateSync(database, itemId, now);
    }

    return { reset: pairs.length };
  });

export const backfillCpAxtraDocumentReferences = async ({ apply = false } = {}) =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT * FROM capture_items
       WHERE status = 'downloaded'
         AND category IN ('bill', 'bill_page', 'transfer', 'transfer_notice')
       ORDER BY id ASC`
    );
    let items;
    try {
      items = allRows(statement).filter((item) => isCpAxtraBill(item) || isCpAxtraSlip(item));
    } finally {
      statement.free();
    }

    const updates = [];
    const conflicts = [];
    const missing = [];
    const now = nowIso();
    for (const item of items) {
      const extracted = cpAxtraReferenceForItem(item);
      const stored = String(item.doc_ref || '').replace(/\D/g, '');
      if (!extracted) {
        missing.push(Number(item.id));
        continue;
      }
      if (stored && stored !== extracted) {
        conflicts.push({ id: Number(item.id), stored, extracted });
        continue;
      }
      if (stored) continue;

      updates.push({ id: Number(item.id), doc_ref: extracted });
      if (!apply) continue;
      const result = parseStoredJson(item.ai_result_json, {});
      const nextResult = result && typeof result === 'object' && !Array.isArray(result)
        ? { ...result, doc_ref: extracted }
        : { doc_ref: extracted };
      database.run(
        `UPDATE capture_items
         SET doc_ref = ?, ai_result_json = ?, updated_at = ?
         WHERE id = ? AND COALESCE(trim(doc_ref), '') = ''`,
        [extracted, normalizeJson(nextResult), now, Number(item.id)]
      );
    }

    return {
      scanned: items.length,
      bills: items.filter(isCpAxtraBill).length,
      slips: items.filter((item) => isCpAxtraSlip(item) && ['transfer', 'transfer_notice'].includes(item.category)).length,
      found: updates.length,
      updated: apply ? updates.length : 0,
      missing,
      conflicts,
      items: updates
    };
  });

export const resetAiPendingCpAxtraMatches = async () =>
  runWrite((database) => {
    const statement = database.prepare(
      `SELECT m.*
       FROM capture_matches m
       WHERE m.status = 'pending'
         AND m.created_by = 'ai-worker'
         AND COALESCE(m.reviewed_by, '') IN ('', 'ai-worker')
       ORDER BY m.id ASC`
    );
    let matches;
    try {
      matches = allRows(statement).filter((match) => {
        const bill = getItemByIdSync(database, match.bill_item_id);
        const slip = getItemByIdSync(database, match.slip_item_id);
        return isCpAxtraBill(bill) || isCpAxtraSlip(slip);
      });
    } finally {
      statement.free();
    }
    if (!matches.length) return { reset: 0, match_ids: [] };

    const now = nowIso();
    const matchIds = matches.map((match) => Number(match.id));
    database.run(
      `UPDATE capture_matches
       SET status = 'rejected', reason_json = ?, confirmed_at = NULL, updated_at = ?
       WHERE id IN (${matchIds.map(() => '?').join(',')})`,
      [normalizeJson(['จัดคู่ CP AXTRA ใหม่โดยยึด Ref 2 / เลขใบกำกับภาษี']), now, ...matchIds]
    );
    const itemIds = [...new Set(matches.flatMap((match) => [
      Number(match.bill_item_id), Number(match.slip_item_id)
    ]).filter(Boolean))];
    for (const itemId of itemIds) syncItemMatchStateSync(database, itemId, now);
    return { reset: matches.length, match_ids: matchIds };
  });

// ซ่อมแถวที่ค้างจากกติกาเก่า: match_status='needs_amount' บนรูปที่ไม่ใช่บิลแล้ว
// บอร์ดนับเป็นงานค้างตลอดไป แต่หน้าวันไม่มีถังไหนแสดงเลย จึงเคลียร์ไม่ได้
export const clearNeedsAmountOnNonBills = async () =>
  runWrite((database) => {
    database.run(
      `UPDATE capture_items
       SET match_status = 'unmatched',
           updated_at = ?
       WHERE match_status = 'needs_amount'
         AND category <> 'bill'`,
      [nowIso()]
    );
    return rowsModified(database);
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

const buildConfirmedTransactionsSnapshotSync = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT
       m.id AS match_id, m.match_group_key, m.score, m.confirmed_at, m.review_note,
       b.id AS bill_id, b.line_message_id AS bill_line_message_id,
       b.source_type AS bill_source_type, b.source_id AS bill_source_id,
       b.sender_user_id AS bill_sender_user_id,
       b.vendor_name, b.supplier_name, b.bill_purpose,
       b.bill_total_text, b.bill_total_value AS document_bill_total_value,
       b.announced_amount, b.ai_summary AS bill_ai_summary,
       b.doc_ref, b.generated_document_type, b.generated_document_json,
       b.storage_relative_path AS bill_storage_relative_path,
       b.event_timestamp_ms AS bill_timestamp_ms,
       (SELECT display_name FROM line_senders ls
         WHERE ls.source_type = b.source_type AND ls.source_id = b.source_id
           AND ls.user_id = b.sender_user_id LIMIT 1) AS bill_sender,
       s.id AS slip_id, s.line_message_id AS slip_line_message_id,
       s.source_type AS slip_source_type, s.source_id AS slip_source_id,
       s.sender_user_id AS slip_sender_user_id,
       s.slip_amount_text, s.slip_amount_value, s.ai_summary AS slip_ai_summary,
       s.storage_relative_path AS slip_storage_relative_path,
       s.event_timestamp_ms AS slip_timestamp_ms,
       (SELECT display_name FROM line_senders ls
         WHERE ls.source_type = s.source_type AND ls.source_id = s.source_id
           AND ls.user_id = s.sender_user_id LIMIT 1) AS slip_sender
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
           AND gm.status = 'confirmed'
           AND gb.status NOT IN ('unsent', 'duplicate')
         ORDER BY COALESCE(gb.event_timestamp_ms, 0), gb.id
         LIMIT 1
       ) END) = ?
       AND ${matchTransactionDateSql('m', 's')} = ?
     ORDER BY COALESCE(b.event_timestamp_ms, 0), b.id, m.id`,
    [sourceId, businessDate]
  );
  let rows;
  try {
    rows = allRows(statement);
  } finally {
    statement.free();
  }

  const grouped = new Map();
  for (const row of rows) {
    const key = row.match_group_key || `match-${row.match_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        match_id: row.match_id,
        match_ids: [],
        match_group_key: row.match_group_key || null,
        score: Number(row.score || 0),
        confirmed_at: row.confirmed_at || null,
        review_note: row.review_note || null,
        bill_members: [],
        slip_members: [],
        attachments: [],
        is_group: Boolean(row.match_group_key)
      });
    }
    const transaction = grouped.get(key);
    if (!transaction.match_ids.includes(Number(row.match_id))) transaction.match_ids.push(Number(row.match_id));
    if (!transaction.bill_members.some((member) => Number(member.bill_id) === Number(row.bill_id))) {
      const bill = getItemByIdSync(database, row.bill_id);
      transaction.bill_members.push({
        bill_id: Number(row.bill_id),
        line_message_id: row.bill_line_message_id,
        source_type: row.bill_source_type,
        source_id: row.bill_source_id,
        sender_user_id: row.bill_sender_user_id,
        bill_sender: row.bill_sender,
        vendor_name: row.vendor_name,
        supplier_name: row.supplier_name,
        bill_purpose: row.bill_purpose,
        bill_total_text: row.bill_total_text,
        bill_total_value: effectiveBillAmount(bill),
        document_bill_total_value: Number(row.document_bill_total_value || 0),
        announced_amount: row.announced_amount == null ? null : Number(row.announced_amount),
        ai_summary: row.bill_ai_summary,
        doc_ref: row.doc_ref,
        generated_document_type: row.generated_document_type,
        generated_document_json: row.generated_document_json,
        storage_relative_path: row.bill_storage_relative_path,
        bill_timestamp_ms: row.bill_timestamp_ms
      });
    }
    if (!transaction.slip_members.some((member) => Number(member.slip_id) === Number(row.slip_id))) {
      transaction.slip_members.push({
        slip_id: Number(row.slip_id),
        line_message_id: row.slip_line_message_id,
        source_type: row.slip_source_type,
        source_id: row.slip_source_id,
        sender_user_id: row.slip_sender_user_id,
        slip_sender: row.slip_sender,
        slip_amount_text: row.slip_amount_text,
        slip_amount_value: Number(row.slip_amount_value || 0),
        ai_summary: row.slip_ai_summary,
        storage_relative_path: row.slip_storage_relative_path,
        slip_timestamp_ms: row.slip_timestamp_ms
      });
    }
  }

  const transactions = [...grouped.values()];
  for (const transaction of transactions) {
    for (const bill of transaction.bill_members) {
      if (!bill.doc_ref) continue;
      const attachmentStmt = database.prepare(
        `SELECT id, line_message_id, source_type, source_id, category,
                page_no, page_count, storage_relative_path, event_timestamp_ms
         FROM capture_items
         WHERE source_id = ? AND doc_ref = ? AND category = 'bill_page'
           AND status NOT IN ('unsent', 'duplicate')
         ORDER BY COALESCE(page_no, 999), id`,
        [bill.source_id, bill.doc_ref]
      );
      try {
        for (const attachment of allRows(attachmentStmt)) {
          if (!transaction.attachments.some((entry) => Number(entry.id) === Number(attachment.id))) {
            transaction.attachments.push(attachment);
          }
        }
      } finally {
        attachmentStmt.free();
      }
    }
    transaction.bill_members.sort((left, right) => Number(left.bill_timestamp_ms || 0) - Number(right.bill_timestamp_ms || 0)
      || Number(left.bill_id || 0) - Number(right.bill_id || 0));
    transaction.slip_members.sort((left, right) => Number(left.slip_timestamp_ms || 0) - Number(right.slip_timestamp_ms || 0)
      || Number(left.slip_id || 0) - Number(right.slip_id || 0));
    transaction.bill_total_value = transaction.bill_members
      .reduce((sum, member) => sum + Number(member.bill_total_value || 0), 0);
    transaction.document_bill_total_value = transaction.bill_members
      .reduce((sum, member) => sum + Number(member.document_bill_total_value || 0), 0);
    transaction.slip_amount_value = transaction.slip_members
      .reduce((sum, member) => sum + Number(member.slip_amount_value || 0), 0);
    transaction.vendor_name = transaction.is_group
      ? `ชุดรวม ${transaction.bill_members.length} บิล · ${transaction.slip_members.length} สลิป`
      : transaction.bill_members[0]?.vendor_name || transaction.bill_members[0]?.supplier_name || null;
    transaction.supplier_name = transaction.bill_members[0]?.supplier_name || null;
    transaction.bill_purpose = transaction.bill_members[0]?.bill_purpose || null;
    transaction.bill_id = transaction.bill_members[0]?.bill_id || null;
    transaction.slip_id = transaction.slip_members[0]?.slip_id || null;
    transaction.bill_timestamp_ms = transaction.bill_members[0]?.bill_timestamp_ms || null;
    transaction.slip_timestamp_ms = transaction.slip_members[0]?.slip_timestamp_ms || null;
    transaction.bill_sender = transaction.bill_members[0]?.bill_sender || null;
    transaction.slip_sender = transaction.slip_members[0]?.slip_sender || null;
    transaction.payment_method = 'bank_transfer';
    transaction.payment_amount_value = transaction.slip_amount_value;
    transaction.cash_payment = null;
  }
  return transactions;
};

const buildConfirmedCashTransactionsSnapshotSync = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT cp.id AS cash_payment_id, cp.bill_item_id AS bill_item_id, cp.amount AS cash_amount,
       cp.business_date AS cash_business_date, cp.recipient_name AS cash_recipient_name,
       cp.note AS cash_note, cp.created_by AS cash_created_by,
       cp.confirmed_at AS cash_confirmed_at, cp.updated_by AS cash_updated_by,
       cp.updated_at AS cash_updated_at, b.*,
       (SELECT display_name FROM line_senders ls
         WHERE ls.source_type = b.source_type AND ls.source_id = b.source_id
           AND ls.user_id = b.sender_user_id LIMIT 1) AS bill_sender
     FROM capture_cash_payments cp
     JOIN capture_items b ON b.id = cp.bill_item_id
     WHERE cp.status = 'confirmed' AND cp.business_date = ? AND b.source_id = ?
       AND b.status NOT IN ('unsent', 'duplicate') AND b.category = 'bill'
     ORDER BY COALESCE(b.event_timestamp_ms, 0), b.id`,
    [businessDate, sourceId]
  );
  let rows;
  try {
    rows = allRows(statement);
  } finally {
    statement.free();
  }
  return rows.map((row) => {
    const bill = getItemByIdSync(database, row.bill_item_id);
    const amount = Number(row.cash_amount || 0);
    const billMember = {
      bill_id: Number(row.bill_item_id),
      line_message_id: row.line_message_id,
      source_type: row.source_type,
      source_id: row.source_id,
      sender_user_id: row.sender_user_id,
      bill_sender: row.bill_sender,
      vendor_name: row.vendor_name,
      supplier_name: row.supplier_name,
      bill_purpose: row.bill_purpose,
      bill_total_text: row.bill_total_text,
      bill_total_value: effectiveBillAmount(bill),
      document_bill_total_value: Number(row.bill_total_value || 0),
      announced_amount: row.announced_amount == null ? null : Number(row.announced_amount),
      ai_summary: row.ai_summary,
      doc_ref: row.doc_ref,
      generated_document_type: row.generated_document_type,
      generated_document_json: row.generated_document_json,
      storage_relative_path: row.storage_relative_path,
      bill_timestamp_ms: row.event_timestamp_ms
    };
    return {
      transaction_key: `cash-${row.cash_payment_id}`,
      match_id: null,
      match_ids: [],
      match_group_key: null,
      score: 100,
      confirmed_at: row.cash_confirmed_at,
      review_note: row.cash_note,
      payment_method: 'cash',
      payment_amount_value: amount,
      cash_payment_id: Number(row.cash_payment_id),
      cash_payment: {
        id: Number(row.cash_payment_id),
        amount,
        business_date: row.cash_business_date,
        recipient_name: row.cash_recipient_name,
        note: row.cash_note,
        confirmed_at: row.cash_confirmed_at,
        created_by: row.cash_created_by,
        updated_at: row.cash_updated_at,
        updated_by: row.cash_updated_by
      },
      bill_members: [billMember],
      slip_members: [],
      attachments: [],
      is_group: false,
      bill_total_value: billMember.bill_total_value,
      document_bill_total_value: billMember.document_bill_total_value,
      slip_amount_value: 0,
      cash_amount_value: amount,
      vendor_name: row.vendor_name || row.supplier_name || null,
      supplier_name: row.supplier_name || null,
      bill_purpose: row.bill_purpose || null,
      bill_id: Number(row.bill_item_id),
      slip_id: null,
      bill_timestamp_ms: row.event_timestamp_ms,
      slip_timestamp_ms: null,
      bill_sender: row.bill_sender || null,
      slip_sender: null
    };
  });
};

const buildConfirmedReimbursementsSnapshotSync = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT
       r.id AS reimbursement_id, r.line_message_id AS reimbursement_line_message_id,
       r.source_type AS reimbursement_source_type, r.source_id AS reimbursement_source_id,
       r.sender_user_id AS reimbursement_sender_user_id,
       r.slip_amount_value AS reimbursement_amount,
       r.bill_purpose, r.reimbursement_evidence_mode, r.reimbursement_review_note,
       r.storage_relative_path AS reimbursement_storage_relative_path,
       r.event_timestamp_ms AS reimbursement_timestamp_ms,
       (SELECT display_name FROM line_senders ls WHERE ls.source_type = r.source_type
         AND ls.source_id = r.source_id AND ls.user_id = r.sender_user_id LIMIT 1) AS reimbursement_sender,
       a.id AS advance_id, a.line_message_id AS advance_line_message_id,
       a.source_type AS advance_source_type, a.source_id AS advance_source_id,
       a.sender_user_id AS advance_sender_user_id,
       a.slip_amount_value AS advance_amount,
       a.storage_relative_path AS advance_storage_relative_path,
       a.event_timestamp_ms AS advance_timestamp_ms,
       (SELECT display_name FROM line_senders ls WHERE ls.source_type = a.source_type
         AND ls.source_id = a.source_id AND ls.user_id = a.sender_user_id LIMIT 1) AS advance_sender
     FROM capture_items r
     JOIN capture_items a ON a.id = r.reimbursement_related_item_id
     WHERE r.source_id = ? AND (${matchBusinessDateSql('r')}) = ?
       AND r.payment_role = 'reimbursement' AND r.reimbursement_status = 'confirmed'
       AND r.status NOT IN ('unsent', 'duplicate')
       AND a.status NOT IN ('unsent', 'duplicate')
     ORDER BY COALESCE(r.event_timestamp_ms, 0), r.id`,
    [sourceId, businessDate]
  );
  try {
    return allRows(statement);
  } finally {
    statement.free();
  }
};

const buildIncomingTransfersSnapshotSync = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT ci.id AS item_id, ci.line_message_id, ci.source_type, ci.source_id,
       ci.sender_user_id, ci.slip_amount_text, ci.slip_amount_value,
       ci.vendor_name, ci.bill_purpose, ci.ai_summary, ci.storage_relative_path,
       ci.event_timestamp_ms,
       (SELECT display_name FROM line_senders ls
         WHERE ls.source_type = ci.source_type AND ls.source_id = ci.source_id
           AND ls.user_id = ci.sender_user_id LIMIT 1) AS sender_name
     FROM capture_items ci
     WHERE ci.source_id = ? AND (${matchBusinessDateSql('ci')}) = ?
       AND ci.category = 'incoming_transfer'
       AND ci.status NOT IN ('unsent', 'duplicate')
     ORDER BY COALESCE(ci.event_timestamp_ms, 0), ci.id`,
    [sourceId, businessDate]
  );
  try {
    return allRows(statement).map((row) => ({
      ...row,
      item_id: Number(row.item_id),
      slip_amount_value: Number(row.slip_amount_value || 0)
    }));
  } finally {
    statement.free();
  }
};

const computeDayWorkloadSync = (database, businessDate, sourceId) => {
  const statement = database.prepare(
    `SELECT
       SUM(CASE WHEN day.category = 'bill' THEN 1 ELSE 0 END) AS bill_count,
       SUM(CASE WHEN day.category IN ('transfer', 'transfer_notice') THEN 1 ELSE 0 END) AS slip_count,
       SUM(CASE WHEN day.match_status IN ('pending', 'manual_review')
         AND day.ai_status = 'done'
         AND day.category IN ('bill', 'transfer', 'transfer_notice') THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN day.match_status IN ('unmatched', 'rejected')
         AND day.ai_status = 'done'
         AND day.category IN ('bill', 'transfer', 'transfer_notice')
         AND COALESCE(day.reimbursement_related_item_id, 0) = 0 THEN 1 ELSE 0 END) AS unmatched_count,
       SUM(CASE WHEN day.match_status = 'needs_amount' AND day.ai_status = 'done' AND day.category = 'bill' THEN 1 ELSE 0 END) AS needs_amount_count,
       SUM(CASE WHEN day.is_orphan_page = 1 THEN 1 ELSE 0 END) AS orphan_page_count,
       SUM(CASE WHEN day.status IN ('received', 'download_failed')
         OR (day.status = 'downloaded' AND day.ai_status <> 'done')
         THEN 1 ELSE 0 END) AS processing_count,
       SUM(CASE WHEN COALESCE(day.payment_role, '') = 'reimbursement'
         AND day.reimbursement_status = 'pending'
         AND COALESCE(day.reimbursement_related_item_id, 0) <> 0 THEN 1 ELSE 0 END) AS reimbursement_pending_count
     FROM (
       SELECT ci.*,
         CASE WHEN ci.category = 'bill_page' AND NOT EXISTS (
           SELECT 1 FROM capture_items p
           WHERE ci.doc_ref IS NOT NULL AND ci.doc_ref <> '' AND p.doc_ref = ci.doc_ref
             AND p.status NOT IN ('unsent', 'duplicate') AND p.category = 'bill'
             AND COALESCE(p.bill_total_value, 0) > 0
         ) THEN 1 ELSE 0 END AS is_orphan_page,
         ${BUSINESS_DATE_SQL} AS business_date
       FROM capture_items ci
       WHERE ci.status NOT IN ('unsent', 'duplicate') AND ci.source_id = ?
     ) day
     WHERE day.business_date = ?`,
    [sourceId, businessDate]
  );
  try {
    const row = getFirstRow(statement) || {};
    for (const key of ['bill_count', 'slip_count', 'pending_count', 'unmatched_count', 'needs_amount_count', 'orphan_page_count', 'processing_count', 'reimbursement_pending_count']) {
      row[key] = Number(row[key] || 0);
    }
    row.unmatched_count += row.orphan_page_count;
    row.pending_count += row.reimbursement_pending_count;
    row.unresolved_count = row.pending_count + row.unmatched_count + row.needs_amount_count + row.processing_count;
    return row;
  } finally {
    statement.free();
  }
};

const buildDayClosingSnapshotSync = (database, businessDate, sourceId) => {
  const workload = computeDayWorkloadSync(database, businessDate, sourceId);
  const transferTransactions = buildConfirmedTransactionsSnapshotSync(database, businessDate, sourceId);
  const cashTransactions = buildConfirmedCashTransactionsSnapshotSync(database, businessDate, sourceId);
  const transactions = [...transferTransactions, ...cashTransactions]
    .sort((a, b) => Number(a.slip_timestamp_ms || a.bill_timestamp_ms || 0) - Number(b.slip_timestamp_ms || b.bill_timestamp_ms || 0));
  const reimbursements = buildConfirmedReimbursementsSnapshotSync(database, businessDate, sourceId);
  const incomingTransfers = buildIncomingTransfersSnapshotSync(database, businessDate, sourceId);
  const seenBills = new Set();
  const seenSlips = new Set();
  let confirmedBillAmount = 0;
  let confirmedSlipAmount = 0;
  let confirmedCashAmount = 0;
  let confirmedTransferBillAmount = 0;
  for (const transaction of transactions) {
    for (const bill of transaction.bill_members) {
      if (seenBills.has(Number(bill.bill_id))) continue;
      seenBills.add(Number(bill.bill_id));
      confirmedBillAmount += Number(bill.bill_total_value || 0);
      if (transaction.payment_method === 'bank_transfer') {
        confirmedTransferBillAmount += Number(bill.bill_total_value || 0);
      }
    }
    for (const slip of transaction.slip_members) {
      if (seenSlips.has(Number(slip.slip_id))) continue;
      seenSlips.add(Number(slip.slip_id));
      confirmedSlipAmount += Number(slip.slip_amount_value || 0);
    }
    if (transaction.payment_method === 'cash') {
      confirmedCashAmount += Number(transaction.cash_payment?.amount || transaction.cash_amount_value || 0);
    }
  }
  return {
    snapshot_version: 5,
    snapshot_created_at: nowIso(),
    ...workload,
    confirmed_count: transactions.length,
    confirmed_transfer_count: transferTransactions.length,
    confirmed_cash_count: cashTransactions.length,
    confirmed_bill_amount: confirmedBillAmount,
    confirmed_transfer_bill_amount: confirmedTransferBillAmount,
    confirmed_slip_amount: confirmedSlipAmount,
    confirmed_cash_amount: confirmedCashAmount,
    confirmed_payment_amount: confirmedSlipAmount + confirmedCashAmount,
    incoming_transfer_count: incomingTransfers.length,
    incoming_transfer_amount: incomingTransfers.reduce((sum, row) => sum + Number(row.slip_amount_value || 0), 0),
    transactions,
    reimbursements,
    incoming_transfers: incomingTransfers
  };
};

const computeDaySummary = (database, businessDate, sourceId) =>
  buildDayClosingSnapshotSync(database, businessDate, sourceId);

export const listDays = async ({ start = '', end = '', sourceId = '' } = {}) =>
  runRead((database) => {
    // ต้องกรองเหมือน liveItem() ในหน้าจอเป๊ะ ๆ ไม่งั้นบอร์ดจะนับ duplicate เป็นงานค้าง
    // ทั้งที่หน้าวันไม่แสดง กลายเป็นงานผีที่กดเข้าไปไม่เจอ
    const where = ["ci.status NOT IN ('unsent', 'duplicate')"];
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
         SUM(CASE WHEN day.cash_payment_amount > 0 THEN 1 ELSE 0 END) AS cash_count,
         SUM(day.cash_payment_amount) AS cash_total,
         SUM(CASE WHEN (day.category = 'bill' AND day.match_status IN ('pending', 'manual_review'))
           AND day.ai_status = 'done'
           OR (COALESCE(day.payment_role, '') = 'reimbursement'
               AND day.reimbursement_status = 'pending'
               AND COALESCE(day.reimbursement_related_item_id, 0) <> 0)
           THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN (day.match_status IN ('unmatched', 'rejected')
             AND day.ai_status = 'done'
             AND day.category IN ('bill', 'transfer', 'transfer_notice')
             AND COALESCE(day.reimbursement_related_item_id, 0) = 0)
           OR day.is_orphan_page = 1
           THEN 1 ELSE 0 END) AS unmatched_count,
         SUM(CASE WHEN day.category = 'bill' AND day.ai_status = 'done' AND day.match_status = 'needs_amount' THEN 1 ELSE 0 END) AS needs_amount_count,
         SUM(CASE WHEN day.status IN ('received', 'download_failed')
           OR (day.status = 'downloaded' AND day.ai_status <> 'done')
           THEN 1 ELSE 0 END) AS processing_count,
         SUM(CASE WHEN day.ai_status = 'failed' THEN 1 ELSE 0 END) AS ai_failed_count,
         c.status AS closing_status,
         c.closed_at,
         c.closed_by,
         c.reopened_at,
         c.reopened_reason,
         c.summary_json
       FROM (
         SELECT ci.source_type, ci.source_id, ci.category, ci.match_status, ci.status, ci.ai_status,
           ci.payment_role, ci.reimbursement_status, ci.reimbursement_related_item_id,
           COALESCE((SELECT cp.amount FROM capture_cash_payments cp
             WHERE cp.bill_item_id = ci.id AND cp.status = 'confirmed'
             ORDER BY cp.id DESC LIMIT 1), 0) AS cash_payment_amount,
           CASE WHEN ci.category = 'bill_page' AND NOT EXISTS (
             SELECT 1 FROM capture_items p
             WHERE ci.doc_ref IS NOT NULL AND ci.doc_ref <> ''
               AND p.doc_ref = ci.doc_ref
               AND p.status NOT IN ('unsent', 'duplicate')
               AND p.category = 'bill'
               AND COALESCE(p.bill_total_value, 0) > 0
           ) THEN 1 ELSE 0 END AS is_orphan_page,
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
    if (Number(summary.unresolved_count || 0) > 0) {
      return { error: 'day_has_unresolved_items', summary };
    }
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
    if (!closing) return { business_date: date, source_id: source, closing: null, transactions: [], reimbursements: [], incoming_transfers: [] };
    const snapshot = parseStoredJson(closing.summary_json, {});
    const hasImmutableSnapshot = Number(snapshot?.snapshot_version || 0) >= 2
      && Array.isArray(snapshot?.transactions)
      && Array.isArray(snapshot?.reimbursements);

    return {
      business_date: date,
      source_id: source,
      closing: {
        ...closing,
        summary: snapshot,
        snapshot_legacy: !hasImmutableSnapshot
      },
      transactions: hasImmutableSnapshot ? snapshot.transactions : [],
      reimbursements: hasImmutableSnapshot ? snapshot.reimbursements : [],
      // Snapshot v4 stores income immutably. Older rounds predate that field,
      // so derive their income from the captured documents for historical reports.
      incoming_transfers: Array.isArray(snapshot?.incoming_transfers)
        ? snapshot.incoming_transfers
        : buildIncomingTransfersSnapshotSync(database, date, source)
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
      where.push(`${matchTransactionDateSql('m', 's')} >= ?`);
      params.push(start);
    }
    if (validDate(end)) {
      where.push(`${matchTransactionDateSql('m', 's')} <= ?`);
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
         s.event_timestamp_ms AS slip_event_timestamp_ms,
         ${matchTransactionDateSql('m', 's')} AS transaction_business_date
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
