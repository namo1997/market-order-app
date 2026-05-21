import pool from '../config/database.js';
import { updateProduct, updateProductSupplierUnitConfig } from './product.model.js';
import { updateTemplate } from './stock-check.model.js';

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

export const listProductUnitSettings = async ({ search = '', limit = 300 } = {}) => {
  const params = [];
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
  let where = 'WHERE p.is_active = true';
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

export const saveProductUnitSettings = async (productId, payload = {}) => {
  const normalizedProductId = Number(productId);
  if (!Number.isFinite(normalizedProductId) || normalizedProductId <= 0) {
    const error = new Error('รหัสสินค้าไม่ถูกต้อง');
    error.statusCode = 400;
    throw error;
  }

  const [[product]] = await pool.query(
    `SELECT id, name, code, default_price, unit_id, product_group_id, supplier_master_id, is_countable, allow_pending_carryover
     FROM products WHERE id = ? AND is_active = true LIMIT 1`,
    [normalizedProductId]
  );
  if (!product) {
    const error = new Error('ไม่พบสินค้า');
    error.statusCode = 404;
    throw error;
  }

  const baseUnitId = toNullableId(payload.unit_id) || product.unit_id;
  await updateProduct(normalizedProductId, {
    unit_id: baseUnitId,
    supplier_master_id: payload.supplier_master_id === undefined
      ? product.supplier_master_id
      : toNullableId(payload.supplier_master_id),
    product_group_id: product.product_group_id,
    default_price: product.default_price,
    is_countable: product.is_countable,
    allow_pending_carryover: product.allow_pending_carryover,
    name: product.name,
    code: product.code
  });

  const supplierMasterId = payload.supplier_master_id === undefined
    ? toNullableId(product.supplier_master_id)
    : toNullableId(payload.supplier_master_id);

  if (supplierMasterId) {
    const purchaseUnitId = toNullableId(payload.purchase_unit_id);
    const purchaseMultiplier = purchaseUnitId === null
      ? null
      : (Number(purchaseUnitId) === Number(baseUnitId)
        ? 1
        : toPositiveNumber(payload.purchase_to_base_multiplier, null));
    if (purchaseUnitId && purchaseMultiplier === null) {
      const error = new Error('กรุณากรอกตัวคูณหน่วยซื้อให้มากกว่า 0');
      error.statusCode = 400;
      throw error;
    }
    await updateProductSupplierUnitConfig(normalizedProductId, supplierMasterId, {
      purchase_unit_id: purchaseUnitId,
      purchase_to_base_multiplier: purchaseMultiplier
    });
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
      const error = new Error('กรุณากรอกตัวคูณหน่วยนับสต๊อกให้มากกว่า 0');
      error.statusCode = 400;
      throw error;
    }
    await updateTemplate(
      stockTemplateId,
      undefined,
      undefined,
      undefined,
      undefined,
      checkUnitId,
      checkMultiplier
    );
  }

  const [rows] = await listProductUnitSettings({ search: product.code || product.name, limit: 1000 });
  return rows.find((row) => Number(row.id) === normalizedProductId) || { id: normalizedProductId };
};
