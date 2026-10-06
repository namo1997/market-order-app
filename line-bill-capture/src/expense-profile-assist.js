// ระยะ 2: ข้อเสนอช่วยลดงานซ้ำของ "ข้อมูลสำหรับค่าใช้จ่าย"
// - paired_document: ค่าจาก profile ของเอกสารคู่ที่ยืนยันจับคู่แล้ว
// - remembered_pair: ร้าน ↔ ผู้รับเงิน ↔ ความสัมพันธ์ ที่เคยบันทึกว่า "ตรวจแล้ว"
// ทุกอย่างเป็นข้อเสนออย่างเดียว ไม่บันทึกอัตโนมัติ ไม่แก้ยอด/คู่เอกสาร และไม่ส่งเลขบัญชีเต็มออก
// ไฟล์นี้ไม่ import expense-profile.js เพื่อไม่ให้เกิด circular import

export const ASSIST_SOURCES = Object.freeze(['paired_document', 'remembered_pair']);
const PAIRED_FIELDS = ['supplier_name', 'supplier_payee_relation', 'recipient_name', 'recipient_bank',
  'recipient_account_masked', 'purpose', 'transaction_type', 'branch', 'department']; // ไม่ส่ง notes: เป็นคำอธิบายเฉพาะเอกสารนั้น
const MEMORY_FIELDS = ['supplier_name', 'recipient_name', 'recipient_bank', 'supplier_payee_relation'];
const MAX_EVIDENCE = 8;
const OPTION_LIMIT = 300;
const UNAVAILABLE = ['unsent', 'duplicate'];

const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const query = (database, sql, params = []) => {
  const statement = database.prepare(sql, params);
  try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
  finally { statement.free(); }
};
const text = (entry) => (plain(entry) && typeof entry.value === 'string' ? entry.value.trim() : '');
const norm = (value) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('th');
// เลขบัญชีต้องเป็นรูปแบบปิดบังและเหลือเลขไม่เกิน 4 หลักเท่านั้น (กฎเดียวกับ validateFields)
const maskedOk = (value) => /^[Xx*•＊●\d\s-]+$/u.test(value) && /[Xx*•＊●]/u.test(value) && value.replace(/\D/g, '').length <= 4;
const usable = (key, value) => value && (key !== 'recipient_account_masked' || maskedOk(value));
const placeholders = (list) => list.map(() => '?').join(',');

const profilesOf = (database, ids) => ids.length ? query(database,
  `SELECT p.item_id,p.status,p.fields_json,p.reviewed_at,p.updated_at FROM capture_expense_profiles p
   JOIN capture_items ci ON ci.id=p.item_id WHERE p.item_id IN (${placeholders(ids)}) AND ci.status NOT IN ('unsent','duplicate')`, ids) : [];
const rank = (left, right) => (left.status === 'reviewed' ? 0 : 1) - (right.status === 'reviewed' ? 0 : 1)
  || String(right.reviewed_at || right.updated_at || '').localeCompare(String(left.reviewed_at || left.updated_at || ''))
  || left.item_id - right.item_id;

const pairedSuggestions = (database, item, taken) => {
  const id = Number(item.id);
  const partners = query(database,
    `SELECT DISTINCT CASE WHEN bill_item_id=? THEN slip_item_id ELSE bill_item_id END AS partner_id
     FROM capture_matches WHERE (bill_item_id=? OR slip_item_id=?) AND status='confirmed'`, [id, id, id])
    .map((row) => Number(row.partner_id)).filter((partner) => Number.isSafeInteger(partner) && partner > 0 && partner !== id);
  const rows = profilesOf(database, partners).sort(rank).map((row) => ({ ...row, fields: parse(row.fields_json, {}) }));
  const out = {};
  for (const key of PAIRED_FIELDS) {
    if (taken[key]) continue;
    for (const row of rows) {
      const value = text(row.fields[key]);
      if (!usable(key, value)) continue;
      out[key] = { value, source: 'paired_document', evidence: [{ item_id: Number(row.item_id) }] };
      break;
    }
  }
  return out;
};

const reviewedPairs = (database, excludeId) => query(database,
  `SELECT p.item_id,p.fields_json,p.reviewed_at FROM capture_expense_profiles p
   JOIN capture_items ci ON ci.id=p.item_id
   WHERE p.status='reviewed' AND p.item_id<>? AND ci.status NOT IN ('unsent','duplicate')`, [excludeId])
  .map((row) => ({ item_id: Number(row.item_id), reviewed_at: row.reviewed_at || '', fields: parse(row.fields_json, {}) }))
  .filter((row) => text(row.fields.supplier_name) && text(row.fields.recipient_name))
  .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at) || a.item_id - b.item_id);

// ค่าที่พบบ่อยสุดในกลุ่ม (เท่ากันให้ใช้ค่าจากการตรวจล่าสุด) พร้อมรายการที่เป็นหลักฐาน
const dominant = (members, key) => {
  const groups = new Map();
  for (const member of members) {
    const value = text(member.fields[key]);
    if (!usable(key, value)) continue;
    const entry = groups.get(value) || { value, ids: [], first: groups.size };
    entry.ids.push(member.item_id); groups.set(value, entry);
  }
  const best = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || a.first - b.first)[0];
  return best ? { value: best.value, evidence: best.ids.slice(0, MAX_EVIDENCE).map((item_id) => ({ item_id })) } : null;
};

const memorySuggestions = (database, item, saved, taken) => {
  const known = (key) => text(saved?.[key]) || taken[key]?.value?.trim() || '';
  const supplier = known('supplier_name'), recipient = known('recipient_name');
  if (!supplier && !recipient) return {};
  const pool = reviewedPairs(database, Number(item.id))
    .filter((row) => (!supplier || norm(text(row.fields.supplier_name)) === norm(supplier))
      && (!recipient || norm(text(row.fields.recipient_name)) === norm(recipient)));
  if (!pool.length) return {};
  // ถ้ายังรู้ฝั่งเดียว ต้องมีคู่ที่เด่นชัดเพียงคู่เดียว ไม่เดาเมื่อคะแนนเท่ากัน
  const groups = new Map();
  for (const row of pool) {
    const key = `${norm(text(row.fields.supplier_name))}\u0000${norm(text(row.fields.recipient_name))}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  if (ordered.length > 1 && ordered[0].length === ordered[1].length) return {};
  const members = ordered[0], out = {};
  for (const key of MEMORY_FIELDS) {
    if (taken[key]) continue;
    if ((key === 'supplier_name' && supplier) || (key === 'recipient_name' && recipient)) continue;
    const best = dominant(members, key);
    if (best) out[key] = { value: best.value, source: 'remembered_pair', evidence: best.evidence };
  }
  return out;
};

// existing = ข้อเสนอจากเอกสารเองที่มีอยู่แล้ว (ชนะเสมอ) คืนเฉพาะช่องที่ยังไม่มีข้อเสนอ
export const assistSuggestions = (database, item, existing = {}) => {
  if (!item || UNAVAILABLE.includes(item.status)) return {};
  const row = query(database, 'SELECT fields_json FROM capture_expense_profiles WHERE item_id=?', [Number(item.id)])[0];
  const saved = row ? parse(row.fields_json, {}) : {};
  const paired = pairedSuggestions(database, item, existing);
  const taken = { ...paired, ...existing };
  return { ...paired, ...memorySuggestions(database, item, saved, taken) };
};

// ประวัติ revision เก็บค่าไว้แบบ immutable จึงตรวจย้อนหลังได้ว่าค่านี้เคยอยู่ใน profile ของเอกสารอ้างอิงจริง
const revisionHas = (database, itemId, key, value, reviewedOnly) => query(database,
  `SELECT new_fields_json FROM capture_expense_profile_revisions WHERE item_id=?${reviewedOnly ? " AND status='reviewed'" : ''}`, [itemId])
  .some((row) => text(parse(row.new_fields_json, {})[key]) === value);

// ตรวจ source ใหม่ตอนบันทึก: ไม่เทียบกับข้อเสนอปัจจุบัน เพราะค่าที่บันทึกแล้วต้องผ่านซ้ำทุกครั้งที่บันทึกฉบับถัดไป
export const validateAssistedEntry = (database, item, key, entry, value) => {
  const paired = entry.source === 'paired_document';
  if (!(paired ? PAIRED_FIELDS : MEMORY_FIELDS).includes(key)) return { error: 'source_invalid' };
  if (!value) return { field: { value: null, source: entry.source, evidence: [] } };
  if (!usable(key, value)) return { error: 'account_must_be_masked' };
  const ids = [];
  for (const ref of entry.evidence) {
    if (!plain(ref) || Object.keys(ref).some((name) => name !== 'item_id')) return { error: 'evidence_item_invalid' };
    if (!Number.isSafeInteger(ref.item_id) || ref.item_id <= 0 || ref.item_id === Number(item.id) || ids.includes(ref.item_id)) return { error: 'evidence_item_invalid' };
    ids.push(ref.item_id);
  }
  if (!ids.length) return { error: 'evidence_required' };
  for (const id of ids) {
    if (paired) {
      const linked = query(database, `SELECT 1 AS linked FROM capture_matches
        WHERE (bill_item_id=? AND slip_item_id=?) OR (bill_item_id=? AND slip_item_id=?) LIMIT 1`, [Number(item.id), id, id, Number(item.id)])[0];
      if (!linked) return { error: 'paired_document_not_linked' };
    }
    if (!revisionHas(database, id, key, value, !paired)) return { error: 'assist_evidence_mismatch' };
  }
  return { field: { value, source: entry.source, evidence: ids.map((item_id) => ({ item_id })) } };
};

// รายชื่อสำหรับ autocomplete: ชื่อร้าน ผู้รับเงิน และธนาคารเท่านั้น ไม่คืนเลขบัญชีหรือคำอธิบายอิสระ
export const listExpenseProfileOptions = (database) => {
  const rows = query(database,
    `SELECT p.status,p.fields_json FROM capture_expense_profiles p JOIN capture_items ci ON ci.id=p.item_id
     WHERE ci.status NOT IN ('unsent','duplicate')`).map((row) => ({ status: row.status, fields: parse(row.fields_json, {}) }));
  const collect = (key) => {
    const counts = new Map();
    for (const row of rows) {
      const value = text(row.fields[key]);
      if (!value) continue;
      const found = counts.get(norm(value)) || { value, count: 0, reviewed: 0 };
      found.count += 1; if (row.status === 'reviewed') found.reviewed += 1;
      counts.set(norm(value), found);
    }
    return [...counts.values()].sort((a, b) => b.reviewed - a.reviewed || b.count - a.count || a.value.localeCompare(b.value, 'th')).slice(0, OPTION_LIMIT);
  };
  return { suppliers: collect('supplier_name'), recipients: collect('recipient_name'), banks: collect('recipient_bank') };
};
