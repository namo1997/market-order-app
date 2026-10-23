import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { setCustomOcrProvider, resetOcrRateLimit, extractBillWithVision } from '../src/services/receiving-ocr.service.js';
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });
const plain = value => JSON.parse(JSON.stringify(value));

// Execute the actual catalog SELECT (including LIKE/NOT EXISTS/bindings), rather
// than returning a pre-deduplicated fixture. SQLite covers relational behavior;
// it is not a replacement for MySQL deployment verification.
function catalogDb() {
  const db = new DatabaseSync(':memory:');
  db.function('CONCAT', { varargs: true }, (...args) => args.join(''));
  db.exec(`CREATE TABLE departments(id INTEGER, branch_id INTEGER);
    CREATE TABLE supplier_masters(id INTEGER, name TEXT, code TEXT, is_active INTEGER);
    CREATE TABLE product_groups(id INTEGER, name TEXT, code TEXT, is_active INTEGER);
    CREATE TABLE product_supplier_master_links(product_id INTEGER, supplier_master_id INTEGER);
    CREATE TABLE products(id INTEGER, is_active INTEGER);
    CREATE TABLE product_group_links(product_id INTEGER, product_group_id INTEGER);
    CREATE TABLE product_group_scopes(product_group_id INTEGER, branch_id INTEGER, department_id INTEGER);
    INSERT INTO departments VALUES(10,1),(20,2);
    INSERT INTO supplier_masters VALUES(1,'ร้านน้ำแข็ง vic','SYN-SM-ICE-VIC',1);
    INSERT INTO product_groups VALUES(3,' ร้านน้ำแข็ง vic ','SYN-ICE-VIC',1),
      (4,'ร้านน้ำแข็ง vic สาขาอื่น','OTHER',1), (5,'ร้านไม่มีทะเบียน','LEGACY',1);`);
  const queries = [];
  return { db, queries, async query(sql, params = []) {
    queries.push({ sql, params });
    // SQLite has no MySQL collation names. The explicit COLLATE the real SQL carries for the mixed
    // Production collations (supplier_masters is 0900, product_groups is unicode_ci) is verified by
    // receiving-collation.test.mjs and on real MySQL by pilot/collation.test.mjs; only the keyword is dropped here.
    return [db.prepare(sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...params)];
  } };
}

test('N1 actual catalog SQL prefers visible master over duplicate legacy name, including legacy-code searches and literal SQL input', async () => {
  const h = await createReceivingHarness(); const db = catalogDb();
  try {
    for (const q of ['', 'vic', 'SYN-ICE-VIC', 'SYN-SM-ICE-VIC']) {
      const rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q }, db }));
      assert.equal(rows.filter(r => r.supplier_key === 'sm:1').length, 1);
      assert.equal(rows.some(r => r.supplier_key === 'pg:3'), false);
      if (!q) assert.ok(rows.some(r => r.supplier_key === 'pg:5'));
    }
    const input = "%' OR 1=1 --";
    assert.equal((await h.catalog.searchReceivingSuppliers({ user, filters: { q: input }, db })).length, 0);
    assert.ok(!db.queries.at(-1).sql.includes(input));
    db.db.exec("INSERT INTO supplier_masters VALUES(2,'ร้านน้ำแข็ง vic','SECOND',1)");
    const rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'vic' }, db }));
    assert.deepEqual(rows.filter(r => r.supplier_master_id).map(r => r.supplier_master_id), [1,2]);
  } finally { db.db.close(); }
});

test('N1 hidden/inactive master cannot suppress a visible legacy shop; foreign legacy code cannot reveal a master', async () => {
  const h = await createReceivingHarness(); const db = catalogDb();
  try {
    db.db.exec(`INSERT INTO products VALUES(7,1); INSERT INTO product_supplier_master_links VALUES(7,1);
      INSERT INTO product_group_links VALUES(7,9); INSERT INTO product_group_scopes VALUES(9,2,20);`);
    let rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'vic' }, db }));
    assert.ok(rows.some(r => r.supplier_key === 'pg:3')); assert.ok(!rows.some(r => r.supplier_master_id));
    db.db.exec('DELETE FROM product_supplier_master_links; UPDATE supplier_masters SET is_active=0');
    rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'vic' }, db }));
    assert.ok(rows.some(r => r.supplier_key === 'pg:3'));
    db.db.exec('UPDATE supplier_masters SET is_active=1; INSERT INTO product_group_scopes VALUES(3,2,20)');
    assert.equal((await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'SYN-ICE-VIC' }, db })).length, 0);
    const before = db.queries.length;
    await assert.rejects(h.catalog.searchReceivingSuppliers({ user, filters: { branch_id: 2, department_id: 20 }, db }), e => e.code === 'FORBIDDEN');
    assert.equal(db.queries.length, before);
  } finally { db.db.close(); }
});

async function noOrder() {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20', serializeTransactions: true });
  h.state.products.find(p => p.id === 7).name = 'น้ำแข็งบด (ใช้ครัว)';
  h.state.products.find(p => p.id === 8).name = 'น้ำแข็งหลอดใหญ่';
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'n-no-order', kind: 'bill',
    delivery_date: h.today, supplier_master_id: 8, order_item_ids: [] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const params = { id: created.body.data.id };
  const counted = await h.invoke('saveCount', { user, params, body: { client_uuid: 'n-no-order', lines: [
    { product_id: 7, counted_quantity: '4.00', unit_text: 'กก.' }, { product_id: 8, counted_quantity: '10.00', unit_text: 'กก.' } ] } });
  assert.equal(counted.statusCode, 200, JSON.stringify(counted.body));
  assert.equal((await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  h.state.aliases.push({ id: 1, supplier_key: 'sm:8', bill_text: 'หลอดใหญ่', normalized_bill_text: 'หลอดใหญ่',
    normalized_unit_text: 'กก.', product_id: 8, unit_id: 2, unit_multiplier: 1, confirm_count: 2 },
    { id: 2, supplier_key: 'sm:999', bill_text: 'ห้ามส่งร้านอื่น', product_id: 7, confirm_count: 2 });
  return { h, params, counted: counted.body.data.lines };
}
const result = () => ({ doc_kind: 'bill', total: '0.30', confidence: .99, lines: [
  { bill_text: 'หลอดเล็ก', quantity_billed: '4', unit_text: 'กก.', unit_price: '0.025', amount: '0.10', confidence: .9 },
  { bill_text: 'หลอดใหญ่', quantity_billed: '10', unit_text: 'กก.', unit_price: '0.02', amount: '0.20', confidence: .99 } ] });

test('N4 no-order OCR receives counted identities/quantities and only shop aliases; excludes unrelated same-day orders, caches and preserves count IDs', async () => {
  const { h, params, counted } = await noOrder(); let calls = 0;
  const orders = structuredClone(h.state.orderItems);
  setCustomOcrProvider(async ctx => {
    calls++;
    assert.deepEqual(plain(ctx.expectedItems), [
      { product_name: 'น้ำแข็งบด (ใช้ครัว)', unit_name: 'กก.', quantity_ordered: null, quantity_counted: '4' },
      { product_name: 'น้ำแข็งหลอดใหญ่', unit_name: 'กก.', quantity_ordered: null, quantity_counted: '10' } ]);
    assert.deepEqual(plain(ctx.knownAliases), [{ bill_text: 'หลอดใหญ่', product_name: 'น้ำแข็งหลอดใหญ่' }]);
    return result();
  });
  const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  assert.equal(read.body.data.lines.length, 3);
  for (const original of counted) {
    const row = read.body.data.lines.find(r => r.id === original.id);
    assert.equal(row.counted_quantity, original.counted_quantity); assert.equal(row.quantity_received, original.quantity_received);
    assert.equal(row.order_item_id, null);
  }
  assert.equal((await h.invoke('runOcr', { user, params })).statusCode, 200); assert.equal(calls, 1);
  assert.deepEqual(h.state.orderItems, orders);
});

test('N4 unmatched bill is merged into counted ID in existing PUT transaction; alias is opt-in until confirm, inventory once, void restores', async () => {
  const { h, params } = await noOrder(); setCustomOcrProvider(async () => result());
  const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200);
  const rows = read.body.data.lines, target = rows.find(r => r.product_id === 7), unknown = rows.find(r => !r.product_id);
  assert.ok(unknown); const originalCounts = rows.filter(r => r.counted_quantity != null).map(r => [r.id, Number(r.counted_quantity)]);
  const body = { deleted_line_ids: [unknown.id], lines: rows.filter(r => r.id !== unknown.id).map(r => ({
    id: r.id, ...(r.id === target.id ? { bill_text: unknown.bill_text, quantity_billed: unknown.quantity_billed,
      unit_price: unknown.unit_price, amount: unknown.amount, remember_alias: true, match: { source: 'manual', confidence: 1 } } : {}), review_decision: 'accept' })) };
  const before = structuredClone(h.state.lines);
  const failed = await h.invoke('updateDocument', { user, params, body: { ...body, lines: [...body.lines, { quantity_received: -1 }] } });
  assert.equal(failed.statusCode, 422); assert.deepEqual(h.state.lines, before, 'delete and merge roll back together');
  assert.equal((await h.invoke('updateDocument', { user, params, body })).statusCode, 200);
  assert.deepEqual(h.state.lines.map(r => [r.id, Number(r.counted_quantity)]), originalCounts);
  assert.equal(h.state.aliases.some(a => a.bill_text === 'หลอดเล็ก'), false);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.equal(h.state.aliases.find(a => a.bill_text === 'หลอดเล็ก').product_id, 7);
  assert.equal(Number(h.state.inventoryBalances.get('7:10').quantity), 9);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 409);
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'ทดสอบ N4' } })).statusCode, 200);
  assert.equal(Number(h.state.inventoryBalances.get('7:10').quantity), 5);
  assert.equal(h.state.aliases.find(a => a.bill_text === 'หลอดเล็ก').confirm_count, 1, 'void retains learned alias evidence per API contract');
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'ทดสอบซ้ำ' } })).statusCode, 409);
  assert.equal(Number(h.state.inventoryBalances.get('7:10').quantity), 5);
});

test('N4 real provider HTTP adapter serializes counted context plus shop aliases as data with no invented order quantities (mock fetch)', async () => {
  let requests = 0;
  await extractBillWithVision({ images: [{ page_no: 1, image_data_url: makeJpegDataUrl() }],
    document: { delivery_date: '2026-10-20' }, apiKey: 'mock-only', endpoint: 'https://mock.invalid/ocr',
    expectedItems: [{ product_name: 'น้ำแข็งบด (ใช้ครัว)', unit_name: 'ถุง', quantity_ordered: null, quantity_counted: '4' }],
    knownAliases: [{ bill_text: 'โม่ครัว', product_name: 'น้ำแข็งบด (ใช้ครัว)' }], nameHints: true,
    fetchImpl: async (_url, options) => {
      requests++; const payload = JSON.parse(options.body); const text = payload.messages[1].content[0].text;
      assert.match(text, /ไม่มีใบสั่ง/); assert.match(text, /ห้ามใช้จำนวนนับแทนจำนวนในบิล/);
      assert.match(text, /"quantity_counted":"4"/); assert.match(text, /"quantity_ordered":null/);
      assert.match(text, /"known_aliases":\[\{"bill_text":"โม่ครัว"/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result()) } }] }) };
    } });
  assert.equal(requests, 1);
});

test('N4 counted names match verbatim or as unconfirmed AI suggestions without extra receipt rows or order links', async () => {
  const { h, params, counted } = await noOrder();
  setCustomOcrProvider(async () => ({ ...result(), lines: [
    { ...result().lines[0], suggested_product_name: 'น้ำแข็งบด (ใช้ครัว)' },
    { ...result().lines[1], bill_text: 'น้ำแข็งหลอดใหญ่' } ] }));
  const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  assert.equal(read.body.data.lines.length, 2); assert.deepEqual(read.body.data.lines.map(r => r.id), counted.map(r => r.id));
  const kitchen = read.body.data.lines.find(r => r.product_id === 7);
  assert.equal(kitchen.bill_text, 'หลอดเล็ก'); assert.equal(kitchen.match.source, 'ai');
  assert.equal(kitchen.review_decision, null); assert.equal(kitchen.counted_quantity, '4.00'); assert.equal(Number(kitchen.quantity_received), Number(counted.find(r => r.id === kitchen.id).quantity_received));
  assert.ok(read.body.data.lines.every(r => r.order_item_id === null));
});

test('N4 no-order OCR enforces scope/status before provider; ignores context supplied in request body', async () => {
  const { h, params } = await noOrder(); let calls = 0;
  setCustomOcrProvider(async ctx => { calls++; assert.doesNotMatch(JSON.stringify(ctx), /CLIENT-INJECTED/); return result(); });
  assert.equal((await h.invoke('runOcr', { user: { ...user, branch_id: 2, department_id: 20 }, params })).statusCode, 403);
  assert.equal((await h.invoke('runOcr', { user, params: { id: 999 } })).statusCode, 404); assert.equal(calls, 0);
  assert.equal((await h.invoke('runOcr', { user, params, body: { expected_items: ['CLIENT-INJECTED'], known_aliases: ['CLIENT-INJECTED'] } })).statusCode, 200);
  assert.equal(calls, 1);
  h.state.documents.find(d => d.id === params.id).status = 'confirmed';
  assert.equal((await h.invoke('runOcr', { user, params })).statusCode, 409); assert.equal(calls, 1);
});

// Owner 2026-10-23 (phone test): a registered supplier whose products sit in a group scoped to another department
// of the same branch is still found and selectable; another branch's scope still hides it.
test('N1 supplier visible to every department of its branch', async () => {
  const h = await createReceivingHarness(); const db = catalogDb();
  try {
    db.db.exec(`INSERT INTO supplier_masters VALUES(6,'บจก.ไทยน้ำทิพย์','SUP006',1); INSERT INTO products VALUES(736,1);
      INSERT INTO product_supplier_master_links VALUES(736,6); INSERT INTO product_group_links VALUES(736,14); INSERT INTO product_group_scopes VALUES(14,1,30);`);
    const rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'ไทยน้ำ' }, db }));
    assert.deepEqual(rows.map(r => r.supplier_key), ['sm:6']);
    assert.equal((await h.catalog.resolveReceivingSupplier({ user, supplierKey: 'sm:6', db })).name, 'บจก.ไทยน้ำทิพย์');
    db.db.exec('UPDATE product_group_scopes SET branch_id = 2 WHERE product_group_id = 14');
    assert.equal((await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'ไทยน้ำ' }, db })).length, 0);
    await assert.rejects(h.catalog.resolveReceivingSupplier({ user, supplierKey: 'sm:6', db }), e => e.code === 'NOT_FOUND');
  } finally { db.db.close(); }
});

// Production data 2026-10-21: supplier master Asiamart and the old product group ผลิตสันกำแพง both use SUP003.
// Codes stay untouched (the group code feeds other ordering features); an exact code search lists the master first.
test('N1 duplicate code: exact code search ranks the registered supplier before an old product group with the same code', async () => {
  const h = await createReceivingHarness(); const db = catalogDb();
  try {
    db.db.exec(`INSERT INTO supplier_masters VALUES(9,'Asiamart','SUP003',1); INSERT INTO product_groups VALUES(8,'ผลิตสันกำแพง','SUP003',1);`);
    const rows = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'SUP003' }, db }));
    assert.deepEqual(rows.map(r => r.supplier_key), ['sm:9', 'pg:8']);
    const byName = plain(await h.catalog.searchReceivingSuppliers({ user, filters: { q: 'ผลิตสันกำแพง' }, db }));
    assert.deepEqual(byName.map(r => r.supplier_key), ['pg:8']);
  } finally { db.db.close(); }
});
