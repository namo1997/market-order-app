// ระยะ 4: อ่านหลักฐานที่มีอยู่เท่านั้น ไม่เรียก AI และไม่เขียนข้อมูล
import { extractRecipientDetails } from './recipient-details.js';
export const ADDITIONAL_EXPENSE_SOURCES = ['ai_summary', 'group_label', 'paired_ocr'];
const parse = value => { try { return JSON.parse(value) || {}; } catch { return {}; } };
const query = (db, sql, params = []) => { const s = db.prepare(sql, params); try { const rows = []; while (s.step()) rows.push(s.getAsObject()); return rows; } finally { s.free(); } };
export const expenseSafeText = value => typeof value === 'string' ? value.replace(/\d[\d\s-]{3,}\d/gu, number => number.replace(/\D/g, '').length > 4 ? `••••${number.replace(/\D/g, '').slice(-4)}` : number) : value;
const dateSql = alias => `CASE WHEN ${alias}.event_timestamp_ms > 0 THEN date((${alias}.event_timestamp_ms / 1000) + 25200, 'unixepoch') ELSE substr(${alias}.created_at,1,10) END`;
const slips = new Set(['transfer', 'transfer_notice', 'incoming_transfer']);
const government = text => /กยศ\.?|ภาษีหัก\s*ณ\s*ที่จ่าย|ประกันสังคม|นำส่ง.*(?:ภาษี|หน่วยงานรัฐ)|เงินหัก.*พนักงาน/u.test(text || '');
export const expenseGroupLabel = item => {
  if (item.source_type !== 'group') return null;
  const defaults = { C987d13b96371f18f5a0996107d4f6ef5: 'สันกำแพง', C92c8a7b4a5099db619f6464e10eefab5: 'คันคลอง' };
  const config = parse(process.env.LINE_BILL_CAPTURE_GROUP_LABELS);
  const value = (config && !Array.isArray(config) && config[item.source_id]) || defaults[item.source_id];
  return typeof value === 'string' && value.trim() ? expenseSafeText(value.trim()).slice(0,200) : null;
};
// ผู้ใช้ยืนยัน 7 ต.ค. 2569: ชื่อกลุ่มสันกำแพงหมายถึงสาขาบ้านเจ๊
// ใช้เฉพาะข้อเสนอสาขาใหม่ ไม่แก้ชื่อกลุ่มหรือข้อเท็จจริงที่บันทึกไว้
export const expenseBranchFromGroupLabel = label => label === 'สันกำแพง' ? 'บ้านเจ๊' : label;
const recipientOf = item => { const ai = parse(item.ai_result_json); return extractRecipientDetails({ ...ai, raw_text: ai.raw_text || item.ai_raw_text || '' }); };
const partnersOf = (db, item) => query(db, `SELECT DISTINCT ci.* FROM capture_matches cm JOIN capture_items ci
 ON ci.id=CASE WHEN cm.bill_item_id=? THEN cm.slip_item_id ELSE cm.bill_item_id END
 WHERE (cm.bill_item_id=? OR cm.slip_item_id=?) AND cm.status IN ('pending','manual_review','confirmed')
 AND ci.status NOT IN ('unsent','duplicate') AND ci.source_type=? AND ci.source_id=? AND (${dateSql('ci')})=?`,
 [Number(item.id),Number(item.id),Number(item.id),item.source_type,item.source_id,item.business_date]);
export const additionalExpenseSuggestions = (db, item, existing = {}, limits = {}) => {
  if (['unsent','duplicate'].includes(item.status)) return {};
  const out = {}, own = [{ item_id: Number(item.id) }];
  const add = (key, value, source, evidence = own) => { if (!existing[key] && !out[key] && typeof value === 'string' && value.trim()) out[key] = { value: expenseSafeText(value.trim()).slice(0, limits[key] || 1000), source, evidence }; };
  const value = Number(item.bill_total_value ?? item.slip_amount_value);
  if (!existing.purpose && value > 0 && item.event_timestamp_ms > 0) {
    const messages = query(db, `SELECT line_message_id,text,event_timestamp_ms FROM line_messages lm
      WHERE source_type=? AND source_id=? AND status='active' AND message_type='text'
      AND (${dateSql('lm')})=? AND event_timestamp_ms BETWEEN ? AND ?
      ORDER BY abs(event_timestamp_ms-?) LIMIT 50`, [item.source_type,item.source_id,item.business_date,item.event_timestamp_ms-1800000,item.event_timestamp_ms+1800000,item.event_timestamp_ms]);
    const candidates = messages.filter(message => /ค่า|กยศ|ภาษี|ประกันสังคม|นำส่ง|หัก/u.test(message.text || '')
      && [...String(message.text).matchAll(/(?<![\d])\d+(?:,\d{3})*(?:\.\d+)?(?![\d])/gu)].some(m => Math.abs(Number(m[0].replaceAll(',','')) - value) < .005));
    // ข้อความหลายความหมายยอดเดียวกันไม่เดา ใช้ AI summary เดิมแทน
    const meanings = new Set(candidates.map(m => m.text.trim()));
    if (meanings.size === 1) add('purpose', expenseSafeText(candidates[0].text).slice(0,1000), 'chat', [{item_id:Number(item.id),message_id:candidates[0].line_message_id}]);
  }
  add('purpose', expenseSafeText(item.ai_summary), 'ai_summary');
  add('branch', expenseBranchFromGroupLabel(expenseGroupLabel(item)), 'group_label');
  if (!slips.has(item.category)) {
    const partners = partnersOf(db,item).filter(row => slips.has(row.category)).map(row => ({ row, recipient: recipientOf(row) }));
    for (const key of ['recipient_name','recipient_bank','recipient_account_masked']) {
      const available = partners.filter(p => p.recipient[key]);
      const values = new Set(available.map(p => p.recipient[key]));
      if (values.size === 1) { const p = available[0]; const value = key === 'recipient_account_masked' ? `••••${p.recipient[key].replace(/\D/g,'').slice(-4)}` : p.recipient[key]; add(key,value,'paired_ocr',[{item_id:Number(p.row.id)}]); }
    }
  }
  const purpose = out.purpose || existing.purpose;
  if (government(purpose?.value)) add('transaction_type','government_remittance',purpose.source,purpose.evidence);
  return out;
};
export const validateAdditionalExpenseSource = (db,item,key,entry) => {
  if (entry.source === 'ai_summary') return ['purpose','transaction_type'].includes(key) ? null : 'source_invalid';
  if (entry.source === 'group_label') return key === 'branch' && item.source_type === 'group' ? null : 'source_invalid';
  if (entry.source === 'paired_ocr') {
    if (!['recipient_name','recipient_bank','recipient_account_masked'].includes(key)) return 'source_invalid';
    const partners = partnersOf(db,item).filter(row => slips.has(row.category));
    if (entry.value === null && !entry.evidence.length) return null;
    if (!entry.evidence.length || entry.evidence.some(ref => !ref || typeof ref !== 'object' || Array.isArray(ref) || !Number.isSafeInteger(ref.item_id) || Object.keys(ref).some(k=>k!=='item_id') || !partners.some(row=>Number(row.id)===ref.item_id))) return 'evidence_item_invalid';
  }
  return null;
};
// ปิดบังข้อความอิสระรวมทั้งประวัติ โดยคงรหัสอ้างอิงหลักฐานไว้ตามเดิม
export const safeExpenseResponse = (data, fieldKey = null) => {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(value => safeExpenseResponse(value));
  return Object.fromEntries(Object.entries(data).map(([key,value]) => [key,
    key === 'value' && fieldKey === 'expense_period' && typeof value === 'string' && /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(value)
      ? value
      : ['value','text','reason'].includes(key) && typeof value === 'string' ? expenseSafeText(value) : safeExpenseResponse(value, key)]));
};
