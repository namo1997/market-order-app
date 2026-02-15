-- Market Order System Database Schema
-- สร้าง database
CREATE DATABASE IF NOT EXISTS market_order_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE market_order_db;

-- ลบ tables เก่าถ้ามี (ลำดับย้อนกลับเพื่อหลีกเลี่ยง foreign key constraints)
DROP TABLE IF EXISTS stock_checks;
DROP TABLE IF EXISTS stock_templates;
DROP TABLE IF EXISTS stock_categories;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_status_settings;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS branches;

-- 1. Branches (สาขา)
CREATE TABLE branches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  clickhouse_branch_id VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Departments (แผนก)
CREATE TABLE departments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  branch_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  is_production BOOLEAN DEFAULT false,
  allowed_roles VARCHAR(64) NOT NULL DEFAULT 'user,admin',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  UNIQUE KEY unique_dept_code (branch_id, code),
  INDEX idx_branch (branch_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Stock Categories (หมวดสินค้าในแต่ละแผนก)
CREATE TABLE stock_categories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  UNIQUE KEY unique_department_category (department_id, name),
  INDEX idx_department (department_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Users (ผู้ใช้)
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  department_id INT NOT NULL,
  role ENUM('user', 'admin', 'super_admin') DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_username (username),
  INDEX idx_department (department_id),
  INDEX idx_role (role),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Units (หน่วยสินค้า)
CREATE TABLE units (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL UNIQUE,
  abbreviation VARCHAR(10),
  is_active BOOLEAN DEFAULT true,
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Suppliers (ซัพพลายเออร์)
CREATE TABLE suppliers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20) UNIQUE,
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  line_id VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LINE Notification Logs
CREATE TABLE line_notification_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  order_id INT NULL,
  group_id VARCHAR(64),
  group_name VARCHAR(255),
  access_token_hash VARCHAR(128),
  status ENUM('success', 'failed', 'skipped') NOT NULL,
  message TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_type (event_type),
  INDEX idx_order_id (order_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_access_token_hash (access_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Products (สินค้า)
CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) UNIQUE,
  unit_id INT NOT NULL,
  supplier_id INT,
  default_price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (unit_id) REFERENCES units(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  INDEX idx_code (code),
  INDEX idx_supplier (supplier_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Department Products (สินค้าที่ผูกกับแผนกสำหรับสั่งซื้อ)
CREATE TABLE department_products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  product_id INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY unique_department_product (department_id, product_id),
  INDEX idx_department (department_id),
  INDEX idx_product (product_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System Settings (ตั้งค่าระบบ)
CREATE TABLE system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value VARCHAR(100) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Purchase Walk Product Order (จัดเรียงสินค้าเดินซื้อของ)
CREATE TABLE purchase_walk_product_order (
  product_id INT PRIMARY KEY,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Order Status Settings (การเปิด/ปิดรับออเดอร์)
CREATE TABLE order_status_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_date DATE NOT NULL UNIQUE,
  is_open BOOLEAN DEFAULT true,
  closed_at TIMESTAMP NULL,
  closed_by_user_id INT,
  notes TEXT,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_order_date (order_date),
  INDEX idx_is_open (is_open)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Orders (คำสั่งซื้อ)
CREATE TABLE orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  order_date DATE NOT NULL,
  status ENUM('draft', 'submitted', 'confirmed', 'completed', 'cancelled') DEFAULT 'draft',
  total_amount DECIMAL(10,2) DEFAULT 0,
  submitted_at TIMESTAMP NULL,
  transferred_at TIMESTAMP NULL,
  transferred_from_department_id INT NULL,
  transferred_from_branch_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_order_number (order_number),
  INDEX idx_order_date (order_date),
  INDEX idx_user_date (user_id, order_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Order Items (รายการสินค้าในคำสั่งซื้อ)
CREATE TABLE order_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  requested_price DECIMAL(10,2),
  actual_price DECIMAL(12,6),
  actual_quantity DECIMAL(12,6),
  received_quantity DECIMAL(10,2),
  received_by_user_id INT,
  received_at TIMESTAMP NULL,
  receive_notes TEXT,
  is_received BOOLEAN DEFAULT false,
  is_purchased BOOLEAN DEFAULT false,
  purchase_reason TEXT,
  notes TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (received_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_order (order_id),
  INDEX idx_product (product_id),
  INDEX idx_received (is_received),
  INDEX idx_purchased (is_purchased)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Stock Templates (รายการของประจำสำหรับเช็คสต็อก - ตั้งค่าตาม Department)
CREATE TABLE stock_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  product_id INT NOT NULL,
  category_id INT,
  required_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  min_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  daily_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES stock_categories(id) ON DELETE SET NULL,
  UNIQUE KEY unique_dept_product (department_id, product_id),
  INDEX idx_department (department_id),
  INDEX idx_product (product_id),
  INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Stock Checks (บันทึกสต็อกตามวันที่)
CREATE TABLE stock_checks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department_id INT NOT NULL,
  product_id INT NOT NULL,
  check_date DATE NOT NULL,
  stock_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  checked_by_user_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_dept_product_date (department_id, product_id, check_date),
  INDEX idx_check_date (check_date),
  INDEX idx_department (department_id),
  INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu Recipes (สูตรเมนูอาหาร)
CREATE TABLE menu_recipes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  menu_barcode VARCHAR(50) NOT NULL,
  menu_name VARCHAR(255) NOT NULL,
  menu_unit_name VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_menu_barcode (menu_barcode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu Recipe Items (วัตถุดิบในสูตร)
CREATE TABLE menu_recipe_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  recipe_id INT NOT NULL,
  product_id INT NOT NULL,
  unit_id INT NOT NULL,
  quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (recipe_id) REFERENCES menu_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id),
  UNIQUE KEY unique_recipe_product (recipe_id, product_id),
  INDEX idx_recipe (recipe_id),
  INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Unit Conversions (การแปลงหน่วย)
CREATE TABLE unit_conversions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  from_unit_id INT NOT NULL,
  to_unit_id INT NOT NULL,
  multiplier DECIMAL(16,6) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_conversion (from_unit_id, to_unit_id),
  FOREIGN KEY (from_unit_id) REFERENCES units(id),
  FOREIGN KEY (to_unit_id) REFERENCES units(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Production Print Logs (บันทึกการพิมพ์คำสั่งซื้อสำหรับฝ่ายผลิต)
CREATE TABLE production_print_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  user_name VARCHAR(100) NOT NULL,
  user_branch_id INT NOT NULL,
  user_branch_name VARCHAR(150) NOT NULL,
  user_department_id INT NOT NULL,
  user_department_name VARCHAR(150) NOT NULL,
  target_branch_id INT NOT NULL,
  target_branch_name VARCHAR(150) NOT NULL,
  target_department_id INT NOT NULL,
  target_department_name VARCHAR(150) NOT NULL,
  order_date DATE NOT NULL,
  supplier_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_print_order_date (order_date),
  INDEX idx_print_user (user_id),
  INDEX idx_print_target (target_branch_id, target_department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
