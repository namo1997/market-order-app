-- ระบบจัดการสต็อกสินค้า (แยกจากระบบสั่งของ)

-- ตาราง: แม่แบบสินค้าที่ต้องนับสต็อก (สำหรับแต่ละแผนก)
CREATE TABLE IF NOT EXISTS stock_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  product_id INT NOT NULL,
  category_id INT NULL,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_dept_product (department_id, product_id),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_department (department_id),
  INDEX idx_product (product_id),
  INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ตาราง: บันทึกผลการนับสต็อก
CREATE TABLE IF NOT EXISTS stock_counts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  product_id INT NOT NULL,
  count_date DATE NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  counted_by_user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (counted_by_user_id) REFERENCES users(id),
  INDEX idx_department_date (department_id, count_date),
  INDEX idx_product_date (product_id, count_date),
  INDEX idx_date (count_date),
  UNIQUE KEY unique_dept_product_date (department_id, product_id, count_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
