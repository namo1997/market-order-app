import pool from '../config/database.js';
import { createConversion } from './unit-conversion.model.js';

const toNullableId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const toPositiveNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const listProductUnitSettings = async ({ search = '', limit = 300, productId = null } = {}) => {
  const params = [];
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
  let where = 'WHERE p.is_active = true';
  const normalizedProductId = toNullableId(productId);
  if (normalizedProductId) {
    where += ' AND p.id = ?';
    params.push(normalizedProductId);
  }
  const term = String(search || '').trim();
  if (term) {
    where += ` AND (
      p.name LIKE ? OR p.code LIKE ? OR p.supplier_item_id LIKE ? OR
      p.barcode LIKE ? OR sm.name LIKE ? OR pg.name LIKE ?
    )`;
    const like = `%${term}%`;
    params.push(like, like, like, like, like, like);
  }

  params.push(normalizedLimit);
  const [rows] = await pool.query(
    `SELECT
       p.id, p.name, p.code, p.supplier_item_id, p.unit_id,
       u.name AS unit_name, u.abbreviation AS unit_abbr,
       p.product_group_id, pg.name AS product_group_name,
       p.supplier_master_id, sm.name AS supplier_master_name,
       psml.purchase_unit_id,
       pu.name AS purchase_unit_name, pu.abbreviation AS purchase_unit_abbr,
       psml.purchase_to_base_multiplier,
       st.id AS stock_template_id,
       st.department_id AS stock_department_id,
       d.name AS stock_department_name,
       b.name AS stock_branch_name,
       st.check_input_unit_id,
       cu.name AS check_input_unit_name, cu.abbreviation AS check_input_unit_abbr,
       st.check_to_base_multiplier
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN product_groups pg ON pg.id = p.product_group_id
     LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
     LEFT JOIN product_supplier_master_links psml
       ON psml.product_id = p.id AND psml.supplier_master_id = p.supplier_master_id
     LEFT JOIN units pu ON pu.id = psml.purchase_unit_id
     LEFT JOIN stock_templates st ON st.id = (
       SELECT st2.id FROM stock_templates st2
       WHERE st2.product_id = p.id
       ORDER BY st2.daily_required DESC, st2.id ASC
       LIMIT 1
     )
     LEFT JOIN departments d ON d.id = st.department_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN units cu ON cu.id = st.check_input_unit_id
     ${where}
     ORDER BY p.name
     LIMIT ?`,
    params
  );
  return rows;
};

const badRequest = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertActiveUnit = async (connection, unitId, message) => {
  const [rows] = await connection.query(
    'SELECT id FROM units WHERE id = ? AND is_active = true LIMIT 1',
    [unitId]
  );
  if (!rows[0]) throw badRequest(message);
};

// Saves base unit / primary supplier / purchase unit / stock-check unit for one product.
// All writes happen in ONE transaction so a validation error never leaves a partial save,
// and only the touched columns/links are changed (extra product groups and extra supplier
// links, including their purchase-unit config, are preserved).
export const saveProductUnitSettings = async (productId, payload = {}) => {
  const normalizedProductId = Number(productId);
  if (!Number.isFinite(normalizedProductId) || normalizedProductId <= 0) {
    throw badRequest('รหัสสินค้าไม่ถูกต้อง');
  }

  let conversionToCreate = null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[product]] = await connection.query(
      `SELECT id, name, code, unit_id, supplier_master_id
       FROM products WHERE id = ? AND is_active = true LIMIT 1 FOR UPDATE`,
      [normalizedProductId]
    );
    if (!product) {
      throw badRequest('ไม่พบสินค้า', 404);
    }

    const requestedBaseUnitId = toNullableId(payload.unit_id);
    const baseUnitId = requestedBaseUnitId || Number(product.unit_id);
    if (requestedBaseUnitId && requestedBaseUnitId !== Number(product.unit_id)) {
      await assertActiveUnit(connection, requestedBaseUnitId, 'ไม่พบหน่วยฐานที่เลือก');
    }

    const previousSupplierMasterId = toNullableId(product.supplier_master_id);
    const supplierMasterId = payload.supplier_master_id === undefined
      ? previousSupplierMasterId
      : toNullableId(payload.supplier_master_id);

    const [linkRows] = await connection.query(
      `SELECT supplier_master_id
       FROM product_supplier_master_links
       WHERE product_id = ?
       ORDER BY is_primary DESC, id ASC`,
      [normalizedProductId]
    );
    const linkedSupplierIds = linkRows.map((row) => Number(row.supplier_master_id));
    let nextPrimarySupplierId = supplierMasterId;

    if (supplierMasterId !== previousSupplierMasterId) {
      if (supplierMasterId) {
        const [smRows] = await connection.query(
          'SELECT id FROM supplier_masters WHERE id = ? AND is_active = true LIMIT 1',
          [supplierMasterId]
        );
        if (!smRows[0]) throw badRequest(`ไม่พบซัพพลายเออร์ที่เลือก (${supplierMasterId})`);
        if (!linkedSupplierIds.includes(supplierMasterId)) {
          await connection.query(
            `INSERT INTO product_supplier_master_links (product_id, supplier_master_id, is_primary)
             VALUES (?, ?, 0)`,
            [normalizedProductId, supplierMasterId]
          );
        }
      } else if (previousSupplierMasterId) {
        // Clearing the primary supplier only removes that link; another linked supplier
        // (if any) becomes primary.
        await connection.query(
          'DELETE FROM product_supplier_master_links WHERE product_id = ? AND supplier_master_id = ?',
          [normalizedProductId, previousSupplierMasterId]
        );
        nextPrimarySupplierId =
          linkedSupplierIds.find((id) => id !== previousSupplierMasterId) || null;
      }
      await connection.query(
        `UPDATE product_supplier_master_links
         SET is_primary = (supplier_master_id = ?)
         WHERE product_id = ?`,
        [nextPrimarySupplierId || 0, normalizedProductId]
      );
    }

    await connection.query(
      'UPDATE products SET unit_id = ?, supplier_master_id = ? WHERE id = ?',
      [baseUnitId, nextPrimarySupplierId, normalizedProductId]
    );

    if (supplierMasterId) {
      const purchaseUnitId = toNullableId(payload.purchase_unit_id);
      const purchaseMultiplier = purchaseUnitId === null
        ? null
        : (Number(purchaseUnitId) === Number(baseUnitId)
          ? 1
          : toPositiveNumber(payload.purchase_to_base_multiplier, null));
      if (purchaseUnitId && purchaseMultiplier === null) {
        throw badRequest('กรุณากรอกตัวคูณหน่วยซื้อให้มากกว่า 0');
      }
      if (purchaseUnitId) {
        await assertActiveUnit(connection, purchaseUnitId, 'ไม่พบหน่วยซื้อที่เลือก');
      }
      await connection.query(
        `UPDATE product_supplier_master_links
         SET purchase_unit_id = ?, purchase_to_base_multiplier = ?
         WHERE product_id = ? AND supplier_master_id = ?`,
        [purchaseUnitId, purchaseMultiplier, normalizedProductId, supplierMasterId]
      );
      if (purchaseUnitId && Number(purchaseUnitId) !== Number(baseUnitId)) {
        conversionToCreate = [Number(purchaseUnitId), Number(baseUnitId), Number(purchaseMultiplier)];
      }
    }

    const stockTemplateId = toNullableId(payload.stock_template_id);
    if (stockTemplateId) {
      const checkUnitId = toNullableId(payload.check_input_unit_id);
      const checkMultiplier = checkUnitId === null
        ? 1
        : (Number(checkUnitId) === Number(baseUnitId)
          ? 1
          : toPositiveNumber(payload.check_to_base_multiplier, null));
      if (checkUnitId && checkMultiplier === null) {
        throw badRequest('กรุณากรอกตัวคูณหน่วยนับสต๊อกให้มากกว่า 0');
      }
      if (checkUnitId) {
        await assertActiveUnit(connection, checkUnitId, 'ไม่พบหน่วยนับสต๊อกที่เลือก');
      }
      const [templateResult] = await connection.query(
        `UPDATE stock_templates
         SET check_input_unit_id = ?, check_to_base_multiplier = ?
         WHERE id = ? AND product_id = ?`,
        [checkUnitId, checkMultiplier, stockTemplateId, normalizedProductId]
      );
      if (templateResult.affectedRows === 0) {
        throw badRequest('ไม่พบรายการสต๊อกของสินค้านี้');
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (conversionToCreate) {
    await createConversion(...conversionToCreate);
  }

  const rows = await listProductUnitSettings({ productId: normalizedProductId, limit: 1 });
  return rows[0] || { id: normalizedProductId };
};
