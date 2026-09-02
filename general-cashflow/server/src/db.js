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
        morning_change_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        non_cash_expected DECIMAL(14,2) NOT NULL DEFAULT 0,
        bill_count INT NOT NULL DEFAULT 0,
        clickhouse_synced_at DATETIME NULL,
        submitted_by INT NULL,
        submitted_at DATETIME NULL,
        checked_by INT NULL,
        checked_at DATETIME NULL,
        closed_by INT NULL,
        closed_at DATETIME NULL,
        closed_reconciliation_snapshot JSON NULL,
        table_check_acknowledged_at DATETIME NULL,
        table_check_acknowledged_by INT NULL,
        table_check_status VARCHAR(40) NULL,
        table_check_note TEXT NULL,
        open_table_count INT NOT NULL DEFAULT 0,
        open_table_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        cashier_variance_acknowledged_at DATETIME NULL,
        cashier_variance_acknowledged_by INT NULL,
        cashier_variance_acknowledged_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        correction_note TEXT NULL,
        review_note TEXT NULL,
        review_note_updated_at DATETIME NULL,
        review_note_updated_by INT NULL,
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

    await ensureColumn(
      connection,
      'daily_receipts',
      'closed_reconciliation_snapshot',
      'closed_reconciliation_snapshot JSON NULL AFTER closed_at'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'morning_change_amount',
      'morning_change_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER cash_expected'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'table_check_acknowledged_at',
      'table_check_acknowledged_at DATETIME NULL AFTER closed_at'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'table_check_acknowledged_by',
      'table_check_acknowledged_by INT NULL AFTER table_check_acknowledged_at'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'table_check_status',
      'table_check_status VARCHAR(40) NULL AFTER table_check_acknowledged_by'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'table_check_note',
      'table_check_note TEXT NULL AFTER table_check_status'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'open_table_count',
      'open_table_count INT NOT NULL DEFAULT 0 AFTER table_check_note'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'open_table_amount',
      'open_table_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER open_table_count'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'cashier_variance_acknowledged_at',
      'cashier_variance_acknowledged_at DATETIME NULL AFTER open_table_amount'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'cashier_variance_acknowledged_by',
      'cashier_variance_acknowledged_by INT NULL AFTER cashier_variance_acknowledged_at'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'cashier_variance_acknowledged_amount',
      'cashier_variance_acknowledged_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER cashier_variance_acknowledged_by'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'review_note',
      'review_note TEXT NULL AFTER correction_note'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'review_note_updated_at',
      'review_note_updated_at DATETIME NULL AFTER review_note'
    );
    await ensureColumn(
      connection,
      'daily_receipts',
      'review_note_updated_by',
      'review_note_updated_by INT NULL AFTER review_note_updated_at'
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS daily_receipt_lines (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        payment_channel_id INT NOT NULL,
        expected_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        cashier_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        statement_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        reconciliation_adjustment_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
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

    await ensureColumn(
      connection,
      'daily_receipt_lines',
      'reconciliation_adjustment_amount',
      'reconciliation_adjustment_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER statement_amount'
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receiving_accounts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        branch_id INT NULL,
        label VARCHAR(160) NOT NULL,
        bank_name VARCHAR(160) NULL,
        account_number VARCHAR(120) NULL,
        account_name VARCHAR(160) NULL,
        account_alias VARCHAR(160) NULL,
        account_type VARCHAR(80) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_receiving_account_number (account_number),
        INDEX idx_receiving_accounts_branch (branch_id),
        INDEX idx_receiving_accounts_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn(
      connection,
      'receiving_accounts',
      'branch_id',
      'branch_id INT NULL AFTER id'
    );
    await ensureColumn(
      connection,
      'receiving_accounts',
      'account_name',
      'account_name VARCHAR(160) NULL AFTER account_number'
    );
    await ensureColumn(
      connection,
      'receiving_accounts',
      'account_alias',
      'account_alias VARCHAR(160) NULL AFTER account_name'
    );
    await ensureColumn(
      connection,
      'receiving_accounts',
      'account_type',
      'account_type VARCHAR(80) NULL AFTER account_alias'
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receiving_account_channels (
        receiving_account_id INT NOT NULL,
        payment_channel_id INT NOT NULL,
        PRIMARY KEY (receiving_account_id, payment_channel_id),
        CONSTRAINT fk_receiving_account_channel_account
          FOREIGN KEY (receiving_account_id) REFERENCES receiving_accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_receiving_account_channel_payment
          FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receiving_account_channel_branches (
        receiving_account_id INT NOT NULL,
        payment_channel_id INT NOT NULL,
        branch_id INT NOT NULL,
        PRIMARY KEY (receiving_account_id, payment_channel_id, branch_id),
        CONSTRAINT fk_account_channel_branch_account
          FOREIGN KEY (receiving_account_id) REFERENCES receiving_accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_account_channel_branch_payment
          FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id) ON DELETE CASCADE,
        CONSTRAINT fk_account_channel_branch_branch
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS branch_grab_stores (
        branch_id INT PRIMARY KEY,
        grab_merchant_id VARCHAR(120) NULL,
        grab_store_id VARCHAR(120) NOT NULL UNIQUE,
        grab_store_name VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_branch_grab_store_branch
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receipt_line_reconciliations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_line_id INT NOT NULL UNIQUE,
        receiving_account_id INT NULL,
        expected_gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        expected_net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        matched_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        settlement_date DATE NULL,
        settlement_status ENUM('PENDING_EVIDENCE','READY_FOR_STATEMENT','MATCHED_AUTO','MATCHED_MANUAL','EXCEPTION') NOT NULL DEFAULT 'READY_FOR_STATEMENT',
        exception_category ENUM('PENDING_SETTLEMENT','REFUND','UNRELATED','OTHER') NULL,
        exception_note TEXT NULL,
        evidence_attachment_id INT NULL,
        manual_checked_without_reference BOOLEAN NOT NULL DEFAULT FALSE,
        manual_checked_at DATETIME NULL,
        manual_checked_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_reconciliation_line FOREIGN KEY (receipt_line_id) REFERENCES daily_receipt_lines(id) ON DELETE CASCADE,
        CONSTRAINT fk_reconciliation_account FOREIGN KEY (receiving_account_id) REFERENCES receiving_accounts(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'manual_checked_without_reference',
      'manual_checked_without_reference BOOLEAN NOT NULL DEFAULT FALSE AFTER evidence_attachment_id'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'manual_checked_at',
      'manual_checked_at DATETIME NULL AFTER manual_checked_without_reference'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'manual_checked_by',
      'manual_checked_by INT NULL AFTER manual_checked_at'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_source',
      "settlement_source VARCHAR(32) NOT NULL DEFAULT 'NONE' AFTER settlement_status"
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'cashier_reference_variance_amount',
      'cashier_reference_variance_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER settlement_source'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_variance_amount',
      'settlement_variance_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER cashier_reference_variance_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_key',
      'settlement_batch_key VARCHAR(120) NULL AFTER settlement_variance_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_start_date',
      'settlement_batch_start_date DATE NULL AFTER settlement_batch_key'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_end_date',
      'settlement_batch_end_date DATE NULL AFTER settlement_batch_start_date'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_gross_amount',
      'settlement_batch_gross_amount DECIMAL(14,2) NULL AFTER settlement_batch_end_date'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_fee_amount',
      'settlement_batch_fee_amount DECIMAL(14,2) NULL AFTER settlement_batch_gross_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_net_amount',
      'settlement_batch_net_amount DECIMAL(14,2) NULL AFTER settlement_batch_fee_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_variance_amount',
      'settlement_batch_variance_amount DECIMAL(14,2) NULL AFTER settlement_batch_net_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_allocated_fee_amount',
      'settlement_batch_allocated_fee_amount DECIMAL(14,2) NULL AFTER settlement_batch_variance_amount'
    );
    await ensureColumn(
      connection,
      'receipt_line_reconciliations',
      'settlement_batch_allocated_net_amount',
      'settlement_batch_allocated_net_amount DECIMAL(14,2) NULL AFTER settlement_batch_allocated_fee_amount'
    );
    await connection.query(`
      UPDATE receipt_line_reconciliations rlr
      JOIN daily_receipt_lines drl ON drl.id = rlr.receipt_line_id
      JOIN payment_channels pc ON pc.id = drl.payment_channel_id
      SET rlr.settlement_source = CASE
        WHEN pc.code = 'GRAB' AND rlr.evidence_attachment_id IS NOT NULL THEN 'GRAB_REPORT'
        WHEN rlr.evidence_attachment_id IS NOT NULL
          AND (rlr.expected_gross_amount <> 0 OR rlr.expected_net_amount <> 0 OR rlr.fee_amount <> 0)
          THEN 'LEGACY_EVIDENCE'
        WHEN rlr.evidence_attachment_id IS NOT NULL THEN 'BANK_STATEMENT'
        WHEN rlr.receiving_account_id IS NOT NULL
          AND (rlr.expected_gross_amount <> 0 OR rlr.expected_net_amount <> 0 OR rlr.fee_amount <> 0)
          THEN 'MANUAL'
        ELSE 'NONE'
      END
      WHERE rlr.settlement_source = 'NONE'
    `);
    await connection.query(`
      UPDATE receipt_line_reconciliations rlr
      JOIN daily_receipt_lines drl ON drl.id = rlr.receipt_line_id
      SET rlr.cashier_reference_variance_amount = CASE
            WHEN rlr.settlement_source IN ('BANK_SETTLEMENT','GRAB_REPORT','LEGACY_EVIDENCE','MANUAL')
              AND rlr.expected_gross_amount > 0
              THEN ROUND(drl.cashier_amount - rlr.expected_gross_amount, 2)
            ELSE 0
          END,
          rlr.settlement_variance_amount = ROUND(
            drl.statement_amount - CASE
              WHEN rlr.settlement_source IN ('BANK_SETTLEMENT','BANK_STATEMENT','GRAB_REPORT','LEGACY_EVIDENCE','MANUAL')
                AND (rlr.expected_net_amount > 0 OR rlr.expected_gross_amount > 0)
                THEN rlr.expected_net_amount
              ELSE GREATEST(drl.cashier_amount - rlr.fee_amount, 0)
            END,
            2
          )
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

    await ensureColumn(
      connection,
      'statement_imports',
      'receiving_account_id',
      'receiving_account_id INT NULL AFTER payment_channel_id'
    );

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

    await ensureColumn(
      connection,
      'statement_transactions',
      'receipt_line_id',
      'receipt_line_id INT NULL AFTER receipt_id'
    );
    await ensureColumn(
      connection,
      'statement_transactions',
      'receiving_account_id',
      'receiving_account_id INT NULL AFTER receipt_line_id'
    );
    await ensureColumn(
      connection,
      'statement_transactions',
      'match_status',
      "match_status VARCHAR(32) NOT NULL DEFAULT 'unmatched' AFTER payment_channel_id"
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS bank_inbox_imports (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        provider VARCHAR(80) NOT NULL,
        source_message_id VARCHAR(160) NOT NULL,
        source_date DATE NULL,
        sender_email VARCHAR(255) NULL,
        subject VARCHAR(500) NULL,
        original_name VARCHAR(255) NOT NULL,
        stored_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(160) NULL,
        archive_checksum CHAR(64) NOT NULL,
        file_data MEDIUMBLOB NULL,
        status ENUM('PENDING_REVIEW','FAILED') NOT NULL DEFAULT 'PENDING_REVIEW',
        file_count INT NOT NULL DEFAULT 0,
        transaction_count INT NOT NULL DEFAULT 0,
        total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bank_inbox_message (provider, source_message_id),
        UNIQUE KEY uq_bank_inbox_checksum (provider, archive_checksum),
        INDEX idx_bank_inbox_status (status),
        INDEX idx_bank_inbox_source_date (source_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await exec(connection,
      "ALTER TABLE bank_inbox_imports MODIFY status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW'"
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS bank_inbox_transactions (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        inbox_import_id BIGINT NOT NULL,
        source_file_name VARCHAR(255) NOT NULL,
        transaction_date DATE NULL,
        description TEXT NULL,
        reference_no VARCHAR(255) NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        unique_hash CHAR(64) NOT NULL,
        raw_payload JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bank_inbox_transaction (inbox_import_id, unique_hash),
        INDEX idx_bank_inbox_transaction_date (transaction_date),
        CONSTRAINT fk_bank_inbox_transaction_import
          FOREIGN KEY (inbox_import_id) REFERENCES bank_inbox_imports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      connection,
      'bank_inbox_transactions',
      'receipt_line_id',
      'receipt_line_id INT NULL AFTER inbox_import_id'
    );
    await ensureColumn(
      connection,
      'bank_inbox_transactions',
      'auto_match_status',
      "auto_match_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' AFTER receipt_line_id"
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS bank_merchant_mappings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        provider VARCHAR(80) NOT NULL,
        merchant_id VARCHAR(160) NOT NULL,
        branch_id INT NOT NULL,
        payment_channel_id INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_primary BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE KEY uq_bank_merchant_mapping (provider, merchant_id),
        CONSTRAINT fk_bank_merchant_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_bank_merchant_channel FOREIGN KEY (payment_channel_id) REFERENCES payment_channels(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      connection,
      'bank_merchant_mappings',
      'is_primary',
      'is_primary BOOLEAN NOT NULL DEFAULT TRUE AFTER is_active'
    );

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
        document_path VARCHAR(500) NULL,
        mime_type VARCHAR(160) NULL,
        document_mime_type VARCHAR(160) NULL,
        size_bytes INT NOT NULL DEFAULT 0,
        document_size_bytes INT NULL,
        file_data MEDIUMBLOB NULL,
        document_data MEDIUMBLOB NULL,
        document_status VARCHAR(40) NOT NULL DEFAULT 'original_only',
        document_error TEXT NULL,
        uploaded_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attachments_receipt (receipt_id),
        CONSTRAINT fk_attachment_receipt FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
        CONSTRAINT fk_attachment_statement FOREIGN KEY (statement_import_id) REFERENCES statement_imports(id) ON DELETE SET NULL,
        CONSTRAINT fk_attachment_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn(
      connection,
      'attachments',
      'document_path',
      'document_path VARCHAR(500) NULL AFTER stored_path'
    );
    await ensureColumn(
      connection,
      'attachments',
      'document_mime_type',
      'document_mime_type VARCHAR(160) NULL AFTER mime_type'
    );
    await ensureColumn(
      connection,
      'attachments',
      'document_size_bytes',
      'document_size_bytes INT NULL AFTER size_bytes'
    );
    await ensureColumn(
      connection,
      'attachments',
      'file_data',
      'file_data MEDIUMBLOB NULL AFTER document_size_bytes'
    );
    await ensureColumn(
      connection,
      'attachments',
      'document_data',
      'document_data MEDIUMBLOB NULL AFTER file_data'
    );
    await ensureColumn(
      connection,
      'attachments',
      'document_status',
      "document_status VARCHAR(40) NOT NULL DEFAULT 'original_only' AFTER document_size_bytes"
    );
    await ensureColumn(
      connection,
      'attachments',
      'document_error',
      'document_error TEXT NULL AFTER document_status'
    );

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS receipt_post_close_adjustments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        receipt_id INT NOT NULL,
        receipt_line_id INT NOT NULL,
        revision INT NOT NULL,
        request_id CHAR(36) NOT NULL UNIQUE,
        channel_label VARCHAR(160) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        reason VARCHAR(1000) NOT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reconciled_total_before DECIMAL(14,2) NOT NULL,
        reconciled_total_after DECIMAL(14,2) NOT NULL,
        variance_total_before DECIMAL(14,2) NOT NULL,
        variance_total_after DECIMAL(14,2) NOT NULL,
        UNIQUE KEY uq_post_close_revision (receipt_id, revision),
        FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id),
        FOREIGN KEY (receipt_line_id) REFERENCES daily_receipt_lines(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
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

    // ผลสรุปตอนเช้าที่ agent สร้างไว้ เป็นตารางเดียวที่ agent เขียนได้
    // และไม่มีความสัมพันธ์กับเอกสารรับเงิน ลบทิ้งทั้งตารางก็ไม่กระทบยอดเงินใดๆ
    // เก็บย้อนหลังไว้เพื่อตรวจภายหลังว่าเช้าวันนั้น agent บอกอะไร
    await exec(connection, `
      CREATE TABLE IF NOT EXISTS morning_briefs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        brief_date DATE NOT NULL,
        source VARCHAR(16) NOT NULL,
        model VARCHAR(80) NULL,
        finding_count INT NOT NULL DEFAULT 0,
        shown_count INT NOT NULL DEFAULT 0,
        brief_text MEDIUMTEXT NULL,
        payload JSON NULL,
        error_message TEXT NULL,
        generated_by VARCHAR(40) NOT NULL DEFAULT 'schedule',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_morning_brief_date (brief_date),
        INDEX idx_morning_brief_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS decision_events (
        id CHAR(36) PRIMARY KEY,
        action_key VARCHAR(120) NOT NULL,
        entity_type VARCHAR(80) NULL,
        entity_id VARCHAR(120) NULL,
        actor_user_id INT NULL,
        actor_role VARCHAR(40) NULL,
        route VARCHAR(255) NULL,
        method VARCHAR(12) NULL,
        page_url VARCHAR(500) NULL,
        reason_code VARCHAR(80) NULL,
        reason_text TEXT NULL,
        context_snapshot JSON NULL,
        request_payload JSON NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'created',
        result_summary JSON NULL,
        committed_at DATETIME NULL,
        completed_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_decision_actor_created (actor_user_id, created_at),
        INDEX idx_decision_action_created (action_key, created_at),
        INDEX idx_decision_entity (entity_type, entity_id),
        CONSTRAINT fk_decision_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS shadow_predictions (
        id CHAR(36) PRIMARY KEY,
        decision_id CHAR(36) NOT NULL UNIQUE,
        run_id CHAR(36) NOT NULL UNIQUE,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        model VARCHAR(120) NULL,
        predicted_action VARCHAR(120) NULL,
        confidence DECIMAL(6,5) NULL,
        rationale TEXT NULL,
        risk_flags JSON NULL,
        comparison_status VARCHAR(32) NULL,
        usage_payload JSON NULL,
        input_snapshot JSON NULL,
        error_message TEXT NULL,
        started_at DATETIME NULL,
        completed_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_shadow_status_created (status, created_at),
        INDEX idx_shadow_comparison (comparison_status, created_at),
        CONSTRAINT fk_shadow_decision FOREIGN KEY (decision_id) REFERENCES decision_events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await exec(connection, `
      CREATE TABLE IF NOT EXISTS decision_followups (
        id CHAR(36) PRIMARY KEY,
        decision_id CHAR(36) NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        answered_by INT NULL,
        answered_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_followup_status_created (status, created_at),
        CONSTRAINT fk_followup_decision FOREIGN KEY (decision_id) REFERENCES decision_events(id) ON DELETE CASCADE,
        CONSTRAINT fk_followup_user FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      INSERT IGNORE INTO receipt_line_reconciliations
        (receipt_line_id)
      SELECT id
      FROM daily_receipt_lines
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

  const [legacyCreditRows] = await connection.query('SELECT id FROM payment_channels WHERE code = ?', ['CREDIT_CARD']);
  const [splitScbRows] = await connection.query('SELECT id FROM payment_channels WHERE code = ?', ['CREDIT_CARD_SCB']);
  if (legacyCreditRows.length > 0 && splitScbRows.length === 0) {
    await connection.query(
      `UPDATE payment_channels
       SET code = 'CREDIT_CARD_SCB',
           label = 'บัตรเครดิต SCB',
           kind = 'credit_card',
           provider = 'SCB',
           sort_order = 20,
           is_active = TRUE
       WHERE code = 'CREDIT_CARD'`
    );
  } else if (legacyCreditRows.length > 0) {
    await connection.query('UPDATE payment_channels SET is_active = FALSE WHERE code = ?', ['CREDIT_CARD']);
  }

  const channels = [
    ['CASH', 'เงินสด', 'cash', 'หน้าร้าน', 10],
    ['CREDIT_CARD_SCB', 'บัตรเครดิต SCB', 'credit_card', 'SCB', 20],
    ['CREDIT_CARD_KBANK', 'บัตรเครดิตกสิกร', 'credit_card', 'Kasikorn', 25],
    ['CREDIT_CARD_KTC', 'บัตรเครดิต KTC', 'credit_card', 'KTC', 30],
    ['QR_KPLUS', 'QR กสิกร', 'qr', 'Kasikorn', 40],
    ['PROMPTPAY', 'เข้าธนาคารไทยพาณิชย์', 'promptpay', 'SCB', 50],
    ['GRAB', 'GRAB food', 'grab', 'Grab', 60],
    ['QR_KRUNGSRI', 'QR กรุงศรี', 'qr', 'Krungsri', 90],
    ['OTHER_UNKNOWN', 'จ่ายหน้าร้าน', 'other', 'Unknown', 999]
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
    ['QR_KPLUS', 'K SHOP'],
    ['QR_KPLUS', 'MYQR'],
    ['QR_KPLUS', 'Thai QR Payment'],
    ['GRAB', 'GRAB'],
    ['GRAB', 'X3812'],
    ['GRAB', 'บจก. แกร็บแท็กซี่'],
    ['CREDIT_CARD_SCB', 'CREDITCARD'],
    ['CREDIT_CARD_SCB', 'CREDITCARD SCB'],
    ['CREDIT_CARD_SCB', 'SCB CREDITCARD'],
    ['CREDIT_CARD_SCB', 'SCB CREDIT CARD'],
    ['CREDIT_CARD_SCB', 'SCB'],
    ['CREDIT_CARD_SCB', 'CREDIT CARD DIVISION(EDC)'],
    ['CREDIT_CARD_KTC', 'CREDITCARD KTC'],
    ['CREDIT_CARD_KTC', 'KTC CREDITCARD'],
    ['CREDIT_CARD_KTC', 'KTC CREDIT CARD'],
    ['CREDIT_CARD_KTC', 'KTC'],
    ['PROMPTPAY', 'SML - พร้อมเพย์'],
    ['PROMPTPAY', 'PromptPay'],
    ['PROMPTPAY', 'SCB PromptPay']
  ];
  for (const [code, description] of mappings) {
    await connection.query(
      `INSERT INTO payment_channel_mappings (payment_channel_id, clickhouse_description)
       SELECT id, ? FROM payment_channels WHERE code = ?
       ON DUPLICATE KEY UPDATE payment_channel_id = VALUES(payment_channel_id)`,
      [description, code]
    );
  }

  // San Kamphaeng has only a Kasikorn card terminal. Historical cashier values
  // were entered under SCB or KTC before the correct channel existed.
  await connection.query(
    `INSERT IGNORE INTO daily_receipt_lines (receipt_id, payment_channel_id)
     SELECT dr.id, pc.id
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id AND b.code = 'SK'
     JOIN payment_channels pc ON pc.code = 'CREDIT_CARD_KBANK'`
  );
  await connection.query(
    `INSERT IGNORE INTO receipt_line_reconciliations (receipt_line_id)
     SELECT drl.id
     FROM daily_receipt_lines drl
     JOIN daily_receipts dr ON dr.id = drl.receipt_id
     JOIN branches b ON b.id = dr.branch_id AND b.code = 'SK'
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'CREDIT_CARD_KBANK'`
  );
  await connection.query(
    `INSERT INTO audit_logs
       (entity_type, entity_id, action, actor_role, before_payload, after_payload, note)
     SELECT
       'daily_receipt', dr.id, 'migrate_sankamphaeng_card_to_kasikorn', 'system',
       JSON_OBJECT(
         'SCB', SUM(CASE WHEN source_pc.code = 'CREDIT_CARD_SCB' THEN source.cashier_amount ELSE 0 END),
         'KTC', SUM(CASE WHEN source_pc.code = 'CREDIT_CARD_KTC' THEN source.cashier_amount ELSE 0 END)
       ),
       JSON_OBJECT('channel', 'CREDIT_CARD_KBANK', 'cashier_amount', SUM(source.cashier_amount)),
       'ย้ายยอดบัตรสาขาสันกำแพงไปบัตรเครดิตกสิกร'
     FROM daily_receipt_lines source
     JOIN daily_receipts dr ON dr.id = source.receipt_id
     JOIN branches b ON b.id = dr.branch_id AND b.code = 'SK'
     JOIN payment_channels source_pc
       ON source_pc.id = source.payment_channel_id
      AND source_pc.code IN ('CREDIT_CARD_SCB', 'CREDIT_CARD_KTC')
     WHERE (source.cashier_amount <> 0 OR source.statement_amount <> 0)
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs existing
         WHERE existing.entity_type = 'daily_receipt'
           AND existing.entity_id = dr.id
           AND existing.action = 'migrate_sankamphaeng_card_to_kasikorn'
       )
     GROUP BY dr.id`
  );
  for (const sourceCode of ['CREDIT_CARD_SCB', 'CREDIT_CARD_KTC']) {
    await connection.query(
      `UPDATE daily_receipt_lines source
       JOIN payment_channels source_pc
         ON source_pc.id = source.payment_channel_id AND source_pc.code = ?
       JOIN daily_receipts dr ON dr.id = source.receipt_id
       JOIN branches b ON b.id = dr.branch_id AND b.code = 'SK'
       JOIN daily_receipt_lines target ON target.receipt_id = source.receipt_id
       JOIN payment_channels target_pc
         ON target_pc.id = target.payment_channel_id AND target_pc.code = 'CREDIT_CARD_KBANK'
       SET target.cashier_amount = target.cashier_amount + source.cashier_amount,
           target.statement_amount = target.statement_amount + source.statement_amount,
           target.variance_amount = target.variance_amount + source.variance_amount,
           source.cashier_amount = 0,
           source.statement_amount = 0,
           source.variance_amount = 0,
           source.variance_reason = NULL`,
      [sourceCode]
    );
  }

  const seedReceivingAccounts = [
    {
      branchCode: 'KK',
      label: 'กสิกร คันคลอง ••••3108',
      bankName: 'Kasikornbank',
      accountNumber: '0308663108',
      accountName: 'บจก. โซลาว',
      accountAlias: 'คันคลอง',
      accountType: 'บัญชีออมทรัพย์',
      channelCodes: ['QR_KPLUS', 'GRAB']
    },
    {
      branchCode: 'SK',
      label: 'กสิกร สันกำแพง ••••7866',
      bankName: 'Kasikornbank',
      accountNumber: '1763147866',
      accountName: 'บจก. โซลาว',
      accountAlias: 'สันกำแพง',
      accountType: 'บัญชีออมทรัพย์',
      channelCodes: ['QR_KPLUS', 'CREDIT_CARD_KBANK']
    },
    {
      branchCode: 'KK',
      label: 'ไทยพาณิชย์ คันคลอง ••••8401',
      bankName: 'Siam Commercial Bank',
      accountNumber: '4070578401',
      channelCodes: ['CREDIT_CARD_SCB', 'PROMPTPAY']
    },
    {
      branchCode: 'KK',
      label: 'กรุงไทย KTC คันคลอง ••••2439',
      bankName: 'Krungthai Bank',
      accountNumber: '4970282439',
      channelCodes: ['CREDIT_CARD_KTC']
    }
  ];
  for (const account of seedReceivingAccounts) {
    const [branchRows] = await connection.query('SELECT id FROM branches WHERE code = ?', [account.branchCode]);
    const branchId = branchRows[0]?.id || null;
    const [accountRows] = await connection.query(
      'SELECT id FROM receiving_accounts WHERE account_number = ? OR label = ?',
      [account.accountNumber, account.label]
    );
    let accountId = accountRows[0]?.id;
    if (!accountId) {
      const [result] = await connection.query(
        `INSERT INTO receiving_accounts
           (branch_id, label, bank_name, account_number, account_name, account_alias, account_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          account.label,
          account.bankName,
          account.accountNumber,
          account.accountName || null,
          account.accountAlias || null,
          account.accountType || null
        ]
      );
      accountId = result.insertId;
    } else {
      await connection.query(
        `UPDATE receiving_accounts
         SET branch_id = ?, label = ?, bank_name = ?, account_number = ?,
             account_name = COALESCE(?, account_name),
             account_alias = COALESCE(?, account_alias),
             account_type = COALESCE(?, account_type),
             is_active = TRUE
         WHERE id = ?`,
        [
          branchId,
          account.label,
          account.bankName,
          account.accountNumber,
          account.accountName || null,
          account.accountAlias || null,
          account.accountType || null,
          accountId
        ]
      );
    }
    for (const removedCode of ['GRAB', 'CREDIT_CARD_SCB', 'CREDIT_CARD_KBANK', 'CREDIT_CARD_KTC']) {
      if (account.channelCodes.includes(removedCode)) continue;
      await connection.query(
        `DELETE rac FROM receiving_account_channels rac
         JOIN payment_channels pc ON pc.id = rac.payment_channel_id
         WHERE rac.receiving_account_id = ? AND pc.code = ?`,
        [accountId, removedCode]
      );
    }
    for (const code of account.channelCodes) {
      await connection.query(
        `INSERT IGNORE INTO receiving_account_channels (receiving_account_id, payment_channel_id)
         SELECT ?, id FROM payment_channels WHERE code = ?`,
        [accountId, code]
      );
    }
  }

  // Grab pays both stores into the Kanklong Kasikorn account. The report store ID
  // determines the branch; the bank account route must therefore permit both.
  for (const branchCode of ['KK', 'SK']) {
    await connection.query(
      `INSERT INTO receiving_account_channel_branches (receiving_account_id, payment_channel_id, branch_id)
       SELECT ra.id, pc.id, b.id
       FROM receiving_accounts ra
       JOIN payment_channels pc ON pc.code = 'GRAB'
       JOIN branches b ON b.code = ?
       WHERE ra.account_number = '0308663108'
       ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id)`,
      [branchCode]
    );
  }

  const grabStores = [
    ['KK', 'bea41ac5-236c-4553-92bc-bcaab40a807e', 'c30f837b-0067-41ce-9d19-767cca330e94', 'ส้มตำ Hello solao (ฮัลโหล โซลาว) - ถนนรอบเมืองเชียงใหม่'],
    ['SK', 'bea41ac5-236c-4553-92bc-bcaab40a807e', 'ff32e3d6-5cea-4517-b543-4d7db1e528c6', 'โซลาวบ้านเจ๊ - ต้นเปา (Hello Solao)']
  ];
  for (const [branchCode, merchantId, storeId, storeName] of grabStores) {
    await connection.query(
      `INSERT INTO branch_grab_stores (branch_id, grab_merchant_id, grab_store_id, grab_store_name)
       SELECT id, ?, ?, ? FROM branches WHERE code = ?
       ON DUPLICATE KEY UPDATE grab_merchant_id = VALUES(grab_merchant_id),
         grab_store_id = VALUES(grab_store_id), grab_store_name = VALUES(grab_store_name)`,
      [merchantId, storeId, storeName, branchCode]
    );
  }

  await connection.query(
    `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id)
     SELECT 'KRUNGSRIBIZ_MUNGMEE', '070000010053466', b.id, pc.id
     FROM branches b JOIN payment_channels pc ON pc.code = 'QR_KRUNGSRI'
     WHERE b.code = 'KK'
     ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE`
  );
  await connection.query(
    `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id, is_primary)
     SELECT 'KPLUSSHOP', 'KB000001590548', b.id, pc.id, TRUE
     FROM branches b JOIN payment_channels pc ON pc.code = 'QR_KPLUS'
     WHERE b.code = 'KK'
     ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE, is_primary = TRUE`
  );
  await connection.query(
    `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id, is_primary)
     SELECT 'KPLUSSHOP', 'KB000001927650', b.id, pc.id, TRUE
     FROM branches b JOIN payment_channels pc ON pc.code = 'QR_KPLUS'
     WHERE b.code = 'SK'
     ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE, is_primary = TRUE`
  );
  await connection.query(
    `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id, is_primary)
     SELECT 'KPLUSSHOP', 'KB000001995795', b.id, pc.id, FALSE
     FROM branches b JOIN payment_channels pc ON pc.code = 'QR_KPLUS'
     WHERE b.code = 'KK'
     ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE, is_primary = FALSE`
  );
  await connection.query(
    `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id, is_primary)
     SELECT 'KPLUSSHOP', 'KB000002044790', b.id, pc.id, FALSE
     FROM branches b JOIN payment_channels pc ON pc.code = 'QR_KPLUS'
     WHERE b.code = 'SK'
     ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE, is_primary = FALSE`
  );

  const [legacyKasikornRows] = await connection.query(
    'SELECT id FROM receiving_accounts WHERE account_number = ? OR label = ?',
    ['0308663108', 'กสิกร ••••3108']
  );
  let kasikornAccountId = legacyKasikornRows[0]?.id;
  if (!kasikornAccountId) {
    const [result] = await connection.query(
      `INSERT INTO receiving_accounts (label, bank_name, account_number)
       VALUES (?, ?, ?)`,
      ['กสิกร ••••3108', 'Kasikornbank', '0308663108']
    );
    kasikornAccountId = result.insertId;
  }
  await connection.query(
    `INSERT IGNORE INTO receiving_account_channels (receiving_account_id, payment_channel_id)
     SELECT ?, id FROM payment_channels WHERE code = 'QR_KPLUS'`,
    [kasikornAccountId]
  );

  await connection.query(`
    INSERT INTO daily_receipt_lines (receipt_id, payment_channel_id, expected_amount, source_description)
    SELECT dr.id, pc.id, 0, NULL
    FROM daily_receipts dr
    JOIN payment_channels pc
      ON pc.code IN ('CREDIT_CARD_SCB', 'CREDIT_CARD_KTC')
     AND pc.is_active = TRUE
    LEFT JOIN daily_receipt_lines drl
      ON drl.receipt_id = dr.id
     AND drl.payment_channel_id = pc.id
    WHERE dr.status <> 'CLOSED'
      AND drl.id IS NULL
  `);
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
