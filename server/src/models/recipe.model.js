import pool from '../config/database.js';

const ensureRecipeTables = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS menu_recipes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      menu_barcode VARCHAR(50) NOT NULL,
      menu_name VARCHAR(255) NOT NULL,
      menu_unit_name VARCHAR(50),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_menu_barcode (menu_barcode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS menu_recipe_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      recipe_id INT NOT NULL,
      product_id INT NOT NULL,
      unit_id INT NOT NULL,
      quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES menu_recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id),
      UNIQUE KEY unique_recipe_product (recipe_id, product_id),
      INDEX idx_recipe (recipe_id),
      INDEX idx_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getRecipes = async () => {
  await ensureRecipeTables();
  const [rows] = await pool.query(
    `SELECT r.id, r.menu_barcode, r.menu_name, r.menu_unit_name, r.is_active,
            COUNT(ri.id) as item_count
     FROM menu_recipes r
     LEFT JOIN menu_recipe_items ri ON ri.recipe_id = r.id
     WHERE r.is_active = true
     GROUP BY r.id
     ORDER BY r.menu_name`
  );
  return rows;
};

export const getRecipeById = async (id) => {
  await ensureRecipeTables();
  const [[recipe]] = await pool.query(
    `SELECT id, menu_barcode, menu_name, menu_unit_name, is_active
     FROM menu_recipes
     WHERE id = ?`,
    [id]
  );

  if (!recipe) return null;

  const [items] = await pool.query(
    `SELECT ri.id, ri.recipe_id, ri.product_id, ri.unit_id, ri.quantity,
            p.name as product_name, p.code as product_code,
            u.name as unit_name, u.abbreviation as unit_abbr
     FROM menu_recipe_items ri
     LEFT JOIN products p ON ri.product_id = p.id
     LEFT JOIN units u ON ri.unit_id = u.id
     WHERE ri.recipe_id = ?
     ORDER BY p.name`,
    [id]
  );

  return { ...recipe, items };
};

export const getRecipesByBarcodes = async (barcodes) => {
  await ensureRecipeTables();
  if (!barcodes || barcodes.length === 0) return [];

  const placeholders = barcodes.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT r.id as recipe_id, r.menu_barcode, r.menu_name, r.menu_unit_name,
            ri.id as item_id, ri.product_id, ri.unit_id, ri.quantity,
            p.name as product_name, p.unit_id as product_unit_id,
            u.abbreviation as unit_abbr,
            pu.abbreviation as product_unit_abbr
     FROM menu_recipes r
     LEFT JOIN menu_recipe_items ri ON ri.recipe_id = r.id
     LEFT JOIN products p ON ri.product_id = p.id
     LEFT JOIN units u ON ri.unit_id = u.id
     LEFT JOIN units pu ON p.unit_id = pu.id
     WHERE r.is_active = true
       AND r.menu_barcode IN (${placeholders})`,
    barcodes
  );

  return rows;
};

export const createRecipe = async (data) => {
  await ensureRecipeTables();
  const { menu_barcode, menu_name, menu_unit_name } = data;
  const [result] = await pool.query(
    `INSERT INTO menu_recipes
     (menu_barcode, menu_name, menu_unit_name, is_active)
     VALUES (?, ?, ?, true)
     ON DUPLICATE KEY UPDATE
       menu_name = VALUES(menu_name),
       menu_unit_name = VALUES(menu_unit_name),
       is_active = true`,
    [menu_barcode, menu_name, menu_unit_name || null]
  );

  const id = result.insertId || (await getRecipeIdByBarcode(menu_barcode));
  return { id, menu_barcode, menu_name, menu_unit_name };
};

const getRecipeIdByBarcode = async (barcode) => {
  const [[row]] = await pool.query(
    'SELECT id FROM menu_recipes WHERE menu_barcode = ?',
    [barcode]
  );
  return row?.id || null;
};

export const deleteRecipe = async (id) => {
  await ensureRecipeTables();
  await pool.query(
    'UPDATE menu_recipes SET is_active = false WHERE id = ?',
    [id]
  );
  return { id };
};

export const addRecipeItem = async (recipeId, productId, quantity, unitId) => {
  await ensureRecipeTables();
  const [result] = await pool.query(
    `INSERT INTO menu_recipe_items (recipe_id, product_id, unit_id, quantity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unit_id = VALUES(unit_id),
       quantity = VALUES(quantity)`,
    [recipeId, productId, unitId, quantity]
  );
  return { id: result.insertId, recipe_id: recipeId, product_id: productId, unit_id: unitId, quantity };
};

export const updateRecipeItem = async (id, quantity, unitId) => {
  await ensureRecipeTables();
  const fields = [];
  const params = [];

  if (quantity !== undefined) {
    fields.push('quantity = ?');
    params.push(quantity);
  }
  if (unitId !== undefined) {
    fields.push('unit_id = ?');
    params.push(unitId);
  }

  if (fields.length === 0) return null;

  params.push(id);
  const [result] = await pool.query(
    `UPDATE menu_recipe_items SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) return null;
  return { id, quantity, unit_id: unitId };
};

export const deleteRecipeItem = async (id) => {
  await ensureRecipeTables();
  const [result] = await pool.query(
    'DELETE FROM menu_recipe_items WHERE id = ?',
    [id]
  );
  if (result.affectedRows === 0) return null;
  return { id };
};
