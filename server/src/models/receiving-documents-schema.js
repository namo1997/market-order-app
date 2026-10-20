import pool from '../config/database.js';

const getDefaultEnv = () =>
  typeof process !== 'undefined' && process && process.env ? process.env : {};

// R2-4: ห้าม ALTER ตารางเดิม (order_items, inventory_balance, inventory_transactions)
// ใช้ความละเอียดจำนวน DECIMAL(10,2) ให้ตรงกับตารางเดิมของระบบทั้งหมด
export const RECEIVING_DOCUMENT_TABLES_DDL = {
  receiving_document_notifications: `CREATE TABLE IF NOT EXISTS receiving_document_notifications (
    document_id INT PRIMARY KEY,
    payload_json LONGTEXT NOT NULL,
    state ENUM('pending','claimed') NOT NULL DEFAULT 'pending',
    claimed_at DATETIME(3) NULL,
    INDEX idx_receiving_notification_pending (state, document_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  receiving_documents: `
    CREATE TABLE IF NOT EXISTS receiving_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_uuid VARCHAR(100) NOT NULL,
      status ENUM('draft', 'confirmed', 'void') NOT NULL DEFAULT 'draft',
      kind ENUM('bill', 'manual_receipt') NOT NULL DEFAULT 'bill',
      branch_id INT NOT NULL,
      department_id INT NOT NULL,
      receiving_scope ENUM('department', 'branch') NOT NULL DEFAULT 'department',
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
      ocr_images_hash CHAR(64) NULL,
      ocr_result_json LONGTEXT NULL,
      ocr_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      ocr_last_requested_at TIMESTAMP NULL,
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
      INDEX idx_receiving_documents_dup_check (branch_id, supplier_master_id, product_group_id, doc_ref, total)
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
      quantity_billed DECIMAL(10,2) NULL,
      quantity_received DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,6) NULL,
      base_unit_price DECIMAL(12,6) NULL,
      amount DECIMAL(12,2) NULL,
      match_source ENUM('alias', 'order', 'manual', 'none', 'ai') NOT NULL DEFAULT 'none',
      match_confidence DECIMAL(5,4) NULL,
      is_user_edited BOOLEAN NOT NULL DEFAULT false,
      note TEXT NULL,
      branch_weight DECIMAL(10,2) NULL,
      branch_department_id INT NULL,
      branch_department_name VARCHAR(255) NULL,
      prev_order_quantity DECIMAL(10,2) NULL,
      prev_order_received_quantity DECIMAL(10,2) NULL,
      prev_order_actual_price DECIMAL(12,6) NULL,
      prev_order_is_received BOOLEAN NULL,
      prev_order_received_by_user_id INT NULL,
      prev_order_received_at TIMESTAMP NULL,
      prev_order_receive_notes TEXT NULL,
      applied_order_received_quantity DECIMAL(10,2) NULL,
      replaced_auto_receive_quantity DECIMAL(10,2) NULL,
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
      last_unit_price DECIMAL(12,6) NULL,
      confirm_count INT UNSIGNED NOT NULL DEFAULT 1,
      candidate_product_id INT NULL,
      candidate_confirm_count INT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_supplier_product_alias (supplier_key, normalized_bill_text, normalized_unit_text),
      INDEX idx_supplier_alias_lookup (normalized_bill_text),
      INDEX idx_supplier_alias_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  supplier_product_alias_events: `
    CREATE TABLE IF NOT EXISTS supplier_product_alias_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      alias_id INT NOT NULL,
      document_id INT NULL,
      supplier_key VARCHAR(120) NOT NULL,
      normalized_bill_text VARCHAR(255) NOT NULL,
      normalized_unit_text VARCHAR(100) NOT NULL DEFAULT '',
      previous_product_id INT NULL,
      proposed_product_id INT NOT NULL,
      applied_product_id INT NOT NULL,
      unit_id INT NULL,
      unit_multiplier DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
      unit_price DECIMAL(12,6) NULL,
      actor_user_id INT NULL,
      actor_role VARCHAR(50) NULL,
      branch_id INT NULL,
      department_id INT NULL,
      decision ENUM('created', 'confirmed_same', 'admin_override', 'candidate_recorded', 'candidate_promoted') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_alias_events_alias (alias_id, created_at),
      INDEX idx_alias_events_lookup (supplier_key, normalized_bill_text, normalized_unit_text),
      CONSTRAINT fk_alias_events_alias
        FOREIGN KEY (alias_id) REFERENCES supplier_product_aliases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  receiving_supplier_profiles: `
    CREATE TABLE IF NOT EXISTS receiving_supplier_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_key VARCHAR(120) NOT NULL,
      ordering_mode ENUM('system', 'walk_in_phone', 'mixed') NULL,
      branches_note VARCHAR(500) NULL,
      bill_format_note TEXT NULL,
      ordering_note TEXT NULL,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_receiving_supplier_profile_key (supplier_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  // Per-branch AP codes of one shop (the same shop can have a different code at each branch). Rows are
  // switched off with is_active instead of deleted so the history stays. Codes only: never bank/tax/phone numbers.
  receiving_supplier_branch_codes: `
    CREATE TABLE IF NOT EXISTS receiving_supplier_branch_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_key VARCHAR(120) NOT NULL,
      supplier_code VARCHAR(30) NOT NULL,
      branch_note VARCHAR(100) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_receiving_supplier_branch_code (supplier_key, supplier_code),
      INDEX idx_receiving_supplier_branch_code_code (supplier_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  receiving_supplier_admin_audits: `
    CREATE TABLE IF NOT EXISTS receiving_supplier_admin_audits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_key VARCHAR(120) NOT NULL,
      alias_id INT NULL,
      action VARCHAR(40) NOT NULL,
      actor_user_id INT NULL,
      actor_name VARCHAR(255) NULL,
      actor_role VARCHAR(50) NULL,
      before_json TEXT NULL,
      after_json TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_supplier_admin_audits_supplier (supplier_key, created_at),
      INDEX idx_supplier_admin_audits_alias (alias_id)
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

// เฉพาะตารางใหม่ของฟีเจอร์ receiving-documents เท่านั้น (ห้ามแตะตารางเดิมของระบบตาม R2-4)
const ADDITIVE_COLUMNS_CHECKS = [
  ...[
    ['receiving_documents', 'counted_complete_at', 'TIMESTAMP NULL'],
    ['receiving_documents', 'count_client_uuid', 'VARCHAR(100) NULL'],
    ['receiving_document_lines', 'counted_quantity', 'DECIMAL(10,2) NULL'],
    ['receiving_document_lines', 'counted_at', 'TIMESTAMP NULL'],
    ['receiving_document_lines', 'counted_by', 'INT NULL'],
    ['receiving_document_lines', 'review_decision', 'VARCHAR(40) NULL'],
    ['receiving_document_lines', 'return_status', 'VARCHAR(20) NULL'],
  ].map(([table, column, definition]) => ({ table, column, definition })),
  { table: 'receiving_documents', column: 'receiving_scope', definition: "ENUM('department', 'branch') NOT NULL DEFAULT 'department'" },
  { table: 'receiving_document_lines', column: 'branch_weight', definition: 'DECIMAL(10,2) NULL' },
  { table: 'receiving_document_lines', column: 'branch_department_id', definition: 'INT NULL' },
  { table: 'receiving_document_lines', column: 'branch_department_name', definition: 'VARCHAR(255) NULL' },
  { table: 'receiving_document_lines', column: 'remember_alias', definition: 'BOOLEAN NOT NULL DEFAULT false' },
  { table: 'receiving_documents', column: 'ocr_result_json', definition: 'LONGTEXT NULL AFTER ocr_images_hash' },
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
    column: 'ocr_images_hash',
    definition: 'CHAR(64) NULL AFTER ocr_confidence'
  },
  {
    table: 'receiving_documents',
    column: 'ocr_attempt_count',
    definition: 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER ocr_images_hash'
  },
  {
    table: 'receiving_documents',
    column: 'ocr_last_requested_at',
    definition: 'TIMESTAMP NULL AFTER ocr_attempt_count'
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
    column: 'prev_order_quantity',
    definition: 'DECIMAL(10,2) NULL AFTER note'
  },
  {
    table: 'receiving_document_lines',
    column: 'prev_order_receive_notes',
    definition: 'TEXT NULL AFTER prev_order_received_at'
  },
  {
    table: 'receiving_document_lines',
    column: 'applied_order_received_quantity',
    definition: 'DECIMAL(10,2) NULL AFTER prev_order_receive_notes'
  },
  {
    // Set only when confirming this line replaced a quantity the nightly auto-receive job had booked.
    table: 'receiving_document_lines',
    column: 'replaced_auto_receive_quantity',
    definition: 'DECIMAL(10,2) NULL AFTER applied_order_received_quantity'
  },
  {
    table: 'receiving_document_lines',
    column: 'applied_order_actual_price',
    definition: 'DECIMAL(12,6) NULL AFTER applied_order_received_quantity'
  },
  {
    table: 'supplier_product_aliases',
    column: 'candidate_product_id',
    definition: 'INT NULL AFTER confirm_count'
  },
  {
    table: 'supplier_product_aliases',
    column: 'candidate_confirm_count',
    definition: 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER candidate_product_id'
  },
  // ฝ่ายบัญชีปิดใช้ชื่อย่อได้โดยไม่ลบประวัติ (หน้า /admin/receiving/suppliers)
  {
    table: 'supplier_product_aliases',
    column: 'is_active',
    definition: 'TINYINT(1) NOT NULL DEFAULT 1 AFTER candidate_confirm_count'
  }
];

const PRECISION_UPGRADE_CHECKS = [
  {
    table: 'receiving_document_lines',
    column: 'unit_price',
    minScale: 6,
    alterSql: 'ALTER TABLE receiving_document_lines MODIFY COLUMN unit_price DECIMAL(12,6) NULL'
  },
  {
    table: 'supplier_product_aliases',
    column: 'last_unit_price',
    minScale: 6,
    alterSql: 'ALTER TABLE supplier_product_aliases MODIFY COLUMN last_unit_price DECIMAL(12,6) NULL'
  }
];

const parseDecimalScale = (typeText = '') => {
  const match = String(typeText).match(/decimal\(\s*\d+\s*,\s*(\d+)\s*\)/i);
  return match ? Number(match[1]) : null;
};

let ensureReceivingTablesPromise = null;

export const resetEnsureReceivingTablesCache = () => {
  ensureReceivingTablesPromise = null;
};

export const shouldAutoEnsureReceivingTables = (env = getDefaultEnv()) => {
  if (env?.AUTO_ENSURE_RECEIVING_TABLES === 'false') return false;
  if (env?.NODE_ENV === 'production' && env?.AUTO_ENSURE_RECEIVING_TABLES !== 'true') {
    return false;
  }
  return true;
};

export const ensureReceivingDocumentsTables = async (
  db = pool,
  { force = false, env = getDefaultEnv() } = {}
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

    const [branchIndex] = await db.query('SHOW INDEX FROM receiving_documents WHERE Key_name = ?', ['idx_receiving_documents_branch_scope_date']);
    // Add an optional optimization only when metadata positively confirms absence.
    if (Array.isArray(branchIndex) && branchIndex.length === 0) {
      await db.query('ALTER TABLE receiving_documents ADD INDEX idx_receiving_documents_branch_scope_date (branch_id, receiving_scope, delivery_date)');
    }

    const [matchColumns] = await db.query('SHOW COLUMNS FROM receiving_document_lines LIKE ?', ['match_source']);
    if (matchColumns?.[0]?.Type && !matchColumns[0].Type.includes("'ai'")) {
      await db.query("ALTER TABLE receiving_document_lines MODIFY COLUMN match_source ENUM('alias', 'order', 'manual', 'none', 'ai') NOT NULL DEFAULT 'none'");
    }

    for (const upgrade of PRECISION_UPGRADE_CHECKS) {
      const [rows] = await db.query(
        `SHOW COLUMNS FROM ${upgrade.table} LIKE ?`,
        [upgrade.column]
      );
      if (Array.isArray(rows) && rows.length > 0) {
        const scale = parseDecimalScale(rows[0].Type);
        if (scale !== null && scale < upgrade.minScale) {
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
