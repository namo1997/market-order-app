-- ====================================
-- Migration: สร้างตารางระบบคลังสินค้า
-- Created: 2026-02-09
-- ====================================

-- ตาราง: ยอดคงเหลือปัจจุบัน
CREATE TABLE IF NOT EXISTS inventory_balance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL COMMENT 'รหัสสินค้า',
  department_id INT NOT NULL COMMENT 'รหัสแผนก',
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'จำนวนคงเหลือ',
  last_transaction_id INT NULL COMMENT 'transaction ล่าสุด',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่อัพเดทล่าสุด',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_product_dept (product_id, department_id),
  INDEX idx_dept (department_id),
  INDEX idx_product (product_id),
  INDEX idx_quantity (quantity),

  CONSTRAINT fk_inventory_balance_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_balance_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='ยอดคงเหลือสินค้าในแต่ละแผนก';

-- ตาราง: ประวัติการเคลื่อนไหวสต็อก
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL COMMENT 'รหัสสินค้า',
  department_id INT NOT NULL COMMENT 'รหัสแผนก',
  transaction_type ENUM('receive', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'initial') NOT NULL COMMENT 'ประเภทการเคลื่อนไหว',
  quantity DECIMAL(10,2) NOT NULL COMMENT 'จำนวน (+ รับเข้า, - จ่ายออก)',
  balance_before DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'ยอดคงเหลือก่อนทำรายการ',
  balance_after DECIMAL(10,2) NOT NULL COMMENT 'ยอดคงเหลือหลังทำรายการ',
  reference_type VARCHAR(50) NULL COMMENT 'ประเภทเอกสารอ้างอิง (order_item, clickhouse_sale, stock_check)',
  reference_id VARCHAR(100) NULL COMMENT 'รหัสเอกสารอ้างอิง',
  notes TEXT NULL COMMENT 'หมายเหตุ',
  created_by INT NULL COMMENT 'ผู้ทำรายการ',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'วันเวลาที่ทำรายการ',

  INDEX idx_product (product_id),
  INDEX idx_dept (department_id),
  INDEX idx_type (transaction_type),
  INDEX idx_date (created_at),
  INDEX idx_reference (reference_type, reference_id),

  CONSTRAINT fk_inventory_trans_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_trans_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_trans_user
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='ประวัติการเคลื่อนไหวสต็อกสินค้า';

-- ตาราง: การผูกสินค้ากับ ClickHouse menu
CREATE TABLE IF NOT EXISTS product_clickhouse_mapping (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL COMMENT 'รหัสสินค้าในระบบ',
  menu_barcode VARCHAR(100) NOT NULL COMMENT 'barcode ของเมนูใน ClickHouse',
  quantity_per_unit DECIMAL(10,3) NOT NULL DEFAULT 1 COMMENT 'อัตราส่วนการใช้ (เช่น 1 จาน = 0.5 กก.)',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_product_barcode (product_id, menu_barcode),
  INDEX idx_barcode (menu_barcode),

  CONSTRAINT fk_product_ch_mapping
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='การผูกสินค้ากับเมนูใน ClickHouse';

-- ตาราง: การซิงค์ยอดขายจาก ClickHouse
CREATE TABLE IF NOT EXISTS clickhouse_sync_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sync_type ENUM('sales', 'menu') NOT NULL DEFAULT 'sales',
  start_date DATE NOT NULL COMMENT 'วันที่เริ่มดึงข้อมูล',
  end_date DATE NOT NULL COMMENT 'วันที่สิ้นสุดดึงข้อมูล',
  branch_id INT NULL COMMENT 'สาขาที่ดึงข้อมูล (NULL = ทั้งหมด)',
  total_records INT NOT NULL DEFAULT 0 COMMENT 'จำนวนรายการทั้งหมด',
  success_records INT NOT NULL DEFAULT 0 COMMENT 'จำนวนรายการสำเร็จ',
  failed_records INT NOT NULL DEFAULT 0 COMMENT 'จำนวนรายการล้มเหลว',
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  synced_by INT NULL COMMENT 'ผู้ทำการซิงค์',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,

  INDEX idx_sync_date (start_date, end_date),
  INDEX idx_status (status),
  INDEX idx_branch (branch_id),

  CONSTRAINT fk_sync_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT fk_sync_user
    FOREIGN KEY (synced_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='บันทึกการซิงค์ข้อมูลจาก ClickHouse';
