import { createHash, randomUUID } from 'node:crypto';
import { createProduct, ensureProductSchemaReady } from './product.model.js';
import { addDepartmentProduct, ensureDepartmentProductsTable } from './department-products.model.js';
import { addToTemplate, ensureStockTemplateSchemaReady } from './stock-check.model.js';
import { assertSupplierManager, parseSupplierKey, resolveFamily, createSupplierAlias, writeAudit } from './receiving-suppliers-admin.model.js';
import { createReceivingError, normalizeItemCode, normalizeMatchText, normalizeTaughtItemCode } from '../services/receiving-ocr.service.js';

const fail = message => { throw createReceivingError('VALIDATION_FAILED', message); };
const conflict = message => { throw createReceivingError('CONFLICT', message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields = ['name', 'unit', 'price', 'bill_text', 'item_code', 'group'];
const longDigits = value => /[0-9๐-๙]{9,}/.test(value.replace(/[\s+()._/-]/g, ''));
const text = (value, label, limit = 255, optional = false) => {
  if (typeof value !== 'string') fail(`${label}ต้องเป็นข้อความ`);
  const out = value.normalize('NFC').trim().replace(/ +/g, ' ');
  if ((!out && !optional) || out.length > limit || /[\u0000-\u001f\u007f]/.test(out)) fail(`${label}ไม่ถูกต้อง`);
  if (longDigits(out)) fail(`${label}มีเลขยาวคล้ายเบอร์โทร เลขบัญชี หรือเลขภาษี กรุณานำออก`);
  return out;
};
const id = value => Number.isSafeInteger(value) && value > 0;
const flag = (value, fallback) => value === undefined ? fallback : typeof value === 'boolean' ? value : fail('ค่าตัวเลือกต้องเป็น true/false');
// Exact cents, no binary rounding or silent coercion of blanks/exponents/commas.
export function productPrice(value) {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(raw.trim())) fail('ราคาต้องเป็นเลข 0–999,999.99 ไม่เกิน 2 ตำแหน่ง');
  const [whole, fraction = ''] = raw.trim().split('.');
  return `${Number(whole)}.${fraction.padEnd(2, '0')}`;
}
export async function prepareSupplierProducts() {
  // All lazy DDL runs BEFORE beginning the product+alias transaction.
  await ensureProductSchemaReady();
  await ensureDepartmentProductsTable();
  await ensureStockTemplateSchemaReady();
}
export async function supplierProductOptions(db, { user, key }) {
  assertSupplierManager(user);
  const family = await resolveFamily(db, parseSupplierKey(key));
  if (!family.supplier.is_active) conflict('ร้านนี้ปิดใช้งานอยู่');
  const [units] = await db.query('SELECT id, name, abbreviation FROM units WHERE is_active = true ORDER BY name, id');
  const [groups] = await db.query('SELECT id, name, code FROM product_groups WHERE is_active = true ORDER BY name, id');
  const [departments] = await db.query(`SELECT d.id, d.name, d.branch_id, b.name AS branch_name FROM departments d
    JOIN branches b ON b.id = d.branch_id WHERE d.is_active = true AND b.is_active = true ORDER BY b.id, d.name, d.id`);
  const [scopes] = await db.query('SELECT product_group_id, branch_id, department_id FROM product_group_scopes');
  return { supplier_key: family.primary.key, units, groups, departments, scopes,
    default_group_id: family.primary.master ? family.groupIds[0] || null : family.primary.id };
}
function settings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(k => !['rows', 'department_ids', 'default_group_id', 'is_countable', 'allow_pending_carryover', 'request_id', 'preview_hash'].includes(k))) fail('รูปแบบข้อมูลไม่ถูกต้อง');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) fail('เพิ่มได้ครั้งละ 1–100 รายการ');
  if (!Array.isArray(body.department_ids) || !body.department_ids.length || body.department_ids.length > 100
    || body.department_ids.some(v => !id(v)) || new Set(body.department_ids).size !== body.department_ids.length) fail('กรุณาเลือกแผนกที่ใช้สินค้า');
  if (!id(body.default_group_id)) fail('กรุณาเลือกกลุ่มสินค้า');
  return { department_ids: [...body.department_ids].sort((a, b) => a - b), default_group_id: body.default_group_id,
    is_countable: flag(body.is_countable, true), allow_pending_carryover: flag(body.allow_pending_carryover, false) };
}
async function preview(db, input, options) {
  const config = settings(input.body);
  const [existing] = await db.query('SELECT id, name FROM products ORDER BY id');
  const family = await resolveFamily(db, parseSupplierKey(input.key));
  const [aliases] = await db.query('SELECT supplier_key, normalized_bill_text, normalized_unit_text, item_code FROM supplier_product_aliases WHERE supplier_key IN (?)', [family.keys]);
  const nameKey = value => normalizeMatchText(value).replace(/\s/g, '');
  const names = new Set(existing.map(p => nameKey(p.name)));
  const codes = new Set(aliases.map(a => a.item_code).filter(Boolean));
  const bills = new Set(aliases.map(a => `${a.normalized_bill_text}|${a.normalized_unit_text}`));
  const items = input.body.rows.map((row, index) => {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(k => !fields.includes(k))) fail('คอลัมน์ไม่ถูกต้อง');
      const name = text(row.name, 'ชื่อสินค้า');
      if (!nameKey(name)) fail('ชื่อสินค้าต้องมีตัวอักษรหรือตัวเลข');
      const unit = text(row.unit, 'หน่วย', 100);
      const units = options.units.filter(u => u.name === unit || u.abbreviation === unit);
      if (units.length !== 1) fail('หน่วยไม่มีในระบบหรือชื่อกำกวม กรุณาใช้ชื่อหน่วยเต็ม');
      const groupText = text(row.group ?? '', 'กลุ่ม', 255, true);
      const groups = groupText ? options.groups.filter(g => g.name === groupText || g.code === groupText) : options.groups.filter(g => Number(g.id) === config.default_group_id);
      if (groups.length !== 1) fail('ไม่พบกลุ่มสินค้าหรือชื่อกลุ่มซ้ำ');
      const groupId = Number(groups[0].id);
      if (!family.primary.master && groupId !== family.primary.id) fail('ร้านตามกลุ่มต้องใช้กลุ่มของร้านนี้');
      for (const depId of config.department_ids) {
        const dep = options.departments.find(d => Number(d.id) === depId);
        if (!dep) fail('ไม่พบแผนกที่เลือก');
        const scopes = options.scopes.filter(s => Number(s.product_group_id) === groupId);
        if (scopes.length && !scopes.some(s => Number(s.department_id) === depId && Number(s.branch_id) === Number(dep.branch_id))) fail('กลุ่มนี้ไม่เปิดให้แผนกที่เลือก กรุณาเลือกกลุ่มที่ใช้ได้');
      }
      const bill = text(row.bill_text || name, 'ชื่อตามบิล');
      if (!normalizeMatchText(bill)) fail('ชื่อตามบิลต้องมีตัวอักษรหรือตัวเลข');
      const rawCode = text(row.item_code ?? '', 'รหัสในบิล', 40, true);
      const code = rawCode ? normalizeTaughtItemCode(rawCode) : null;
      if (rawCode && !code) fail('รหัสในบิลต้องเป็นรหัสสั้น ตัวอักษรอังกฤษ/ตัวเลข');
      const price = productPrice(row.price);
      const billKey = `${normalizeMatchText(bill)}|${normalizeMatchText(units[0].name)}`;
      if (names.has(nameKey(name))) fail('ชื่อสินค้าซ้ำในระบบหรือในชุดนำเข้า กรุณาผูกชื่อย่อกับสินค้าเดิม');
      if (code && codes.has(code)) fail('รหัสสินค้าในบิลซ้ำของร้านนี้');
      if (bills.has(billKey)) fail('ชื่อตามบิลและหน่วยซ้ำของร้านนี้');
      names.add(nameKey(name)); if (code) codes.add(code); bills.add(billKey);
      return { row: index + 1, name, unit: units[0].name, unit_id: Number(units[0].id), price, bill_text: bill, item_code: code,
        group: groups[0].name, product_group_id: groupId, errors: [] };
    } catch (error) {
      if (error.code !== 'VALIDATION_FAILED') throw error;
      // Never echo a row containing sensitive numbers back into previews/logs.
      return { row: index + 1, errors: [error.message] };
    }
  });
  return { ...config, supplier_key: options.supplier_key, items, valid: items.every(row => !row.errors.length),
    preview_hash: digest({ config, items, supplier_key: options.supplier_key }) };
}
export async function previewSupplierProducts(db, input) {
  assertSupplierManager(input.user);
  return preview(db, input, await supplierProductOptions(db, input));
}
export async function importSupplierProducts(db, input) {
  assertSupplierManager(input.user);
  settings(input.body);
  if (typeof input.body.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.body.request_id)) fail('รหัสคำขอไม่ถูกต้อง');
  if (typeof input.body.preview_hash !== 'string' || !/^[0-9a-f]{64}$/.test(input.body.preview_hash)) fail('กรุณาตรวจตัวอย่างก่อนยืนยัน');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // The singleton row serializes product-name checks across shops before any snapshot read.
    // INSERT IGNORE takes an InnoDB row lock even when the row already exists.
    await connection.query('INSERT IGNORE INTO receiving_supplier_product_guard (id) VALUES (1)');
    // Serialize this supplier's imports, including requests via its legacy twin key.
    const family = await resolveFamily(connection, parseSupplierKey(input.key));
    await connection.query(family.primary.master ? 'SELECT id FROM supplier_masters WHERE id = ? FOR UPDATE' : 'SELECT id FROM product_groups WHERE id = ? FOR UPDATE', [family.primary.id]);
    const fingerprint = digest({ ...input.body, request_id: undefined });
    const [prior] = await connection.query('SELECT actor_user_id, supplier_key, fingerprint, result_json FROM receiving_supplier_product_imports WHERE request_id = ? FOR UPDATE', [input.body.request_id]);
    if (prior.length) {
      if (Number(prior[0].actor_user_id) !== Number(input.user.id) || prior[0].supplier_key !== family.primary.key || prior[0].fingerprint !== fingerprint) conflict('รหัสคำขอถูกใช้กับข้อมูลอื่นแล้ว');
      await connection.commit();
      return typeof prior[0].result_json === 'string' ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    }
    const options = await supplierProductOptions(connection, input);
    const checked = await preview(connection, input, options);
    if (!checked.valid) fail('ข้อมูลมีข้อผิดพลาดหรือซ้ำ กรุณาตรวจตัวอย่างใหม่');
    if (checked.preview_hash !== input.body.preview_hash) conflict('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจตัวอย่างใหม่');
    const products = [];
    for (const row of checked.items) {
      const product = await createProduct({ name: row.name, code: `PRD-${randomUUID()}`, default_price: row.price,
        unit_id: row.unit_id, product_group_ids: [row.product_group_id],
        supplier_master_ids: family.primary.master ? [family.primary.id] : [],
        is_countable: checked.is_countable, allow_pending_carryover: checked.allow_pending_carryover }, { connection });
      for (const departmentId of checked.department_ids) {
        await addDepartmentProduct(departmentId, product.id, { connection });
        // Register on the existing stock-count form; zero target is configuration, never fabricated stock.
        if (checked.is_countable) await addToTemplate(departmentId, product.id, '0.00', null, '0.00', false, row.unit_id, 1, { connection });
      }
      const alias = await createSupplierAlias(connection, { user: input.user, key: family.primary.key,
        body: { product_id: product.id, bill_text: row.bill_text, unit_text: row.unit, item_code: row.item_code } }, { connection });
      products.push({ id: product.id, name: row.name, alias_id: alias.id, item_code: row.item_code });
    }
    const result = { supplier_key: family.primary.key, products, count: products.length };
    await writeAudit(connection, { supplierKey: family.primary.key, action: 'products_create', user: input.user,
      after: { ...result, department_ids: checked.department_ids, is_countable: checked.is_countable, allow_pending_carryover: checked.allow_pending_carryover } });
    await connection.query(`INSERT INTO receiving_supplier_product_imports
      (request_id, supplier_key, actor_user_id, fingerprint, result_json) VALUES (?, ?, ?, ?, ?)`,
    [input.body.request_id, family.primary.key, input.user.id, fingerprint, JSON.stringify(result)]);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) conflict('ข้อมูลซ้ำ กรุณาตรวจตัวอย่างใหม่');
    throw error;
  } finally { connection.release(); }
}
