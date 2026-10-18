import { createHash } from 'node:crypto';
import { ensureIssueTables } from '../models/receiving-issues-schema.js';
import { ensureQueueTables } from '../models/receiving-queue-schema.js';
import { createIssue, history, locked, transaction } from '../models/receiving-issues-store.js';
import { discrepancies, stamp } from '../models/receiving-issues-policy.js';
const system = {role:'super_admin',name:'ระบบติดตามปัญหา'};
export async function scanConfirmedIssues(db, documentId, now=new Date()) {
  await ensureIssueTables(db);
  const [docs]=await db.query('SELECT id,status FROM receiving_documents WHERE id=?',[documentId]);
  if(docs[0]?.status!=='confirmed') return;
  const [scanned]=await db.query('SELECT document_id FROM receiving_issue_scans WHERE document_id=?',[documentId]);
  if(scanned.length) return;
  const [audits]=await db.query("SELECT details_json FROM receiving_document_audits WHERE document_id=? AND action='confirm' ORDER BY id DESC LIMIT 1",[documentId]);
  const candidates=audits.length ? JSON.parse(audits[0].details_json).issue_candidates : null;
  // Older confirmations have no frozen count: compare the bill only, never today's order balance.
  const [lines]=candidates ? [[]] : await db.query('SELECT id,bill_text,quantity_billed,quantity_received,unit_price FROM receiving_document_lines WHERE document_id=? ORDER BY id',[documentId]);
  for(const issue of candidates || discrepancies(lines)) {
    const key=`auto-${documentId}-${issue.line_id}-${issue.type}`;
    await createIssue(db,system,{...issue,document_id:documentId,client_uuid:key},now,key);
  }
  await db.query('INSERT IGNORE INTO receiving_issue_scans (document_id,scanned_at) VALUES (?,?)',[documentId,stamp(now)]);
}
// A separate connection runs only after confirm commits and releases its locks.
// A cron reconciliation retries unfinished scans after failures or process restarts.
export async function afterReceivingConfirm(db, documentId) {
  try { await scanConfirmedIssues(db,documentId); }
  catch { console.warn('[receiving-issues] scan deferred'); }
}
export async function discoverIssueFollowups(db, now=new Date()) {
  await ensureIssueTables(db); await ensureQueueTables(db);
  const [docs]=await db.query(`SELECT DISTINCT d.id FROM receiving_documents d JOIN receiving_document_audits a ON a.document_id=d.id AND a.action='confirm'
    LEFT JOIN receiving_issue_scans s ON s.document_id=d.id
    WHERE d.status='confirmed' AND s.document_id IS NULL AND JSON_EXTRACT(a.details_json,'$.issue_candidates') IS NOT NULL ORDER BY d.id LIMIT 50`);
  for(const doc of docs) {
    try { await scanConfirmedIssues(db,doc.id,now); }
    catch { console.warn('[receiving-issues] reconciliation deferred'); }
  }
  const [issues]=await db.query(`SELECT i.id FROM receiving_issues i LEFT JOIN receiving_issue_reminders r ON r.issue_id=i.id AND r.due_at=i.due_at
    WHERE i.status IN ('open','waiting_supplier') AND i.due_at<=? AND r.issue_id IS NULL ORDER BY i.due_at,i.id LIMIT 100`,[stamp(now)]);
  for(const issue of issues) await transaction(db,async conn=>{
    const row=await locked(conn,system,issue.id);
    if(!['open','waiting_supplier'].includes(row.status) || Date.parse(`${row.due_at.replace(' ','T')}Z`)>now.getTime()) return;
    const [existing]=await conn.query('SELECT followup_id FROM receiving_issue_reminders WHERE issue_id=? AND due_at=?',[row.id,stamp(`${row.due_at.replace(' ','T')}Z`)]);
    if(existing.length) return;
    const dueAt=stamp(`${row.due_at.replace(' ','T')}Z`);
    const key=createHash('sha256').update(`issue:${row.id}:${dueAt}`).digest('hex');
    const items=[{issue_id:row.id,order_item_id:-row.id,product_name:row.product_name,remaining_quantity:String(row.quantity),unit_name:'',due_status:'overdue'}];
    const [result]=await conn.query(`INSERT INTO receiving_followups
      (supplier_key,supplier_name,branch_id,department_id,pending_items_json,actor_user_id,actor_name,note,source,auto_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[`issue:${row.id}`,row.supplier_name,row.branch_id,row.department_id||0,JSON.stringify(items),null,'ระบบติดตามปัญหา',`ปัญหารับของ #${row.id} เลยกำหนดตาม`,'overdue',key,stamp(now),stamp(now)]);
    await conn.query('INSERT INTO receiving_issue_reminders (issue_id,due_at,followup_id) VALUES (?,?,?)',[row.id,dueAt,result.insertId]);
    await history(conn,row,system,'reminded',{followup_id:result.insertId},now);
  });
}
