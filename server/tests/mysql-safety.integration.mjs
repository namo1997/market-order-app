// Manual opt-in integration run against a disposable MySQL instance on the SSD.
// Never run this file against an existing application database.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const port = Number(process.env.SOLAO_AUDIT_MYSQL_PORT);
assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1', 'SSD simulation required');
assert.ok((await realpath(process.cwd())).startsWith('/Volumes/SSD Files/SOLAO/'), 'Run only from SSD snapshot');
assert.ok(Number.isSafeInteger(port) && port > 1024 && port !== 3306, 'Explicit isolated MySQL port required');
const database = `audit_backend_${Date.now()}`;
const db = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', multipleStatements: true });
let pool;
const passed = [];
try {
  await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await db.query(`USE \`${database}\``);
  const schema = (await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'))
    .replace(/^CREATE DATABASE[^;]+;/m, '').replace(/^USE market_order_db;/m, '');
  await db.query(schema);
  await db.query(`
    ALTER TABLE products ADD product_group_id INT NULL, ADD is_countable BOOLEAN DEFAULT true,
      ADD barcode VARCHAR(100), ADD qr_code VARCHAR(100);
    CREATE TABLE product_groups (id INT PRIMARY KEY, name VARCHAR(100), code VARCHAR(30), line_id VARCHAR(100),
      is_active BOOLEAN DEFAULT true, is_internal BOOLEAN DEFAULT false, linked_branch_id INT,
      linked_department_id INT, skip_receiving_required BOOLEAN DEFAULT true);
    CREATE TABLE product_group_links (product_id INT, product_group_id INT, is_primary BOOLEAN DEFAULT true);
    CREATE TABLE supplier_masters (id INT PRIMARY KEY, name VARCHAR(100), phone VARCHAR(50),
      contact_person VARCHAR(100), address VARCHAR(200));
    CREATE TABLE product_supplier_master_links (product_id INT, supplier_master_id INT,
      is_primary BOOLEAN DEFAULT true, purchase_unit_id INT, purchase_to_base_multiplier DECIMAL(16,6));
    INSERT INTO branches (id,name,code) VALUES (1,'Simulation branch','SIM');
    INSERT INTO departments (id,branch_id,name,code) VALUES (1,1,'Simulation department','SIM');
    INSERT INTO users (id,username,password,name,department_id) VALUES (1,'simulation','','Simulation user',1);
    INSERT INTO units (id,name,abbreviation) VALUES (1,'unit','u');
    INSERT INTO product_groups (id,name,code) VALUES (1,'Simulation group','SIM');
    INSERT INTO supplier_masters (id,name) VALUES (1,'Simulation supplier');
    INSERT INTO products (id,name,code,unit_id,product_group_id) VALUES (1,'Simulation product','SIM1',1,1),(2,'Simulation product 2','SIM2',1,1);
    INSERT INTO product_group_links VALUES (1,1,true),(2,1,true);
    INSERT INTO product_supplier_master_links VALUES (1,1,true,1,1),(2,1,true,1,1);
  `);
  Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: '', DB_NAME: database, DB_CONNECTION_LIMIT: '30', DB_RETRY_ATTEMPTS: '1' });
  pool = (await import('../src/config/database.js')).default;
  const inventory = await import('../src/models/inventory.model.js');
  await inventory.ensureInventoryTables();
  const movement = (product, amount) => inventory.createTransaction({ product_id: product, department_id: 1, transaction_type: 'receive', quantity: amount, reference_type: 'simulation', reference_id: null, notes: 'Synthetic audit fixture', created_by: 1 });
  await movement(1, 10);
  await Promise.all(Array.from({ length: 20 }, () => movement(1, 1)));
  const [[existingBalance]] = await db.query('SELECT quantity FROM inventory_balance WHERE product_id=1 AND department_id=1');
  assert.equal(Number(existingBalance.quantity), 30);
  const [[existingLedger]] = await db.query('SELECT SUM(quantity) AS quantity, COUNT(*) AS count FROM inventory_transactions WHERE product_id=1');
  assert.equal(Number(existingLedger.quantity), 30); assert.equal(Number(existingLedger.count), 21);
  passed.push('20 concurrent increments preserve an existing balance and ledger');
  await Promise.all(Array.from({ length: 20 }, () => movement(2, 1)));
  const [[newBalance]] = await db.query('SELECT quantity FROM inventory_balance WHERE product_id=2 AND department_id=1');
  assert.equal(Number(newBalance.quantity), 20);
  passed.push('20 concurrent first receipts preserve a newly created balance');

  const order = await import('../src/models/order.model.js');
  const po = await import('../src/models/purchase-order.model.js');
  await order.ensureOrderReceivingColumns();
  const created = await order.createOrder({ user_id: 1, order_date: '2026-11-04', items: [{ product_id: 1, source_product_group_id: 1, quantity: 5, requested_price: 10 }] });
  await order.updateOrder(created.id, { items: [{ product_id: 1, quantity: 6, requested_price: 10 }] }, { isAdmin: true });
  const [[orderItem]] = await db.query('SELECT id FROM order_items WHERE order_id=?', [created.id]);
  await order.updateReceivingItems([{ order_item_id: orderItem.id, received_quantity: 0 }], 1, { userId: 1 });
  await assert.rejects(order.updateOrder(created.id, { items: [{ product_id: 1, quantity: 7, requested_price: 10 }] }, { isAdmin: true }), (error) => error.statusCode === 400);
  await assert.rejects(order.deleteOrder(created.id), (error) => error.statusCode === 400);
  const [[retained]] = await db.query('SELECT id,received_quantity FROM order_items WHERE id=?', [orderItem.id]);
  assert.equal(retained.id, orderItem.id); assert.equal(Number(retained.received_quantity), 0);
  passed.push('normal order edits succeed; zero receipt blocks destructive replacement/deletion');

  await po.ensurePurchaseOrderTables();
  const purchase = await po.createPurchaseOrder({ supplierMasterId: 1, departmentId: 1, branchId: 1, createdBy: 1, poDate: '2026-11-04', items: [{ product_id: 1, quantity_ordered: 4, unit_price: 2 }] });
  const received = await po.receivePurchaseOrder({ poId: purchase.id, items: [{ po_item_id: purchase.items[0].id, quantity_received: 2 }], receivedBy: 1 });
  assert.equal(received.status, 'partial');
  await assert.rejects(po.cancelPurchaseOrder(purchase.id), (error) => error.statusCode === 400);
  const [[afterPo]] = await db.query('SELECT quantity FROM inventory_balance WHERE product_id=1 AND department_id=1');
  assert.equal(Number(afterPo.quantity), 32);
  passed.push('real PO partial receipt updates ledger/balance and cannot be cancelled');
  const concurrentOrders = await Promise.all(Array.from({ length: 30 }, () => order.createOrder({ user_id: 1, order_date: '2026-11-04', items: [{ product_id: 1, source_product_group_id: 1, quantity: 1, requested_price: 1 }] })));
  assert.equal(new Set(concurrentOrders.map((row) => row.order_number)).size, 30);
  passed.push('30 simultaneous order creations produce unique numbers without exhausting the 30-connection pool');
  const concurrentPOs = await Promise.all(Array.from({ length: 6 }, () => po.createPurchaseOrder({ supplierMasterId: 1, departmentId: 1, branchId: 1, createdBy: 1, poDate: '2026-11-04', items: [{ product_id: 1, quantity_ordered: 4, unit_price: 2 }] })));
  assert.equal(new Set(concurrentPOs.map((row) => row.po_number)).size, 6);
  passed.push('6 simultaneous PO creations retry number conflicts and retain unique sequential numbers');

  const racePO = concurrentPOs[0];
  let signalRead, releaseRead;
  const readReached = new Promise((resolve) => { signalRead = resolve; });
  const resumeRead = new Promise((resolve) => { releaseRead = resolve; });
  const originalQuery = pool.query;
  pool.query = async (...args) => {
    const result = await originalQuery(...args);
    if (String(args[0]).includes('SELECT id, status FROM purchase_orders')) {
      signalRead();
      await resumeRead;
    }
    return result;
  };
  try {
    const cancellation = po.cancelPurchaseOrder(racePO.id).then(() => null, (error) => error);
    await readReached;
    await po.receivePurchaseOrder({ poId: racePO.id, items: [{ po_item_id: racePO.items[0].id, quantity_received: 4 }], receivedBy: 1 });
    releaseRead();
    assert.equal((await cancellation)?.statusCode, 409);
    const [[raceStatus]] = await db.query('SELECT status FROM purchase_orders WHERE id=?', [racePO.id]);
    assert.equal(raceStatus.status, 'completed');
    passed.push('forced real-SQL cancellation/receiving race preserves completed status with HTTP 409');
  } finally {
    releaseRead();
    pool.query = originalQuery;
  }

  console.log(JSON.stringify({ database, passed, assertions: 'all passed' }, null, 2));
} finally {
  if (pool) await pool.end();
  await db.end();
}
