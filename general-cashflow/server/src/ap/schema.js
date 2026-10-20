import { RECEIVING_DDL } from './receiving.js';
// Additive only. Deliberately not registered in the existing startup migration.
export const AP_DDL = [
  ...RECEIVING_DDL,
  `CREATE TABLE IF NOT EXISTS ap_batches (id BIGINT PRIMARY KEY AUTO_INCREMENT, fingerprint CHAR(64) NOT NULL UNIQUE, month_start DATE NOT NULL, metadata JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS ap_accounts (code VARCHAR(80) PRIMARY KEY, name VARCHAR(200) NOT NULL, kind VARCHAR(30) NOT NULL, native_account_id INT NULL)`,
  `CREATE TABLE IF NOT EXISTS ap_suppliers (supplier_key VARCHAR(160) PRIMARY KEY, branch_code VARCHAR(20) NOT NULL, name VARCHAR(300) NOT NULL, reference VARCHAR(300) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ap_sources (source_key VARCHAR(200) PRIMARY KEY, batch_id BIGINT NOT NULL, branch_code VARCHAR(20) NOT NULL, business_date DATE NULL, amount DECIMAL(14,2) NULL, source_type VARCHAR(30) NOT NULL, document JSON NOT NULL, FOREIGN KEY (batch_id) REFERENCES ap_batches(id), INDEX ap_source_period (business_date, branch_code))`,
  `CREATE TABLE IF NOT EXISTS ap_source_links (source_key VARCHAR(200) PRIMARY KEY, canonical_key VARCHAR(200) NOT NULL, relation_type VARCHAR(30) NOT NULL, reason VARCHAR(500) NOT NULL, FOREIGN KEY (source_key) REFERENCES ap_sources(source_key), INDEX ap_canonical (canonical_key))`,
  `CREATE TABLE IF NOT EXISTS ap_journals (journal_key VARCHAR(200) PRIMARY KEY, source_key VARCHAR(200) NOT NULL, business_date DATE NOT NULL, branch_code VARCHAR(20) NOT NULL, journal_type VARCHAR(30) NOT NULL, due_date DATE NULL, reverses_key VARCHAR(200) NULL UNIQUE, description VARCHAR(1000) NOT NULL, flags JSON NOT NULL, FOREIGN KEY (source_key) REFERENCES ap_sources(source_key), FOREIGN KEY (reverses_key) REFERENCES ap_journals(journal_key), INDEX ap_journal_period (business_date, branch_code))`,
  `CREATE TABLE IF NOT EXISTS ap_journal_lines (journal_key VARCHAR(200) NOT NULL, line_no INT NOT NULL, account_code VARCHAR(80) NOT NULL, supplier_key VARCHAR(160) NULL, debit DECIMAL(14,2) NOT NULL DEFAULT 0, credit DECIMAL(14,2) NOT NULL DEFAULT 0, PRIMARY KEY (journal_key, line_no), FOREIGN KEY (journal_key) REFERENCES ap_journals(journal_key), FOREIGN KEY (account_code) REFERENCES ap_accounts(code), FOREIGN KEY (supplier_key) REFERENCES ap_suppliers(supplier_key), CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)))`,
  `CREATE TABLE IF NOT EXISTS ap_period_controls (batch_id BIGINT NOT NULL, branch_code VARCHAR(20) NOT NULL, month_start DATE NOT NULL, opening_complete BOOLEAN NOT NULL DEFAULT FALSE, purchases_complete BOOLEAN NOT NULL DEFAULT FALSE, payments_complete BOOLEAN NOT NULL DEFAULT FALSE, document JSON NOT NULL, PRIMARY KEY (batch_id, branch_code), FOREIGN KEY (batch_id) REFERENCES ap_batches(id))`,
  `CREATE TABLE IF NOT EXISTS ap_opening_imports (id BIGINT PRIMARY KEY AUTO_INCREMENT, batch_id BIGINT NOT NULL, fingerprint CHAR(64) NOT NULL, previous_id BIGINT NULL, document JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (batch_id) REFERENCES ap_batches(id), FOREIGN KEY (previous_id) REFERENCES ap_opening_imports(id), INDEX ap_opening_batch (batch_id, id))`,
  `CREATE TABLE IF NOT EXISTS ap_match_cases (match_key VARCHAR(200) PRIMARY KEY, source_key VARCHAR(200) NOT NULL, status VARCHAR(30) NOT NULL, adapter_version VARCHAR(30) NOT NULL, document JSON NOT NULL, FOREIGN KEY (source_key) REFERENCES ap_sources(source_key))`
];
export const ACCOUNTS = [
  ['CASH', 'เงินสด', 'ASSET'], ['BANK_UNASSIGNED', 'ธนาคารยังไม่ระบุบัญชี', 'ASSET'],
  ['PAYMENT_UNASSIGNED', 'เงินจ่ายรอระบุเงินสด/บัญชีธนาคาร', 'CLEARING'],
  ['INVENTORY', 'สินค้าคงคลัง/วัตถุดิบ', 'ASSET'], ['INPUT_VAT', 'ภาษีซื้อ', 'ASSET'],
  ['AP', 'เจ้าหนี้การค้า (แยกซัพในรายการ)', 'LIABILITY'], ['OPENING_CLEARING', 'บัญชีพักยอดยกมา', 'EQUITY'],
  ['PASS_THROUGH', 'เงินผ่านร้านเนื้อย่างพี่เก้ง', 'ASSET'],
  ['COGS_FOOD', 'ต้นทุนวัตถุดิบ/ซื้อ (periodic)', 'EXPENSE'],
  ...[['PACKAGING','บรรจุภัณฑ์'],['STAFF','บุคลากร'],['RENT','ค่าเช่า'],['UTILITIES','สาธารณูปโภค'],['REPAIR','ซ่อมบำรุง'],['TRANSPORT','ขนส่ง'],['ADMIN','บัญชีและธุรการ'],['MARKETING','การตลาด'],['OTHER','ค่าใช้จ่ายอื่น'],['TAX','ภาษี']].map(([c,n])=>[c,n,'EXPENSE'])
];
export async function migrateAp(connection) {
  for (const sql of AP_DDL) await connection.query(sql);
  for (const row of ACCOUNTS) await connection.query('INSERT IGNORE INTO ap_accounts (code,name,kind) VALUES (?,?,?)', row);
}
