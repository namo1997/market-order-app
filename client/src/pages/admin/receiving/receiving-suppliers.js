// Pure helpers for the accounting supplier page (no React, no network).
export const orderingModeLabels = { system: 'ผ่านระบบ', walk_in_phone: 'สั่งหน้าร้าน / โทรสั่ง', mixed: 'ผสม' };
export const orderingModeOptions = Object.entries(orderingModeLabels);
export const orderingLabel = mode => orderingModeLabels[mode] || 'ยังไม่ระบุ';
export const kindLabels = { master: 'ร้านค้า (ทะเบียนซัพพลายเออร์)', group: 'กลุ่มสินค้า / ร้านตามกลุ่ม' };
export const auditLabels = { alias_create: 'เพิ่มชื่อย่อ', alias_update: 'แก้ชื่อย่อ', alias_disable: 'ปิดใช้ชื่อย่อ',
  alias_enable: 'เปิดใช้ชื่อย่อ', profile_update: 'แก้รูปแบบการสั่ง / หมายเหตุ' };
export const emptySupplierFilters = { q: '', kind: '' };
export const emptyAliasDraft = { id: null, bill_text: '', unit_text: '', product_id: '' };
export const NOTE_LIMITS = { branches_note: 500, bill_format_note: 2000, ordering_note: 2000 };

// After an alias is switched on/off its button stays locked for a moment so a double click cannot undo it.
export const TOGGLE_LOCK_MS = 1500;
export const TOGGLE_NOTE_MS = 5000;
export const BRANCH_CODE_LIMIT = 20;
export const emptyBranchCode = { code: '', branch_note: '' };
export const sourceLabels = { sm: 'ทะเบียนซัพพลายเออร์', pg: 'กลุ่มสินค้าเดิม' };
// Where an alias is stored when the shop is the merge of a supplier master and its legacy product group.
export function aliasSourceLabel(keys = []) {
  const kinds = [...new Set(keys.map(key => String(key).slice(0, 2)))].filter(kind => sourceLabels[kind]);
  return kinds.length > 1 ? 'ทั้งทะเบียนซัพพลายเออร์และกลุ่มสินค้า' : kinds.length === 1 ? `เฉพาะ${sourceLabels[kinds[0]]}` : '';
}
export const branchCodesDraft = detail => (detail?.branch_codes || []).map(entry => ({ code: entry.code || '', branch_note: entry.branch_note || '' }));
// Same rules as the server: short codes only, never bank/tax/phone-like numbers.
const longDigits = text => /\d{9,}/.test(String(text).replace(/[\s-]/g, ''));
export function branchCodesProblem(list = []) {
  const seen = new Set();
  for (const entry of list) {
    const code = (entry.code || '').trim(), note = (entry.branch_note || '').trim();
    if (!code && !note) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$/.test(code) || longDigits(code)) return 'รหัสเจ้าหนี้ต้องเป็นรหัสสั้น เช่น AP-049 (ห้ามใส่เลขบัญชี เลขภาษี หรือเบอร์โทร)';
    if (note.length > 100 || /[\u0000-\u001f\u007f]/.test(note) || longDigits(note)) return 'หมายเหตุสาขายาวเกิน 100 ตัวอักษร หรือมีเลขยาวคล้ายเบอร์โทร/เลขบัญชี';
    if (seen.has(code.toUpperCase())) return `รหัส ${code} ซ้ำกัน`;
    seen.add(code.toUpperCase());
  }
  if (seen.size > BRANCH_CODE_LIMIT) return `ใส่รหัสได้ไม่เกิน ${BRANCH_CODE_LIMIT} รายการ`;
  return '';
}
export const branchCodesBody = (list = []) => list.map(entry => ({ code: (entry.code || '').trim(), branch_note: (entry.branch_note || '').trim() }))
  .filter(entry => entry.code || entry.branch_note).map(entry => (entry.branch_note ? entry : { code: entry.code }));
const codesKey = list => JSON.stringify(branchCodesBody(list).map(entry => [entry.code, entry.branch_note || '']));
export const branchCodesChanged = (draft, detail) => codesKey(draft) !== codesKey(branchCodesDraft(detail));
export const branchCodesText = (list = []) => list.map(entry => entry.branch_note ? `${entry.code} (${entry.branch_note})` : entry.code).join(', ');

export function profileDraft(detail) {
  return { ordering_mode: detail?.ordering_mode || '', branches_note: detail?.branches_note || '',
    bill_format_note: detail?.bill_format_note || '', ordering_note: detail?.ordering_note || '' };
}
// Mirrors the server rules so the form can explain a problem before sending.
export function profileProblem(draft) {
  for (const [field, limit] of Object.entries(NOTE_LIMITS)) if ((draft[field] || '').length > limit) return `หมายเหตุยาวเกิน ${limit} ตัวอักษร`;
  return '';
}
export function profileBody(draft) {
  return { ordering_mode: draft.ordering_mode || null, branches_note: draft.branches_note.trim() || null,
    bill_format_note: draft.bill_format_note.trim() || null, ordering_note: draft.ordering_note.trim() || null };
}
export function aliasDraftFrom(alias) {
  return alias ? { id: alias.id, bill_text: alias.bill_text, unit_text: alias.unit_text || '', product_id: String(alias.product_id) } : { ...emptyAliasDraft };
}
export function aliasProblem(draft) {
  const text = (draft.bill_text || '').trim();
  if (!text) return 'กรุณากรอกข้อความตามที่เขียนในบิล';
  if (text.length > 255) return 'ข้อความในบิลยาวเกิน 255 ตัวอักษร';
  if (/[\u0000-\u001f\u007f]/.test(draft.bill_text)) return 'ข้อความในบิลมีอักขระที่ใช้ไม่ได้';
  if ((draft.unit_text || '').length > 100) return 'หน่วยในบิลยาวเกิน 100 ตัวอักษร';
  if (!/^[1-9]\d{0,9}$/.test(String(draft.product_id || ''))) return 'กรุณาเลือกสินค้าในระบบ';
  return '';
}
export function aliasBody(draft) {
  return { bill_text: draft.bill_text.trim(), unit_text: (draft.unit_text || '').trim(), product_id: Number(draft.product_id) };
}
// Edits send only changed fields, so an unchanged form is a no-op the server also ignores.
export function aliasChanges(draft, alias) {
  const body = aliasBody(draft), changes = {};
  if (body.bill_text !== alias.bill_text) changes.bill_text = body.bill_text;
  if (body.unit_text !== (alias.unit_text || '')) changes.unit_text = body.unit_text;
  if (body.product_id !== Number(alias.product_id)) changes.product_id = body.product_id;
  return changes;
}
export function supplierErrorMessage(error) {
  const status = error?.response?.status, message = error?.response?.data?.message;
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์จัดการชื่อย่อร้านค้า';
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (status === 404) return message || 'ไม่พบข้อมูล อาจถูกเปลี่ยนแปลงไปแล้ว กรุณารีเฟรช';
  if (status === 409) return message || 'มีชื่อย่อและหน่วยนี้ของร้านนี้อยู่แล้ว';
  if (status === 413 || status === 422) return message || 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  if (status === 503) return 'ระบบยังไม่พร้อม (ยังไม่ได้สร้างตารางข้อมูล) กรุณาแจ้งผู้ดูแล';
  return 'บันทึกไม่สำเร็จ กรุณาลองใหม่';
}
export function auditSummary(audit) {
  const before = audit.before || {}, after = audit.after || {};
  if (audit.action === 'profile_update') {
    const codes = Array.isArray(after.branch_codes) && JSON.stringify(before.branch_codes || []) !== JSON.stringify(after.branch_codes)
      ? ` · รหัสเจ้าหนี้ตามสาขา: ${branchCodesText(after.branch_codes) || 'ไม่มี'}` : '';
    return `รูปแบบการสั่ง: ${orderingLabel(before.ordering_mode)} → ${orderingLabel(after.ordering_mode)}${codes}`;
  }
  const label = value => value ? `${value.bill_text}${value.unit_text ? ` (${value.unit_text})` : ''} → ${value.product_name || `สินค้า #${value.product_id}`}` : '—';
  return audit.action === 'alias_create' ? label(after) : audit.action === 'alias_update' ? `${label(before)} ⇒ ${label(after)}` : label(after || before);
}
