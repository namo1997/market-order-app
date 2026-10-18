import { pathToFileURL } from 'node:url';
import { bangkokDate } from './common.mjs';

export async function seed(server, pool, source, { profile = 'default', date = bangkokDate() } = {}) {
  if (!['default', 'jae-waew'].includes(profile)) throw new Error('Invalid pilot seed profile');
  const { LEGACY_FIXTURE_DDL } = await import(pathToFileURL(`${server}/tests/integration/legacy-receiving-schema.mjs`));
  for (const ddl of LEGACY_FIXTURE_DDL) await pool.query(ddl.includes('CREATE TABLE IF NOT EXISTS users (')
    ? ddl.replace('name VARCHAR(255),', "name VARCHAR(255), role VARCHAR(30) NOT NULL DEFAULT 'user', is_active BOOLEAN NOT NULL DEFAULT true,") : ddl);
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
  if (profile === 'jae-waew') return seedJaeWaew(pool, source, date);
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
