import pool from '../config/database.js';

export const RECEIVING_DOCUMENT_TABLES_DDL = {
  receiving_documents: `
    CREATE TABLE IF NOT EXISTS receiving_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_uuid VARCHAR(100) NOT NULL,
      status ENUM('draft', 'confirmed', 'void') NOT NULL DEFAULT 'draft',
      kind ENUM('bill', 'manual_receipt') NOT NULL DEFAULT 'bill',
      branch_id INT NOT NULL,
      department_id INT NOT NULL,
      supplier_master_id INT NULL,
      product_group_id INT NULL,
      supplier_name_text VARCHAR(255) NOT NULL DEFAULT '',
      delivery_date DATE NOT NULL,
      doc_ref VARCHAR(100) NULL,
      doc_date DATE NULL,
      subtotal DECIMAL(12,2) NULL,
      discount DECIMAL(12,2) NULL,
      vat DECIMAL(12,2) NULL,
      total DECIMAL(12,2) NULL,
      is_header_edited BOOLEAN NOT NULL DEFAULT false,
      ocr_status ENUM('none', 'pending', 'done', 'failed') NOT NULL DEFAULT 'none',
      ocr_model VARCHAR(100) NULL,
      ocr_confidence DECIMAL(5,4) NULL,
      ocr_warnings_json TEXT NULL,
      warnings_json TEXT NULL,
      lbc_capture_id VARCHAR(100) NULL,
      receiver_user_id INT NOT NULL,
      receiver_name VARCHAR(255) NOT NULL DEFAULT '',
      receiver_signature MEDIUMBLOB NULL,
      receiver_signature_mime VARCHAR(50) NULL,
      courier_name VARCHAR(255) NULL,
      courier_signature MEDIUMBLOB NULL,
      courier_signature_mime VARCHAR(50) NULL,
      confirmed_at TIMESTAMP NULL,
      confirmed_by_user_id INT NULL,
      voided_at TIMESTAMP NULL,
      voided_by_user_id INT NULL,
      void_reason TEXT NULL,
      audit_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_receiving_documents_client_uuid (client_uuid),
      INDEX idx_receiving_documents_scope_date (branch_id, department_id, delivery_date),
      INDEX idx_receiving_documents_status (status),
      INDEX idx_receiving_documents_supplier_master (supplier_master_id),
      INDEX idx_receiving_documents_product_group (product_group_id),
      INDEX idx_receiving_documents_dup_check (supplier_master_id, product_group_id, doc_ref, total)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  receiving_document_lines: `
    CREATE TABLE IF NOT EXISTS receiving_document_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      line_no INT NOT NULL,
      bill_text VARCHAR(500) NOT NULL DEFAULT '',
      product_id INT NULL,
      product_name VARCHAR(255) NULL,
      order_item_id INT NULL,
      unit VARCHAR(100) NULL,
      unit_text VARCHAR(100) NULL,
      unit_id INT NULL,
      unit_multiplier DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
      quantity_billed DECIMAL(12,3) NULL,
      quantity_received DECIMAL(12,3) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NULL,
      base_unit_price DECIMAL(12,6) NULL,
      amount DECIMAL(12,2) NULL,
      match_source ENUM('alias', 'order', 'manual', 'none') NOT NULL DEFAULT 'none',
      match_confidence DECIMAL(5,4) NULL,
      is_user_edited BOOLEAN NOT NULL DEFAULT false,
      note TEXT NULL,
      prev_order_received_quantity DECIMAL(12,3) NULL,
      prev_order_actual_price DECIMAL(12,6) NULL,
      prev_order_is_received BOOLEAN NULL,
      prev_order_received_by_user_id INT NULL,
      prev_order_received_at TIMESTAMP NULL,
      applied_order_received_quantity DECIMAL(12,3) NULL,
      applied_order_actual_price DECIMAL(12,6) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_receiving_lines_document (document_id, line_no),
      INDEX idx_receiving_lines_product (product_id),
      INDEX idx_receiving_lines_order_item (order_item_id),
      CONSTRAINT fk_receiving_lines_document
        FOREIGN KEY (document_id) REFERENCES receiving_documents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  receiving_document_images: `
    CREATE TABLE IF NOT EXISTS receiving_document_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      page_no INT NOT NULL,
      mime_type VARCHAR(50) NOT NULL,
      width INT NULL,
      height INT NULL,
      size_bytes INT UNSIGNED NOT NULL,
      sha256 CHAR(64) NOT NULL,
      image_data MEDIUMBLOB NOT NULL,
      storage_path VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_receiving_images_doc_page (document_id, page_no),
      INDEX idx_receiving_images_sha256 (sha256),
      CONSTRAINT fk_receiving_images_document
        FOREIGN KEY (document_id) REFERENCES receiving_documents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  supplier_product_aliases: `
    CREATE TABLE IF NOT EXISTS supplier_product_aliases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_key VARCHAR(120) NOT NULL,
      supplier_master_id INT NULL,
      product_group_id INT NULL,
      supplier_name_text VARCHAR(255) NULL,
      bill_text VARCHAR(255) NOT NULL,
      normalized_bill_text VARCHAR(255) NOT NULL,
      unit_text VARCHAR(100) NOT NULL DEFAULT '',
      normalized_unit_text VARCHAR(100) NOT NULL DEFAULT '',
      product_id INT NOT NULL,
      unit_id INT NULL,
      unit_multiplier DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
      last_unit_price DECIMAL(12,2) NULL,
      confirm_count INT UNSIGNED NOT NULL DEFAULT 1,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_supplier_product_alias (supplier_key, normalized_bill_text, normalized_unit_text),
      INDEX idx_supplier_alias_lookup (normalized_bill_text),
      INDEX idx_supplier_alias_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  receiving_document_audits: `
    CREATE TABLE IF NOT EXISTS receiving_document_audits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      action VARCHAR(50) NOT NULL,
      actor_user_id INT NULL,
      actor_name VARCHAR(255) NULL,
      details_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_receiving_audits_document (document_id, created_at),
      CONSTRAINT fk_receiving_audits_document
        FOREIGN KEY (document_id) REFERENCES receiving_documents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `
};

const ADDITIVE_COLUMNS_CHECKS = [
  {
    table: 'order_items',
    column: 'actual_price',
    definition: 'DECIMAL(12,6) NULL'
  },
  {
    table: 'receiving_documents',
    column: 'discount',
    definition: 'DECIMAL(12,2) NULL AFTER subtotal'
  },
  {
    table: 'receiving_documents',
    column: 'is_header_edited',
    definition: 'BOOLEAN NOT NULL DEFAULT false AFTER total'
  },
  {
    table: 'receiving_documents',
    column: 'lbc_capture_id',
    definition: 'VARCHAR(100) NULL AFTER warnings_json'
  },
  {
    table: 'receiving_document_lines',
    column: 'unit_multiplier',
    definition: 'DECIMAL(12,4) NOT NULL DEFAULT 1.0000 AFTER unit_id'
  },
  {
    table: 'receiving_document_lines',
    column: 'base_unit_price',
    definition: 'DECIMAL(12,6) NULL AFTER unit_price'
  },
  {
    table: 'receiving_document_lines',
    column: 'is_user_edited',
    definition: 'BOOLEAN NOT NULL DEFAULT false AFTER match_confidence'
  },
  {
    table: 'receiving_document_lines',
    column: 'note',
    definition: 'TEXT NULL AFTER is_user_edited'
  },
  {
    table: 'receiving_document_lines',
    column: 'applied_order_received_quantity',
    definition: 'DECIMAL(12,3) NULL AFTER prev_order_received_at'
  },
  {
    table: 'receiving_document_lines',
    column: 'applied_order_actual_price',
    definition: 'DECIMAL(12,6) NULL AFTER applied_order_received_quantity'
  }
];

const PRECISION_UPGRADE_CHECKS = [
  {
    table: 'order_items',
    column: 'received_quantity',
    targetType: 'decimal(12,3)',
    alterSql: 'ALTER TABLE order_items MODIFY COLUMN received_quantity DECIMAL(12,3) NULL'
  },
  {
    table: 'inventory_balance',
    column: 'quantity',
    targetType: 'decimal(12,3)',
    alterSql: 'ALTER TABLE inventory_balance MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 0'
  },
  {
    table: 'inventory_transactions',
    column: 'quantity',
    targetType: 'decimal(12,3)',
    alterSql: 'ALTER TABLE inventory_transactions MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL'
  }
];

let ensureReceivingTablesPromise = null;

export const resetEnsureReceivingTablesCache = () => {
  ensureReceivingTablesPromise = null;
};

export const shouldAutoEnsureReceivingTables = (env = process.env) => {
  if (env?.AUTO_ENSURE_RECEIVING_TABLES === 'false') return false;
  if (env?.NODE_ENV === 'production' && env?.AUTO_ENSURE_RECEIVING_TABLES !== 'true') {
    return false;
  }
  return true;
};

export const ensureReceivingDocumentsTables = async (
  db = pool,
  { force = false, env = process.env } = {}
) => {
  if (!force && !shouldAutoEnsureReceivingTables(env)) {
    return;
  }

  if (db === pool && !force && ensureReceivingTablesPromise) {
    return ensureReceivingTablesPromise;
  }

  const runEnsure = async () => {
    for (const ddl of Object.values(RECEIVING_DOCUMENT_TABLES_DDL)) {
      await db.query(ddl);
    }

    for (const check of ADDITIVE_COLUMNS_CHECKS) {
      const [rows] = await db.query(
        `SHOW COLUMNS FROM ${check.table} LIKE ?`,
        [check.column]
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(
          `ALTER TABLE ${check.table} ADD COLUMN ${check.column} ${check.definition}`
        );
      }
    }

    for (const upgrade of PRECISION_UPGRADE_CHECKS) {
      const [rows] = await db.query(
        `SHOW COLUMNS FROM ${upgrade.table} LIKE ?`,
        [upgrade.column]
      );
      if (Array.isArray(rows) && rows.length > 0) {
        const colType = String(rows[0].Type || '').toLowerCase();
        if (colType && !colType.includes(',3)') && !colType.includes(',4)') && !colType.includes(',6)')) {
          await db.query(upgrade.alterSql);
        }
      }
    }
  };

  if (db !== pool || force) {
    return runEnsure();
  }

  ensureReceivingTablesPromise = runEnsure().catch((error) => {
    ensureReceivingTablesPromise = null;
    throw error;
  });

  return ensureReceivingTablesPromise;
};
