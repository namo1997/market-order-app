import { fail } from './domain.js';
import { fetchReceivingPage, matchReceivingDocuments, receivingEndpoint, receivingHash } from './receiving.js';
const parsed = value => typeof value === 'string' ? JSON.parse(value) : value;
const publicErrors = new Set(['RECEIVING_SYNC_RUNNING','RECEIVING_HTTP_FAILED','RECEIVING_INVALID_PAYLOAD','RECEIVING_FETCH_FAILED','RECEIVING_REVISION_CONFLICT','RECEIVING_AUDIT_REQUIRED']);

// One atomic import after all pages validate. A failed page never advances the watermark.
// No ap_journals, payments, P&L or period controls are written here.
export const createReceivingSync = ({ getPool, config, fetchImpl = fetch, audit }) => async ({ actor } = {}) => {
  const endpoint = receivingEndpoint(config), originHash = receivingHash(endpoint.href);
  if (typeof audit !== 'function') throw fail('RECEIVING_AUDIT_REQUIRED', 503);
  const connection = await getPool().getConnection();
  let locked = false, runId, transaction = false, cursor = null;
  const stats = { seen: 0, changed: 0 };
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('ap_receiving_sync',0) AS acquired");
    if (Number(lock.acquired) !== 1) throw fail('RECEIVING_SYNC_RUNNING', 409);
    locked = true;
    const [[previous]] = await connection.query("SELECT watermark FROM ap_receiving_sync_runs WHERE status='SUCCEEDED' AND origin_hash=? ORDER BY id DESC LIMIT 1", [originHash]);
    // Inclusive replay overlap protects equal updated_at timestamps across runs.
    const updatedSince = previous?.watermark ? new Date(Date.parse(previous.watermark) - 1000).toISOString() : null;
    const [created] = await connection.query("INSERT INTO ap_receiving_sync_runs (status,origin_hash,updated_since) VALUES ('RUNNING',?,?)", [originHash, updatedSince]);
    runId = created.insertId;
    const incoming = new Map(), cursors = new Set(); let watermark = previous?.watermark || null;
    do {
      if (cursors.has(cursor) || cursors.size >= 100) throw fail('RECEIVING_INVALID_PAYLOAD', 502);
      cursors.add(cursor);
      const page = await fetchReceivingPage(config, { cursor, updatedSince, fetchImpl });
      for (const doc of page.documents) {
        stats.seen++;
        if (!watermark || doc.updated_at > watermark) watermark = doc.updated_at;
        const old = incoming.get(doc.document_id);
        if (old && old.updated_at === doc.updated_at && receivingHash(old) !== receivingHash(doc)) throw fail('RECEIVING_REVISION_CONFLICT', 502);
        if (!old || old.updated_at <= doc.updated_at) incoming.set(doc.document_id, doc);
      }
      cursor = page.nextCursor;
    } while (cursor != null);
    await connection.beginTransaction(); transaction = true;
    const [stored] = await connection.query('SELECT * FROM ap_receiving_documents ORDER BY document_id FOR UPDATE');
    const current = new Map(stored.map(r => [Number(r.document_id), { row: r, document: parsed(r.document) }]));
    for (const doc of incoming.values()) {
      const old = current.get(doc.document_id);
      if (old && doc.updated_at < old.document.updated_at) continue;
      if (old && doc.updated_at === old.document.updated_at && receivingHash(doc) !== old.row.content_hash) throw fail('RECEIVING_REVISION_CONFLICT', 502);
      current.set(doc.document_id, { row: old?.row, document: doc });
    }
    const [sources] = await connection.query("SELECT document FROM ap_sources WHERE source_type='LBC' ORDER BY source_key");
    for (const { document: doc, match } of matchReceivingDocuments([...current.values()].map(r => r.document), sources.map(s => parsed(s.document)))) {
      const old = current.get(doc.document_id).row, hash = receivingHash(doc);
      if (old && old.content_hash === hash && old.match_status === match.status && old.linked_source_key === match.linkedSourceKey) continue;
      const body = JSON.stringify(doc);
      await connection.query(`INSERT INTO ap_receiving_documents
        (document_id,source_updated_at,receipt_date,branch_code,status,content_hash,document,match_status,linked_source_key,sync_run_id)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_updated_at=VALUES(source_updated_at),receipt_date=VALUES(receipt_date),
        branch_code=VALUES(branch_code),status=VALUES(status),content_hash=VALUES(content_hash),document=VALUES(document),
        match_status=VALUES(match_status),linked_source_key=VALUES(linked_source_key),sync_run_id=VALUES(sync_run_id)`,
      [doc.document_id,doc.updated_at,doc.receipt_date,doc.branch.code,doc.status,hash,body,match.status,match.linkedSourceKey,runId]);
      await connection.query(`INSERT INTO ap_receiving_history
        (document_id,sync_run_id,content_hash,document,match_status,linked_source_key,previous_hash) VALUES (?,?,?,?,?,?,?)`,
      [doc.document_id,runId,hash,body,match.status,match.linkedSourceKey,old?.content_hash || null]);
      stats.changed++;
    }
    await connection.query("UPDATE ap_receiving_sync_runs SET status='SUCCEEDED',cursor=NULL,watermark=?,documents_seen=?,documents_changed=?,finished_at=NOW() WHERE id=?", [watermark,stats.seen,stats.changed,runId]);
    const result = { id: Number(runId), status: 'SUCCEEDED', ...stats };
    await audit({ connection, actor, entityType: 'ap_receiving_sync_runs', entityId: Number(runId), action: 'ap.receiving.sync', beforePayload: null, afterPayload: result });
    await connection.commit(); transaction = false;
    return result;
  } catch (error) {
    if (transaction) await connection.rollback();
    const code = publicErrors.has(error.message) ? error.message : 'RECEIVING_SYNC_FAILED';
    if (runId) await connection.query("UPDATE ap_receiving_sync_runs SET status='FAILED',cursor=?,error_code=?,documents_seen=?,documents_changed=0,finished_at=NOW() WHERE id=?", [cursor,code,stats.seen,runId]);
    throw fail(code, error.statusCode || 503);
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK('ap_receiving_sync')"); }
    finally { connection.release(); }
  }
};
