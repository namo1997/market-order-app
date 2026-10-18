import { createHash } from 'node:crypto';
import * as p from './receiving-issues-policy.js';
const select = `SELECT *, DATE_FORMAT(due_at,'%Y-%m-%d %H:%i:%s.%f') AS due_at,
 DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS created_at,
 DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updated_at,
 DATE_FORMAT(closed_at,'%Y-%m-%d %H:%i:%s.%f') AS closed_at FROM receiving_issues`;
export const mapIssue = row => ({ ...row, quantity: String(row.quantity), amount: String(row.amount),
  resolution_amount: row.resolution_amount == null ? null : String(row.resolution_amount),
  due_at: p.iso(row.due_at), created_at: p.iso(row.created_at), updated_at: p.iso(row.updated_at),
  closed_at: row.closed_at ? p.iso(row.closed_at) : null });
// Resolve display names from the receipt for older issues saved with a bill
// alias. Scope has already been checked; bind every line ID and match its doc.
async function withLineNames(db, rows) {
  const ids = [...new Set(rows.map(row => row.line_id).filter(Boolean))];
  if (!ids.length) return rows.map(mapIssue);
  const [lines] = await db.query(`SELECT id,document_id,product_name,bill_text FROM receiving_document_lines WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return rows.map(row => {
    const line = lines.find(line => Number(line.id) === Number(row.line_id) && Number(line.document_id) === Number(row.document_id));
    return { ...mapIssue(row), product_name: line?.product_name || row.product_name, bill_text: line?.bill_text || null };
  });
}
export async function transaction(db, action) {
  const conn = await db.getConnection();
  try { await conn.beginTransaction(); const result = await action(conn); await conn.commit(); return result; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
export async function locked(conn, user, id) {
  const [rows] = await conn.query(`${select} WHERE id=? FOR UPDATE`, [p.idOf(id)]);
  p.assertAccess(user, rows[0]); return rows[0];
}
export async function history(conn, row, user, action, details, now) {
  await conn.query(`INSERT INTO receiving_issue_history (issue_id,action,actor_user_id,details_json,created_at) VALUES (?,?,?,?,?)`,
    [row.id, action, user?.id || null, JSON.stringify(details), p.stamp(now)]);
}
export async function listIssues(db, user, filters = {}, now = new Date()) {
  const clauses = []; const values = [];
  if (!p.manager(user)) { if (!user.branch_id) p.fail('ไม่พบสาขาผู้ใช้', 'FORBIDDEN'); clauses.push('branch_id=?'); values.push(p.idOf(user.branch_id)); }
  if (filters.branch_id) { clauses.push('branch_id=?'); values.push(p.idOf(filters.branch_id)); }
  const status = filters.status || 'pending';
  if (status === 'pending') clauses.push("status IN ('open','waiting_supplier')");
  else if (status === 'closed') clauses.push("status IN ('resolved','cancelled')");
  else if (status !== 'all') { if (!['open','waiting_supplier','resolved','cancelled'].includes(status)) p.fail(); clauses.push('status=?'); values.push(status); }
  if (filters.type) { if (!p.TYPES.includes(filters.type)) p.fail(); clauses.push('type=?'); values.push(filters.type); }
  if (filters.supplier) { clauses.push('supplier_name LIKE ?'); values.push(`%${p.text(filters.supplier, 255)}%`); }
  if (filters.min_age_days) { const days = p.idOf(filters.min_age_days); if (days > 3650) p.fail(); clauses.push('created_at<=?'); values.push(p.stamp(new Date(now.getTime() - days * 86400000))); }
  if (filters.overdue === 'true') { clauses.push('due_at<=?'); values.push(p.stamp(now)); }
  if (filters.before_id) { clauses.push('id<?'); values.push(p.idOf(filters.before_id)); }
  const [rows] = await db.query(`${select} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 101`, values);
  return { items: await withLineNames(db, rows.slice(0,100)), next_before_id: rows.length > 100 ? rows[99].id : null };
}
export async function detailIssue(db, user, id) {
  const [rows] = await db.query(`${select} WHERE id=?`, [p.idOf(id)]);
  const row = rows[0]; p.assertAccess(user, row);
  const [evidence] = await db.query(`SELECT id,collector_name,note,signature_data IS NOT NULL AS has_signature,
    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS created_at FROM receiving_issue_evidence WHERE issue_id=? ORDER BY id`, [row.id]);
  const [events] = await db.query(`SELECT id,action,actor_user_id,details_json,
    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS created_at FROM receiving_issue_history WHERE issue_id=? ORDER BY id`, [row.id]);
  return { ...(await withLineNames(db, [row]))[0], evidence: evidence.map(e => ({...e, created_at:p.iso(e.created_at)})),
    history: events.map(({details_json,...e}) => ({...e, details:JSON.parse(details_json), created_at:p.iso(e.created_at)})) };
}
export async function createIssue(db, user, body, now = new Date(), automatic = null) {
  const clientUuid = p.uuid(body.client_uuid);
  if (!automatic && clientUuid.startsWith('auto-')) p.fail('รหัสคำขอนี้สงวนสำหรับระบบ');
  if (!p.TYPES.includes(body.type)) p.fail('ประเภทปัญหาไม่ถูกต้อง');
  const quantity = p.decimal(p.units(body.quantity, true)); const amount = p.decimal(p.units(body.amount ?? '0'));
  const note = p.text(body.note ?? '');
  const dueAt = body.due_at !== undefined ? p.due(body.due_at) : p.stamp(new Date(now.getTime()+86400000));
  return transaction(db, async conn => {
    const [docs] = await conn.query('SELECT id,status,branch_id,department_id,supplier_name_text FROM receiving_documents WHERE id=? FOR UPDATE', [p.idOf(body.document_id)]);
    const doc = docs[0]; p.assertAccess(user, doc);
    if (doc.status !== 'confirmed') p.fail('ต้องอ้างอิงเอกสารที่ยืนยันแล้ว', 'NOT_DRAFT');
    let productName = p.text(body.product_name ?? '', 255);
    let lineId = null;
    if (body.line_id != null) {
      lineId = p.idOf(body.line_id);
      const [lines] = await conn.query('SELECT id,bill_text,product_name FROM receiving_document_lines WHERE id=? AND document_id=?', [lineId, doc.id]);
      if (!lines.length) p.fail('ไม่พบบรรทัดในเอกสารนี้', 'NOT_FOUND');
      productName = lines[0].product_name || lines[0].bill_text;
    }
    const [existing] = await conn.query(`${select} WHERE client_uuid=?`, [clientUuid]);
    if (existing.length) {
      p.assertAccess(user, existing[0]);
      const row = existing[0];
      if (Number(row.document_id)!==Number(doc.id) || Number(row.line_id)!==Number(lineId) || row.type!==body.type || p.units(row.quantity)!==p.units(quantity) || p.units(row.amount)!==p.units(amount) || (!automatic && row.note!==note) || (!automatic && body.due_at && p.stamp(p.iso(row.due_at))!==dueAt)) p.fail('รหัสคำขอนี้ใช้กับเรื่องอื่นแล้ว', 'NOT_DRAFT');
      return { issue: mapIssue(row), created: false };
    }
    const [result] = await conn.query(`INSERT INTO receiving_issues
      (client_uuid,auto_key,type,document_id,line_id,branch_id,department_id,supplier_name,product_name,quantity,amount,note,due_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [clientUuid, automatic, body.type, doc.id, lineId, doc.branch_id, doc.department_id,
      doc.supplier_name_text || 'ไม่ระบุร้าน', productName, quantity, amount, note, dueAt, user.id || null, p.stamp(now), p.stamp(now)]);
    const row = {id:result.insertId};
    await history(conn,row,user,automatic ? 'auto_created':'created',{type:body.type,quantity,amount},now);
    const [rows] = await conn.query(`${select} WHERE id=?`, [row.id]);
    return { issue: mapIssue(rows[0]), created:true };
  });
}
export async function closeReminders(conn, id) {
  await conn.query(`UPDATE receiving_followups f JOIN receiving_issue_reminders r ON r.followup_id=f.id
    SET f.status='resolved', f.updated_at=UTC_TIMESTAMP(3) WHERE r.issue_id=? AND f.status<>'resolved'`, [id]);
}
export async function updateIssue(db,user,id,body,now=new Date()) {
  p.assertManager(user);
  return transaction(db,async conn => {
    const row = await locked(conn,user,id); p.assertOpen(row);
    if (p.idOf(body.version)!==Number(row.version)) p.fail('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่','NOT_DRAFT');
    const status = body.status ?? row.status;
    if (!['open','waiting_supplier','resolved','cancelled'].includes(status)) p.fail('สถานะไม่ถูกต้อง');
    if (row.status==='waiting_supplier' && status==='open') p.fail('ไม่สามารถย้อนสถานะได้','NOT_DRAFT');
    const note = p.text(body.note ?? row.note);
    let resolution = null, resolutionAmount = null, resolutionRef = null;
    if (status==='resolved') {
      if (!p.RESOLUTIONS.includes(body.resolution)) p.fail('กรุณาเลือกทางจบ');
      resolution = body.resolution;
      resolutionAmount = p.decimal(p.units(body.resolution_amount ?? row.amount));
      resolutionRef = p.text(body.resolution_ref ?? '',255);
      if (resolution==='returned') {
        const [proof] = await conn.query('SELECT id FROM receiving_issue_evidence WHERE issue_id=? AND collector_name IS NOT NULL LIMIT 1',[row.id]);
        if (!proof.length) p.fail('กรุณาแนบรูปและชื่อผู้มารับคืนก่อนปิดเรื่อง');
      }
      if (['new_bill','credit_note'].includes(resolution) && !resolutionRef) p.fail('กรุณาระบุเลขที่เอกสารอ้างอิง');
      if (resolution==='written_off' && !note) p.fail('กรุณาระบุเหตุผลตัดสูญ');
    } else if (body.resolution != null || body.resolution_amount != null || body.resolution_ref != null) p.fail('บันทึกทางจบได้เมื่อปิดเรื่องเท่านั้น');
    if (status==='cancelled' && !note) p.fail('กรุณาระบุเหตุผลยกเลิก');
    const owner = body.owner_user_id===undefined ? row.owner_user_id : body.owner_user_id===null ? null : p.idOf(body.owner_user_id);
    if (owner!=null) {
      const [users]=await conn.query('SELECT id FROM users WHERE id=? AND is_active=true AND role IN (?,?,?,?)',[owner,'admin','super_admin','accounting','accountant']);
      if (!users.length) p.fail('ผู้รับผิดชอบต้องเป็นบัญชีหรือผู้ดูแลที่ใช้งานอยู่');
    }
    const dueAt=body.due_at !== undefined ? p.due(body.due_at) : p.stamp(p.iso(row.due_at));
    const closed=['resolved','cancelled'].includes(status);
    await conn.query(`UPDATE receiving_issues SET status=?,resolution=?,resolution_amount=?,resolution_ref=?,note=?,owner_user_id=?,due_at=?,
      version=version+1,updated_at=?,closed_at=? WHERE id=?`,[status,resolution,resolutionAmount,resolutionRef,note,owner,dueAt,p.stamp(now),closed?p.stamp(now):null,row.id]);
    if (closed || dueAt!==p.stamp(p.iso(row.due_at))) await closeReminders(conn,row.id);
    await history(conn,row,user,'updated',{from:row.status,to:status,resolution,resolution_amount:resolutionAmount,resolution_ref:resolutionRef,note,owner_user_id:owner,due_at:p.iso(dueAt)},now);
    const [rows]=await conn.query(`${select} WHERE id=?`,[row.id]); return mapIssue(rows[0]);
  });
}
export async function attachEvidence(db,user,id,body,now=new Date()) {
  const proof=p.parseEvidence(body);
  return transaction(db,async conn=>{
    const row=await locked(conn,user,id);
    const [existing]=await conn.query('SELECT id,sha256,signature_data,collector_name,note FROM receiving_issue_evidence WHERE issue_id=? AND client_uuid=?',[row.id,proof.clientUuid]);
    if(existing.length) {
      const old=existing[0];
      const hash=value=>createHash('sha256').update(value).digest('hex');
      if(old.sha256!==hash(proof.image.buffer) || old.collector_name!==proof.collector || old.note!==proof.note ||
        (old.signature_data?hash(old.signature_data):null)!==(proof.signature?hash(proof.signature.buffer):null)) p.fail('รหัสหลักฐานนี้ใช้กับข้อมูลอื่นแล้ว','NOT_DRAFT');
      return {id:old.id,created:false};
    }
    p.assertOpen(row);
    if(!p.manager(user) && row.type!=='return') p.fail('พนักงานแนบหลักฐานได้เฉพาะเรื่องคืนของ','FORBIDDEN');
    if(row.type==='return' && !proof.collector) p.fail('กรุณาระบุชื่อคนมารับคืน');
    const [count]=await conn.query('SELECT COUNT(*) AS count FROM receiving_issue_evidence WHERE issue_id=?',[row.id]);
    if(Number(count[0].count)>=10) p.fail('แนบหลักฐานได้ไม่เกิน 10 ชุดต่อเรื่อง');
    const [result]=await conn.query(`INSERT INTO receiving_issue_evidence
      (issue_id,client_uuid,image_data,mime_type,sha256,signature_data,collector_name,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [row.id,proof.clientUuid,proof.image.buffer,proof.image.mimeType,createHash('sha256').update(proof.image.buffer).digest('hex'),
      proof.signature?.buffer ?? null,proof.collector,proof.note,user.id,p.stamp(now)]);
    await history(conn,row,user,'evidence_added',{evidence_id:result.insertId,collector_name:proof.collector,has_signature:Boolean(proof.signature),note:proof.note},now);
    return {id:result.insertId,created:true};
  });
}
export async function evidenceBinary(db,user,id,evidenceId,kind='image') {
  if(!['image','signature'].includes(kind)) p.fail();
  const [issues]=await db.query(`${select} WHERE id=?`,[p.idOf(id)]); p.assertAccess(user,issues[0]);
  const [rows]=await db.query(`SELECT image_data,mime_type,signature_data FROM receiving_issue_evidence WHERE id=? AND issue_id=?`,[p.idOf(evidenceId),p.idOf(id)]);
  const row=rows[0];if(!row || (kind==='signature' && !row.signature_data)) p.fail('ไม่พบหลักฐาน','NOT_FOUND');
  return {buffer:kind==='signature'?row.signature_data:row.image_data,mime:kind==='signature'?'image/png':row.mime_type};
}

export async function listIssueAssignees(db,user) {
  p.assertManager(user);
  const [items]=await db.query('SELECT id,name FROM users WHERE is_active=true AND role IN (?,?,?,?) ORDER BY name,id LIMIT 200',['admin','super_admin','accounting','accountant']);
  return {items};
}

export async function issueSourceDocument(db,user,id) {
  const [rows]=await db.query('SELECT id,status,branch_id,department_id,supplier_name_text FROM receiving_documents WHERE id=?',[p.idOf(id)]);
  p.assertAccess(user,rows[0]);
  const [lines]=await db.query('SELECT id,line_no,bill_text,product_name FROM receiving_document_lines WHERE document_id=? ORDER BY line_no,id',[p.idOf(id)]);
  return {...rows[0],lines};
}
