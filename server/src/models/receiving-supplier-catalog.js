import pool from '../config/database.js';
import { resolveActorScope, validateBranchDepartmentConsistency } from './receiving-documents-helpers.js';
import { createReceivingError } from '../services/receiving-ocr.service.js';

const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fail = message => { throw createReceivingError('VALIDATION_FAILED', message); };

// Match the existing product-group scope policy. Supplier masters have no scope
// column: their linked products inherit the same product-group visibility rule.
// COLLATION: supplier_masters is utf8mb4_0900_ai_ci in Production, product_groups/receiving tables are
// utf8mb4_unicode_ci. Every string comparison or UNION that mixes them carries an explicit COLLATE below.
const groupVisible = alias => `(NOT EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.product_group_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.product_group_id = ${alias}.id AND gs.branch_id = ? AND gs.department_id = ?))`;
const productVisible = `(NOT EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id)
  OR EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id AND gs.branch_id = ? AND gs.department_id = ?))`;
// Owner 2026-10-23 (phone test): ไทยน้ำทิพย์ could not be found from ครัวตำยำ because its drinks sit in a group scoped
// to other departments. A registered supplier is visible to every department of the branch (binds branch_id once),
// the same rule the product search uses; product groups keep their department scope.
const productVisibleBranch = `(NOT EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id)
  OR EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id AND gs.branch_id = ?))`;
const masterVisible = `(NOT EXISTS (SELECT 1 FROM product_supplier_master_links ml WHERE ml.supplier_master_id = sm.id)
  OR EXISTS (SELECT 1 FROM product_supplier_master_links ml JOIN products p ON p.id = ml.product_id
    WHERE ml.supplier_master_id = sm.id AND p.is_active = true AND ${productVisibleBranch}))`;

export async function supplierCatalogScope(db, user, filters = {}) {
  const actor = await resolveActorScope(db, user);
  if (!actor.userId) throw createReceivingError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
  for (const field of ['branch_id', 'department_id']) if (filters[field] != null && !positive(filters[field])) fail('สาขาหรือแผนกไม่ถูกต้อง');
  if (!actor.isAdmin && ((filters.branch_id != null && Number(filters.branch_id) !== actor.branchId)
    || (filters.department_id != null && Number(filters.department_id) !== actor.departmentId))) {
    throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์ค้นหาร้านของสาขาหรือแผนกอื่น');
  }
  const branchId = actor.isAdmin ? Number(filters.branch_id || actor.branchId) : actor.branchId;
  const departmentId = actor.isAdmin ? Number(filters.department_id || actor.departmentId) : actor.departmentId;
  if (!positive(branchId) || !positive(departmentId)) fail('กรุณาเลือกสาขาและแผนก');
  await validateBranchDepartmentConsistency(db, { branchId, departmentId });
  return { branchId, departmentId };
}

export async function searchReceivingSuppliers({ user, filters = {}, db = pool }) {
  const { branchId, departmentId } = await supplierCatalogScope(db, user, filters);
  if (typeof (filters.q ?? '') !== 'string' || (filters.q || '').length > 100) fail('คำค้นร้านยาวเกินกำหนด');
  // Bind search text; wildcard characters are literal, not SQL patterns.
  const q = `%${(filters.q || '').trim().replace(/[!%_]/g, c => `!${c}`)}%`;
  const [rows] = await db.query(`SELECT supplier_key, name, code, supplier_master_id, product_group_id FROM (
    SELECT CONCAT('sm:', sm.id) AS supplier_key, sm.name COLLATE utf8mb4_unicode_ci AS name,
      sm.code COLLATE utf8mb4_unicode_ci AS code, sm.id AS supplier_master_id, NULL AS product_group_id
    FROM supplier_masters sm WHERE sm.is_active = true AND (sm.name LIKE ? ESCAPE '!' OR sm.code LIKE ? ESCAPE '!'
      OR EXISTS (SELECT 1 FROM product_groups legacy WHERE legacy.is_active = true AND TRIM(legacy.name) = TRIM(sm.name) COLLATE utf8mb4_unicode_ci
        AND (legacy.name LIKE ? ESCAPE '!' OR legacy.code LIKE ? ESCAPE '!') AND ${groupVisible('legacy')}))
      AND ${masterVisible}
    UNION ALL
    SELECT CONCAT('pg:', pg.id), pg.name, pg.code, NULL, pg.id FROM product_groups pg
    WHERE pg.is_active = true AND (pg.name LIKE ? ESCAPE '!' OR pg.code LIKE ? ESCAPE '!')
      AND NOT EXISTS (SELECT 1 FROM supplier_masters sm WHERE sm.is_active = true AND TRIM(sm.name) COLLATE utf8mb4_unicode_ci = TRIM(pg.name) AND ${masterVisible})
      AND ${groupVisible('pg')}
  ) suppliers ORDER BY name, supplier_key LIMIT 30`, [q, q, q, q, branchId, departmentId, branchId,
    q, q, branchId, branchId, departmentId]);
  // 2026-10-21: Production has the same code on a supplier master and an old product group (SUP003:
  // Asiamart vs ผลิตสันกำแพง). Without touching either code, an exact code search lists the registered
  // supplier first so the first card is the supplier the code belongs to (stable sort keeps name order).
  const exact = (filters.q || '').trim().toLowerCase();
  const rank = row => (exact && String(row.code || '').trim().toLowerCase() === exact ? 0 : 2) + (row.supplier_master_id == null ? 1 : 0);
  return [...rows].sort((a, b) => rank(a) - rank(b)).map(row => ({ supplier_key: row.supplier_key, name: row.name, code: row.code,
    supplier_master_id: row.supplier_master_id == null ? null : Number(row.supplier_master_id),
    product_group_id: row.product_group_id == null ? null : Number(row.product_group_id) }));
}

async function selectedSupplier(db, supplierKey, { branchId, departmentId }) {
  if (typeof supplierKey !== 'string' || !/^(sm|pg):[1-9]\d*$/.test(supplierKey) || !positive(supplierKey.slice(3))) fail('รหัสร้านไม่ถูกต้อง');
  const id = Number(supplierKey.slice(3));
  const master = supplierKey.startsWith('sm:');
  // Only these two static queries can be selected; input never supplies identifiers.
  const [suppliers] = await db.query(master
    ? `SELECT sm.id, sm.name FROM supplier_masters sm WHERE sm.id = ? AND sm.is_active = true
        AND (NOT EXISTS (SELECT 1 FROM product_supplier_master_links ml WHERE ml.supplier_master_id = sm.id)
          OR EXISTS (SELECT 1 FROM product_supplier_master_links ml JOIN products p ON p.id = ml.product_id
            WHERE ml.supplier_master_id = sm.id AND p.is_active = true AND ${productVisibleBranch}))`
    : `SELECT pg.id, pg.name FROM product_groups pg WHERE pg.id = ? AND pg.is_active = true AND ${groupVisible('pg')}`,
  master ? [id, branchId] : [id, branchId, departmentId]);
  if (!suppliers.length) throw createReceivingError('NOT_FOUND', 'ไม่พบร้านในพื้นที่รับสินค้านี้');
  return { id, master, name: suppliers[0].name };
}

export async function resolveReceivingSupplier({ user, supplierKey, filters = {}, db = pool }) {
  const scope = await supplierCatalogScope(db, user, filters);
  return selectedSupplier(db, supplierKey, scope);
}

export async function receivingSupplierProducts({ user, supplierKey, filters = {}, db = pool }) {
  const { branchId, departmentId } = await supplierCatalogScope(db, user, filters);
  const { id, master } = await selectedSupplier(db, supplierKey, { branchId, departmentId });
  // Owner 2026-10-24 (ข้อ 1): the add sheet is a checklist of the shop's goods. Goods this department received before
  // (confirmed alias or confirmed receipt) come first, then the products accounting registered for the shop.
  // Visibility is branch-wide like the product search (2026-10-23): ร้านน้ำแข็ง vic's history was hidden from แผนกครัว
  // because its ice sits in a group scoped to other departments.
  const [rows] = await db.query(`SELECT x.id, x.name, x.unit_id, x.unit_name FROM (
      SELECT p.id, p.name, p.unit_id, u.name AS unit_name,
        (EXISTS (SELECT 1 FROM supplier_product_aliases a WHERE a.product_id = p.id AND a.supplier_key = ? AND a.confirm_count >= 1 AND a.is_active = 1)
          OR EXISTS (SELECT 1 FROM receiving_document_lines l JOIN receiving_documents d ON d.id = l.document_id
            WHERE l.product_id = p.id AND d.status = 'confirmed' AND d.branch_id = ? AND d.department_id = ?
              AND ${master ? 'd.supplier_master_id = ?' : 'd.product_group_id = ? AND d.supplier_master_id IS NULL'})) AS used,
        (${master ? 'EXISTS (SELECT 1 FROM product_supplier_master_links ml WHERE ml.product_id = p.id AND ml.supplier_master_id = ?)'
          : '(p.product_group_id = ? OR EXISTS (SELECT 1 FROM product_group_links gl WHERE gl.product_id = p.id AND gl.product_group_id = ?))'}) AS listed
      FROM products p LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = true AND ${productVisibleBranch}
    ) x WHERE x.used OR x.listed ORDER BY x.used DESC, x.name, x.id LIMIT 40`,
  [supplierKey, branchId, departmentId, id, ...(master ? [id] : [id, id]), branchId]);
  // A blind-count recommendation is identity only: never counts, prices or bill text.
  return rows.map(row => ({ id: Number(row.id), name: row.name,
    unit_id: row.unit_id == null ? null : Number(row.unit_id), unit_name: row.unit_name || '' }));
}

const LOOSE_MARKS = ['\u0e48', '\u0e49', '\u0e4a', '\u0e4b', '\u0e47', '\u0e4c'];
export const looseThai = value => LOOSE_MARKS.reduce((text, mark) => text.split(mark).join(''), String(value || '').replace(/กระ/g, 'กะ'));
const LOOSE_NAME_SQL = LOOSE_MARKS.reduce((sql, mark) => `REPLACE(${sql}, '${mark}', '')`, "REPLACE(p.name, 'กระ', 'กะ')");

// Receiving only: a recipient can accept goods for any department in their
// branch. The general ordering catalogue keeps its department scope unchanged.
export async function searchReceivingProducts({ user, filters = {}, db = pool }) {
  const { branchId } = await supplierCatalogScope(db, user, filters);
  if (typeof filters.q !== 'string' || !filters.q.trim() || filters.q.length > 100) fail('กรุณาระบุคำค้นสินค้าไม่เกิน 100 ตัวอักษร');
  const escapeLike = value => `%${value.replace(/[!%_]/g, c => `!${c}`)}%`;
  const q = escapeLike(filters.q.trim());
  const scopeSql = `AND (NOT EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.product_group_id = p.product_group_id
          OR EXISTS (SELECT 1 FROM product_group_links gl WHERE gl.product_id = p.id AND gl.product_group_id = gs.product_group_id))
        OR EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.branch_id = ? AND (gs.product_group_id = p.product_group_id
          OR EXISTS (SELECT 1 FROM product_group_links gl WHERE gl.product_id = p.id AND gl.product_group_id = gs.product_group_id))))`;
  const select = `SELECT p.id, p.name, p.code, p.barcode, p.qr_code, p.unit_id, u.name AS unit_name
    FROM products p LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.is_active = true`;
  let [rows] = await db.query(`${select}
      AND (p.name LIKE ? ESCAPE '!' OR p.code LIKE ? ESCAPE '!' OR p.barcode LIKE ? ESCAPE '!' OR p.qr_code LIKE ? ESCAPE '!')
      ${scopeSql}
    ORDER BY p.name, p.id LIMIT 20`, [q, q, q, q, branchId]);
  // UX test 2026-10-23: the bill said กะเพรา, the catalogue says ใบกระเพรา and the search found nothing. When the exact
  // search is empty, compare names with tone marks removed and กระ/กะ folded, on both sides.
  const loose = looseThai(filters.q.trim());
  if (!rows.length && /[\u0e00-\u0e7f]/.test(loose)) {
    [rows] = await db.query(`${select}
      AND ${LOOSE_NAME_SQL} LIKE ? ESCAPE '!'
      ${scopeSql}
    ORDER BY p.name, p.id LIMIT 20`, [escapeLike(loose), branchId]);
  }
  // Real-bill test 2026-10-24: a bill names more than the catalogue does ("สามชั้นลอกหนังแผ่น" for สามชั้นลอกหนัง,
  // "กุ้งขาว ไซส์ L 10 กก. (41-45 ตัว/กก.) 1 ลัง" for กุ้งขาว ไซส์ L). When both searches are empty, offer the
  // catalogue names contained in the typed text, most specific (longest) first. INSTR runs on MySQL and SQLite.
  if (!rows.length && filters.q.trim().length >= 3) {
    [rows] = await db.query(`${select}
      AND (INSTR(?, p.name) > 0 OR INSTR(?, ${LOOSE_NAME_SQL}) > 0)
      ${scopeSql}
    ORDER BY LENGTH(p.name) DESC, p.id LIMIT 40`, [filters.q.trim(), loose, branchId]);
    rows = rows.filter(row => String(row.name || '').trim().length >= 3).slice(0, 20);
  }
  return rows.map(row => ({ id: Number(row.id), name: row.name, code: row.code ?? null,
    barcode: row.barcode ?? null, qr_code: row.qr_code ?? null,
    unit_id: row.unit_id == null ? null : Number(row.unit_id), unit_name: row.unit_name || '' }));
}
