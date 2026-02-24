import pool from '../config/database.js';

let sourceMappingTableEnsured = false;

export const ensureWithdrawSourceMappingTable = async () => {
  if (sourceMappingTableEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdraw_branch_source_mappings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      target_branch_id INT NOT NULL,
      source_department_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_withdraw_target_branch (target_branch_id),
      INDEX idx_withdraw_source_department (source_department_id),
      CONSTRAINT fk_withdraw_target_branch
        FOREIGN KEY (target_branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      CONSTRAINT fk_withdraw_source_department
        FOREIGN KEY (source_department_id) REFERENCES departments(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  sourceMappingTableEnsured = true;
};

export const getMappedSourceDepartmentByBranch = async ({
  targetBranchId,
  connection = pool
}) => {
  await ensureWithdrawSourceMappingTable();

  const normalizedBranchId = Number(targetBranchId);
  if (!Number.isFinite(normalizedBranchId)) return null;

  const [rows] = await connection.query(
    `SELECT
      m.id,
      m.target_branch_id,
      m.source_department_id,
      sb.name AS source_branch_name,
      sd.name AS source_department_name
     FROM withdraw_branch_source_mappings m
     JOIN departments sd ON sd.id = m.source_department_id
     JOIN branches sb ON sb.id = sd.branch_id
     WHERE m.target_branch_id = ?
     LIMIT 1`,
    [normalizedBranchId]
  );

  return rows[0] || null;
};

export const getWithdrawSourceMappings = async () => {
  await ensureWithdrawSourceMappingTable();

  const [rows] = await pool.query(
    `SELECT
      m.id,
      m.target_branch_id,
      tb.name AS target_branch_name,
      m.source_department_id,
      sd.name AS source_department_name,
      sb.id AS source_branch_id,
      sb.name AS source_branch_name,
      m.updated_at
     FROM withdraw_branch_source_mappings m
     JOIN branches tb ON tb.id = m.target_branch_id
     JOIN departments sd ON sd.id = m.source_department_id
     JOIN branches sb ON sb.id = sd.branch_id
     WHERE tb.is_active = true AND sd.is_active = true
     ORDER BY tb.name`
  );

  return rows;
};

export const getAvailableTargetBranches = async () => {
  const [rows] = await pool.query(
    `SELECT id, name, code
     FROM branches
     WHERE is_active = true
     ORDER BY name`
  );
  return rows;
};

export const getAvailableSourceDepartments = async () => {
  const [rows] = await pool.query(
    `SELECT d.id, d.name AS department_name, b.id AS branch_id, b.name AS branch_name
     FROM departments d
     JOIN branches b ON b.id = d.branch_id
     WHERE d.is_active = true
     ORDER BY b.name, d.name`
  );
  return rows;
};

export const replaceWithdrawSourceMappings = async (mappings = []) => {
  await ensureWithdrawSourceMappingTable();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM withdraw_branch_source_mappings');

    for (const item of Array.isArray(mappings) ? mappings : []) {
      const targetBranchId = Number(item?.target_branch_id ?? item?.branch_id);
      const sourceDepartmentId = Number(item?.source_department_id ?? item?.department_id);

      if (!Number.isFinite(targetBranchId) || !Number.isFinite(sourceDepartmentId)) {
        continue;
      }

      const [branchRows] = await connection.query(
        'SELECT id FROM branches WHERE id = ? AND is_active = true LIMIT 1',
        [targetBranchId]
      );
      if (branchRows.length === 0) continue;

      const [departmentRows] = await connection.query(
        'SELECT id FROM departments WHERE id = ? AND is_active = true LIMIT 1',
        [sourceDepartmentId]
      );
      if (departmentRows.length === 0) continue;

      await connection.query(
        `INSERT INTO withdraw_branch_source_mappings
         (target_branch_id, source_department_id)
         VALUES (?, ?)`,
        [targetBranchId, sourceDepartmentId]
      );
    }

    await connection.commit();
    return getWithdrawSourceMappings();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
