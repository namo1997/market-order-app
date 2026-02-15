import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

let ensuredSupplierMasterTable = false;

export const ensureSupplierMasterTable = async () => {
  if (ensuredSupplierMasterTable) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_masters (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      contact_person VARCHAR(255) NULL,
      phone VARCHAR(50) NULL,
      address TEXT NULL,
      line_id VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  ensuredSupplierMasterTable = true;
};

export const getAllSupplierMasters = async () => {
  await ensureSupplierMasterTable();
  const [rows] = await pool.query(
    `SELECT id, name, code, contact_person, phone, address, line_id, is_active
     FROM supplier_masters
     WHERE is_active = true
     ORDER BY name`
  );
  return rows;
};

export const createSupplierMaster = async (data) => {
  await ensureSupplierMasterTable();
  const {
    name,
    code,
    contact_person,
    phone,
    address,
    line_id
  } = data;

  const normalizedCode = String(code || '').trim();
  const finalCode = normalizedCode || await generateNextCode({
    table: 'supplier_masters',
    prefix: 'SUP',
    codeField: 'code'
  });

  const [result] = await pool.query(
    `INSERT INTO supplier_masters
      (name, code, contact_person, phone, address, line_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [name, finalCode, contact_person || null, phone || null, address || null, line_id || null]
  );

  return {
    id: result.insertId,
    name,
    code: finalCode,
    contact_person: contact_person || null,
    phone: phone || null,
    address: address || null,
    line_id: line_id || null,
    is_active: true
  };
};

export const updateSupplierMaster = async (id, data) => {
  await ensureSupplierMasterTable();
  const {
    name,
    code,
    contact_person,
    phone,
    address,
    line_id
  } = data;

  let finalCode = String(code ?? '').trim();
  if (!finalCode) {
    const [rows] = await pool.query(
      'SELECT code FROM supplier_masters WHERE id = ?',
      [id]
    );
    finalCode = rows?.[0]?.code;
  }

  await pool.query(
    `UPDATE supplier_masters
     SET name = ?, code = ?, contact_person = ?, phone = ?, address = ?, line_id = ?
     WHERE id = ?`,
    [name, finalCode, contact_person || null, phone || null, address || null, line_id || null, id]
  );

  return {
    id,
    name,
    code: finalCode,
    contact_person: contact_person || null,
    phone: phone || null,
    address: address || null,
    line_id: line_id || null
  };
};

export const deleteSupplierMaster = async (id) => {
  await ensureSupplierMasterTable();
  await pool.query(
    'UPDATE supplier_masters SET is_active = false WHERE id = ?',
    [id]
  );
  return { id };
};
