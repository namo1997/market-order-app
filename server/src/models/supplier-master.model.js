import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';
import {
  httpError,
  optionalPhone,
  optionalText,
  requireText,
  toDuplicateError
} from '../utils/master-data-validation.js';

const SUPPLIER_MASTER_DUPLICATE_FIELDS = { code: 'รหัสซัพพลายเออร์' };

// Validates lengths (supplier_masters column sizes) and blank names. The phone format is only
// checked when it is new/changed so legacy rows with free-text phones can still be edited.
const normalizeSupplierMasterText = (data = {}, previousPhone = undefined) => {
  const phoneText = optionalText(data.phone, 'เบอร์โทร', 50);
  const phoneChanged = previousPhone === undefined || (phoneText || null) !== (previousPhone || null);
  return {
    name: requireText(data.name, 'ชื่อซัพพลายเออร์', 255),
    code: optionalText(data.code, 'รหัสซัพพลายเออร์', 50),
    contact_person: optionalText(data.contact_person, 'ชื่อผู้ติดต่อ', 255),
    phone: phoneChanged ? optionalPhone(data.phone, 'เบอร์โทร', 50) : phoneText,
    address: optionalText(data.address, 'ที่อยู่', 5000),
    line_id: optionalText(data.line_id, 'LINE ID', 100),
    bank_name: optionalText(data.bank_name, 'ธนาคาร', 255),
    account_number: optionalText(data.account_number, 'เลขบัญชี', 100),
    account_name: optionalText(data.account_name, 'ชื่อบัญชี', 255)
  };
};

let ensuredSupplierMasterTable = false;

const toBoolean = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  if (typeof value === 'number') return value === 1;
  return Boolean(value);
};

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
const SUPPORTED_BANK_ACCOUNT_RULES = new Map([
  ['กสิกรไทย (KBank)', '10'],
  ['ไทยพาณิชย์ (SCB)', '10'],
  ['กรุงไทย (Krungthai)', '10'],
  ['กรุงเทพ (Bangkok Bank)', '10'],
  ['กรุงศรีอยุธยา (Krungsri)', '10'],
  ['ทหารไทยธนชาต (ttb)', '10'],
  ['ออมสิน (GSB)', '10-12'],
  ['ธ.ก.ส. (BAAC)', '10-12'],
  ['ยูโอบี (UOB)', '10'],
  ['ซีไอเอ็มบี ไทย (CIMB Thai)', '10'],
  ['เกียรตินาคินภัทร (KKP)', '10'],
  ['แลนด์ แอนด์ เฮ้าส์ (LH Bank)', '10'],
  ['ไอซีบีซี ไทย (ICBC)', '10']
]);

const validateBankAccountPayload = ({
  hasBankAccount,
  bankName,
  accountNumber,
  accountName
}) => {
  if (!hasBankAccount) return;

  if (!String(bankName || '').trim()) {
    const error = new Error('bank_name is required when has_bank_account is true');
    error.statusCode = 400;
    throw error;
  }
  if (!SUPPORTED_BANK_ACCOUNT_RULES.has(String(bankName).trim())) {
    const error = new Error('bank_name is not supported');
    error.statusCode = 400;
    throw error;
  }
  if (!String(accountName || '').trim()) {
    const error = new Error('account_name is required when has_bank_account is true');
    error.statusCode = 400;
    throw error;
  }

  const digits = normalizeDigits(accountNumber);
  if (!digits) {
    const error = new Error('account_number is required when has_bank_account is true');
    error.statusCode = 400;
    throw error;
  }
  const bankRule = SUPPORTED_BANK_ACCOUNT_RULES.get(String(bankName).trim()) || '10-12';
  const isValidLength =
    bankRule === '10'
      ? digits.length === 10
      : digits.length >= 10 && digits.length <= 12;
  if (!isValidLength) {
    const error = new Error(
      bankRule === '10'
        ? 'account_number must be 10 digits'
        : 'account_number must be 10-12 digits'
    );
    error.statusCode = 400;
    throw error;
  }
};

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
      has_bank_account BOOLEAN NOT NULL DEFAULT false,
      bank_name VARCHAR(255) NULL,
      account_number VARCHAR(100) NULL,
      account_name VARCHAR(255) NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [hasBankAccountColumn] = await pool.query(
    "SHOW COLUMNS FROM supplier_masters LIKE 'has_bank_account'"
  );
  if (hasBankAccountColumn.length === 0) {
    await pool.query(
      "ALTER TABLE supplier_masters ADD COLUMN has_bank_account BOOLEAN NOT NULL DEFAULT false AFTER line_id"
    );
  }

  const [bankNameColumn] = await pool.query(
    "SHOW COLUMNS FROM supplier_masters LIKE 'bank_name'"
  );
  if (bankNameColumn.length === 0) {
    await pool.query(
      "ALTER TABLE supplier_masters ADD COLUMN bank_name VARCHAR(255) NULL AFTER line_id"
    );
  }

  const [accountNumberColumn] = await pool.query(
    "SHOW COLUMNS FROM supplier_masters LIKE 'account_number'"
  );
  if (accountNumberColumn.length === 0) {
    await pool.query(
      "ALTER TABLE supplier_masters ADD COLUMN account_number VARCHAR(100) NULL AFTER bank_name"
    );
  }

  const [accountNameColumn] = await pool.query(
    "SHOW COLUMNS FROM supplier_masters LIKE 'account_name'"
  );
  if (accountNameColumn.length === 0) {
    await pool.query(
      "ALTER TABLE supplier_masters ADD COLUMN account_name VARCHAR(255) NULL AFTER account_number"
    );
  }

  ensuredSupplierMasterTable = true;
};

export const getAllSupplierMasters = async () => {
  await ensureSupplierMasterTable();
  const [rows] = await pool.query(
    `SELECT id, name, code, contact_person, phone, address, line_id, has_bank_account, bank_name, account_number, account_name, is_active
     FROM supplier_masters
     WHERE is_active = true
     ORDER BY name`
  );
  return rows;
};

export const createSupplierMaster = async (data) => {
  await ensureSupplierMasterTable();
  const { has_bank_account } = data;
  const {
    name,
    code,
    contact_person,
    phone,
    address,
    line_id,
    bank_name,
    account_number,
    account_name
  } = normalizeSupplierMasterText(data);
  const hasBankAccount = toBoolean(has_bank_account);
  validateBankAccountPayload({
    hasBankAccount,
    bankName: bank_name,
    accountNumber: account_number,
    accountName: account_name
  });
  const normalizedAccountNumber = normalizeDigits(account_number);

  const normalizedCode = String(code || '').trim();
  const finalCode = normalizedCode || await generateNextCode({
    table: 'supplier_masters',
    prefix: 'SUP',
    codeField: 'code'
  });

  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO supplier_masters
        (name, code, contact_person, phone, address, line_id, has_bank_account, bank_name, account_number, account_name, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
      [
        name,
        finalCode,
        contact_person || null,
        phone || null,
        address || null,
        line_id || null,
        hasBankAccount,
        hasBankAccount ? bank_name || null : null,
        hasBankAccount ? normalizedAccountNumber || null : null,
        hasBankAccount ? account_name || null : null
      ]
    );
  } catch (error) {
    throw toDuplicateError(error, SUPPLIER_MASTER_DUPLICATE_FIELDS);
  }

  return {
    id: result.insertId,
    name,
    code: finalCode,
    contact_person: contact_person || null,
    phone: phone || null,
    address: address || null,
    line_id: line_id || null,
    has_bank_account: hasBankAccount,
    bank_name: hasBankAccount ? bank_name || null : null,
    account_number: hasBankAccount ? normalizedAccountNumber || null : null,
    account_name: hasBankAccount ? account_name || null : null,
    is_active: true
  };
};

export const updateSupplierMaster = async (id, data) => {
  await ensureSupplierMasterTable();
  const [currentRows] = await pool.query(
    'SELECT id, code, phone FROM supplier_masters WHERE id = ?',
    [id]
  );
  if (!currentRows[0]) {
    throw httpError('ไม่พบซัพพลายเออร์', 404);
  }
  const { has_bank_account } = data;
  const {
    name,
    code,
    contact_person,
    phone,
    address,
    line_id,
    bank_name,
    account_number,
    account_name
  } = normalizeSupplierMasterText(data, currentRows[0].phone);
  const hasBankAccount = toBoolean(has_bank_account);
  validateBankAccountPayload({
    hasBankAccount,
    bankName: bank_name,
    accountNumber: account_number,
    accountName: account_name
  });
  const normalizedAccountNumber = normalizeDigits(account_number);

  const finalCode = code || currentRows[0].code;

  try {
    await pool.query(
      `UPDATE supplier_masters
       SET name = ?, code = ?, contact_person = ?, phone = ?, address = ?, line_id = ?, has_bank_account = ?, bank_name = ?, account_number = ?, account_name = ?
       WHERE id = ?`,
      [
        name,
        finalCode,
        contact_person || null,
        phone || null,
        address || null,
        line_id || null,
        hasBankAccount,
        hasBankAccount ? bank_name || null : null,
        hasBankAccount ? normalizedAccountNumber || null : null,
        hasBankAccount ? account_name || null : null,
        id
      ]
    );
  } catch (error) {
    throw toDuplicateError(error, SUPPLIER_MASTER_DUPLICATE_FIELDS);
  }

  return {
    id,
    name,
    code: finalCode,
    contact_person: contact_person || null,
    phone: phone || null,
    address: address || null,
    line_id: line_id || null,
    has_bank_account: hasBankAccount,
    bank_name: hasBankAccount ? bank_name || null : null,
    account_number: hasBankAccount ? normalizedAccountNumber || null : null,
    account_name: hasBankAccount ? account_name || null : null
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
