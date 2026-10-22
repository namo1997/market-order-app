import { bangkokTimestamp, exportDocument } from './receiving-ap-export-values.js';

const invalid = () => { throw Object.assign(new Error('พารามิเตอร์ส่งออกไม่ถูกต้อง'), { code: 'VALIDATION_FAILED' }); };
const epoch = value => String(new Date(value).getTime() / 1000);
function sinceValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) invalid();
  const date = new Date(value);
  const day = new Date(`${value.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || day.toISOString().slice(0,10) !== value.slice(0,10)
    || Number(value.slice(11,13)) > 23 || Number(value.slice(14,16)) > 59 || Number(value.slice(17,19)) > 59
    || Number(value.slice(0,4)) < 1970 || Number(value.slice(0,4)) > 9999) invalid();
  return epoch(value);
}
export function exportFilters(query = {}) {
  if (Object.keys(query).some(key => !['limit','cursor','updated_since'].includes(key))) invalid();
  const limit = query.limit === undefined ? 100 : query.limit;
  if (!/^[1-9]\d{0,2}$/.test(String(limit)) || Number(limit) > 500 || typeof limit === 'object') invalid();
  const since = query.updated_since === undefined ? null : sinceValue(query.updated_since);
  let after = null;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)) invalid();
    let decoded;
    try { decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { invalid(); }
    if (!decoded || decoded.v !== 1 || decoded.since !== since || !Array.isArray(decoded.after) || decoded.after.length !== 2
      || typeof decoded.after[0] !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(decoded.after[0])
      || !Number.isFinite(Number(decoded.after[0])) || Number(decoded.after[0]) > 253402300799
      || !Number.isSafeInteger(decoded.after[1]) || decoded.after[1] < 1) invalid();
    after = decoded.after;
  }
  return { limit: Number(limit), since, after };
}
const placeholders = ids => ids.map(() => '?').join(',');

// No lazy schema ensure here: the service credential authorizes SELECT only.
// One read-only InnoDB snapshot keeps header/status/lines coherent during void.
export async function listApDocuments(db, filters, now = new Date()) {
  const connection = await db.getConnection();
  let started = false;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    started = true;
    const clauses = ["d.status IN ('confirmed','void')"], params = [];
    if (filters.since !== null) { clauses.push('d.updated_at >= FROM_UNIXTIME(?)'); params.push(filters.since); }
    if (filters.after) {
      clauses.push('(d.updated_at > FROM_UNIXTIME(?) OR (d.updated_at = FROM_UNIXTIME(?) AND d.id > ?))');
      params.push(filters.after[0], filters.after[0], filters.after[1]);
    }
    const [rows] = await connection.query(`SELECT d.id, d.status, d.kind, d.branch_id, d.department_id,
      d.receiving_scope, d.supplier_master_id, d.product_group_id, d.supplier_name_text, d.doc_ref,
      d.subtotal, d.discount, d.vat, d.total,
      CAST(UNIX_TIMESTAMP(d.updated_at) AS CHAR) AS updated_epoch,
      UNIX_TIMESTAMP(d.confirmed_at) AS confirmed_epoch, UNIX_TIMESTAMP(d.voided_at) AS voided_epoch,
      DATE_FORMAT(d.delivery_date,'%Y-%m-%d') AS receipt_date, DATE_FORMAT(d.doc_date,'%Y-%m-%d') AS export_doc_date,
      CASE WHEN JSON_VALID(d.ocr_result_json) THEN JSON_UNQUOTE(JSON_EXTRACT(d.ocr_result_json,'$.doc_kind')) ELSE NULL END AS export_ocr_kind,
      b.code AS branch_code, b.name AS branch_name, dep.name AS department_name,
      sm.code AS master_ap_code, sm.name AS master_name, pg.name AS group_name,
      (SELECT bc.supplier_code FROM receiving_supplier_branch_codes bc
        WHERE bc.is_active = 1 AND bc.branch_id = d.branch_id
        AND bc.supplier_key = CASE WHEN d.supplier_master_id IS NOT NULL THEN CONCAT('sm:',d.supplier_master_id)
          ELSE CONCAT('pg:',d.product_group_id) END ORDER BY bc.id LIMIT 1) AS branch_ap_code,
      (SELECT COUNT(*) FROM receiving_document_images img WHERE img.document_id = d.id) AS image_count
      FROM receiving_documents d LEFT JOIN branches b ON b.id = d.branch_id
      LEFT JOIN departments dep ON dep.id = d.department_id
      LEFT JOIN supplier_masters sm ON sm.id = d.supplier_master_id
      LEFT JOIN product_groups pg ON pg.id = d.product_group_id
      WHERE ${clauses.join(' AND ')} ORDER BY d.updated_at, d.id LIMIT ?`, [...params, filters.limit + 1]);
    const page = rows.slice(0, filters.limit), ids = page.map(row => Number(row.id));
    let lines = [], issues = [];
    if (ids.length) {
      [lines] = await connection.query(`SELECT id, document_id, product_id, product_name, item_code, bill_text,
        quantity_received, unit, unit_text, unit_multiplier, unit_price, base_unit_price, amount, quantity_billed, price_by_weight, review_decision
        FROM receiving_document_lines WHERE document_id IN (${placeholders(ids)}) ORDER BY document_id, line_no, id`, ids);
      [issues] = await connection.query(`SELECT i.document_id, i.type, i.status, i.resolution, i.resolution_ref,
        CASE WHEN l.review_decision = 'missing_bill' AND i.type = 'wrong_item' THEN 'request_bill' ELSE NULL END AS export_type
        FROM receiving_issues i LEFT JOIN receiving_document_lines l ON l.id = i.line_id AND l.document_id = i.document_id
        WHERE i.document_id IN (${placeholders(ids)}) AND i.status IN ('open','waiting_supplier','resolved') ORDER BY i.document_id, i.id`, ids);
      // Pricing/bill requests belong to the existing exception followup store,
      // not the quantity-claim table. Read its explicit document links only.
      const [followups] = await connection.query(`SELECT pending_items_json, status FROM receiving_followups
        WHERE status IN ('open','acknowledged','resolved') AND (${ids.map(() =>
    "JSON_CONTAINS(CASE WHEN JSON_VALID(pending_items_json) THEN pending_items_json ELSE '[]' END, JSON_OBJECT('document_id', ?))").join(' OR ')}) ORDER BY id`, ids);
      for (const followup of followups) {
        let items;
        try { items = JSON.parse(followup.pending_items_json); } catch { continue; }
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!ids.includes(Number(item?.document_id)) || !['missing_bill','price_review'].includes(item?.review_decision)) continue;
          issues.push({ document_id: item.document_id, type: item.review_decision === 'missing_bill' ? 'request_bill' : 'price_review',
            status: followup.status === 'resolved' ? 'resolved' : 'open' });
        }
      }
    }
    const documents = page.map(row => exportDocument(row, lines.filter(line => Number(line.document_id) === Number(row.id)),
      issues.filter(issue => Number(issue.document_id) === Number(row.id))));
    const last = page.at(-1);
    const next_cursor = rows.length > filters.limit ? Buffer.from(JSON.stringify({ v: 1, since: filters.since,
      after: [String(last.updated_epoch), Number(last.id)] })).toString('base64url') : null;
    await connection.commit();
    return { version: 1, generated_at: bangkokTimestamp(now.getTime() / 1000), next_cursor, documents };
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
