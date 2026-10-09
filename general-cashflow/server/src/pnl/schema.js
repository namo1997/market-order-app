export const CATEGORY_SEEDS = [
  ['COGS_FOOD', 'วัตถุดิบอาหารและเครื่องดื่ม', 1, 10],
  ['PACKAGING', 'บรรจุภัณฑ์และของใช้สิ้นเปลือง', 0, 20],
  ['STAFF', 'ค่าแรงและเงินเดือน', 0, 30], ['RENT', 'ค่าเช่า', 0, 40],
  ['UTILITIES', 'น้ำ ไฟ แก๊ส อินเทอร์เน็ต', 0, 50],
  ['REPAIR', 'ซ่อมบำรุงและอุปกรณ์', 0, 60],
  ['MARKETING', 'การตลาดและค่าธรรมเนียมแพลตฟอร์ม', 0, 70], ['OTHER', 'อื่น ๆ', 0, 80]
];
export const migratePnl = async (connection) => {
  const definitions = [
    `pnl_categories (code VARCHAR(40) PRIMARY KEY, name VARCHAR(120) NOT NULL,
      is_cogs BOOLEAN NOT NULL DEFAULT FALSE, sort_order INT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE)`,
    `pnl_expense_rounds (id BIGINT PRIMARY KEY AUTO_INCREMENT, source_id VARCHAR(80) NOT NULL,
      business_date DATE NOT NULL, branch_id INT NULL, status ENUM('open','closed') NOT NULL,
      revision VARCHAR(120) NULL, fingerprint CHAR(64) NULL, snapshot_fingerprint CHAR(64) NULL,
      profile_max_updated_at VARCHAR(40) NULL, item_count INT NOT NULL DEFAULT 0,
      amount_total DECIMAL(14,2) NOT NULL DEFAULT 0, reimbursement_count INT NOT NULL DEFAULT 0,
      incoming_transfer_count INT NOT NULL DEFAULT 0, fetched_at DATETIME NOT NULL,
      UNIQUE KEY uq_pnl_round (source_id, business_date))`,
    `pnl_expense_items (id BIGINT PRIMARY KEY AUTO_INCREMENT, stable_key VARCHAR(120) NOT NULL UNIQUE,
      round_id BIGINT NOT NULL, kind ENUM('BILL','PAYMENT_WITHOUT_BILL') NOT NULL,
      branch_id INT NULL, business_date DATE NOT NULL, supplier_name VARCHAR(300) NULL,
      description VARCHAR(1000) NULL, amount DECIMAL(14,2) NOT NULL, payment_method VARCHAR(20) NULL,
      transaction_type VARCHAR(40) NULL, profile_status VARCHAR(20) NULL, bill_id BIGINT NULL,
      raw_json JSON NOT NULL, INDEX idx_pnl_item_date (business_date, branch_id),
      FOREIGN KEY (round_id) REFERENCES pnl_expense_rounds(id) ON DELETE CASCADE)`,
    `pnl_category_rules (id INT PRIMARY KEY AUTO_INCREMENT, match_field ENUM('supplier','purpose') NOT NULL,
      pattern VARCHAR(200) NOT NULL, category_code VARCHAR(40) NOT NULL, priority INT NOT NULL DEFAULT 100,
      created_by INT NOT NULL, created_at DATETIME NOT NULL, UNIQUE KEY uq_pnl_rule (match_field, pattern),
      FOREIGN KEY (category_code) REFERENCES pnl_categories(code))`,
    `pnl_item_overrides (stable_key VARCHAR(120) PRIMARY KEY, category_code VARCHAR(40) NULL,
      excluded BOOLEAN NULL, note VARCHAR(500) NULL, updated_by INT NOT NULL, updated_at DATETIME NOT NULL,
      FOREIGN KEY (category_code) REFERENCES pnl_categories(code))`,
    `pnl_manual_expenses (id BIGINT PRIMARY KEY AUTO_INCREMENT, month_start DATE NOT NULL,
      branch_id INT NULL, category_code VARCHAR(40) NOT NULL, description VARCHAR(300) NOT NULL,
      amount DECIMAL(14,2) NOT NULL CHECK (amount > 0), note VARCHAR(500) NULL,
      created_by INT NOT NULL, created_at DATETIME NOT NULL, updated_by INT NULL,
      updated_at DATETIME NULL, deleted_at DATETIME NULL,
      FOREIGN KEY (category_code) REFERENCES pnl_categories(code))`,
    `pnl_sync_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, month_start DATE NOT NULL,
      started_by INT NOT NULL, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
      status ENUM('RUNNING','SUCCEEDED','FAILED') NOT NULL, rounds_seen INT,
      rounds_refetched INT, duplicate_keys INT NOT NULL DEFAULT 0,
      moved_keys INT NOT NULL DEFAULT 0, error_code VARCHAR(80) NULL)`
  ];
  for (const definition of definitions) await connection.query(`CREATE TABLE IF NOT EXISTS ${definition}
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for (const seed of CATEGORY_SEEDS) await connection.query(
    'INSERT IGNORE INTO pnl_categories (code, name, is_cogs, sort_order) VALUES (?, ?, ?, ?)', seed);
};
