import pool from '../config/database.js';

// ดึงรายการสาขาทั้งหมด
export const getAllBranches = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, code FROM branches WHERE is_active = true ORDER BY name'
  );
  return rows;
};

// ดึงรายการแผนกตามสาขา
export const getDepartmentsByBranch = async (branchId) => {
  const [rows] = await pool.query(
    'SELECT id, name, code FROM departments WHERE branch_id = ? AND is_active = true ORDER BY name',
    [branchId]
  );
  return rows;
};

// ดึงข้อมูลแผนกพร้อมสาขา
export const getDepartmentById = async (departmentId) => {
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.code, d.branch_id,
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
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id,
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
  const [rows] = await pool.query(
    `SELECT d.id, d.name, b.name as branch_name
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
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id,
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
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
            d.name as department_name, d.branch_id,
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
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.department_id,
              d.name as department_name, d.branch_id,
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
  const { username, name, role, department_id } = data;
  const [result] = await pool.query(
    `INSERT INTO users (username, name, role, department_id, is_active) 
     VALUES (?, ?, ?, ?, true)`,
    [username, name, role, department_id]
  );
  return { id: result.insertId, username, name, role, department_id };
};

// อัพเดทผู้ใช้
export const updateUser = async (id, data) => {
  const { name, role, department_id } = data;
  await pool.query(
    'UPDATE users SET name = ?, role = ?, department_id = ? WHERE id = ?',
    [name, role, department_id, id]
  );
  return { id, ...data };
};

// เปลี่ยนรหัสผ่าน
export const updatePassword = async (id, hashedPassword) => {
  return { id };
};

// ลบผู้ใช้ (Soft delete)
export const deleteUser = async (id) => {
  await pool.query(
    'UPDATE users SET is_active = false WHERE id = ?',
    [id]
  );
  return { id };
};
