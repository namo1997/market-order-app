import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';
import { ensureSupplierMasterTable } from './supplier-master.model.js';
import { ensureSupplierColumns, ensureSupplierScopeTable } from './supplier.model.js';
import { ensureWithdrawSourceMappingTable } from './withdraw-source-mapping.model.js';

let ensuredProductGroupColumns = false;

const normalizeCountableValue = (value, fallback = 1) => {
  if (value === undefined || value === null || value === '') {
    return Number(fallback) === 0 ? 0 : 1;
  }
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return Number(fallback) === 0 ? 0 : 1;
};

const normalizeIdList = (...candidates) => {
  const values = [];

  const appendValue = (raw) => {
    if (Array.isArray(raw)) {
      raw.forEach((item) => appendValue(item));
      return;
    }

    if (raw === undefined || raw === null || raw === '') return;

    if (typeof raw === 'string' && (raw.includes('|') || raw.includes(','))) {
      raw
        .split(/[|,]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => appendValue(part));
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    if (parsed <= 0) return;
    values.push(parsed);
  };

  candidates.forEach((candidate) => appendValue(candidate));

  const dedup = [];
  const seen = new Set();
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    dedup.push(value);
  });
  return dedup;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  } catch {
    return [];
  }
};

const parsePositiveId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const loadProductGroupIds = async (connection, productId) => {
  const [rows] = await connection.query(
    `SELECT product_group_id
     FROM product_group_links
     WHERE product_id = ?
     ORDER BY is_primary DESC, id ASC`,
    [productId]
  );
  return rows
    .map((row) => Number(row.product_group_id))
    .filter((id) => Number.isFinite(id));
};

const loadSupplierMasterIds = async (connection, productId) => {
  const [rows] = await connection.query(
    `SELECT supplier_master_id
     FROM product_supplier_master_links
     WHERE product_id = ?
     ORDER BY is_primary DESC, id ASC`,
    [productId]
  );
  return rows
    .map((row) => Number(row.supplier_master_id))
    .filter((id) => Number.isFinite(id));
};

const validateProductGroupIds = async (connection, ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    const error = new Error('กรุณาเลือกกลุ่มสินค้าอย่างน้อย 1 กลุ่ม');
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await connection.query(
    `SELECT id
     FROM product_groups
     WHERE is_active = true
       AND id IN (?)`,
    [ids]
  );
  const found = new Set(rows.map((row) => Number(row.id)));
  const missing = ids.find((id) => !found.has(Number(id)));
  if (missing !== undefined) {
    const error = new Error(`ไม่พบกลุ่มสินค้าที่เลือก (${missing})`);
    error.statusCode = 400;
    throw error;
  }
};

const validateSupplierMasterIds = async (connection, ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return;

  const [rows] = await connection.query(
    `SELECT id
     FROM supplier_masters
     WHERE is_active = true
       AND id IN (?)`,
    [ids]
  );
  const found = new Set(rows.map((row) => Number(row.id)));
  const missing = ids.find((id) => !found.has(Number(id)));
  if (missing !== undefined) {
    const error = new Error(`ไม่พบซัพพลายเออร์ที่เลือก (${missing})`);
    error.statusCode = 400;
    throw error;
  }
};

const upsertProductGroupLinks = async (connection, productId, groupIds) => {
  await connection.query('DELETE FROM product_group_links WHERE product_id = ?', [productId]);
  if (!Array.isArray(groupIds) || groupIds.length === 0) return;

  const values = groupIds.map((groupId, index) => [
    productId,
    Number(groupId),
    index === 0 ? 1 : 0
  ]);

  await connection.query(
    'INSERT INTO product_group_links (product_id, product_group_id, is_primary) VALUES ?',
    [values]
  );
};

const upsertSupplierMasterLinks = async (connection, productId, supplierMasterIds) => {
  await connection.query('DELETE FROM product_supplier_master_links WHERE product_id = ?', [productId]);
  if (!Array.isArray(supplierMasterIds) || supplierMasterIds.length === 0) return;

  const values = supplierMasterIds.map((supplierMasterId, index) => [
    productId,
    Number(supplierMasterId),
    index === 0 ? 1 : 0
  ]);

  await connection.query(
    'INSERT INTO product_supplier_master_links (product_id, supplier_master_id, is_primary) VALUES ?',
    [values]
  );
};

const mapProductRow = (row) => {
  const {
    product_group_ids_json,
    supplier_master_ids_json,
    ...rest
  } = row;
  const groupIdsFromJson = parseJsonArray(row.product_group_ids_json);
  const supplierMasterIdsFromJson = parseJsonArray(row.supplier_master_ids_json);
  const primaryGroupId = parsePositiveId(row.product_group_id);
  const primarySupplierMasterId = parsePositiveId(row.supplier_master_id);

  const productGroupIds = groupIdsFromJson.length > 0
    ? groupIdsFromJson
    : (Number.isFinite(primaryGroupId) ? [primaryGroupId] : []);

  const supplierMasterIds = supplierMasterIdsFromJson.length > 0
    ? supplierMasterIdsFromJson
    : (Number.isFinite(primarySupplierMasterId) ? [primarySupplierMasterId] : []);

  return {
    ...rest,
    product_group_ids: productGroupIds,
    supplier_ids: productGroupIds,
    product_group_names: rest.product_group_names || rest.product_group_name || '',
    supplier_names: rest.product_group_names || rest.product_group_name || '',
    supplier_master_ids: supplierMasterIds,
    supplier_master_names: rest.supplier_master_names || rest.supplier_master_name || ''
  };
};

const ensureProductRelationTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_group_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      product_group_id INT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_product_group_link (product_id, product_group_id),
      INDEX idx_product_group_links_product (product_id),
      INDEX idx_product_group_links_group (product_group_id),
      INDEX idx_product_group_links_primary (is_primary),
      CONSTRAINT fk_product_group_links_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_group_links_group
        FOREIGN KEY (product_group_id) REFERENCES product_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_supplier_master_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      supplier_master_id INT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_product_supplier_master_link (product_id, supplier_master_id),
      INDEX idx_product_supplier_master_links_product (product_id),
      INDEX idx_product_supplier_master_links_supplier (supplier_master_id),
      INDEX idx_product_supplier_master_links_primary (is_primary),
      CONSTRAINT fk_product_supplier_master_links_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_supplier_master_links_supplier
        FOREIGN KEY (supplier_master_id) REFERENCES supplier_masters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    INSERT IGNORE INTO product_group_links (product_id, product_group_id, is_primary)
    SELECT p.id, p.product_group_id, true
    FROM products p
    JOIN product_groups pg ON pg.id = p.product_group_id
    WHERE p.product_group_id IS NOT NULL
  `);

  await pool.query(`
    INSERT IGNORE INTO product_supplier_master_links (product_id, supplier_master_id, is_primary)
    SELECT p.id, p.supplier_master_id, true
    FROM products p
    JOIN supplier_masters sm ON sm.id = p.supplier_master_id
    WHERE p.supplier_master_id IS NOT NULL
  `);
};

const ensureProductGroupColumns = async () => {
  if (ensuredProductGroupColumns) return;

  const [groupColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'product_group_id'"
  );
  if (groupColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN product_group_id INT NULL AFTER unit_id'
    );
  }

  const [supplierColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'supplier_id'"
  );
  if (supplierColumn.length > 0) {
    await pool.query(
      'UPDATE products SET product_group_id = COALESCE(product_group_id, supplier_id)'
    );
  }

  const [groupIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_product_group'"
  );
  if (groupIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_product_group (product_group_id)'
    );
  }

  const [countableColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'is_countable'"
  );
  if (countableColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN is_countable BOOLEAN NOT NULL DEFAULT true AFTER default_price'
    );
  }

  const [barcodeColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'barcode'"
  );
  if (barcodeColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN barcode VARCHAR(255) NULL AFTER code'
    );
  }

  const [barcodeIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_products_barcode'"
  );
  if (barcodeIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_products_barcode (barcode)'
    );
  }

  const [qrCodeColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'qr_code'"
  );
  if (qrCodeColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN qr_code VARCHAR(255) NULL AFTER barcode'
    );
  }

  const [qrCodeIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_products_qr_code'"
  );
  if (qrCodeIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_products_qr_code (qr_code)'
    );
  }

  await ensureSupplierMasterTable();

  const [supplierMasterColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'supplier_master_id'"
  );
  if (supplierMasterColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN supplier_master_id INT NULL AFTER product_group_id'
    );
  }

  const [supplierMasterIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_supplier_master_id'"
  );
  if (supplierMasterIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_supplier_master_id (supplier_master_id)'
    );
  }

  await ensureProductRelationTables();

  ensuredProductGroupColumns = true;
};

// ---------------------------------------------------------------------------
// SQL fragments ร่วมสำหรับ getAllProducts และ getProductById (ลดโค้ดซ้ำ)
// ---------------------------------------------------------------------------
const PRODUCT_GROUP_LINK_JOIN = `
  LEFT JOIN (
    SELECT
      pgl.product_id,
      JSON_ARRAYAGG(pgl.product_group_id) AS product_group_ids_json,
      GROUP_CONCAT(pg.name ORDER BY pg.name SEPARATOR ', ') AS product_group_names
    FROM product_group_links pgl
    JOIN product_groups pg
      ON pg.id = pgl.product_group_id
     AND pg.is_active = true
    GROUP BY pgl.product_id
  ) pgx ON pgx.product_id = p.id
`;

const SUPPLIER_MASTER_LINK_JOIN = `
  LEFT JOIN (
    SELECT
      psml.product_id,
      JSON_ARRAYAGG(psml.supplier_master_id) AS supplier_master_ids_json,
      GROUP_CONCAT(sm2.name ORDER BY sm2.name SEPARATOR ', ') AS supplier_master_names
    FROM product_supplier_master_links psml
    JOIN supplier_masters sm2
      ON sm2.id = psml.supplier_master_id
     AND sm2.is_active = true
    GROUP BY psml.product_id
  ) smx ON smx.product_id = p.id
`;

const LAST_ACTUAL_PRICE_JOIN = `
  LEFT JOIN (
    SELECT oi.product_id, MAX(o.order_date) AS last_date
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.actual_price IS NOT NULL
    GROUP BY oi.product_id
  ) last ON last.product_id = p.id
  LEFT JOIN (
    SELECT oi.product_id, o.order_date, MAX(oi.actual_price) AS last_actual_price
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.actual_price IS NOT NULL
    GROUP BY oi.product_id, o.order_date
  ) lap ON lap.product_id = p.id AND lap.order_date = last.last_date
`;
// ---------------------------------------------------------------------------

// ดึงรายการสินค้าทั้งหมด
export const getAllProducts = async (filters = {}) => {
  await ensureProductGroupColumns();
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  await ensureWithdrawSourceMappingTable();

  const branchId = Number(filters.branchId);
  const departmentId = Number(filters.departmentId);
  const resolveBranchId = Number.isFinite(branchId) ? branchId : null;

  const params = [resolveBranchId];

  let query = `
    SELECT p.id, p.name, p.code, p.barcode, p.qr_code, p.default_price, p.is_countable, p.is_active, p.unit_id,
           u.name as unit_name, u.abbreviation as unit_abbr,
           p.product_group_id as supplier_id,
           s.name as supplier_name,
           p.product_group_id as product_group_id,
           s.name as product_group_name,
           pgx.product_group_ids_json,
           COALESCE(pgx.product_group_names, s.name) as product_group_names,
           p.supplier_master_id,
           sm.name as supplier_master_name,
           sm.code as supplier_master_code,
           smx.supplier_master_ids_json,
           COALESCE(smx.supplier_master_names, sm.name) as supplier_master_names,
           lap.last_actual_price
    FROM products p
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN withdraw_branch_source_mappings wbm
      ON wbm.target_branch_id = ?
    LEFT JOIN product_groups s
      ON s.id = COALESCE(
        (
          SELECT pg_map.id
          FROM product_group_links pgl_map
          JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
          WHERE pgl_map.product_id = p.id
            AND pg_map.is_internal = true
            AND pg_map.linked_department_id = wbm.source_department_id
          ORDER BY pg_map.id
          LIMIT 1
        ),
        p.product_group_id
      )
    LEFT JOIN supplier_masters sm ON p.supplier_master_id = sm.id
    ${PRODUCT_GROUP_LINK_JOIN}
    ${SUPPLIER_MASTER_LINK_JOIN}
    ${LAST_ACTUAL_PRICE_JOIN}
    WHERE p.is_active = true
  `;

  if (filters.supplierId) {
    query += `
      AND EXISTS (
        SELECT 1
        FROM product_group_links pgl_filter
        WHERE pgl_filter.product_id = p.id
          AND pgl_filter.product_group_id = ?
      )
    `;
    params.push(Number(filters.supplierId));
  }

  if (Array.isArray(filters.allowedSupplierIds)) {
    const allowedIds = filters.allowedSupplierIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    if (allowedIds.length === 0) {
      query += ' AND 1 = 0';
    } else {
      query += `
        AND (
          p.product_group_id IN (?)
          OR EXISTS (
            SELECT 1
            FROM product_group_links pgl_allowed
            WHERE pgl_allowed.product_id = p.id
              AND pgl_allowed.product_group_id IN (?)
          )
        )
      `;
      params.push(allowedIds, allowedIds);
    }
  }

  if (filters.supplierMasterId) {
    query += `
      AND EXISTS (
        SELECT 1
        FROM product_supplier_master_links psml_filter
        WHERE psml_filter.product_id = p.id
          AND psml_filter.supplier_master_id = ?
      )
    `;
    params.push(Number(filters.supplierMasterId));
  }

  if (filters.search) {
    query += ' AND p.name LIKE ?';
    params.push(`%${filters.search}%`);
  }

  if (!filters.bypassScope && Number.isFinite(branchId) && Number.isFinite(departmentId)) {
    query += `
      AND (
        NOT EXISTS (
          SELECT 1
          FROM product_group_links pgl_any
          JOIN product_group_scopes pgs_any
            ON pgs_any.product_group_id = pgl_any.product_group_id
          WHERE pgl_any.product_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM product_group_links pgl_scope
          JOIN product_group_scopes pgs
            ON pgs.product_group_id = pgl_scope.product_group_id
          WHERE pgl_scope.product_id = p.id
            AND pgs.branch_id = ?
            AND pgs.department_id = ?
        )
      )
    `;
    params.push(branchId, departmentId);
  }

  query += ' ORDER BY p.name';

  const [rows] = await pool.query(query, params);
  return rows.map((row) => mapProductRow(row));
};

// ดึงข้อมูลสินค้าตาม ID
export const getProductById = async (productId) => {
  await ensureProductGroupColumns();

  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.code, p.barcode, p.qr_code, p.default_price, p.is_countable, p.unit_id, p.is_active,
            p.product_group_id as product_group_id,
            p.product_group_id as supplier_id,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.name as supplier_name,
            s.name as product_group_name,
            pgx.product_group_ids_json,
            COALESCE(pgx.product_group_names, s.name) as product_group_names,
            p.supplier_master_id,
            sm.name as supplier_master_name,
            sm.code as supplier_master_code,
            smx.supplier_master_ids_json,
            COALESCE(smx.supplier_master_names, sm.name) as supplier_master_names,
            lap.last_actual_price
     FROM products p
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN product_groups s ON p.product_group_id = s.id
     LEFT JOIN supplier_masters sm ON p.supplier_master_id = sm.id
     ${PRODUCT_GROUP_LINK_JOIN}
     ${SUPPLIER_MASTER_LINK_JOIN}
     ${LAST_ACTUAL_PRICE_JOIN}
     WHERE p.id = ?
     LIMIT 1`,
    [productId]
  );

  return rows[0] ? mapProductRow(rows[0]) : null;
};

// สร้างสินค้าใหม่
export const createProduct = async (data) => {
  await ensureProductGroupColumns();

  const {
    name,
    code,
    barcode,
    qr_code,
    default_price,
    is_countable,
    unit_id
  } = data;

  const productGroupIds = normalizeIdList(
    data.product_group_ids,
    data.supplier_ids,
    data.product_group_id,
    data.supplier_id
  );
  const supplierMasterIds = normalizeIdList(
    data.supplier_master_ids,
    data.supplier_master_id
  );

  const normalizedDefaultPrice =
    default_price === undefined || default_price === null || default_price === ''
      ? 0
      : default_price;
  const normalizedIsCountable = normalizeCountableValue(is_countable, 1);
  const normalizedCode = String(code || '').trim();
  const finalCode = normalizedCode || await generateNextCode({
    table: 'products',
    prefix: 'PRD',
    codeField: 'code'
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateProductGroupIds(connection, productGroupIds);
    await validateSupplierMasterIds(connection, supplierMasterIds);

    const primaryProductGroupId = productGroupIds[0];
    const primarySupplierMasterId = supplierMasterIds[0] || null;

    const [result] = await connection.query(
      `INSERT INTO products
       (name, code, barcode, qr_code, default_price, is_countable, unit_id, product_group_id, supplier_master_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
      [
        name,
        finalCode,
        barcode ? String(barcode).trim() : null,
        qr_code ? String(qr_code).trim() : null,
        normalizedDefaultPrice,
        normalizedIsCountable,
        unit_id,
        primaryProductGroupId,
        primarySupplierMasterId
      ]
    );

    const productId = Number(result.insertId);
    await upsertProductGroupLinks(connection, productId, productGroupIds);
    await upsertSupplierMasterLinks(connection, productId, supplierMasterIds);

    await connection.commit();
    const created = await getProductById(productId);
    return created || {
      id: productId,
      ...data,
      code: finalCode,
      supplier_id: primaryProductGroupId,
      product_group_id: primaryProductGroupId,
      supplier_master_id: primarySupplierMasterId,
      supplier_ids: productGroupIds,
      product_group_ids: productGroupIds,
      supplier_master_ids: supplierMasterIds
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// อัพเดทสินค้า
export const updateProduct = async (id, data) => {
  await ensureProductGroupColumns();

  const {
    name,
    code,
    barcode,
    qr_code,
    default_price,
    is_countable,
    unit_id
  } = data;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, name, code, barcode, qr_code, default_price, is_countable, unit_id,
              product_group_id, supplier_master_id
       FROM products
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const current = rows[0];
    if (!current) {
      throw new Error('Product not found');
    }

    const currentGroupIds = await loadProductGroupIds(connection, id);
    const currentSupplierMasterIds = await loadSupplierMasterIds(connection, id);

    const groupInputProvided = [
      'product_group_ids',
      'supplier_ids',
      'product_group_id',
      'supplier_id'
    ].some((key) => data[key] !== undefined);

    const supplierMasterInputProvided = [
      'supplier_master_ids',
      'supplier_master_id'
    ].some((key) => data[key] !== undefined);

    const nextProductGroupIds = groupInputProvided
      ? normalizeIdList(
        data.product_group_ids,
        data.supplier_ids,
        data.product_group_id,
        data.supplier_id
      )
      : (currentGroupIds.length > 0
        ? currentGroupIds
        : normalizeIdList(current.product_group_id));

    const nextSupplierMasterIds = supplierMasterInputProvided
      ? normalizeIdList(data.supplier_master_ids, data.supplier_master_id)
      : (currentSupplierMasterIds.length > 0
        ? currentSupplierMasterIds
        : normalizeIdList(current.supplier_master_id));

    await validateProductGroupIds(connection, nextProductGroupIds);
    await validateSupplierMasterIds(connection, nextSupplierMasterIds);

    const primaryProductGroupId = nextProductGroupIds[0];
    const primarySupplierMasterId = nextSupplierMasterIds[0] || null;

    const normalizedName = name !== undefined ? name : current.name;
    const normalizedBarcode = barcode !== undefined ? (String(barcode || '').trim() || null) : current.barcode;
    const normalizedQrCode = qr_code !== undefined ? (String(qr_code || '').trim() || null) : current.qr_code;
    const normalizedDefaultPrice =
      default_price !== undefined ? default_price : current.default_price;
    const normalizedUnitId = unit_id !== undefined ? unit_id : current.unit_id;
    const normalizedIsCountable = normalizeCountableValue(is_countable, current.is_countable);
    let finalCode = String(code ?? '').trim();
    if (!finalCode) {
      finalCode = current.code;
    }

    await connection.query(
      `UPDATE products
       SET name = ?, code = ?, barcode = ?, qr_code = ?, default_price = ?, is_countable = ?,
           unit_id = ?, product_group_id = ?, supplier_master_id = ?
       WHERE id = ?`,
      [
        normalizedName,
        finalCode,
        normalizedBarcode,
        normalizedQrCode,
        normalizedDefaultPrice,
        normalizedIsCountable,
        normalizedUnitId,
        primaryProductGroupId,
        primarySupplierMasterId,
        id
      ]
    );

    await upsertProductGroupLinks(connection, id, nextProductGroupIds);
    await upsertSupplierMasterLinks(connection, id, nextSupplierMasterIds);

    await connection.commit();

    const updated = await getProductById(id);
    return updated || {
      id,
      ...data,
      code: finalCode,
      supplier_id: primaryProductGroupId,
      product_group_id: primaryProductGroupId,
      supplier_master_id: primarySupplierMasterId,
      supplier_ids: nextProductGroupIds,
      product_group_ids: nextProductGroupIds,
      supplier_master_ids: nextSupplierMasterIds
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ลบสินค้า (Soft delete)
export const deleteProduct = async (id) => {
  await pool.query(
    'UPDATE products SET is_active = false WHERE id = ?',
    [id]
  );
  return { id };
};

// ดึงรายการกลุ่มสินค้าทั้งหมด
export const getAllProductGroups = async () => {
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.code, s.contact_person, s.phone,
            s.linked_branch_id, s.linked_department_id,
            b.name AS linked_branch_name, d.name AS linked_department_name,
            s.id as product_group_id, s.name as product_group_name
     FROM product_groups s
     LEFT JOIN branches b ON s.linked_branch_id = b.id
     LEFT JOIN departments d ON s.linked_department_id = d.id
     WHERE s.is_active = true
     ORDER BY s.name`
  );
  return rows;
};

export const getAllProductGroupsByScope = async ({ branchId, departmentId }) => {
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  const normalizedBranchId = Number(branchId);
  const normalizedDepartmentId = Number(departmentId);

  if (!Number.isFinite(normalizedBranchId) || !Number.isFinite(normalizedDepartmentId)) {
    return getAllProductGroups();
  }

  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.code, s.contact_person, s.phone,
            s.linked_branch_id, s.linked_department_id,
            b.name AS linked_branch_name, d.name AS linked_department_name,
            s.id as product_group_id, s.name as product_group_name
     FROM product_groups s
     LEFT JOIN branches b ON s.linked_branch_id = b.id
     LEFT JOIN departments d ON s.linked_department_id = d.id
     WHERE s.is_active = true
       AND (
         (
           NOT EXISTS (
             SELECT 1
             FROM product_group_scopes pgs_any
             WHERE pgs_any.product_group_id = s.id
           )
         )
         OR EXISTS (
           SELECT 1
           FROM product_group_scopes pgs
           WHERE pgs.product_group_id = s.id
             AND pgs.branch_id = ?
             AND pgs.department_id = ?
         )
       )
     ORDER BY s.name`,
    [
      normalizedBranchId,
      normalizedDepartmentId
    ]
  );
  return rows;
};

export const getAllSupplierMasters = async () => {
  await ensureSupplierMasterTable();
  const [rows] = await pool.query(
    `SELECT id, name, code, contact_person, phone
     FROM supplier_masters
     WHERE is_active = true
     ORDER BY name`
  );
  return rows;
};

// Legacy aliases
export const getAllSuppliers = getAllProductGroups;
export const getAllSuppliersByScope = getAllProductGroupsByScope;

// ดึงรายการ units ทั้งหมด
export const getAllUnits = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, abbreviation FROM units WHERE is_active = true ORDER BY name'
  );
  return rows;
};
