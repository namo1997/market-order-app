import { assertSupplierManager, parseSupplierKey, resolveFamily, transaction, writeAudit } from './receiving-suppliers-admin.model.js';
import { createReceivingError, normalizeMatchText } from '../services/receiving-ocr.service.js';
import { validBillRefPattern } from '../services/receiving-ocr-checks.js';

// Customer names a shop prints on its bills ("ชื่อลูกค้า โซลาวฮัลโหล") taught per shop -> our branch.
// Stored under every key of a merged shop (like aliases) so OCR finds them by the document's key.
const fail = message => { throw createReceivingError('VALIDATION_FAILED', message); };
const FIELDS = ['customer_name', 'branch_id'];
export const GENERIC_COMPANY = /^(?:บริษัท|บจก\.?|บ\.)?โซลาว(?:จำกัด|จก\.?|บจก\.?|co\.?,?ltd\.?)?(?:\(?สำนักงานใหญ่\)?)?$/iu;
const select = `SELECT c.id, c.supplier_key, c.customer_name, c.normalized_name, c.branch_id, b.name AS branch_name,
  c.is_active, c.updated_at FROM receiving_supplier_customer_names c LEFT JOIN branches b ON b.id = c.branch_id`;
const view = row => ({ id: Number(row.id), customer_name: row.customer_name, branch_id: Number(row.branch_id),
  branch_name: row.branch_name ?? null, is_active: Boolean(row.is_active), updated_at: row.updated_at ?? null });
const marks = keys => keys.map(() => '?').join(', ');

export async function listCustomerNames(db, { user, key }) {
  assertSupplierManager(user);
  const { primary } = await resolveFamily(db, parseSupplierKey(key));
  const [rows] = await db.query(`${select} WHERE c.supplier_key = ? ORDER BY c.customer_name, c.id`, [primary.key]);
  const [branches] = await db.query('SELECT id, name FROM branches ORDER BY name, id');
  return { items: (rows || []).map(view), branch_options: (branches || []).map(row => ({ id: Number(row.id), name: row.name })) };
}

export async function createCustomerName(db, { user, key, body }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('ข้อมูลไม่ถูกต้อง');
  if (Object.keys(body).some(field => !FIELDS.includes(field))) fail('มีช่องข้อมูลที่ไม่รองรับ');
  const name = typeof body.customer_name === 'string' ? body.customer_name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 100) fail('ชื่อลูกค้าในบิลต้องมี 1–100 ตัวอักษร');
  const normalized = normalizeMatchText(name).slice(0, 100);
  if (!normalized) fail('ชื่อลูกค้าในบิลต้องมีตัวอักษร');
  // Owner 2026-10-22: shops print the bare company name for every branch, so it can never mean one branch.
  if (GENERIC_COMPANY.test(name.replace(/\s+/g, ''))) fail('ชื่อกลางของบริษัทบอกสาขาไม่ได้ ให้สอนชื่อสถานที่ส่ง/สาขาที่พิมพ์ในบิลแทน เช่น โซลาวบ้านแจ้');
  const branchId = Number(body.branch_id);
  if (!Number.isSafeInteger(branchId) || branchId < 1) fail('กรุณาเลือกสาขา');
  const { primary, keys } = await resolveFamily(db, target);
  const [branches] = await db.query('SELECT id, name FROM branches WHERE id = ?', [branchId]);
  if (!branches?.length) fail('ไม่พบสาขาที่เลือก');
  return transaction(db, async connection => {
    let id = null;
    for (const itemKey of keys) {
      const [inserted] = await connection.query(`INSERT INTO receiving_supplier_customer_names
        (supplier_key, customer_name, normalized_name, branch_id, is_active, updated_by_user_id) VALUES (?, ?, ?, ?, 1, ?)`,
      [itemKey, name, normalized, branchId, Number(user.id) || null]);
      if (itemKey === primary.key) id = Number(inserted.insertId);
    }
    await writeAudit(connection, { supplierKey: primary.key, action: 'customer_name_create', user,
      after: { customer_name: name, branch_id: branchId, branch_name: branches[0].name, is_active: 1 } });
    return { id, customer_name: name, branch_id: branchId, branch_name: branches[0].name, is_active: true };
  });
}

export async function setCustomerNameActive(db, { user, key, id, active }) {
  assertSupplierManager(user);
  const { primary, keys } = await resolveFamily(db, parseSupplierKey(key));
  const rowId = Number(id);
  if (!Number.isSafeInteger(rowId) || rowId < 1) fail('รหัสชื่อลูกค้าไม่ถูกต้อง');
  const [rows] = await db.query(`${select} WHERE c.id = ? AND c.supplier_key IN (${marks(keys)})`, [rowId, ...keys]);
  if (!rows?.length) throw createReceivingError('NOT_FOUND', 'ไม่พบชื่อลูกค้านี้');
  const row = rows[0];
  if (Boolean(row.is_active) === active) return view(row);
  await transaction(db, async connection => {
    await connection.query(`UPDATE receiving_supplier_customer_names SET is_active = ?, updated_by_user_id = ?
      WHERE supplier_key IN (${marks(keys)}) AND normalized_name = ?`, [active ? 1 : 0, Number(user.id) || null, ...keys, row.normalized_name]);
    await writeAudit(connection, { supplierKey: primary.key, action: active ? 'customer_name_enable' : 'customer_name_disable', user,
      before: { customer_name: row.customer_name, branch_id: Number(row.branch_id), is_active: row.is_active ? 1 : 0 },
      after: { customer_name: row.customer_name, branch_id: Number(row.branch_id), is_active: active ? 1 : 0 } });
  });
  return { ...view(row), is_active: active };
}


// Bill-number shape of a shop (receiving_supplier_bill_refs), saved under every key of a merged shop.
export async function getBillRefPattern(db, { user, key }) {
  assertSupplierManager(user);
  const { primary } = await resolveFamily(db, parseSupplierKey(key));
  const [rows] = await db.query('SELECT ref_pattern, updated_at FROM receiving_supplier_bill_refs WHERE supplier_key = ? LIMIT 1', [primary.key]);
  return { ref_pattern: rows?.[0]?.ref_pattern || null, updated_at: rows?.[0]?.updated_at ?? null };
}
export async function saveBillRefPattern(db, { user, key, body }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => field !== 'ref_pattern')) fail('ข้อมูลไม่ถูกต้อง');
  const clear = body.ref_pattern === null || body.ref_pattern === '';
  const pattern = clear ? null : validBillRefPattern(body.ref_pattern);
  if (!clear && !pattern) fail('รูปแบบเลขที่บิลใช้ # แทนตัวเลข มีอักษรคงที่อย่างน้อย 2 ตัว ยาว 4–40 ตัว เช่น 0100######');
  const { primary, keys } = await resolveFamily(db, target);
  const [before] = await db.query('SELECT ref_pattern FROM receiving_supplier_bill_refs WHERE supplier_key = ? LIMIT 1', [primary.key]);
  const previous = before?.[0]?.ref_pattern || null;
  if (previous === pattern) return { ref_pattern: pattern, changed: false };
  await transaction(db, async connection => {
    for (const itemKey of keys) {
      if (pattern) await connection.query(`INSERT INTO receiving_supplier_bill_refs (supplier_key, ref_pattern, updated_by_user_id) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE ref_pattern = VALUES(ref_pattern), updated_by_user_id = VALUES(updated_by_user_id)`, [itemKey, pattern, Number(user.id) || null]);
      else await connection.query('UPDATE receiving_supplier_bill_refs SET ref_pattern = ?, updated_by_user_id = ? WHERE supplier_key = ?', ['', Number(user.id) || null, itemKey]);
    }
    await writeAudit(connection, { supplierKey: primary.key, action: 'bill_ref_pattern', user, before: { ref_pattern: previous }, after: { ref_pattern: pattern } });
  });
  return { ref_pattern: pattern, changed: true };
}
