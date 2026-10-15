import { pathToFileURL } from 'node:url';
import { bangkokDate } from './common.mjs';

export async function seed(server, pool, source) {
  const { LEGACY_FIXTURE_DDL } = await import(pathToFileURL(`${server}/tests/integration/legacy-receiving-schema.mjs`));
  for (const ddl of LEGACY_FIXTURE_DDL) await pool.query(ddl);
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
  await pool.query("INSERT INTO units (id,name,abbreviation) VALUES (1,'กิโลกรัม','กก.')");
  for (const id of [1, 2, 3]) await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)',
    [id, `SYNTHETIC ร้านตัวอย่าง ${id}`, `SYN-PG${id}`]);
  for (let id = 1; id <= 30; id++) {
    const group = Math.ceil(id / 10);
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,1,10.00)',
      [id, `SYNTHETIC ผัก ${String(id).padStart(2, '0')}`, `SYN-P${id}`, group]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [id, group]);
  }
  const date = bangkokDate();
  for (const userId of [1, 2]) {
    const [order] = await pool.query("INSERT INTO orders (order_number,user_id,order_date,status) VALUES (?,?,?,'submitted')",
      [`SYNTHETIC-${date}-${userId}`, userId, date]);
    for (let product = 1; product <= 30; product++) {
      await pool.query('INSERT INTO order_items (order_id,product_id,quantity,requested_price) VALUES (?,?,20.00,10.00)',
        [order.insertId, product]);
    }
  }
  return { label: 'SYNTHETIC', date, branches: 2, departments: 2, users: 2,
    supplierProductGroups: 3, products: 30, orders: 2, orderItems: 60 };
}
