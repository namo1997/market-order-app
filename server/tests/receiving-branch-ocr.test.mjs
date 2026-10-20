import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, makeJpegDataUrl, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { setCustomOcrProvider, resetOcrRateLimit } from '../src/services/receiving-ocr.service.js';
import { branchOcrExpectedItems, mergeBranchOcrLines } from '../src/models/receiving-branch-ocr.js';
const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const store = { ...user, id: 13, department_id: 30 };
const foreign = { ...user, id: 14, branch_id: 2, department_id: 20 };
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });
const bill = (text, extra = {}) => ({ doc_kind: 'bill', total: '0.30', doc_date: '18/10/2569', confidence: 0.99,
  lines: [{ bill_text: text, quantity_billed: '5', unit_text: 'กก.', unit_price: '0.06', amount: '0.30', confidence: 0.99 }], ...extra });
async function setup({ image = true } = {}) {
  resetOcrRateLimit();
  const h = await createReceivingHarness({ testDate: '2026-10-18', serializeTransactions: true });
  const first = h.state.orderItems.find(row => row.id === 50);
  Object.assign(first, { quantity: 6, order_date: h.today });
  h.state.orderItems.push({ ...structuredClone(first), id: 60, order_id: 3, quantity: 4,
    department_id: 30, department_name: 'สโตร์', received_quantity: null });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'branch-ocr', scope: 'branch',
    delivery_date: h.today, product_group_id: 3, order_item_ids: [50,60] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.data.id;
  if (image) assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: {
    page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  const name = first.product_name;
  return { h, id, name, ocr: (actor = store, body = {}) => h.invoke('runOcr', { user: actor, params: { id }, body }) };
}

test('branch OCR aggregates context, allocates exact quantities/cents, keeps physical IDs and confirms/voids every department', async () => {
  const { h, id, name, ocr } = await setup();
  const ids = h.state.lines.map(row => row.id);
  let calls = 0;
  setCustomOcrProvider(async context => {
    calls++;
    assert.deepEqual(JSON.parse(JSON.stringify(context.expectedItems)), [{ product_name: name,
      unit_name: 'กก.', quantity_ordered: '10' }]);
    return bill(name);
  });
  const result = await ocr(store, { allocations: [{ department_id: 30, quantity_received: 999 }] });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.ocr.status, 'done');
  assert.equal(result.body.data.doc_date, '2026-10-18');
  assert.equal(result.body.data.lines.length, 1);
  assert.deepEqual(h.state.lines.map(row => row.id), ids);
  assert.deepEqual(h.state.lines.map(row => Number(row.quantity_received)), [6,4]);
  assert.deepEqual(h.state.lines.map(row => Number(row.amount)), [0.18,0.12]);
  assert.deepEqual(h.state.lines.map(row => Number(row.quantity_billed)), [3,2]);
  assert.deepEqual(h.state.lines.map(row => Number(row.counted_quantity)), [6,4]);
  assert.deepEqual(h.state.lines.map(row => Number(row.branch_weight)), [6,4]);
  assert.deepEqual(h.state.lines.map(row => Number(row.branch_department_id)), [10,30]);
  assert.equal((await ocr()).statusCode, 200); assert.equal(calls, 1, 'same hash uses cache');
  assert.equal((await h.invoke('addSignature', { user: store, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user: store, params: { id } })).statusCode, 200);
  assert.deepEqual([50,60].map(id => Number(h.state.orderItems.find(row => row.id === id).received_quantity)), [6,4]);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
  assert.equal(h.state.inventoryBalances.get('7:30').quantity, 4);
  assert.equal((await ocr()).statusCode, 409); assert.equal(calls, 1);
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'ทดสอบ' } })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
  assert.equal(h.state.inventoryBalances.get('7:30').quantity, 0);
});

test('branch OCR uses only this supplier aliases and applies alias match to both departments', async () => {
  const { h, name, ocr } = await setup();
  const alias = { id: 1, supplier_key: 'pg:3', bill_text: 'ทB', normalized_bill_text: 'ทb', product_id: 7,
    unit_id: 2, unit_multiplier: 1, confirm_count: 2, updated_at: new Date('2026-10-18') };
  h.state.aliases.push(alias, { ...alias, id: 2, supplier_key: 'pg:4', bill_text: 'ห้ามส่ง' });
  setCustomOcrProvider(async ({ knownAliases }) => {
    assert.deepEqual(knownAliases, [{ bill_text: 'ทB', product_name: name }]);
    return bill('ทB');
  });
  const result = await ocr(); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.lines[0].match.source, 'alias');
  assert.deepEqual(h.state.lines.map(row => Number(row.quantity_received)), [6,4]);
});

test('branch OCR rejects foreign scope/missing document/no images before provider or quota claim', async () => {
  const { h, id, ocr } = await setup({ image: false });
  let calls = 0; setCustomOcrProvider(async () => { calls++; throw new Error('must not call'); });
  assert.equal((await ocr(foreign)).statusCode, 403);
  assert.equal((await h.invoke('runOcr', { user, params: { id: 999 } })).statusCode, 404);
  assert.equal((await ocr()).statusCode, 422);
  assert.equal(calls, 0); assert.equal(h.state.documents.find(row => row.id === id).ocr_attempt_count || 0, 0);
});

test('branch OCR simultaneous requests claim once; same hash retry never calls provider again', async () => {
  const { h, ocr, name } = await setup();
  let release, entered; const ready = new Promise(resolve => { entered = resolve; }); let calls = 0;
  setCustomOcrProvider(async () => { calls++; entered(); return new Promise(resolve => { release = () => resolve(bill(name)); }); });
  const first = ocr(); await ready;
  const second = await ocr(); assert.equal(second.statusCode, 409);
  release(); assert.equal((await first).statusCode, 200);
  assert.equal((await ocr()).statusCode, 200); assert.equal(calls, 1);
  assert.equal(h.state.documents[0].ocr_attempt_count, 1);
});

test('branch OCR preserves manual group edits and header across new image reading', async () => {
  const { h, id, name, ocr } = await setup();
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { doc_ref: 'MANUAL', lines: [
    { id: h.state.lines[0].id, quantity_received: '7', unit_price: '10', amount: null } ] } });
  assert.equal(updated.statusCode, 200);
  const saved = structuredClone(h.state.lines);
  setCustomOcrProvider(async () => bill(name, { doc_ref: 'AI' }));
  const result = await ocr(); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.doc_ref, 'MANUAL'); assert.deepEqual(h.state.lines, saved.map(line => ({ ...line, review_decision: null })));
});

test('branch OCR unknown or repeated products roll back without losing department lines', async () => {
  for (const duplicate of [false, true]) {
    const { h, name, ocr } = await setup();
    const saved = structuredClone(h.state.lines);
    setCustomOcrProvider(async () => { const data = bill(duplicate ? name : 'รายการนอกใบสั่ง');
      if (duplicate) data.lines.push({ ...data.lines[0] }); return data; });
    const result = await ocr(); assert.equal(result.statusCode, 422, JSON.stringify(result.body));
    assert.deepEqual(h.state.lines, saved); assert.equal(h.state.documents[0].ocr_status, 'failed');
  }
});

test('branch OCR keeps distinct units and rejects ambiguous same-product units', () => {
  const rows = [{ id: 1, order_item_id: 50, product_id: 7, product_name: 'ผัก', unit_id: 1, unit_name: 'กก.', quantity_ordered: 6 },
    { id: 2, order_item_id: 60, product_id: 7, product_name: 'ผัก', unit_id: 1, unit_name: 'กก.', quantity_ordered: 4 },
    { id: 3, order_item_id: 70, product_id: 7, product_name: 'ผัก', unit_id: 2, unit_name: 'ถุง', quantity_ordered: 2 }];
  const expectedItems = branchOcrExpectedItems(rows); assert.equal(expectedItems.length, 2);
  assert.deepEqual(expectedItems.map(row => row.quantity_ordered), ['10','2']);
  const existingLines = rows.map(row => ({ ...row, branch_weight: row.quantity_ordered, quantity_received: row.quantity_ordered }));
  const args = { existingLines, aliases: [], supplierKey: 'pg:3', expectedItems,
    units: [{ id: 1, name: 'กก.' }, { id: 2, name: 'ถุง' }] };
  const lines = mergeBranchOcrLines({ ...args, ocrLines: [{ line_no: 1, bill_text: 'ผัก', unit_text: 'ถุง', quantity_billed: 1, unit_price: 10 }] });
  assert.equal(Number(lines.find(row => row.order_item_id === 70).quantity_received), 2);
  assert.throws(() => mergeBranchOcrLines({ ...args, ocrLines: [{ line_no: 1, bill_text: 'ผัก', quantity_billed: 1 }] }), { code: 'VALIDATION_FAILED' });
});

test('branch OCR late transaction failure rolls back header and both department quantities', async () => {
  const { h, name, ocr } = await setup();
  const saved = structuredClone(h.state.lines);
  h.state.failOnOcrAudit = true;
  setCustomOcrProvider(async () => bill(name, { doc_ref: 'MUST-ROLLBACK' }));
  assert.equal((await ocr()).statusCode, 500);
  assert.deepEqual(h.state.lines, saved);
  assert.equal(h.state.documents[0].doc_ref, null);
  assert.equal(h.state.documents[0].ocr_status, 'failed');
});

test('branch OCR rejects unknown unit without silently treating it as the order unit', async () => {
  const { h, name, ocr } = await setup();
  const saved = structuredClone(h.state.lines);
  setCustomOcrProvider(async () => { const data = bill(name); data.lines[0].unit_text = 'หน่วยที่ไม่รู้จัก'; return data; });
  assert.equal((await ocr()).statusCode, 422); assert.deepEqual(h.state.lines, saved);
});

test('branch OCR missing products clear unread defaults and reversed order retains raw-read metadata per product', () => {
  const rows = [{ id: 1, line_no: 1, order_item_id: 50, product_id: 7, product_name: 'หมู', unit_id: 2, unit_text: 'กก.', unit_name: 'กก.', branch_weight: 6, quantity_ordered: 6, quantity_received: 6 },
    { id: 2, line_no: 2, order_item_id: 60, product_id: 7, product_name: 'หมู', unit_id: 2, unit_text: 'กก.', unit_name: 'กก.', branch_weight: 4, quantity_ordered: 4, quantity_received: 4 },
    { id: 3, line_no: 3, order_item_id: 70, product_id: 8, product_name: 'ผัก', unit_id: 2, unit_text: 'กก.', unit_name: 'กก.', branch_weight: 2, quantity_ordered: 2, quantity_received: 2 }];
  const args = { existingLines: rows, aliases: [], supplierKey: 'pg:3', expectedItems: branchOcrExpectedItems(rows), units: [{ id: 2, name: 'กก.' }] };
  const read = { line_no: 1, bill_text: 'ผัก', unit_text: 'กก.', quantity_billed: 1, unit_price: 10, amount: 10 };
  const lines = mergeBranchOcrLines({ ...args, ocrLines: [read] });
  assert.deepEqual(lines.map(row => Number(row.quantity_received)), [6,4,2]);
  assert.deepEqual(lines.slice(0,2).map(row => row.unit_price), [null,null]);
  const reverse = mergeBranchOcrLines({ ...args, ocrLines: [read, { ...read, line_no: 2, bill_text: 'หมู', quantity_billed: 5 }] });
  assert.deepEqual(reverse.map(row => row.ocr_line_no), [2,2,1]);
  assert.deepEqual(reverse.map(row => Number(row.quantity_received)), [6,4,2]);
});

test('integration branch OCR: uncounted branch drafts block all roles before provider and quota', async () => {
  const h=await createReceivingHarness({prepareCount:false});
  const created=await h.invoke('createDocument',{user,body:{client_uuid:'branch-locked',scope:'branch',delivery_date:h.today,product_group_id:3,order_item_ids:[50,51]}});
  assert.equal(created.statusCode,201);
  const id=created.body.data.id;
  await h.invoke('uploadImage',{user,params:{id},body:{page_no:1,image_data_url:makeJpegDataUrl()}});
  let calls=0; setCustomOcrProvider(async()=>{calls++;return bill('หมู');});
  for(const role of ['user','admin','super_admin']) assert.equal((await h.invoke('runOcr',{user:{...user,role},params:{id}})).statusCode,409);
  assert.equal(calls,0);assert.equal(h.state.documents[0].ocr_attempt_count||0,0);
});
