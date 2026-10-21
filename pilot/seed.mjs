import { seedMaerim } from './seed-maerim.mjs';
import { pathToFileURL } from 'node:url';
import { bangkokDate } from './common.mjs';
import { seedSuppliers202610 } from './seed-suppliers.mjs';

// Pilot-only fixture adjustments applied while the table is CREATED. Never ALTER/MODIFY an existing
// column that is referenced by a foreign key (MySQL: ER_FK_COLUMN_CANNOT_CHANGE_CHILD).
export function pilotFixtureDdl(ddl) {
  if (ddl.includes('CREATE TABLE IF NOT EXISTS users (')) {
    return ddl.replace('name VARCHAR(255),', "name VARCHAR(255), role VARCHAR(30) NOT NULL DEFAULT 'user', is_active BOOLEAN NOT NULL DEFAULT true,");
  }
  // Production products.id is AUTO_INCREMENT; the minimal fixture needs it so admin product create can INSERT.
  if (ddl.includes('CREATE TABLE IF NOT EXISTS products (')) return ddl.replace('id INT PRIMARY KEY,', 'id INT PRIMARY KEY AUTO_INCREMENT,');
  // Production supplier_masters has line_id; the supplier-master schema ensure adds later columns AFTER it.
  if (ddl.includes('CREATE TABLE IF NOT EXISTS supplier_masters (')) return ddl.replace('code VARCHAR(50) NOT NULL UNIQUE,', 'code VARCHAR(50) NOT NULL UNIQUE, line_id VARCHAR(100) NULL,');
  return ddl;
}
export const STOCK_TEMPLATES_DDL = `CREATE TABLE IF NOT EXISTS stock_templates (
    id INT AUTO_INCREMENT PRIMARY KEY, department_id INT NOT NULL, product_id INT NOT NULL,
    category_id INT NULL, required_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_pilot_stock_template (department_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

export async function seed(server, pool, source, { profile = 'default', date = bangkokDate() } = {}) {
  if (!['default', 'jae-waew', 'ice-vic', 'suppliers-2026-10', 'maerim', 'all'].includes(profile)) throw new Error('Invalid pilot seed profile');
  const { LEGACY_FIXTURE_DDL } = await import(pathToFileURL(`${server}/tests/integration/legacy-receiving-schema.mjs`));
  for (const ddl of LEGACY_FIXTURE_DDL) await pool.query(pilotFixtureDdl(ddl));
  // Stock-count template table the production admin product-create flow registers into (additive, no FK).
  await pool.query(STOCK_TEMPLATES_DDL);
  await source.order.ensureOrderReceivingColumns();
  await source.inventory.ensureInventoryTables();
  await source.schema.ensureReceivingDocumentsTables(pool, { force: true });
  await source.schema.ensureReceivingDocumentsTables(pool, { force: true });
  // Only a fresh CREATE DATABASE receiving_pilot is accepted by the caller.
  // No reset, delete, dump, import or Production connection is available.
  for (const id of [1, 2]) {
    await pool.query('INSERT INTO branches (id,name,code) VALUES (?,?,?)', [id, `SYNTHETIC สาขา ${id}`, `SYN-${id}`]);
    await pool.query('INSERT INTO departments (id,branch_id,name,code) VALUES (?,?,?,?)', [id, id, `SYNTHETIC ครัว ${id}`, `SYN-D${id}`]);
    await pool.query('INSERT INTO users (id,department_id,name) VALUES (?,?,?)', [id, id, `SYNTHETIC ผู้รับ ${id}`]);
  }
  await pool.query('INSERT INTO departments (id,branch_id,name,code) VALUES (3,1,?,?)', ['SYNTHETIC บัญชี', 'SYN-ACCOUNTING']);
  await pool.query('INSERT INTO users (id,department_id,name,role) VALUES (3,3,?,?)', ['SYNTHETIC บัญชี', 'accounting']);
  await pool.query("INSERT INTO units (id,name,abbreviation) VALUES (1,'กิโลกรัม','กก.')");
  if (profile === 'maerim') return seedMaerim(pool, source, date);
  if (profile === 'jae-waew') return seedJaeWaew(pool, source, date);
  if (profile === 'ice-vic') return seedIceVic(pool, source, date);
  if (profile === 'suppliers-2026-10') return seedSuppliers202610(pool, source, date);
  if (profile === 'all') return seedAll(pool, source, date);
  for (const id of [1, 2, 3]) await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)',
    [id, `SYNTHETIC ร้านตัวอย่าง ${id}`, `SYN-PG${id}`]);
  for (let id = 1; id <= 30; id++) {
    const group = Math.ceil(id / 10);
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,1,10.00)',
      [id, `SYNTHETIC ผัก ${String(id).padStart(2, '0')}`, `SYN-P${id}`, group]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [id, group]);
  }
  for (const userId of [1, 2]) {
    const [order] = await pool.query("INSERT INTO orders (order_number,user_id,order_date,status) VALUES (?,?,?,'submitted')",
      [`SYNTHETIC-${date}-${userId}`, userId, date]);
    for (let product = 1; product <= 30; product++) {
      await pool.query('INSERT INTO order_items (order_id,product_id,quantity,requested_price) VALUES (?,?,20.00,10.00)',
        [order.insertId, product]);
    }
  }
  return { label: 'SYNTHETIC', date, branches: 2, departments: 3, users: 3,
    supplierProductGroups: 3, products: 30, orders: 2, orderItems: 60 };
}

async function seedJaeWaew(pool, source, date) {
  const supplier = 'เจ๊แววไก่สด ตลาดเมืองใหม่';
  await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)', [1, supplier, 'SYN-JAE-WAEW']);
  const products = [
    { id: 1, name: 'ขา B', price: '60.00', aliases: ['ทB', 'ทร'] },
    { id: 2, name: 'ปีกบน', price: '76.00', aliases: ['ป.บน'] },
    { id: 3, name: 'ปีกกลาง', price: '135.00', aliases: ['ป.กลาง', 'ปีกกลาง (ญ.)'] },
    { id: 4, name: 'อกไก่', price: '80.00', aliases: ['ต.ไก่'] }
  ];
  const supplierKey = source.ocr.buildSupplierKey({ productGroupId: 1 });
  const unit = 'กก.';
  const [order] = await pool.query("INSERT INTO orders (order_number,user_id,order_date,status,total_amount) VALUES (?,?,?,'submitted',?)",
    [`SYNTHETIC-JAE-WAEW-${date}-1`, 1, date, '3510.00']);
  for (const product of products) {
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,?,?)',
      [product.id, product.name, `SYN-JW${product.id}`, 1, 1, product.price]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [product.id, 1]);
    await pool.query('INSERT INTO order_items (order_id,product_id,quantity,requested_price) VALUES (?,?,?,?)',
      [order.insertId, product.id, '10.00', product.price]);
    for (const alias of product.aliases) {
      await pool.query(`INSERT INTO supplier_product_aliases
        (supplier_key,product_group_id,supplier_name_text,bill_text,normalized_bill_text,
         unit_text,normalized_unit_text,product_id,unit_id,unit_multiplier,last_unit_price,updated_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [supplierKey, 1, supplier, alias, source.ocr.normalizeMatchText(alias), unit,
        source.ocr.normalizeMatchText(unit), product.id, 1, '1.0000', product.price, 1]);
    }
  }
  return { label: 'SYNTHETIC', profile: 'jae-waew', date, branches: 2, departments: 3, users: 3,
    supplierProductGroups: 1, products: 4, aliases: 6, orders: 1, orderItems: 4 };
}

async function seedIceVic(pool, source, date) {
  const supplier = 'ร้านน้ำแข็ง vic';
  await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)', [1, supplier, 'SYN-ICE-VIC']);
  await pool.query(`CREATE TABLE IF NOT EXISTS supplier_masters (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await pool.query('INSERT INTO supplier_masters (id,name,code) VALUES (?,?,?)', [1, supplier, 'SYN-SM-ICE-VIC']);
  await pool.query("INSERT INTO units (id,name,abbreviation) VALUES (2,'ถุง','ถุง')");
  const products = [
    { id: 1, name: 'น้ำแข็งหลอดใหญ่', price: '35.00', aliases: ['หลอดใหญ่'] },
    { id: 2, name: 'น้ำแข็งบด (ใช้ครัว)', price: '35.00', aliases: ['โม่ครัว'] },
    { id: 3, name: 'น้ำแข็งสำหรับกาแฟ', price: '35.00', aliases: ['กาแฟ'] },
    { id: 4, name: 'น้ำแข็งบด (ใช้ผลิต)', price: '35.00', aliases: ['โม่โรงงาน'] }
  ];
  const unit = 'ถุง';
  const groupKey = source.ocr.buildSupplierKey({ productGroupId: 1 });
  const nameKey = source.ocr.buildSupplierKey({ supplierNameText: supplier });
  for (const product of products) {
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,?,?)',
      [product.id, product.name, `SYN-ICE${product.id}`, 1, 2, product.price]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [product.id, 1]);
    await pool.query('INSERT INTO product_supplier_master_links (product_id,supplier_master_id,is_primary) VALUES (?,1,true)', [product.id]);
    for (const alias of product.aliases) {
      for (const supplierKey of [groupKey, nameKey, source.ocr.buildSupplierKey({ supplierMasterId: 1 })]) {
        await pool.query(`INSERT INTO supplier_product_aliases
          (supplier_key,product_group_id,supplier_name_text,bill_text,normalized_bill_text,
           unit_text,normalized_unit_text,product_id,unit_id,unit_multiplier,last_unit_price,updated_by_user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [supplierKey, 1, supplier, alias, source.ocr.normalizeMatchText(alias), unit,
          source.ocr.normalizeMatchText(unit), product.id, 2, '1.0000', product.price, 1]);
      }
    }
  }
  return { label: 'SYNTHETIC', profile: 'ice-vic', date, branches: 2, departments: 3, users: 3,
    supplierProductGroups: 1, supplierMasters: 1, products: 4, aliases: 4, orders: 0, orderItems: 0 };
}

async function seedAll(pool, source, date) {
  await seedJaeWaew(pool, source, date);
  const supplier = 'ร้านน้ำแข็ง vic';
  await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)', [2, supplier, 'SYN-ICE-VIC']);
  await pool.query(`CREATE TABLE IF NOT EXISTS supplier_masters (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await pool.query('INSERT INTO supplier_masters (id,name,code) VALUES (?,?,?)', [1, supplier, 'SYN-SM-ICE-VIC']);
  await pool.query("INSERT INTO units (id,name,abbreviation) VALUES (2,'ถุง','ถุง')");
  const products = [
    { id: 5, name: 'น้ำแข็งหลอดใหญ่', price: '35.00', aliases: ['หลอดใหญ่'] },
    { id: 6, name: 'น้ำแข็งบด (ใช้ครัว)', price: '35.00', aliases: ['โม่ครัว'] },
    { id: 7, name: 'น้ำแข็งสำหรับกาแฟ', price: '35.00', aliases: ['กาแฟ'] },
    { id: 8, name: 'น้ำแข็งบด (ใช้ผลิต)', price: '35.00', aliases: ['โม่โรงงาน'] }
  ];
  const unit = 'ถุง';
  const groupKey = source.ocr.buildSupplierKey({ productGroupId: 2 });
  const nameKey = source.ocr.buildSupplierKey({ supplierNameText: supplier });
  for (const product of products) {
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,?,?)',
      [product.id, product.name, `SYN-ICE${product.id}`, 2, 2, product.price]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [product.id, 2]);
    await pool.query('INSERT INTO product_supplier_master_links (product_id,supplier_master_id,is_primary) VALUES (?,1,true)', [product.id]);
    for (const alias of product.aliases) {
      for (const supplierKey of [groupKey, nameKey, source.ocr.buildSupplierKey({ supplierMasterId: 1 })]) {
        await pool.query(`INSERT INTO supplier_product_aliases
          (supplier_key,product_group_id,supplier_name_text,bill_text,normalized_bill_text,
           unit_text,normalized_unit_text,product_id,unit_id,unit_multiplier,last_unit_price,updated_by_user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [supplierKey, 2, supplier, alias, source.ocr.normalizeMatchText(alias), unit,
          source.ocr.normalizeMatchText(unit), product.id, 2, '1.0000', product.price, 1]);
      }
    }
  }
  return { label: 'SYNTHETIC', profile: 'all', date, branches: 2, departments: 3, users: 3,
    supplierProductGroups: 2, supplierMasters: 1, products: 8, aliases: 10, orders: 1, orderItems: 4 };
}
