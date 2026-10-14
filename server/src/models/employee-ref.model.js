import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import pool from '../config/database.js';

const execFileAsync = promisify(execFile);
const DEFAULT_EMPLOYEE_DB_PATH = '/Users/surachart/สำหรับระบบพนักงาน/backend/data/leave_system.db';

let tableEnsured = false;

export const ensureEmployeeRefTable = async () => {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_refs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source_employee_id VARCHAR(100) NOT NULL UNIQUE,
      employee_code VARCHAR(50) NOT NULL,
      first_name VARCHAR(255) NULL,
      last_name VARCHAR(255) NULL,
      nickname VARCHAR(255) NULL,
      full_name VARCHAR(255) NULL,
      status VARCHAR(50) NULL,
      role VARCHAR(50) NULL,
      branch_ref_id VARCHAR(100) NULL,
      branch_name VARCHAR(255) NULL,
      department_ref_id VARCHAR(100) NULL,
      department_name VARCHAR(255) NULL,
      position_ref_id VARCHAR(100) NULL,
      position_name VARCHAR(255) NULL,
      position_level INT NULL,
      manager_source_employee_id VARCHAR(100) NULL,
      is_head TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      synced_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_employee_refs_code (employee_code),
      INDEX idx_employee_refs_role (role),
      INDEX idx_employee_refs_branch_department (branch_name, department_name),
      INDEX idx_employee_refs_is_head (is_head)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
};

const resolveEmployeeDbPath = () => {
  const configured = process.env.EMPLOYEE_DB_PATH || DEFAULT_EMPLOYEE_DB_PATH;
  return path.resolve(configured);
};

const sqliteJson = async (dbPath, sql) => {
  const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, sql], {
    maxBuffer: 1024 * 1024 * 20
  });
  const text = String(stdout || '').trim();
  return text ? JSON.parse(text) : [];
};

export const readEmployeesFromLocalProject = async () => {
  const dbPath = resolveEmployeeDbPath();
  if (!fs.existsSync(dbPath)) {
    const err = new Error(`Employee DB not found: ${dbPath}`);
    err.statusCode = 404;
    throw err;
  }

  const rows = await sqliteJson(dbPath, `
    SELECT
      e.id AS source_employee_id,
      e.employee_code,
      e.first_name,
      e.last_name,
      e.nickname,
      COALESCE(e.full_name_raw, TRIM(e.first_name || ' ' || e.last_name)) AS full_name,
      e.status,
      e.role,
      e.branch_id AS branch_ref_id,
      b.name AS branch_name,
      e.department_id AS department_ref_id,
      d.name AS department_name,
      e.position_id AS position_ref_id,
      p.name AS position_name,
      p.level AS position_level,
      e.manager_id AS manager_source_employee_id
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    ORDER BY e.employee_code
  `);

  return rows.map((row) => {
    const role = String(row.role || '').toUpperCase();
    const positionName = String(row.position_name || '');
    const positionLevel = Number(row.position_level || 0);
    const isHead =
      ['APPROVER_L1', 'APPROVER_L2', 'APPROVER_L3', 'HR', 'ADMIN'].includes(role) ||
      positionLevel >= 3 ||
      /หัวหน้า|ผู้จัดการ|manager|lead/i.test(positionName);

    return {
      ...row,
      employee_code: String(row.employee_code || ''),
      is_head: isHead ? 1 : 0,
      is_active: ['ACTIVE', 'PROBATION'].includes(String(row.status || '').toUpperCase()) ? 1 : 0
    };
  });
};

export const syncEmployeeRefsFromLocalProject = async () => {
  await ensureEmployeeRefTable();
  const rows = await readEmployeesFromLocalProject();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const row of rows) {
      await connection.query(
        `INSERT INTO employee_refs
          (source_employee_id, employee_code, first_name, last_name, nickname, full_name, status, role,
           branch_ref_id, branch_name, department_ref_id, department_name, position_ref_id, position_name,
           position_level, manager_source_employee_id, is_head, is_active, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           employee_code = VALUES(employee_code),
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           nickname = VALUES(nickname),
           full_name = VALUES(full_name),
           status = VALUES(status),
           role = VALUES(role),
           branch_ref_id = VALUES(branch_ref_id),
           branch_name = VALUES(branch_name),
           department_ref_id = VALUES(department_ref_id),
           department_name = VALUES(department_name),
           position_ref_id = VALUES(position_ref_id),
           position_name = VALUES(position_name),
           position_level = VALUES(position_level),
           manager_source_employee_id = VALUES(manager_source_employee_id),
           is_head = VALUES(is_head),
           is_active = VALUES(is_active),
           synced_at = NOW()`,
        [
          row.source_employee_id,
          row.employee_code,
          row.first_name || null,
          row.last_name || null,
          row.nickname || null,
          row.full_name || null,
          row.status || null,
          row.role || null,
          row.branch_ref_id || null,
          row.branch_name || null,
          row.department_ref_id || null,
          row.department_name || null,
          row.position_ref_id || null,
          row.position_name || null,
          Number.isFinite(Number(row.position_level)) ? Number(row.position_level) : null,
          row.manager_source_employee_id || null,
          row.is_head,
          row.is_active
        ]
      );
    }
    await connection.commit();
    return getEmployeeRefStats();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getEmployeeRefs = async (filters = {}) => {
  await ensureEmployeeRefTable();
  let sql = `SELECT * FROM employee_refs WHERE 1=1`;
  const params = [];
  if (filters.isActive != null) {
    sql += ' AND is_active = ?';
    params.push(Number(filters.isActive));
  }
  if (filters.isHead != null) {
    sql += ' AND is_head = ?';
    params.push(Number(filters.isHead));
  }
  if (filters.role) {
    sql += ' AND role = ?';
    params.push(filters.role);
  }
  if (filters.branchName) {
    sql += ' AND branch_name = ?';
    params.push(filters.branchName);
  }
  if (filters.departmentName) {
    sql += ' AND department_name = ?';
    params.push(filters.departmentName);
  }
  if (filters.search) {
    sql += ` AND (employee_code LIKE ? OR full_name LIKE ? OR nickname LIKE ? OR first_name LIKE ? OR last_name LIKE ?)`;
    const q = `%${filters.search}%`;
    params.push(q, q, q, q, q);
  }
  sql += ' ORDER BY is_active DESC, is_head DESC, branch_name, department_name, employee_code';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Math.min(Math.max(Number(filters.limit) || 100, 1), 1000));
  }
  const [rows] = await pool.query(sql, params);
  return rows;
};

export const findActiveHeadEmployeeRef = async ({ sourceEmployeeId, employeeCode } = {}) => {
  await ensureEmployeeRefTable();
  const conditions = [];
  const params = [];

  if (sourceEmployeeId != null && String(sourceEmployeeId).trim()) {
    conditions.push('source_employee_id = ?');
    params.push(String(sourceEmployeeId));
  }
  if (employeeCode != null && String(employeeCode).trim()) {
    conditions.push('employee_code = ?');
    params.push(String(employeeCode));
  }

  if (conditions.length === 0) return null;

  const [rows] = await pool.query(
    `SELECT *
     FROM employee_refs
     WHERE is_active = 1
       AND is_head = 1
       AND (${conditions.join(' OR ')})
     LIMIT 1`,
    params
  );
  return rows[0] || null;
};

export const getEmployeeRefStats = async () => {
  await ensureEmployeeRefTable();
  const [[summary]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN is_head = 1 AND is_active = 1 THEN 1 ELSE 0 END) AS active_head_count,
      MAX(synced_at) AS last_synced_at
    FROM employee_refs
  `);
  const [byRole] = await pool.query(`
    SELECT role, COUNT(*) AS count
    FROM employee_refs
    WHERE is_active = 1
    GROUP BY role
    ORDER BY count DESC, role
  `);
  return { ...summary, byRole };
};
