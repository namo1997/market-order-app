import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Deliberately opt-in: normal tests/*.test.mjs does not include this file.
// User-authorized conditional skip only when no integration socket is supplied.
const enabled = Boolean(process.env.RECEIVING_IT_MYSQL_SOCKET);
const options = { skip: enabled ? false : 'Set RECEIVING_IT_MYSQL_SOCKET for disposable SSD MySQL', timeout: 30000 };
let h;
let sequence = 0;
const api = '/api/receiving-documents';
const today = '2026-10-15';
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f9sAAAAASUVORK5CYII=';

before(async () => {
  if (!enabled) return;
  const { openHarness } = await import('./receiving-mysql-harness.mjs');
  h = await openHarness();
  await h.setup();
});
beforeEach(async () => { if (h) { await h.reset(); sequence = 0; } });
after(async () => { if (h) await h.close(); });

async function request(method, suffix, body, actor = 1) {
  return h.request(method, `${api}${suffix}`, body, actor);
}
function success(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  return response.body.data;
}
async function scalar(sql, params = []) {
  const [[row]] = await h.raw.query(sql, params);
  return Object.values(row)[0];
}
async function orderItem({ product = 1, quantity = '20.00' } = {}) {
  const [order] = await h.raw.query(
    "INSERT INTO orders (order_number,user_id,order_date,status) VALUES (?,1,?,'submitted')",
    [`IT-order-${++sequence}`, today]);
  const [item] = await h.raw.query(
    'INSERT INTO order_items (order_id,product_id,quantity,actual_price,receive_notes) VALUES (?,?,?,2.345678,?)',
    [order.insertId, product, quantity, 'original receiving note']);
  return item.insertId;
}
async function draft({ actor = 1, supplier = true, items = [], uuid } = {}) {
  return success(await request('POST', '/', {
    client_uuid: uuid || `IT-document-${++sequence}`, delivery_date: today,
    kind: 'bill', ...(supplier ? { product_group_id: 1 } : {}), order_item_ids: items
  }, actor), 201);
}
async function ready({ actor = 1, product = 1, item = null, qty = '2.50', price = '12.123456',
  text = 'IT alias', supplier = true } = {}) {
  const doc = await draft({ actor, supplier });
  success(await request('PUT', `/${doc.id}`, { lines: [{
    line_no: 1, bill_text: text, product_id: product, order_item_id: item,
    unit_text: '', unit_id: 1, quantity_received: qty, unit_price: price,
    unit_multiplier: 1, match: { source: 'manual', confidence: 1 }
  }] }, actor));
  success(await request('POST', `/${doc.id}/signatures`, {
    role: 'receiver', image_data_url: signature, name: `IT user ${actor}`
  }, actor));
  return doc;
}
async function snapshot() {
  const result = {};
  for (const table of ['orders', 'order_items', 'inventory_balance', 'inventory_transactions',
    'supplier_product_aliases', 'supplier_product_alias_events', 'receiving_documents',
    'receiving_document_lines', 'receiving_document_images', 'receiving_document_audits']) {
    const [rows] = await h.raw.query(`SELECT * FROM ${table} ORDER BY id`);
    result[table] = rows;
  }
  return result;
}
async function seedAlias() {
  // Omit candidate/count/unit fields: exercise actual CREATE TABLE DEFAULTs.
  await h.raw.query(`INSERT INTO supplier_product_aliases
    (supplier_key,bill_text,normalized_bill_text,product_id)
    VALUES ('pg:1','IT alias','it alias',1)`);
  const [[alias]] = await h.raw.query('SELECT * FROM supplier_product_aliases');
  assert.equal(alias.confirm_count, 1);
  assert.equal(alias.candidate_product_id, null);
  assert.equal(alias.candidate_confirm_count, 0);
  assert.equal(alias.normalized_unit_text, '');
  assert.equal(alias.unit_multiplier, '1.0000');
  return alias.id;
}

test('MySQL schema: real InnoDB, unique indexes, DECIMAL scales, defaults and repeatable ensure', options, async () => {
  const [[before]] = await h.raw.query('SHOW CREATE TABLE receiving_document_lines');
  await h.app.schema.ensureReceivingDocumentsTables(h.raw, { force: true });
  await h.app.schema.ensureReceivingDocumentsTables(h.raw, { force: true });
  const [[after]] = await h.raw.query('SHOW CREATE TABLE receiving_document_lines');
  assert.equal(after['Create Table'], before['Create Table']);
  const [tables] = await h.raw.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
    ('order_items','inventory_balance','inventory_transactions','receiving_documents','supplier_product_aliases')`);
  assert.equal(tables.length, 5);
  for (const row of tables) assert.equal(row.ENGINE, 'InnoDB');
  const [columns] = await h.raw.query(`SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='receiving_document_lines'
    AND COLUMN_NAME IN ('quantity_received','unit_price')`);
  const types = Object.fromEntries(columns.map(c => [c.COLUMN_NAME, c.COLUMN_TYPE]));
  assert.equal(types.quantity_received, 'decimal(10,2)');
  assert.equal(types.unit_price, 'decimal(12,6)');
  const [keys] = await h.raw.query('SHOW INDEX FROM receiving_documents WHERE Key_name=?', ['uq_receiving_documents_client_uuid']);
  assert.equal(keys[0].Non_unique, 0);
  await seedAlias();
});

test('POST same client_uuid concurrently: actual unique collision returns one document and one audit', options, async () => {
  const body = { client_uuid: 'IT-same-client-uuid', delivery_date: today, kind: 'bill' };
  const results = await h.concurrent(/INSERT\s+INTO\s+receiving_documents\s*\(/i,
    () => Promise.all([request('POST', '/', body), request('POST', '/', body)]));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  assert.ok(h.sqlErrors.includes('ER_DUP_ENTRY'), 'Must hit the real unique constraint');
  assert.equal(await scalar('SELECT COUNT(*) FROM receiving_documents WHERE client_uuid=?', [body.client_uuid]), 1);
  assert.equal(await scalar("SELECT COUNT(*) FROM receiving_document_audits WHERE action='create'"), 1);
  const again = success(await request('POST', '/', body));
  assert.equal(again.id, results[0].body.data.id);
});

test('concurrent confirm on two real connections: one 200, one 409, one inventory increment', options, async () => {
  const item = await orderItem();
  const doc = await ready({ item });
  const results = await h.concurrent(/FROM receiving_documents rd\s+WHERE rd.id = \?\s+FOR UPDATE/i,
    () => Promise.all([request('POST', `/${doc.id}/confirm`, {}, 1), request('POST', `/${doc.id}/confirm`, {}, 2)]));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409).body.code, 'NOT_DRAFT');
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '2.50');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance WHERE product_id=1'), '2.50');
  assert.equal(await scalar('SELECT COUNT(*) FROM inventory_transactions'), 1);
  assert.equal(await scalar('SELECT COUNT(*) FROM supplier_product_alias_events'), 1);
  assert.equal(await scalar("SELECT COUNT(*) FROM receiving_document_audits WHERE action='confirm'"), 1);
});

test('void late SQL failure rolls back all tables; retry succeeds and second void changes nothing', options, async () => {
  const item = await orderItem();
  const doc = await ready({ item });
  success(await request('PUT', `/${doc.id}`, { lines: [{
    line_no: 2, bill_text: 'IT unlinked', product_id: 2, quantity_received: '1.25', unit_price: '3.00'
  }] }));
  success(await request('POST', `/${doc.id}/confirm`));
  const confirmed = await snapshot();
  await h.raw.query(`CREATE TRIGGER it_fail_void_audit BEFORE INSERT ON receiving_document_audits
    FOR EACH ROW BEGIN IF NEW.action='void' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IT forced late void failure';
    END IF; END`);
  try {
    const result = await request('POST', `/${doc.id}/void`, { reason: 'IT rollback probe' });
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(result.body).includes('45000'), false);
    assert.equal(JSON.stringify(result.body).includes('stack'), false);
    assert.ok(h.sqlErrors.includes('ER_SIGNAL_EXCEPTION'));
    assert.deepEqual(await snapshot(), confirmed, 'Every row and value must roll back, including alias history and audits');
  } finally { await h.raw.query('DROP TRIGGER it_fail_void_audit'); }
  success(await request('POST', `/${doc.id}/void`, { reason: 'IT retry' }));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), null);
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), 'original receiving note');
  const [balances] = await h.raw.query('SELECT quantity FROM inventory_balance ORDER BY product_id');
  assert.deepEqual(balances.map(r => r.quantity), ['0.00', '0.00']);
  const voided = await snapshot();
  const twice = await request('POST', `/${doc.id}/void`, { reason: 'IT repeated void' });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.code, 'NOT_DRAFT');
  assert.deepEqual(await snapshot(), voided);
});

test('confirm late SQL failure rolls back order, inventory, alias learning, document and audit', options, async () => {
  const item = await orderItem();
  const doc = await ready({ item });
  const original = await snapshot();
  await h.raw.query(`CREATE TRIGGER it_fail_confirm_audit BEFORE INSERT ON receiving_document_audits
    FOR EACH ROW BEGIN IF NEW.action='confirm' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IT forced late confirm failure';
    END IF; END`);
  try {
    const result = await request('POST', `/${doc.id}/confirm`);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'INTERNAL_ERROR');
    assert.ok(h.sqlErrors.includes('ER_SIGNAL_EXCEPTION'));
    assert.deepEqual(await snapshot(), original);
  } finally { await h.raw.query('DROP TRIGGER it_fail_confirm_audit'); }
  success(await request('POST', `/${doc.id}/confirm`));
});

test('alias DEFAULTs: three distinct ordinary users promote candidate product only on third confirmation', options, async () => {
  const id = await seedAlias();
  for (const actor of [1, 2, 3]) {
    const doc = await ready({ actor, product: 2 });
    success(await request('POST', `/${doc.id}/confirm`, {}, actor));
    const [[alias]] = await h.raw.query('SELECT * FROM supplier_product_aliases WHERE id=?', [id]);
    assert.equal(alias.product_id, actor === 3 ? 2 : 1);
    assert.equal(alias.candidate_confirm_count, actor === 3 ? 0 : actor);
  }
  assert.equal(await scalar("SELECT COUNT(*) FROM supplier_product_alias_events WHERE decision='candidate_promoted'"), 1);
});

test('alias DEFAULTs: one user confirming candidate three times must not promote', options, async () => {
  const id = await seedAlias();
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await ready({ product: 2 });
    success(await request('POST', `/${doc.id}/confirm`));
  }
  const [[alias]] = await h.raw.query('SELECT * FROM supplier_product_aliases WHERE id=?', [id]);
  assert.equal(alias.product_id, 1);
  assert.equal(alias.candidate_product_id, 2);
  assert.equal(alias.candidate_confirm_count, 1);
  assert.equal(await scalar("SELECT COUNT(*) FROM supplier_product_alias_events WHERE decision='candidate_recorded'"), 3);
});

test('supplier none never learns an alias or an alias event', options, async () => {
  const doc = await ready({ supplier: false });
  success(await request('POST', `/${doc.id}/confirm`));
  assert.equal(await scalar('SELECT COUNT(*) FROM supplier_product_aliases'), 0);
  assert.equal(await scalar('SELECT COUNT(*) FROM supplier_product_alias_events'), 0);
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '2.50');
});

test('quantity 9.125 is rejected 422 or stored at two decimals and voids exactly', options, async () => {
  const item = await orderItem();
  const doc = await draft();
  const original = await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]);
  const result = await request('PUT', `/${doc.id}`, { lines: [{
    product_id: 1, order_item_id: item, quantity_received: '9.125', unit_price: '0.123456'
  }] });
  if (result.status === 422) {
    assert.equal(result.body.code, 'VALIDATION_FAILED');
    assert.equal(await scalar('SELECT COUNT(*) FROM receiving_document_lines WHERE document_id=?', [doc.id]), 0);
    assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), original);
    return;
  }
  success(result);
  const stored = await scalar('SELECT quantity_received FROM receiving_document_lines WHERE document_id=?', [doc.id]);
  assert.match(stored, /^9\.1[23]$/);
  success(await request('POST', `/${doc.id}/signatures`, { role: 'receiver', image_data_url: signature }));
  success(await request('POST', `/${doc.id}/confirm`));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), stored);
  success(await request('POST', `/${doc.id}/void`, { reason: 'IT decimal round trip' }));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), original);
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '0.00');
});

test('unit_price DECIMAL(12,6) survives persistence, confirm, alias and void without precision loss', options, async () => {
  const item = await orderItem();
  const doc = await ready({ item, qty: '1.00', price: '0.123456' });
  const [[line]] = await h.raw.query('SELECT unit_price,base_unit_price FROM receiving_document_lines WHERE document_id=?', [doc.id]);
  assert.equal(line.unit_price, '0.123456');
  assert.equal(line.base_unit_price, '0.123456');
  success(await request('POST', `/${doc.id}/confirm`));
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '0.123456');
  assert.equal(await scalar('SELECT last_unit_price FROM supplier_product_aliases'), '0.123456');
  assert.equal(await scalar('SELECT unit_price FROM supplier_product_alias_events'), '0.123456');
  success(await request('POST', `/${doc.id}/void`, { reason: 'IT price precision' }));
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '2.345678');
});

test('two bills accumulate for one order_item; void FIRST bill preserves SECOND bill contribution', options, async () => {
  const item = await orderItem();
  const first = await ready({ item, qty: '2.25', price: '10.00' });
  success(await request('POST', `/${first.id}/confirm`));
  const second = await ready({ item, qty: '3.50', price: '12.123456' });
  success(await request('POST', `/${second.id}/confirm`));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '5.75');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '5.75');
  // Strict delta contract: later receipt metadata and quantity must survive.
  success(await request('POST', `/${first.id}/void`, { reason: 'IT void first bill' }));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '3.50');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '3.50');
  assert.equal(await scalar('SELECT status FROM receiving_documents WHERE id=?', [second.id]), 'confirmed');
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '12.123456');
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), `รับสินค้าตามเอกสาร #${second.id}`);
  success(await request('POST', `/${second.id}/void`, { reason: 'IT void remaining second bill' }));
  assert.equal(Number(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item])), 0);
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '0.00');
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '2.345678');
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), 'original receiving note');
});

test('legacy GET /api/orders/receiving executes actual route/controller/order SQL', options, async () => {
  const item = await orderItem();
  const response = await h.request('GET', `/api/orders/receiving?date=${today}`);
  const items = success(response);
  assert.equal(response.body.count, 1);
  assert.equal(items[0].order_item_id, item);
  assert.equal(items[0].quantity, '20.00');
  assert.equal(items[0].product_id, 1);
  assert.equal(await scalar('SELECT COUNT(*) FROM inventory_transactions'), 0);
});

test('legacy PUT /api/orders/receiving updates received quantity and inventory exactly once', options, async () => {
  const item = await orderItem();
  const body = { items: [{ order_item_id: item, received_quantity: '4.25', receive_notes: 'IT legacy receipt' }] };
  const first = success(await h.request('PUT', `/api/orders/receiving?date=${today}`, body));
  assert.equal(first.updated, 1);
  success(await h.request('PUT', `/api/orders/receiving?date=${today}`, body));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '4.25');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '4.25');
  assert.equal(await scalar('SELECT COUNT(*) FROM inventory_transactions'), 1);
});


test('delta void LAST bill first restores previous price; independent edits survive final reversal', options, async () => {
  const item = await orderItem();
  const first = await ready({ item, qty: '2.25', price: '10.00' });
  success(await request('POST', `/${first.id}/confirm`));
  const second = await ready({ item, qty: '3.50', price: '12.00' });
  success(await request('POST', `/${second.id}/confirm`));
  success(await request('POST', `/${second.id}/void`, { reason: 'IT last first' }));
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '2.25');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '2.25');
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '10.000000');
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), `รับสินค้าตามเอกสาร #${first.id}`);
  await h.raw.query('UPDATE order_items SET actual_price=?, receive_notes=?, quantity=? WHERE id=?',
    ['19.123456', 'new manual note', '25.00', item]);
  success(await request('POST', `/${first.id}/void`, { reason: 'IT final with manual edits' }));
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '0.00');
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '19.123456');
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), 'new manual note');
  assert.equal(await scalar('SELECT quantity FROM order_items WHERE id=?', [item]), '25.00');
});

for (const failure of ['cancelled', 'received-underflow']) {
  test(`delta void ${failure} leaves all tables unchanged`, options, async () => {
    const item = await orderItem();
    const doc = await ready({ item, qty: '2.25' });
    success(await request('POST', `/${doc.id}/confirm`));
    if (failure === 'cancelled') await h.raw.query("UPDATE orders SET status='cancelled'");
    if (failure === 'received-underflow') await h.raw.query('UPDATE order_items SET received_quantity=2 WHERE id=?', [item]);
    const before = await snapshot();
    const response = await request('POST', `/${doc.id}/void`, { reason: 'IT negative guard' });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'NOT_DRAFT');
    assert.deepEqual(await snapshot(), before);
  });
}

test('concurrent delta void on two real connections succeeds once and subtracts only first bill', options, async () => {
  const item = await orderItem();
  const first = await ready({ item, qty: '2.25' });
  success(await request('POST', `/${first.id}/confirm`));
  const second = await ready({ item, qty: '3.50' });
  success(await request('POST', `/${second.id}/confirm`));
  const results = await h.concurrent(/FROM receiving_documents rd\s+WHERE rd.id = \?\s+FOR UPDATE/i,
    () => Promise.all([request('POST', `/${first.id}/void`, { reason: 'IT race' }),
      request('POST', `/${first.id}/void`, { reason: 'IT race' })]));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item]), '3.50');
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '3.50');
  assert.equal(await scalar("SELECT COUNT(*) FROM receiving_document_audits WHERE action='void'"), 1);
});


test('concurrent void of different bills sharing an order serializes delta and metadata rebasing', options, async () => {
  const item = await orderItem();
  const first = await ready({ item, qty: '2.25', price: '10.00' });
  success(await request('POST', `/${first.id}/confirm`));
  const second = await ready({ item, qty: '3.50', price: '12.00' });
  success(await request('POST', `/${second.id}/confirm`));
  const results = await h.concurrent(/FROM receiving_documents rd\s+WHERE rd.id = \?\s+FOR UPDATE/i,
    () => Promise.all([request('POST', `/${first.id}/void`, { reason: 'IT two bills race' }),
      request('POST', `/${second.id}/void`, { reason: 'IT two bills race' })]));
  for (const result of results) success(result);
  assert.equal(Number(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item])), 0);
  assert.equal(await scalar('SELECT quantity FROM inventory_balance'), '0.00');
  assert.equal(await scalar('SELECT actual_price FROM order_items WHERE id=?', [item]), '2.345678');
  assert.equal(await scalar('SELECT receive_notes FROM order_items WHERE id=?', [item]), 'original receiving note');
});


test('R2 OCR custom provider with two linked items, priced line and absent doc_kind persists via real SQL and caches', options, async () => {
  const items = [await orderItem(), await orderItem({ product: 2 })];
  const doc = await draft({ items });
  const jpeg = Buffer.alloc(23);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 3, 0, 2, 3]);
  jpeg.set([0xff, 0xd9], 21);
  success(await request('POST', `/${doc.id}/images`, {
    page_no: 1, image_data_url: `data:image/jpeg;base64,${jpeg.toString('base64')}`
  }), 201);
  let calls = 0;
  h.app.ocr.setCustomOcrProvider(async ({ expectedItems }) => {
    calls++;
    assert.equal(expectedItems.length, 2);
    assert.deepEqual(Object.keys(expectedItems[0]).sort(), ['product_name', 'quantity_ordered', 'unit_name']);
    return { model: 'SYNTHETIC-mock', supplier_name: 'SYNTHETIC supplier', doc_ref: 'SYNTHETIC-ocr',
      doc_date: '16/10/2569', subtotal: '25.00', discount: '0.00', vat: '0.00', total: '25.00', confidence: 1,
      lines: [{ bill_text: expectedItems[0].product_name, unit_text: expectedItems[0].unit_name,
        quantity_billed: '2.50', unit_price: '10.00', amount: '25.00', confidence: 1 }] };
  });
  try {
    const result = success(await request('POST', `/${doc.id}/ocr`));
    assert.equal(result.status, 'draft');
    assert.equal(result.ocr.status, 'done');
    assert.equal(result.ocr.doc_kind, 'other');
    assert.ok(result.ocr.warnings.includes('NOT_A_BILL'));
    assert.equal(result.total, '25.00');
    assert.equal(result.doc_date, '2026-10-16');
    assert.equal(result.lines.length, 2);
    const line = result.lines.find(l => l.order_item_id === items[0]);
    assert.equal(Number(line.quantity_received), 2.5);
    assert.equal(line.unit_price, '10.00');
    assert.equal(line.amount, '25.00');
    assert.equal(line.unit_id, 1);
    const omitted = result.lines.find(l => l.order_item_id === items[1]);
    assert.equal(Number(omitted.quantity_received), 0);
    assert.equal(omitted.unit_price, null);
    assert.equal(omitted.amount, null);
    assert.deepEqual(success(await request('GET', `/${doc.id}`)), result);
    assert.deepEqual(success(await request('POST', `/${doc.id}/ocr`)), result);
    assert.equal(calls, 1);
    assert.equal(await scalar("SELECT COUNT(*) FROM receiving_document_audits WHERE action='ocr'"), 1);
    assert.equal(h.sqlErrors.length, 0);
  } finally { h.app.ocr.setCustomOcrProvider(async () => { throw new Error('Unexpected OCR in SQL test'); }); }
});

for (const mode of ['linked', 'unlinked', 'transfer']) {
  test(`R2 void negative ${mode}: exact ledger, warning and audit commit together; late failure rolls back; repeat is 409`, options, async () => {
    const item = mode === 'unlinked' ? null : await orderItem();
    if (mode === 'transfer') {
      await h.raw.query("INSERT INTO departments (id,branch_id,name) VALUES (3,1,'IT source store')");
      await h.raw.query('UPDATE product_groups SET is_internal=true WHERE id=1');
      await h.raw.query('INSERT INTO product_group_withdraw_sources (product_group_id,source_department_id) VALUES (1,3)');
    }
    try {
      const doc = await ready({ item, qty: '2.25' });
      success(await request('POST', `/${doc.id}/confirm`));
      await h.raw.query('UPDATE inventory_balance SET quantity=2 WHERE product_id=1 AND department_id=1');
      const before = await snapshot();
      await h.raw.query(`CREATE TRIGGER it_fail_void_audit BEFORE INSERT ON receiving_document_audits
        FOR EACH ROW BEGIN IF NEW.action='void' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IT forced negative void failure';
        END IF; END`);
      try {
        const failed = await request('POST', `/${doc.id}/void`, { reason: 'IT negative rollback' });
        assert.equal(failed.status, 500);
        assert.equal(failed.body.code, 'INTERNAL_ERROR');
        assert.ok(h.sqlErrors.includes('ER_SIGNAL_EXCEPTION'));
        assert.deepEqual(await snapshot(), before);
      } finally { await h.raw.query('DROP TRIGGER it_fail_void_audit'); }
      const result = success(await request('POST', `/${doc.id}/void`, { reason: 'IT allow negative' }));
      assert.equal(result.status, 'void');
      assert.equal(await scalar('SELECT quantity FROM inventory_balance WHERE product_id=1 AND department_id=1'), '-0.25');
      if (item) assert.equal(Number(await scalar('SELECT received_quantity FROM order_items WHERE id=?', [item])), 0);
      const [tx] = await h.raw.query('SELECT * FROM inventory_transactions WHERE id>? ORDER BY id',
        [Math.max(...before.inventory_transactions.map(t => t.id))]);
      assert.equal(tx.length, mode === 'transfer' ? 2 : 1);
      const target = tx.find(t => t.department_id === 1);
      assert.equal(target.quantity, '-2.25');
      assert.equal(target.balance_before, '2.00');
      assert.equal(target.balance_after, '-0.25');
      if (mode === 'transfer') {
        const source = tx.find(t => t.department_id === 3);
        assert.equal(source.quantity, '2.25');
        assert.equal(source.balance_after, '0.00');
        assert.equal(await scalar('SELECT quantity FROM inventory_balance WHERE department_id=3'), '0.00');
      }
      assert.equal(result.warnings.filter(w => w.code === 'INVENTORY_NEGATIVE_AFTER_VOID').length, 1);
      const details = JSON.parse(await scalar("SELECT details_json FROM receiving_document_audits WHERE action='void'"));
      assert.deepEqual(details.warnings, ['INVENTORY_NEGATIVE_AFTER_VOID']);
      assert.deepEqual(success(await request('GET', `/${doc.id}`)).warnings, result.warnings);
      assert.deepEqual(success(await request('GET', '/'))[0].warnings, result.warnings);
      const voided = await snapshot();
      const repeated = await request('POST', `/${doc.id}/void`, { reason: 'IT repeat negative' });
      assert.equal(repeated.status, 409);
      assert.equal(repeated.body.code, 'NOT_DRAFT');
      assert.deepEqual(await snapshot(), voided);
    } finally {
      if (mode === 'transfer') await h.raw.query('DELETE FROM product_group_withdraw_sources WHERE product_group_id=1');
    }
  });
}
