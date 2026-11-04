// Manual opt-in native SQL validation against a disposable SSD MySQL instance.
// Creates a uniquely named empty database; never targets an application database.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const port = Number(process.env.SOLAO_AUDIT_MYSQL_PORT);
assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1', 'SSD simulation required');
assert.ok((await realpath(process.cwd())).startsWith('/Volumes/SSD Files/SOLAO/'), 'Run only from SSD snapshot');
assert.ok(Number.isSafeInteger(port) && port > 1024 && port <= 65535 && port !== 3306, 'Explicit isolated MySQL port required');
const rootInput = process.env.SOLAO_AUDIT_MYSQL_ROOT;
assert.ok(rootInput, 'Explicit newly created disposable MySQL root required');
const root = await realpath(rootInput);
assert.match(root, /^\/Volumes\/SSD Files\/SOLAO\/market-order-system\/tmp\/market-gate-[a-f0-9]{8}$/, 'Unexpected disposable instance root');
const identity = JSON.parse(await readFile(`${root}/identity.json`, 'utf8'));
assert.equal(identity.scope, 'new-disposable-market-instance');
assert.equal(identity.purpose, 'simplification-release-20261104');
assert.equal(await realpath(identity.root), root);
assert.equal(await realpath(identity.datadir), await realpath(`${root}/data`));
assert.equal(identity.port, port);
assert.ok(typeof identity.serverUuid === 'string' && identity.serverUuid.length > 0, 'Missing disposable server UUID');
const database = `audit_gp_${Date.now()}_${randomUUID().slice(0, 8)}`;
const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '' });
let pool;
const passed = [];
try {
  // A random port alone is insufficient: positively identify the actual server
  // and reject any instance that already contains application/test databases.
  const [[server]] = await admin.query('SELECT @@datadir AS datadir, @@port AS port, @@server_uuid AS serverUuid');
  assert.equal(await realpath(server.datadir), await realpath(identity.datadir));
  assert.equal(Number(server.port), port);
  assert.equal(server.serverUuid, identity.serverUuid);
  const [schemas] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA');
  const systemSchemas = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
  assert.ok(schemas.every(row => systemSchemas.has(row.name)), 'Disposable instance must contain system schemas only');
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${database}\``);
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: '',
    DB_NAME: database, DB_CONNECTION_LIMIT: '4', DB_RETRY_ATTEMPTS: '1'
  });
  pool = (await import('../src/config/database.js')).default;
  const gp = await import('../src/models/general-purchase.model.js');
  await gp.ensureGeneralPurchaseTables();
  for (let id = 1; id <= 41; id++) {
    await admin.query(`INSERT INTO general_purchase_orders
      (id, pr_number, status, request_date, branch_name, department_name, subtotal_amount, actual_total_amount, created_at)
      VALUES (?, ?, ?, '2026-11-04', ?, ?, ?, ?, '2026-11-04 00:00:00')`, [
      id, `PR-SIM-${id}`, id === 36 || id === 37 ? 'approved' : 'pending_review',
      id >= 38 && id <= 40 ? 'SK' : 'KK', id === 41 ? 'Office' : 'Kitchen', id === 35 ? 1.23 : 0, id === 35 ? 99.99 : 0
    ]);
  }
  const image = 'data:image/png;base64,SYNTHETIC_FIXTURE';
  await admin.query(`INSERT INTO general_purchase_order_items
    (general_purchase_order_id, item_name, requested_quantity, estimated_price, actual_price, item_image_data_url)
    VALUES ?`, [[
    [35, 'Synthetic first', 2, 100, 0, image],
    [35, 'Synthetic second', 1, 50.25, 0, null],
    [35, 'Synthetic third', 1, 0, 7, null]
  ]]);
  await admin.query(`INSERT INTO general_purchase_order_logs
    (general_purchase_order_id, to_status, action, actor_name, details)
    VALUES (35, 'pending_review', 'create_pr', 'Synthetic actor', 'Synthetic audit evidence')`);

  const filters = { branch: 'KK', department: 'Kitchen', status: 'pending_review', pageSize: 30 };
  const first = await gp.getGeneralPurchaseOrderSummaries({ ...filters, page: 1 });
  assert.equal(first.orders.length, 30);
  assert.deepEqual(first.pagination, { page: 1, page_size: 30, total: 35, total_pages: 2 });
  assert.deepEqual(first.stats, { total: 37, byStatus: { approved: 2, pending_review: 35 } });
  const second = await gp.getGeneralPurchaseOrderSummaries({ ...filters, page: 2 });
  assert.equal(second.orders.length, 5);
  assert.equal(new Set([...first.orders, ...second.orders].map(row => row.id)).size, 35);
  assert.ok([...first.orders, ...second.orders].every(row => row.header.branch === 'KK' && row.header.department === 'Kitchen' && row.status === 'pending_review'));
  passed.push('real SQL pagination, ordering, counts and branch/department/status scopes');

  const summary = first.orders.find(row => row.id === 35);
  assert.ok(summary);
  assert.equal(summary.summary, true);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.itemSummary, 'Synthetic first · Synthetic second และอีก 1 รายการ');
  assert.deepEqual(summary.items, []); assert.deepEqual(summary.timeline, []);
  assert.equal(JSON.stringify(first).includes('base64'), false);
  passed.push('summary item aggregates omit full image/item/audit payloads');

  assert.equal(summary.itemEstimatedTotal, 150.25); assert.equal(summary.subtotalAmount, 1.23);
  assert.equal(summary.itemActualTotal, 7); assert.equal(summary.actualTotalAmount, 99.99);
  const empty = first.orders.find(row => row.id === 34);
  assert.equal(empty.itemCount, 0); assert.equal(empty.itemEstimatedTotal, 0); assert.equal(empty.itemActualTotal, 0);
  passed.push('item-sum monetary display remains separate from deliberately different header totals; zero/empty retained');

  const legacy = await gp.getGeneralPurchaseOrders({ branch: 'KK', department: 'Kitchen' });
  assert.equal(legacy.length, 37);
  assert.equal(legacy.find(row => row.id === 35).items[0].imageDataUrl, image);
  const detail = await gp.getGeneralPurchaseOrderById(35);
  assert.equal(detail.items.length, 3); assert.equal(detail.items[0].imageDataUrl, image);
  assert.equal(detail.timeline[0].note, 'Synthetic audit evidence');
  assert.equal(detail.items.reduce((sum, item) => sum + item.totalPrice, 0), summary.itemEstimatedTotal);
  assert.equal(detail.items.reduce((sum, item) => sum + item.actualPrice, 0), summary.itemActualTotal);
  passed.push('legacy list and full detail retain image, audit and exact prior item-sum display contracts');

  const beyond = await gp.getGeneralPurchaseOrderSummaries({ ...filters, page: 3 });
  assert.deepEqual(beyond.orders, []); assert.equal(beyond.pagination.total, 35);
  await assert.rejects(gp.getGeneralPurchaseOrderSummaries({ pageSize: 101 }), error => error.statusCode === 400);
  passed.push('out-of-range page returns empty rows with true totals and oversized page_size rejects');

  // Explicit old/manual suffixes can contain gaps. New automatic allocation
  // must advance past MAX, not reuse COUNT+1, and concurrent PRs must retry.
  for (let id = 101; id <= 110; id++) {
    await admin.query(`INSERT INTO general_purchase_orders
      (id, pr_number, status, request_date, branch_name, department_name)
      VALUES (?, ?, 'approved', '2026-11-05', 'SIM', 'SIM')`, [id, `PR-SIM-${id}`]);
  }
  await admin.query(`UPDATE general_purchase_orders SET status = 'awaiting_receipt',
    po_date = '2026-11-05', po_number = ? WHERE id = ?`, ['GPO-20261105-001', 36]);
  await admin.query(`UPDATE general_purchase_orders SET status = 'awaiting_receipt',
    po_date = '2026-11-05', po_number = ? WHERE id = ?`, ['GPO-20261105-003', 37]);
  const issue = (id, poNumber = '') => gp.issueGeneralPurchasePO({
    id, poNumber, poDate: '2026-11-05', vendorName: 'Synthetic vendor', actor: { name: 'Synthetic actor' }
  });
  assert.equal((await issue(101)).poNumber, 'GPO-20261105-004');
  passed.push('automatic GP PO allocation advances gap 001/003 to 004');

  const concurrent = await Promise.all([102, 103, 104, 105, 106, 107].map(id => issue(id)));
  assert.equal(new Set(concurrent.map(row => row.poNumber)).size, 6);
  assert.deepEqual(concurrent.map(row => Number(row.poNumber.split('-').pop())).sort((a, b) => a - b), [5, 6, 7, 8, 9, 10]);
  const [issueLogs] = await admin.query(`SELECT general_purchase_order_id, COUNT(*) AS count
    FROM general_purchase_order_logs WHERE action = 'issue_po' AND general_purchase_order_id BETWEEN 101 AND 107
    GROUP BY general_purchase_order_id`);
  assert.equal(issueLogs.length, 7); assert.ok(issueLogs.every(row => Number(row.count) === 1));
  passed.push('six concurrent different-PR blank issues allocate unique sequential numbers and exactly one audit each');

  await assert.rejects(issue(108, 'GPO-20261105-003'), error => error.statusCode === 409);
  const [[manual]] = await admin.query('SELECT status, po_number FROM general_purchase_orders WHERE id = 108');
  assert.equal(manual.status, 'approved'); assert.equal(manual.po_number, null);
  const [[manualLogs]] = await admin.query("SELECT COUNT(*) AS count FROM general_purchase_order_logs WHERE general_purchase_order_id = 108 AND action = 'issue_po'");
  assert.equal(Number(manualLogs.count), 0);
  passed.push('explicit duplicate GP PO number returns 409 with approved state and no issue audit');

  const samePr = await Promise.allSettled([issue(109), issue(109)]);
  assert.equal(samePr.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = samePr.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
  const [[sameLogs]] = await admin.query("SELECT COUNT(*) AS count FROM general_purchase_order_logs WHERE general_purchase_order_id = 109 AND action = 'issue_po'");
  assert.equal(Number(sameLogs.count), 1);
  passed.push('concurrent same-PR issues preserve state conflict and a single committed issue audit');

  await admin.query(`UPDATE general_purchase_orders SET status = 'awaiting_receipt',
    po_number = 'GPO-20261106-001', po_date = '2026-11-04' WHERE id = 110`);
  await admin.query(`INSERT INTO general_purchase_orders
    (id, pr_number, status, request_date, po_date, po_number, branch_name, department_name)
    VALUES (111, 'PR-SIM-111', 'approved', '2026-11-06', NULL, NULL, 'SIM', 'SIM'),
    (112, 'PR-SIM-112', 'awaiting_receipt', '2026-11-06', '2026-11-06', 'CUSTOM-999999', 'SIM', 'SIM')`);
  const crossDate = await gp.issueGeneralPurchasePO({ id: 111, poDate: '2026-11-06', vendorName: 'Synthetic vendor' });
  assert.equal(crossDate.poNumber, 'GPO-20261106-002');
  passed.push('matching embedded date prefix reserves suffix despite different stored PO date; unrelated custom numeric suffix does not advance allocation');
  console.log(JSON.stringify({ database, scenarios: passed.length, passed, assertions: 'all passed' }, null, 2));
} finally {
  if (pool) await pool.end();
  await admin.end();
}
