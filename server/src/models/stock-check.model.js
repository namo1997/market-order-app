import pool from '../config/database.js';

const ensureStockTemplateColumns = async () => {
  const columns = [
    {
      name: 'min_quantity',
      definition: 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER required_quantity'
    },
    {
      name: 'daily_required',
      definition: 'BOOLEAN NOT NULL DEFAULT false AFTER min_quantity'
    }
  ];

  for (const column of columns) {
    const [rows] = await pool.query(
      'SHOW COLUMNS FROM stock_templates LIKE ?',
      [column.name]
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE stock_templates ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
};

// ==============================
// หมวดสินค้า (Stock Categories)
// ==============================

export const getCategoriesByDepartmentId = async (departmentId) => {
  const [rows] = await pool.query(
    `SELECT id, department_id, name, sort_order, is_active, created_at, updated_at
     FROM stock_categories
     WHERE department_id = ? AND is_active = true
     ORDER BY sort_order, name`,
    [departmentId]
  );
  return rows;
};

export const addCategory = async (departmentId, name) => {
  const [[maxRow]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM stock_categories WHERE department_id = ?',
    [departmentId]
  );
  const nextSortOrder = Number(maxRow?.max_sort || 0) + 1;
  const [result] = await pool.query(
    'INSERT INTO stock_categories (department_id, name, sort_order) VALUES (?, ?, ?)',
    [departmentId, name, nextSortOrder]
  );
  return { id: result.insertId, department_id: departmentId, name, sort_order: nextSortOrder };
};

export const updateCategory = async (id, name, sortOrder) => {
  const fields = [];
  const params = [];

  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name);
  }

  if (sortOrder !== undefined) {
    fields.push('sort_order = ?');
    params.push(sortOrder);
  }

  if (fields.length === 0) {
    return null;
  }

  params.push(id);
  const [result] = await pool.query(
    `UPDATE stock_categories SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return { id, name, sort_order: sortOrder };
};

export const deleteCategory = async (id) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE stock_templates SET category_id = NULL WHERE category_id = ?',
      [id]
    );
    const [result] = await connection.query(
      'DELETE FROM stock_categories WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return null;
    }

    await connection.commit();
    return { id };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ดึงรายการของประจำทั้งหมดของ department พร้อมข้อมูลสินค้า
export const getTemplateByDepartmentId = async (departmentId) => {
  await ensureStockTemplateColumns();
  const [rows] = await pool.query(
    `SELECT
      st.id,
      st.department_id,
      st.product_id,
      st.category_id,
      st.required_quantity,
      st.min_quantity,
      st.daily_required,
      st.created_at,
      st.updated_at,
      p.name as product_name,
      p.code as product_code,
      p.default_price,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.id as supplier_id,
      s.name as supplier_name,
      sc.name as category_name,
      sc.sort_order as category_sort_order
    FROM stock_templates st
    LEFT JOIN products p ON st.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN stock_categories sc ON st.category_id = sc.id
    WHERE st.department_id = ?
    ORDER BY p.name`,
    [departmentId]
  );
  return rows;
};

// ดึงรายการสต็อกที่บันทึกไว้ตามแผนก/วันที่
export const getStockChecksByDepartmentId = async (departmentId, date) => {
  const [rows] = await pool.query(
    `SELECT product_id, stock_quantity
     FROM stock_checks
     WHERE department_id = ? AND check_date = ?
     ORDER BY product_id`,
    [departmentId, date]
  );
  return rows;
};

// ดึงสถานะเช็คสต็อกของทุกแผนกในสาขา (ตามวันที่)
export const getBranchStockCheckDepartments = async (branchId, date) => {
  const [rows] = await pool.query(
    `SELECT
      d.id AS department_id,
      d.name AS department_name,
      COUNT(st.id) AS template_count,
      SUM(CASE WHEN COALESCE(st.daily_required, false) = true THEN 1 ELSE 0 END) AS daily_required_count,
      SUM(CASE WHEN sc.id IS NOT NULL THEN 1 ELSE 0 END) AS checked_count,
      SUM(
        CASE
          WHEN COALESCE(st.daily_required, false) = true AND sc.id IS NOT NULL THEN 1
          ELSE 0
        END
      ) AS checked_daily_required_count
     FROM departments d
     LEFT JOIN stock_templates st ON st.department_id = d.id
     LEFT JOIN stock_checks sc
       ON sc.department_id = d.id
      AND sc.product_id = st.product_id
      AND sc.check_date = ?
     WHERE d.branch_id = ?
       AND d.is_active = true
     GROUP BY d.id, d.name
     ORDER BY d.name`,
    [date, branchId]
  );
  return rows;
};

// Admin: ดึงรายการของประจำทั้งหมดพร้อมข้อมูล department และสินค้า
export const getAllTemplates = async () => {
  await ensureStockTemplateColumns();
  const [rows] = await pool.query(
    `SELECT
      st.id,
      st.department_id,
      st.product_id,
      st.category_id,
      st.required_quantity,
      st.min_quantity,
      st.daily_required,
      st.created_at,
      st.updated_at,
      p.name as product_name,
      p.code as product_code,
      p.default_price,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.id as supplier_id,
      s.name as supplier_name,
      sc.name as category_name,
      sc.sort_order as category_sort_order,
      d.name as department_name,
      b.name as branch_name
    FROM stock_templates st
    LEFT JOIN products p ON st.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN stock_categories sc ON st.category_id = sc.id
    LEFT JOIN departments d ON st.department_id = d.id
    LEFT JOIN branches b ON d.branch_id = b.id
    ORDER BY b.name, d.name, p.name`
  );
  return rows;
};

// Admin: เพิ่มสินค้าเข้ารายการของประจำของ department
export const addToTemplate = async (
  departmentId,
  productId,
  requiredQuantity,
  categoryId,
  minQuantity,
  dailyRequired
) => {
  await ensureStockTemplateColumns();
  const hasCategory = categoryId !== undefined;
  const normalizedMin = Number(minQuantity || 0);
  const normalizedDaily = dailyRequired === undefined ? undefined : dailyRequired ? 1 : 0;
  // ตรวจสอบว่ามีสินค้านี้อยู่ใน template แล้วหรือยัง
  const [existing] = await pool.query(
    'SELECT id, daily_required FROM stock_templates WHERE department_id = ? AND product_id = ?',
    [departmentId, productId]
  );

  if (existing.length > 0) {
    // ถ้ามีอยู่แล้ว ให้อัพเดทจำนวน
    const currentDaily = Number(existing[0].daily_required || 0);
    if (hasCategory) {
      if (normalizedDaily === undefined) {
        await pool.query(
          'UPDATE stock_templates SET required_quantity = ?, category_id = ?, min_quantity = ? WHERE id = ?',
          [requiredQuantity, categoryId, normalizedMin, existing[0].id]
        );
      } else {
        await pool.query(
          'UPDATE stock_templates SET required_quantity = ?, category_id = ?, min_quantity = ?, daily_required = ? WHERE id = ?',
          [requiredQuantity, categoryId, normalizedMin, normalizedDaily, existing[0].id]
        );
      }
    } else {
      if (normalizedDaily === undefined) {
        await pool.query(
          'UPDATE stock_templates SET required_quantity = ?, min_quantity = ? WHERE id = ?',
          [requiredQuantity, normalizedMin, existing[0].id]
        );
      } else {
        await pool.query(
          'UPDATE stock_templates SET required_quantity = ?, min_quantity = ?, daily_required = ? WHERE id = ?',
          [requiredQuantity, normalizedMin, normalizedDaily, existing[0].id]
        );
      }
    }
    return {
      id: existing[0].id,
      department_id: departmentId,
      product_id: productId,
      required_quantity: requiredQuantity,
      min_quantity: normalizedMin,
      daily_required: normalizedDaily ?? currentDaily,
      category_id: hasCategory ? categoryId : undefined
    };
  } else {
    // ถ้ายังไม่มี ให้เพิ่มใหม่
    const [result] = await pool.query(
      'INSERT INTO stock_templates (department_id, product_id, category_id, required_quantity, min_quantity, daily_required) VALUES (?, ?, ?, ?, ?, ?)',
      [
        departmentId,
        productId,
        hasCategory ? categoryId : null,
        requiredQuantity,
        normalizedMin,
        normalizedDaily ?? 0
      ]
    );
    return {
      id: result.insertId,
      department_id: departmentId,
      product_id: productId,
      category_id: hasCategory ? categoryId : null,
      required_quantity: requiredQuantity,
      min_quantity: normalizedMin,
      daily_required: normalizedDaily ?? 0
    };
  }
};

// Admin: แก้ไขจำนวนต้องการในรายการของประจำ
export const updateTemplate = async (
  id,
  requiredQuantity,
  categoryId,
  minQuantity,
  dailyRequired
) => {
  await ensureStockTemplateColumns();
  const fields = [];
  const params = [];

  if (requiredQuantity !== undefined) {
    fields.push('required_quantity = ?');
    params.push(requiredQuantity);
  }

  if (categoryId !== undefined) {
    fields.push('category_id = ?');
    params.push(categoryId);
  }

  if (minQuantity !== undefined) {
    fields.push('min_quantity = ?');
    params.push(minQuantity);
  }

  if (dailyRequired !== undefined) {
    fields.push('daily_required = ?');
    params.push(dailyRequired ? 1 : 0);
  }

  if (fields.length === 0) {
    return null;
  }

  params.push(id);
  const [result] = await pool.query(
    `UPDATE stock_templates SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return {
    id,
    required_quantity: requiredQuantity,
    category_id: categoryId,
    min_quantity: minQuantity,
    daily_required: dailyRequired
  };
};

// Admin: ลบสินค้าออกจากรายการของประจำ
export const deleteFromTemplate = async (id) => {
  const [result] = await pool.query(
    'DELETE FROM stock_templates WHERE id = ?',
    [id]
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return { id };
};

// Admin: ลบสินค้าออกจากรายการของประจำ (หลายรายการ)
export const deleteTemplates = async (ids) => {
  if (!ids || ids.length === 0) return { count: 0 };

  // Debug logging
  console.log('Deleting templates with IDs:', ids);

  if (ids.length === 0) return { count: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const sql = `DELETE FROM stock_templates WHERE id IN (${placeholders})`;

  try {
    const [result] = await pool.query(sql, ids);
    return { count: result.affectedRows };
  } catch (error) {
    console.error('SQL Error in deleteTemplates model:', error);
    throw error;
  }
};

// Admin: ดึงรายการสินค้าทั้งหมดที่ยังไม่ได้อยู่ใน template ของ department
export const getAvailableProducts = async (departmentId) => {
  const [rows] = await pool.query(
    `SELECT
      p.id,
      p.name,
      p.code,
      p.default_price,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.id as supplier_id,
      s.name as supplier_name
    FROM products p
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.is_active = true
      AND p.id NOT IN (
        SELECT product_id FROM stock_templates WHERE department_id = ?
      )
    ORDER BY p.name`,
    [departmentId]
  );
  return rows;
};

// บันทึกสต็อก (upsert) สำหรับแผนก/วันที่
export const upsertStockChecks = async (departmentId, userId, date, items) => {
  if (!items || items.length === 0) {
    return { count: 0 };
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const values = items.map((item) => [
      departmentId,
      item.product_id,
      date,
      item.stock_quantity,
      userId
    ]);

    await connection.query(
      `INSERT INTO stock_checks
        (department_id, product_id, check_date, stock_quantity, checked_by_user_id)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         stock_quantity = VALUES(stock_quantity),
         checked_by_user_id = VALUES(checked_by_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [values]
    );

    await connection.commit();
    return { count: items.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// บันทึกเช็คสต็อกทั้งสาขาแบบเลือกแผนก
export const bulkCheckByBranchDepartments = async ({
  branchId,
  departmentIds = [],
  userId,
  date,
  onlyDailyRequired = true
}) => {
  const normalizedDepartmentIds = (departmentIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  if (normalizedDepartmentIds.length === 0) {
    return { inserted: 0, departments: [] };
  }

  const placeholders = normalizedDepartmentIds.map(() => '?').join(', ');
  const dailyRequiredFilter = onlyDailyRequired
    ? 'AND COALESCE(st.daily_required, false) = true'
    : '';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      `SELECT
         st.department_id,
         st.product_id
       FROM stock_templates st
       JOIN departments d ON d.id = st.department_id
       LEFT JOIN stock_checks sc
         ON sc.department_id = st.department_id
        AND sc.product_id = st.product_id
        AND sc.check_date = ?
       WHERE d.branch_id = ?
         AND d.is_active = true
         AND st.department_id IN (${placeholders})
         ${dailyRequiredFilter}
         AND sc.id IS NULL
       ORDER BY st.department_id, st.product_id`,
      [date, branchId, ...normalizedDepartmentIds]
    );

    if (targetRows.length === 0) {
      await connection.commit();
      return {
        inserted: 0,
        departments: normalizedDepartmentIds.map((id) => ({
          department_id: id,
          inserted_count: 0
        }))
      };
    }

    const values = targetRows.map((row) => [
      row.department_id,
      row.product_id,
      date,
      0,
      userId
    ]);

    await connection.query(
      `INSERT INTO stock_checks
        (department_id, product_id, check_date, stock_quantity, checked_by_user_id)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         stock_quantity = VALUES(stock_quantity),
         checked_by_user_id = VALUES(checked_by_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [values]
    );

    const countByDepartment = new Map();
    targetRows.forEach((row) => {
      const key = Number(row.department_id);
      countByDepartment.set(key, (countByDepartment.get(key) || 0) + 1);
    });

    await connection.commit();
    return {
      inserted: targetRows.length,
      departments: normalizedDepartmentIds.map((id) => ({
        department_id: id,
        inserted_count: countByDepartment.get(id) || 0
      }))
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
