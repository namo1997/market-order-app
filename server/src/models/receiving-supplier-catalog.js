import pool from '../config/database.js';
import { resolveActorScope, validateBranchDepartmentConsistency } from './receiving-documents-helpers.js';
import { createReceivingError } from '../services/receiving-ocr.service.js';

const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fail = message => { throw createReceivingError('VALIDATION_FAILED', message); };

// Match the existing product-group scope policy. Supplier masters have no scope
// column: their linked products inherit the same product-group visibility rule.
const groupVisible = alias => `(NOT EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.product_group_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM product_group_scopes gs WHERE gs.product_group_id = ${alias}.id AND gs.branch_id = ? AND gs.department_id = ?))`;
const productVisible = `(NOT EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id)
  OR EXISTS (SELECT 1 FROM product_group_links gl JOIN product_group_scopes gs ON gs.product_group_id = gl.product_group_id WHERE gl.product_id = p.id AND gs.branch_id = ? AND gs.department_id = ?))`;

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
    SELECT CONCAT('sm:', sm.id) AS supplier_key, sm.name, sm.code, sm.id AS supplier_master_id, NULL AS product_group_id
    FROM supplier_masters sm WHERE sm.is_active = true AND (sm.name LIKE ? ESCAPE '!' OR sm.code LIKE ? ESCAPE '!')
      AND (NOT EXISTS (SELECT 1 FROM product_supplier_master_links ml WHERE ml.supplier_master_id = sm.id)
        OR EXISTS (SELECT 1 FROM product_supplier_master_links ml JOIN products p ON p.id = ml.product_id
          WHERE ml.supplier_master_id = sm.id AND p.is_active = true AND ${productVisible}))
    UNION ALL
    SELECT CONCAT('pg:', pg.id), pg.name, pg.code, NULL, pg.id FROM product_groups pg
    WHERE pg.is_active = true AND (pg.name LIKE ? ESCAPE '!' OR pg.code LIKE ? ESCAPE '!') AND ${groupVisible('pg')}
  ) suppliers ORDER BY name, supplier_key LIMIT 30`, [q, q, branchId, departmentId, q, q, branchId, departmentId]);
  return rows.map(row => ({ supplier_key: row.supplier_key, name: row.name, code: row.code,
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
            WHERE ml.supplier_master_id = sm.id AND p.is_active = true AND ${productVisible}))`
    : `SELECT pg.id, pg.name FROM product_groups pg WHERE pg.id = ? AND pg.is_active = true AND ${groupVisible('pg')}`,
  [id, branchId, departmentId]);
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
  const [rows] = await db.query(`SELECT p.id, p.name, p.unit_id, u.name AS unit_name FROM products p
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.is_active = true AND ${productVisible} AND (
      EXISTS (SELECT 1 FROM supplier_product_aliases a WHERE a.product_id = p.id AND a.supplier_key = ? AND a.confirm_count >= 1)
      OR EXISTS (SELECT 1 FROM receiving_document_lines l JOIN receiving_documents d ON d.id = l.document_id
        WHERE l.product_id = p.id AND d.status = 'confirmed' AND d.branch_id = ? AND d.department_id = ?
          AND ${master ? 'd.supplier_master_id = ?' : 'd.product_group_id = ? AND d.supplier_master_id IS NULL'})
    ) ORDER BY p.name, p.id LIMIT 20`, [branchId, departmentId, supplierKey, branchId, departmentId, id]);
  // A blind-count recommendation is identity only: never counts, prices or bill text.
  return rows.map(row => ({ id: Number(row.id), name: row.name,
    unit_id: row.unit_id == null ? null : Number(row.unit_id), unit_name: row.unit_name || '' }));
}
