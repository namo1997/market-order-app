import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool;

const baseDbConfig = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  enableKeepAlive: true,
  dateStrings: true
};

export const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      ...baseDbConfig,
      database: config.db.database
    });
  }
  return pool;
};

const exec = async (connection, sql) => {
  await connection.query(sql);
};

const ensureColumn = async (connection, table, column, definitionSql) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].cnt === 0) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definitionSql}`);
  }
};

export const migrateDatabase = async () => {
  const bootstrap = await mysql.createConnection(baseDbConfig);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  const connection = await getPool().getConnection();
  try {
    await exec(connection, `
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(80) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(160) NOT NULL,
        role ENUM('cashier','auditor','recorder','admin') NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_role (role),
        INDEX idx_users_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS branches (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(40) NOT NULL UNIQUE,
        name VARCHAR(160) NOT NULL,
        clickhouse_branch_id VARCHAR(120) NULL UNIQUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_branches_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS payment_channels (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(50) NOT NULL UNIQUE,
        label VARCHAR(160) NOT NULL,
        kind ENUM('cash','qr','grab','credit_card','promptpay','other') NOT NULL,
        provider VARCHAR(160) NULL,
        sort_order INT NOT NULL DEFAULT 100,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_payment_channels_kind (kind),
        INDEX idx_payment_channels_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn(
      connection,
      'payment_channels',
      'account_number',
      'account_number VARCHAR(120) NULL AFTER provider'
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS payment_channel_mappings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        payment_channel_id INT NOT NULL,
        clickhouse_description VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_payment_mapping_desc (clickhouse_description),
        INDEX idx_payment_mapping_channel (payment_channel_id),
        CONSTRAINT fk_payment_mapping_channel
          FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS daily_receipts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_date DATE NOT NULL,
        branch_id INT NOT NULL,
        status ENUM('DRAFT','SUBMITTED','CHECKED_OK','CHECKED_VARIANCE','NEEDS_CORRECTION','CLOSED') NOT NULL DEFAULT 'DRAFT',
        gross_sales_expected DECIMAL(14,2) NOT NULL DEFAULT 0,
        cash_expected DECIMAL(14,2) NOT NULL DEFAULT 0,
        non_cash_expected DECIMAL(14,2) NOT NULL DEFAULT 0,
        bill_count INT NOT NULL DEFAULT 0,
        clickhouse_synced_at DATETIME NULL,
        submitted_by INT NULL,
        submitted_at DATETIME NULL,
        checked_by INT NULL,
        checked_at DATETIME NULL,
        closed_by INT NULL,
        closed_at DATETIME NULL,
        correction_note TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_receipt_day_branch (receipt_date, branch_id),
        INDEX idx_receipts_status (status),
        INDEX idx_receipts_date (receipt_date),
        CONSTRAINT fk_receipt_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_receipt_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_receipt_checked_by FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_receipt_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS daily_receipt_lines (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        payment_channel_id INT NOT NULL,
        expected_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        cashier_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        statement_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        variance_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        variance_reason TEXT NULL,
        source_description TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_receipt_channel (receipt_id, payment_channel_id),
        INDEX idx_receipt_lines_channel (payment_channel_id),
        CONSTRAINT fk_receipt_line_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_receipt_line_channel FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS statement_imports (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        payment_channel_id INT NULL,
        original_name VARCHAR(255) NOT NULL,
        stored_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(160) NULL,
        status ENUM('IMPORTED','FAILED') NOT NULL DEFAULT 'IMPORTED',
        row_count INT NOT NULL DEFAULT 0,
        duplicate_count INT NOT NULL DEFAULT 0,
        total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        imported_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_statement_import_receipt (receipt_id),
        CONSTRAINT fk_statement_import_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_statement_import_channel FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id) ON DELETE SET NULL,
        CONSTRAINT fk_statement_import_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS statement_transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        import_id INT NOT NULL,
        receipt_id INT NOT NULL,
        payment_channel_id INT NULL,
        transaction_date DATE NULL,
        description TEXT NULL,
        reference_no VARCHAR(255) NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        unique_hash CHAR(64) NOT NULL,
        raw_payload JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_statement_transaction_hash (unique_hash),
        INDEX idx_statement_transaction_receipt (receipt_id),
        INDEX idx_statement_transaction_channel (payment_channel_id),
        CONSTRAINT fk_statement_transaction_import FOREIGN KEY (import_id) REFERENCES statement_imports(id) ON DELETE CASCADE,
        CONSTRAINT fk_statement_transaction_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_statement_transaction_channel FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receipt_misc_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        label VARCHAR(160) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_receipt_misc_items_receipt (receipt_id),
        CONSTRAINT fk_receipt_misc_item_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_receipt_misc_item_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS attachments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        statement_import_id INT NULL,
        attachment_type ENUM('cashier_summary','cash_slip','statement','other') NOT NULL DEFAULT 'other',
        original_name VARCHAR(255) NOT NULL,
        stored_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(160) NULL,
        size_bytes INT NOT NULL DEFAULT 0,
        uploaded_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attachments_receipt (receipt_id),
        CONSTRAINT fk_attachment_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_attachment_statement FOREIGN KEY (statement_import_id) REFERENCES statement_imports(id) ON DELETE SET NULL,
        CONSTRAINT fk_attachment_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        entity_type VARCHAR(80) NOT NULL,
        entity_id INT NULL,
        action VARCHAR(80) NOT NULL,
        actor_user_id INT NULL,
        actor_role VARCHAR(40) NULL,
        before_payload JSON NULL,
        after_payload JSON NULL,
        note TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_entity (entity_type, entity_id),
        INDEX idx_audit_actor (actor_user_id),
        CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await seedDefaults(connection);
  } finally {
    connection.release();
  }
};

const upsertUser = async (connection, { username, password, fullName, role }) => {
  const [existing] = await connection.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length > 0) return;
  const passwordHash = await bcrypt.hash(password, 10);
  await connection.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)`,
    [username, passwordHash, fullName, role]
  );
};

const seedDefaults = async (connection) => {
  await upsertUser(connection, {
    username: config.seed.adminUsername,
    password: config.seed.adminPassword,
    fullName: 'System Admin',
    role: 'admin'
  });

  if (config.seed.demoUsers) {
    await upsertUser(connection, { username: 'cashier', password: 'cashier123', fullName: 'Cashier Demo', role: 'cashier' });
    await upsertUser(connection, { username: 'auditor', password: 'auditor123', fullName: 'Auditor Demo', role: 'auditor' });
    await upsertUser(connection, { username: 'recorder', password: 'recorder123', fullName: 'Recorder Demo', role: 'recorder' });
  }

  const branches = [
    ['KK', 'สาขาคันคลอง', '2PdQF0n9TADAVUEV2dDeqOo7D9N'],
    ['SK', 'สาขาสันกำแพง', '2PxT0SwTMlORbcER7eaIqi08v4k']
  ];
  for (const branch of branches) {
    await connection.query(
      `INSERT INTO branches (code, name, clickhouse_branch_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), clickhouse_branch_id = VALUES(clickhouse_branch_id), is_active = TRUE`,
      branch
    );
  }

  const channels = [
    ['CASH', 'เงินสด', 'cash', 'หน้าร้าน', 10],
    ['QR_KPLUS', 'QR กสิกร', 'qr', 'Kasikorn', 20],
    ['QR_KRUNGSRI', 'QR กรุงศรี', 'qr', 'Krungsri', 21],
    ['GRAB', 'GRAB', 'grab', 'Grab', 30],
    ['CREDIT_CARD', 'บัตรเครดิต', 'credit_card', 'ธนาคาร/EDC', 40],
    ['PROMPTPAY', 'พร้อมเพย์', 'promptpay', 'PromptPay', 50],
    ['OTHER_UNKNOWN', 'อื่นๆ / ยังไม่จัดหมวด', 'other', 'Unknown', 999]
  ];
  for (const channel of channels) {
    await connection.query(
      `INSERT INTO payment_channels (code, label, kind, provider, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), kind = VALUES(kind), provider = VALUES(provider), sort_order = VALUES(sort_order), is_active = TRUE`,
      channel
    );
  }

  const mappings = [
    ['QR_KPLUS', 'เคพลัสช็อป'],
    ['GRAB', 'GRAB'],
    ['CREDIT_CARD', 'CREDITCARD'],
    ['PROMPTPAY', 'SML - พร้อมเพย์']
  ];
  for (const [code, description] of mappings) {
    await connection.query(
      `INSERT IGNORE INTO payment_channel_mappings (payment_channel_id, clickhouse_description)
       SELECT id, ? FROM payment_channels WHERE code = ?`,
      [description, code]
    );
  }
};

export const logAudit = async ({ connection = getPool(), entityType, entityId, action, actor, beforePayload = null, afterPayload = null, note = null }) => {
  await connection.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, actor_user_id, actor_role, before_payload, after_payload, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId || null,
      action,
      actor?.id || null,
      actor?.role || null,
      beforePayload ? JSON.stringify(beforePayload) : null,
      afterPayload ? JSON.stringify(afterPayload) : null,
      note
    ]
  );
};

export const closePool = async () => {
  if (pool) await pool.end();
};
