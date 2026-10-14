import pool from '../config/database.js';
import {
  getInternalProductGroupsByScope,
  getTransformProductGroupsByScope
} from './supplier.model.js';

let ensuredTransformConfigTables = false;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeIdList = (values = []) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const normalizeIngredientList = (ingredients = []) => {
  const map = new Map();
  if (!Array.isArray(ingredients)) return map;

  for (const item of ingredients) {
    const productId = Number(item?.product_id);
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    map.set(productId, (map.get(productId) || 0) + quantity);
  }
  return map;
};

const ensureDepartmentIsProduction = async (departmentId) => {
  const normalizedDepartmentId = Number(departmentId);
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.branch_id, b.name AS branch_name
     FROM departments d
     JOIN branches b ON b.id = d.branch_id
     WHERE d.id = ?
       AND d.is_active = true
       AND COALESCE(d.is_production, false) = true
     LIMIT 1`,
    [normalizedDepartmentId]
  );
  return rows[0] || null;
};

const resolveAllowedTransformGroupIds = async ({ branchId, departmentId }) => {
  const transformGroups = await getTransformProductGroupsByScope({ branchId, departmentId });
  let groupIds = Array.isArray(transformGroups)
    ? transformGroups
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (groupIds.length === 0) {
    const internalGroups = await getInternalProductGroupsByScope({ branchId, departmentId });
    groupIds = Array.isArray(internalGroups)
      ? internalGroups
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      : [];
  }

  return groupIds;
};

const getDepartmentOutputProducts = async ({ departmentId, branchId, search = '' }) => {
  const allowedGroupIds = await resolveAllowedTransformGroupIds({ branchId, departmentId });
  if (allowedGroupIds.length === 0) {
    return [];
  }

  const params = [allowedGroupIds];
  let query = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.code AS product_code,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr
    FROM products p
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.is_active = true
      AND EXISTS (
        SELECT 1
        FROM product_group_links pgl
        WHERE pgl.product_id = p.id
          AND pgl.product_group_id IN (?)
      )
  `;

  const keyword = String(search || '').trim();
  if (keyword) {
    query += ' AND (p.name LIKE ? OR p.code LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  query += ' ORDER BY p.name';
  const [rows] = await pool.query(query, params);
  return rows;
};

const getIngredientCandidates = async () => {
  const [rows] = await pool.query(
    `SELECT
      p.id,
      p.name,
      p.code,
      pg.id AS product_group_id,
      pg.name AS product_group_name,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr
     FROM products p
     JOIN product_group_links pgl ON pgl.product_id = p.id
     JOIN product_groups pg ON pg.id = pgl.product_group_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.is_active = true
       AND pg.is_active = true

     UNION

     SELECT
      p.id,
      p.name,
      p.code,
      pg.id AS product_group_id,
      pg.name AS product_group_name,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr
     FROM products p
     LEFT JOIN product_groups pg ON pg.id = p.product_group_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.is_active = true
       AND NOT EXISTS (
        SELECT 1
        FROM product_group_links pgl
        WHERE pgl.product_id = p.id
       )

     ORDER BY COALESCE(product_group_name, 'ไม่ระบุกลุ่มสินค้า'), name`
  );
  return rows;
};

export const ensureProductionTransformConfigTables = async () => {
  if (ensuredTransformConfigTables) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS production_transform_product_configs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      department_id INT NOT NULL,
      output_product_id INT NOT NULL,
      requires_base_ingredient BOOLEAN NOT NULL DEFAULT false,
      base_ingredient_product_id INT NULL,
      base_ingredient_per_output DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
      created_by INT NULL,
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_transform_config_output (department_id, output_product_id),
      INDEX idx_transform_config_department (department_id),
      INDEX idx_transform_config_output_product (output_product_id),
      INDEX idx_transform_config_base_product (base_ingredient_product_id),
      CONSTRAINT fk_transform_config_department
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      CONSTRAINT fk_transform_config_output_product
        FOREIGN KEY (output_product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_transform_config_base_product
        FOREIGN KEY (base_ingredient_product_id) REFERENCES products(id) ON DELETE SET NULL,
      CONSTRAINT fk_transform_config_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_transform_config_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS production_transform_config_required_ingredients (
      id INT PRIMARY KEY AUTO_INCREMENT,
      config_id INT NOT NULL,
      ingredient_product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_transform_required_ingredient (config_id, ingredient_product_id),
      INDEX idx_transform_required_config (config_id),
      INDEX idx_transform_required_ingredient (ingredient_product_id),
      CONSTRAINT fk_transform_required_config
        FOREIGN KEY (config_id) REFERENCES production_transform_product_configs(id) ON DELETE CASCADE,
      CONSTRAINT fk_transform_required_ingredient_product
        FOREIGN KEY (ingredient_product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // migrate legacy single ingredient -> multi ingredient table (idempotent)
  await pool.query(
    `INSERT IGNORE INTO production_transform_config_required_ingredients (config_id, ingredient_product_id)
     SELECT id, base_ingredient_product_id
     FROM production_transform_product_configs
     WHERE requires_base_ingredient = true
       AND base_ingredient_product_id IS NOT NULL`
  );

  ensuredTransformConfigTables = true;
};

export const getProductionTransformConfigOverview = async ({
  departmentId,
  search = ''
}) => {
  await ensureProductionTransformConfigTables();

  const department = await ensureDepartmentIsProduction(departmentId);
  if (!department) {
    const error = new Error('DEPARTMENT_NOT_PRODUCTION');
    error.statusCode = 400;
    throw error;
  }

  const [products, configs, requiredIngredientRows, ingredients] = await Promise.all([
    getDepartmentOutputProducts({
      departmentId: Number(department.id),
      branchId: Number(department.branch_id),
      search
    }),
    pool.query(
      `SELECT
        c.output_product_id,
        c.requires_base_ingredient,
        c.id AS config_id,
        c.updated_at,
        c.updated_by,
        u.name AS updated_by_name
       FROM production_transform_product_configs c
       LEFT JOIN users u ON u.id = c.updated_by
       WHERE c.department_id = ?`,
      [Number(department.id)]
    ).then((result) => result[0]),
    pool.query(
      `SELECT
        c.output_product_id,
        ri.ingredient_product_id,
        p.name AS ingredient_product_name,
        p.code AS ingredient_product_code,
        u.abbreviation AS ingredient_unit_abbr,
        u.name AS ingredient_unit_name
       FROM production_transform_product_configs c
       JOIN production_transform_config_required_ingredients ri ON ri.config_id = c.id
       JOIN products p ON p.id = ri.ingredient_product_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE c.department_id = ?
       ORDER BY c.output_product_id, p.name`,
      [Number(department.id)]
    ).then((result) => result[0]),
    getIngredientCandidates()
  ]);

  const configMap = new Map(
    (configs || []).map((row) => [Number(row.output_product_id), row])
  );
  const requiredMap = new Map();
  for (const row of (requiredIngredientRows || [])) {
    const outputProductId = Number(row.output_product_id);
    if (!requiredMap.has(outputProductId)) {
      requiredMap.set(outputProductId, []);
    }
    requiredMap.get(outputProductId).push({
      product_id: Number(row.ingredient_product_id),
      product_name: row.ingredient_product_name,
      product_code: row.ingredient_product_code,
      unit_abbr: row.ingredient_unit_abbr,
      unit_name: row.ingredient_unit_name
    });
  }

  const outputProducts = (products || []).map((product) => {
    const productId = Number(product.product_id);
    const config = configMap.get(productId);
    const requiredIngredients = requiredMap.get(productId) || [];
    return {
      product_id: productId,
      product_name: product.product_name,
      product_code: product.product_code,
      unit_name: product.unit_name,
      unit_abbr: product.unit_abbr,
      requires_base_ingredient: Boolean(Number(config?.requires_base_ingredient || 0)),
      required_ingredient_product_ids: requiredIngredients.map((item) => Number(item.product_id)),
      required_ingredients: requiredIngredients,
      updated_at: config?.updated_at || null,
      updated_by: config?.updated_by ? Number(config.updated_by) : null,
      updated_by_name: config?.updated_by_name || null
    };
  });

  return {
    department: {
      id: Number(department.id),
      name: department.name,
      branch_id: Number(department.branch_id),
      branch_name: department.branch_name
    },
    output_products: outputProducts,
    ingredient_products: ingredients.map((row) => ({
      id: Number(row.id),
      name: row.name,
      code: row.code,
      product_group_id: row.product_group_id ? Number(row.product_group_id) : null,
      product_group_name: row.product_group_name || 'ไม่ระบุกลุ่มสินค้า',
      unit_name: row.unit_name,
      unit_abbr: row.unit_abbr
    }))
  };
};

export const upsertProductionTransformProductConfig = async ({
  departmentId,
  outputProductId,
  requiresBaseIngredient,
  requiredIngredientProductIds,
  userId
}) => {
  await ensureProductionTransformConfigTables();

  const department = await ensureDepartmentIsProduction(departmentId);
  if (!department) {
    const error = new Error('DEPARTMENT_NOT_PRODUCTION');
    error.statusCode = 400;
    throw error;
  }

  const normalizedOutputProductId = Number(outputProductId);
  if (!Number.isFinite(normalizedOutputProductId) || normalizedOutputProductId <= 0) {
    const error = new Error('INVALID_OUTPUT_PRODUCT');
    error.statusCode = 400;
    throw error;
  }

  const outputProducts = await getDepartmentOutputProducts({
    departmentId: Number(department.id),
    branchId: Number(department.branch_id)
  });
  const allowedOutput = new Set(outputProducts.map((row) => Number(row.product_id)));
  if (!allowedOutput.has(normalizedOutputProductId)) {
    const error = new Error('OUTPUT_PRODUCT_NOT_ALLOWED');
    error.statusCode = 400;
    throw error;
  }

  const normalizedRequiresBase = Boolean(requiresBaseIngredient);
  const normalizedRequiredIngredientIds = normalizedRequiresBase
    ? normalizeIdList(requiredIngredientProductIds)
    : [];

  if (normalizedRequiresBase && normalizedRequiredIngredientIds.length === 0) {
    const error = new Error('BASE_INGREDIENT_REQUIRED');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedRequiredIngredientIds.includes(normalizedOutputProductId)) {
    const error = new Error('BASE_INGREDIENT_DUPLICATE_OUTPUT');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedRequiredIngredientIds.length > 0) {
    const [ingredientRows] = await pool.query(
      `SELECT id
       FROM products
       WHERE is_active = true
         AND id IN (?)`,
      [normalizedRequiredIngredientIds]
    );
    const found = new Set(ingredientRows.map((row) => Number(row.id)));
    const missing = normalizedRequiredIngredientIds.find((id) => !found.has(Number(id)));
    if (missing !== undefined) {
      const error = new Error('BASE_INGREDIENT_NOT_FOUND');
      error.statusCode = 404;
      throw error;
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO production_transform_product_configs
        (department_id, output_product_id, requires_base_ingredient, base_ingredient_product_id,
         base_ingredient_per_output, created_by, updated_by)
       VALUES (?, ?, ?, NULL, 1.0000, ?, ?)
       ON DUPLICATE KEY UPDATE
        requires_base_ingredient = VALUES(requires_base_ingredient),
        base_ingredient_product_id = NULL,
        base_ingredient_per_output = 1.0000,
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP`,
      [
        Number(department.id),
        normalizedOutputProductId,
        normalizedRequiresBase,
        userId || null,
        userId || null
      ]
    );

    const [configRows] = await connection.query(
      `SELECT id
       FROM production_transform_product_configs
       WHERE department_id = ? AND output_product_id = ?
       LIMIT 1`,
      [Number(department.id), normalizedOutputProductId]
    );
    const configId = Number(configRows[0]?.id);

    await connection.query(
      'DELETE FROM production_transform_config_required_ingredients WHERE config_id = ?',
      [configId]
    );

    if (normalizedRequiresBase && normalizedRequiredIngredientIds.length > 0) {
      const placeholders = normalizedRequiredIngredientIds.map(() => '(?, ?)').join(', ');
      const values = [];
      normalizedRequiredIngredientIds.forEach((ingredientId) => {
        values.push(configId, ingredientId);
      });
      await connection.query(
        `INSERT INTO production_transform_config_required_ingredients
           (config_id, ingredient_product_id)
         VALUES ${placeholders}`,
        values
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    department_id: Number(department.id),
    output_product_id: normalizedOutputProductId,
    requires_base_ingredient: normalizedRequiresBase,
    required_ingredient_product_ids: normalizedRequiredIngredientIds
  };
};

export const resolveProductionTransformIngredients = async ({
  departmentId,
  outputProductId,
  ingredients = []
}) => {
  await ensureProductionTransformConfigTables();

  const normalizedDepartmentId = Number(departmentId);
  const normalizedOutputProductId = Number(outputProductId);

  const ingredientMap = normalizeIngredientList(ingredients);

  const [configRows] = await pool.query(
    `SELECT id, requires_base_ingredient
     FROM production_transform_product_configs
     WHERE department_id = ?
       AND output_product_id = ?
     LIMIT 1`,
    [normalizedDepartmentId, normalizedOutputProductId]
  );

  if (configRows.length === 0) {
    return Array.from(ingredientMap.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity
    }));
  }

  const config = configRows[0];
  const requiresBase = Boolean(Number(config?.requires_base_ingredient || 0));
  if (!requiresBase) {
    return Array.from(ingredientMap.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity
    }));
  }

  const configId = Number(config?.id);
  const [requiredRows] = await pool.query(
    `SELECT ri.ingredient_product_id, p.name
     FROM production_transform_config_required_ingredients ri
     JOIN products p ON p.id = ri.ingredient_product_id
     WHERE ri.config_id = ?
     ORDER BY p.name`,
    [configId]
  );

  if (requiredRows.length === 0) {
    const error = new Error('BASE_INGREDIENT_NOT_CONFIGURED');
    error.statusCode = 400;
    throw error;
  }

  const missingRequired = requiredRows.filter((row) => {
    const productId = Number(row.ingredient_product_id);
    return !ingredientMap.has(productId) || Number(ingredientMap.get(productId) || 0) <= 0;
  });
  if (missingRequired.length > 0) {
    const error = new Error('BASE_INGREDIENT_REQUIRED_QTY_MISSING');
    error.statusCode = 400;
    error.details = missingRequired.map((row) => row.name || `#${row.ingredient_product_id}`);
    throw error;
  }

  return Array.from(ingredientMap.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity
  }));
};
