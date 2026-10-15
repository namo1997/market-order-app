// This checkout contains no schema.sql or SQL migrations. These are explicitly
// MINIMAL legacy fixtures, not an asserted copy of Production. Column sources:
// order.model.js queries/ensureOrderReceivingColumns; supplier.model.js ensures;
// product.model.js product_group_links DDL; docs/review-round1.md #12 (price scale).
// Inventory + all receiving tables are created by the real application ensures.
const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
export const LEGACY_FIXTURE_DDL = [
  `CREATE TABLE IF NOT EXISTS branches (
    id INT PRIMARY KEY, name VARCHAR(255) NOT NULL, code VARCHAR(50), is_active BOOLEAN DEFAULT true
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY, branch_id INT NOT NULL, name VARCHAR(255), code VARCHAR(50),
    is_active BOOLEAN DEFAULT true, is_production BOOLEAN DEFAULT false,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY, department_id INT NOT NULL, name VARCHAR(255),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS units (
    id INT PRIMARY KEY, name VARCHAR(100), abbreviation VARCHAR(30)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS product_groups (
    id INT PRIMARY KEY, name VARCHAR(255), code VARCHAR(50), line_id VARCHAR(100),
    is_active BOOLEAN DEFAULT true
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY, name VARCHAR(255), code VARCHAR(100),
    product_group_id INT NULL, unit_id INT, default_price DECIMAL(12,6) NULL,
    is_active BOOLEAN DEFAULT true, is_countable BOOLEAN DEFAULT true,
    FOREIGN KEY (product_group_id) REFERENCES product_groups(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INT PRIMARY KEY AUTO_INCREMENT, order_number VARCHAR(100) NOT NULL UNIQUE,
    user_id INT NOT NULL, order_date DATE NOT NULL,
    status ENUM('draft','submitted','confirmed','completed','cancelled') DEFAULT 'submitted',
    total_amount DECIMAL(12,2) DEFAULT 0, submitted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id), INDEX idx_order_date (order_date)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INT PRIMARY KEY AUTO_INCREMENT, order_id INT NOT NULL, product_id INT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL, requested_price DECIMAL(12,6) NULL,
    actual_price DECIMAL(12,6) NULL, notes TEXT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id)
  ) ${suffix}`,
  `CREATE TABLE IF NOT EXISTS product_group_links (
    id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, product_group_id INT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_product_group_link (product_id, product_group_id),
    INDEX idx_product_group_links_product (product_id),
    INDEX idx_product_group_links_group (product_group_id),
    INDEX idx_product_group_links_primary (is_primary),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (product_group_id) REFERENCES product_groups(id) ON DELETE CASCADE
  ) ${suffix}`
];
