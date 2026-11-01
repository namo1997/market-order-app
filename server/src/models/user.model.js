import pool from '../config/database.js';
import { httpError, requireText, toDuplicateError } from '../utils/master-data-validation.js';

const ensureDepartmentColumns = async () => {
  const [rows] = await pool.query(
    "SHOW COLUMNS FROM departments LIKE 'is_production'"
  );
  if (rows.length === 0) {
    await pool.query(
      'ALTER TABLE departments ADD COLUMN is_production BOOLEAN NOT NULL DEFAULT false AFTER code'
    );
  }

  const [roleRows] = await pool.query(
    "SHOW COLUMNS FROM departments LIKE 'allowed_roles'"
  );
  if (roleRows.length === 0) {
    await pool.query(
      "ALTER TABLE departments ADD COLUMN allowed_roles VARCHAR(64) NOT NULL DEFAULT 'user,admin' AFTER is_production"
    );
  }

  const [stockCheckRows] = await pool.query(
    "SHOW COLUMNS FROM departments LIKE 'stock_check_required'"
  );
  if (stockCheckRows.length === 0) {
    await pool.query(
      'ALTER TABLE departments ADD COLUMN stock_check_required BOOLEAN NOT NULL DEFAULT true AFTER allowed_roles'
    );
  }

  const [stockBalanceRows] = await pool.query(
    "SHOW COLUMNS FROM departments LIKE 'can_view_stock_balance'"
  );
  if (stockBalanceRows.length === 0) {
    await pool.query(
      'ALTER TABLE departments ADD COLUMN can_view_stock_balance BOOLEAN NOT NULL DEFAULT false AFTER stock_check_required'
    );
  }
};

// ดึงรายการสาขาทั้งหมด
export const getAllBranches = async () => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    'SELECT id, name, code FROM branches WHERE is_active = true ORDER BY name'
  );
  return rows;
};

// ดึงรายการแผนกตามสาขา
export const getDepartmentsByBranch = async (branchId) => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    'SELECT id, name, code, is_production, allowed_roles, stock_check_required FROM departments WHERE branch_id = ? AND is_active = true ORDER BY name',
    [branchId]
  );
  return rows;
};

// ดึงข้อมูลแผนกพร้อมสาขา
export const getDepartmentById = async (departmentId) => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.code, d.branch_id,
            d.is_production, d.allowed_roles, d.stock_check_required,
            b.name as branch_name, b.code as branch_code
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     WHERE d.id = ? AND d.is_active = true`,
    [departmentId]
  );
  return rows[0] || null;
};

// ดึงรายการผู้ใช้ตามแผนก
export const getUsersByDepartment = async (departmentId) => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id, d.is_production, d.stock_check_required, d.can_view_stock_balance,
            b.name as branch_name, b.code as branch_code
     FROM users u
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     WHERE u.department_id = ? AND u.is_active = true
     ORDER BY u.name`,
    [departmentId]
  );
  return rows;
};

export const getDefaultAdminDepartment = async () => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.is_production, b.name as branch_name
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     WHERE d.is_active = true AND b.is_active = true
     ORDER BY (b.name = 'สาขาส่วนกลาง') DESC, d.id ASC
     LIMIT 1`
  );
  return rows[0] || null;
};

// ดึงข้อมูล user ตาม ID
export const getUserById = async (userId) => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id, d.is_production, d.stock_check_required, d.can_view_stock_balance,
            b.name as branch_name, b.code as branch_code
     FROM users u
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     WHERE u.id = ? AND u.is_active = true`,
    [userId]
  );
  return rows[0] || null;
};

// ดึงข้อมูล user ตาม username
export const getUserByUsername = async (username) => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id, d.is_production, d.stock_check_required, d.can_view_stock_balance,
            b.name as branch_name, b.code as branch_code
     FROM users u
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     WHERE u.username = ? AND u.is_active = true`,
    [username]
  );
  return rows[0] || null;
};

// ดึงรายการผู้ใช้ทั้งหมด
export const getAllUsers = async () => {
  await ensureDepartmentColumns();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
              d.name as department_name, d.branch_id, d.is_production, d.stock_check_required, d.can_view_stock_balance,
              b.name as branch_name, b.code as branch_code
       FROM users u
       JOIN departments d ON u.department_id = d.id
       JOIN branches b ON d.branch_id = b.id
       WHERE u.is_active = true
       ORDER BY u.name`
  );
  return rows;
};

// สร้างผู้ใช้ใหม่
export const createUser = async (data) => {
  const username = requireText(data.username, 'ชื่อผู้ใช้ (username)', 50);
  const name = requireText(data.name, 'ชื่อ-นามสกุล', 100);
  const { role, department_id } = data;
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (username, name, role, department_id, is_active) 
       VALUES (?, ?, ?, ?, true)`,
      [username, name, role, department_id]
    );
  } catch (error) {
    throw toDuplicateError(error, { username: 'ชื่อผู้ใช้ (username)' });
  }
  return { id: result.insertId, username, name, role, department_id };
};

// อัพเดทผู้ใช้
export const updateUser = async (id, data) => {
  const name = requireText(data.name, 'ชื่อ-นามสกุล', 100);
  const { role, department_id } = data;
  const [result] = await pool.query(
    'UPDATE users SET name = ?, role = ?, department_id = ? WHERE id = ?',
    [name, role, department_id, id]
  );
  if (result.affectedRows === 0) {
    throw httpError('ไม่พบผู้ใช้', 404);
  }
  return { id, ...data, name };
};

// ใช้ตรวจว่า token เดิมยังใช้ได้อยู่หรือไม่ (ผู้ใช้/แผนกที่ถูกลบหรือซ่อนแล้วต้องใช้ token เดิมต่อไม่ได้)
// Rules mirror the login endpoints:
//   - users.is_active must be true (login by userId requires it)
//   - for role 'user' (department login) the department must also be active.
//     Admin accounts log in by userId, which does not require an active department
//     (e.g. admin_bkk lives in an inactive department), so they are not locked out by it.
// Integrator: call from middleware/auth.js `authenticate` after verifyToken (make it async), e.g.
//   if (!(await isUserActive(decoded.id))) {
//     return res.status(401).json({ success: false, message: 'บัญชีหรือแผนกนี้ถูกปิดการใช้งานแล้ว กรุณาเข้าสู่ระบบใหม่' });
//   }
export const isUserActive = async (userId) => {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return false;
  const [rows] = await pool.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?
       AND u.is_active = true
       AND (u.role IN ('admin', 'super_admin') OR d.is_active = true)
     LIMIT 1`,
    [normalizedId]
  );
  return rows.length > 0;
};

// เปลี่ยนรหัสผ่าน
export const updatePassword = async (id, hashedPassword) => {
  return { id };
};

// ลบผู้ใช้ (Soft delete)
export const deleteUser = async (id) => {
  const [result] = await pool.query(
    'UPDATE users SET is_active = false WHERE id = ?',
    [id]
  );
  if (result.affectedRows === 0) {
    throw httpError('ไม่พบผู้ใช้', 404);
  }
  return { id };
};
