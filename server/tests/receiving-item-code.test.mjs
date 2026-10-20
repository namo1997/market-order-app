import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, makeJpegDataUrl, createReceivingHarness } from './helpers/receiving-fake-db.mjs';
import * as ocr from '../src/services/receiving-ocr.service.js';

// SYNTHETIC data only: product 7 plays "ไข่เบอร์ 1" (eggs) in these tests; the bill text is misread as foam.
afterEach(() => ocr.setCustomOcrProvider(null));

const line = (extra = {}) => ({ bill_text: 'ไข่เบอร์ 1', quantity_billed: 15, unit_price: 139, amount: 2085, confidence: 0.95, ...extra });
const codeAlias = (extra = {}) => ({ id: 1, supplier_key: 'pg:3', bill_text: 'ไข่เบอร์ 1', normalized_bill_text: '#code:5002',
  unit_text: '', normalized_unit_text: '', item_code: '5002', product_id: 7, unit_id: 2, unit_multiplier: 1,
  confirm_count: 2, is_active: 1, updated_at: new Date('2026-10-18'), ...extra });

test('item_code normalisation accepts short codes and rejects phone/tax/bank-like or unsafe values', () => {
  for (const [input, expected] of [['5002', '5002'], [5002, '5002'], [' 20 10 ', '2010'], ['11090', '11090'], ['ab-12/3', 'AB-12/3'], ['a'.repeat(40), 'A'.repeat(40)]]) {
    assert.equal(ocr.normalizeItemCode(input), expected, String(input));
  }
  for (const input of ['0812345678', '081-234-5678', '0105555123456', '1-2345-67890-12-3', '123456789', '8851234567890', 'a'.repeat(41), '',
    '   ', null, undefined, {}, [], true, -5, 1.5, 'ไข่1', '<b>1</b>', '5002; DROP', '-12', 'ก']) {
    assert.equal(ocr.normalizeItemCode(input), null, JSON.stringify(input));
  }
  assert.equal(ocr.normalizeItemCode('12345678'), '12345678', '8 digits is still a plausible short code');
});

test('OCR payload keeps a valid printed item_code per line, drops invalid ones without a schema warning, and stays backward compatible', () => {
  const result = ocr.normalizeOcrPayload({ doc_kind: 'bill', total: 2085, subtotal: 2085, lines: [
    line({ item_code: ' 5002 ' }), line({ bill_text: 'ก', item_code: '0812345678' }), line({ bill_text: 'ข' }), line({ bill_text: 'ค', item_code: { x: 1 } })
  ] });
  assert.deepEqual(result.lines.map(l => l.item_code), ['5002', null, null, null]);
  assert.equal(result.has_schema_warnings, false, 'a rejected code must not discount the whole bill');
  assert.ok(result.lines.every(l => 'item_code' in l));
});

test('wire schema and shared prompt ask for the optional per-line item_code and forbid inventing it', () => {
  const lineSchema = ocr.BILL_OCR_JSON_SCHEMA.schema.properties.lines.items;
  assert.deepEqual(lineSchema.properties.item_code, { type: ['string', 'null'] });
  assert.ok(lineSchema.required.includes('item_code'), 'strict structured output requires every property');
  assert.deepEqual([...lineSchema.required].sort(), Object.keys(lineSchema.properties).sort());
  assert.match(ocr.BILL_OCR_SYSTEM_PROMPT, /"item_code"/);
  assert.match(ocr.BILL_OCR_SYSTEM_PROMPT, /ห้ามเดาหรือแต่งรหัส/);
  assert.match(ocr.BILL_OCR_SYSTEM_PROMPT, /เลขผู้เสียภาษี เลขบัญชี เบอร์โทร/);
});

test('code-first matching: a confirmed code alias beats a misread bill text and a wrong text alias', () => {
  const foamTextAlias = { id: 2, supplier_key: 'pg:3', bill_text: 'โฟมเบอร์ 1', normalized_bill_text: ocr.normalizeMatchText('โฟมเบอร์ 1'),
    unit_text: '', normalized_unit_text: '', product_id: 8, unit_multiplier: 1, confirm_count: 9, is_active: 1 };
  const products = [{ id: 7, name: 'ไข่เบอร์ 1', unit_id: 2 }, { id: 8, name: 'โฟมกันกระแทก', unit_id: 2 }];
  const run = (aliases, extra = {}, supplierKey = 'pg:3') => ocr.matchOcrLinesToCatalog({
    ocrLines: [line({ bill_text: 'โฟมเบอร์ 1', item_code: '5002', ...extra })], aliases, products, units: [], supplierKey })[0];
  const byCode = run([foamTextAlias, codeAlias()]);
  assert.equal(byCode.product_id, 7);
  assert.equal(byCode.product_name, 'ไข่เบอร์ 1');
  assert.equal(byCode.match.source, 'alias');
  assert.equal(byCode.bill_text, 'โฟมเบอร์ 1', 'the bill text is shown exactly as read');
  assert.equal(byCode.item_code, '5002');
  assert.equal(byCode.quantity_billed, 15);
  // Without a code the old text behaviour is unchanged.
  const byText = run([foamTextAlias, codeAlias()], { item_code: null });
  assert.equal(byText.product_id, 8);
  assert.ok(!('item_code' in byText));
  // Case/space differences in the printed code still match.
  assert.equal(run([codeAlias({ item_code: 'ab-12' })], { item_code: ' ab-12 ' }).product_id, 7);
});

test('code-first matching ignores disabled, unconfirmed, other-supplier and different-code aliases', () => {
  const textAlias = { id: 2, supplier_key: 'pg:3', bill_text: 'โฟมเบอร์ 1', normalized_bill_text: ocr.normalizeMatchText('โฟมเบอร์ 1'),
    unit_text: '', normalized_unit_text: '', product_id: 8, unit_multiplier: 1, confirm_count: 1, is_active: 1 };
  const products = [{ id: 7, name: 'ไข่เบอร์ 1', unit_id: 2 }, { id: 8, name: 'โฟมกันกระแทก', unit_id: 2 }];
  const run = (aliases, supplierKey = 'pg:3') => ocr.matchOcrLinesToCatalog({
    ocrLines: [line({ bill_text: 'โฟมเบอร์ 1', item_code: '5002' })], aliases, products, units: [], supplierKey })[0];
  assert.equal(run([textAlias, codeAlias({ is_active: 0 })]).product_id, 8, 'disabled code alias is ignored');
  assert.equal(run([textAlias, codeAlias({ is_active: 0 })]).match.source, 'alias');
  assert.equal(run([textAlias, codeAlias({ confirm_count: 0 })]).product_id, 8, 'unconfirmed code alias is ignored');
  assert.equal(run([textAlias, codeAlias({ supplier_key: 'pg:4' })]).product_id, 8, 'another supplier code does not leak');
  assert.equal(run([textAlias, codeAlias({ item_code: '5003' })]).product_id, 8, 'different code');
  assert.equal(run([codeAlias()], 'none').product_id, null, 'no supplier key means no alias matching');
  assert.equal(run([codeAlias({ is_active: 0 })]).product_id, null);
  // A disabled text alias is skipped too.
  assert.equal(run([{ ...textAlias, is_active: 0 }]).product_id, null);
});

test('OCR run maps a line by its printed code even when the model misread the text', async () => {
  const h = await createReceivingHarness();
  const actor = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
  const created = await h.invoke('createDocument', { user: actor, body: { client_uuid: 'item-code-ocr', delivery_date: h.today, product_group_id: 3 } });
  const id = created.body.data.id;
  await h.invoke('uploadImage', { user: actor, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  h.state.aliases.push(codeAlias());
  let hints;
  ocr.setCustomOcrProvider(async ({ knownAliases }) => { hints = knownAliases; return { doc_kind: 'bill', total: '2085', doc_date: h.today, confidence: 0.99,
    lines: [line({ bill_text: 'โฟมเบอร์ 1', item_code: '5002', confidence: 0.99 }), line({ bill_text: 'ของไม่รู้จัก', item_code: '0812345678', amount: 10, unit_price: 10, quantity_billed: 1 })] }; });
  ocr.resetOcrRateLimit();
  const result = await h.invoke('runOcr', { user: actor, params: { id }, body: {} });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const lines = result.body.data.lines;
  const eggs = lines.find(l => l.bill_text === 'โฟมเบอร์ 1');
  assert.equal(eggs.product_id, 7);
  assert.equal(eggs.match.source, 'alias');
  assert.equal(eggs.item_code, '5002');
  const unknown = lines.find(l => l.bill_text === 'ของไม่รู้จัก');
  assert.ok(!unknown.product_id);
  assert.ok(!('item_code' in unknown), 'a phone-like number is never stored');
  assert.equal(h.state.lines.filter(l => l.document_id === Number(id) && l.item_code).length, 1);
  assert.ok(Array.isArray(hints));
});

test('OCR run ignores a disabled code alias', async () => {
  const h = await createReceivingHarness();
  const actor = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
  const created = await h.invoke('createDocument', { user: actor, body: { client_uuid: 'item-code-off', delivery_date: h.today, product_group_id: 3 } });
  const id = created.body.data.id;
  await h.invoke('uploadImage', { user: actor, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  h.state.aliases.push(codeAlias({ is_active: 0 }));
  ocr.setCustomOcrProvider(async () => ({ doc_kind: 'bill', total: '2085', doc_date: h.today, confidence: 0.99,
    lines: [line({ bill_text: 'โฟมเบอร์ 1', item_code: '5002', confidence: 0.99 })] }));
  ocr.resetOcrRateLimit();
  const result = await h.invoke('runOcr', { user: actor, params: { id }, body: {} });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const unmatched = result.body.data.lines.find(l => l.bill_text === 'โฟมเบอร์ 1');
  assert.ok(unmatched && !unmatched.product_id && unmatched.match.source !== 'alias');
});

test('confirming a line that carries an item_code learns a code alias with the same confirm/candidate rules', async () => {
  const h = await createReceivingHarness();
  const users = { a: { id: 12, name: 'A', role: 'user', branch_id: 1, department_id: 10 }, b: { id: 13, name: 'B', role: 'user', branch_id: 1, department_id: 10 },
    admin: { id: 1, name: 'Admin', role: 'admin', branch_id: 1, department_id: 10 } };
  const confirmLine = async (actor, uuid, { productId = 7, itemCode = '5002', remember = true, billText = 'โฟมเบอร์ 1', productGroupId = 3 } = {}) => {
    const created = await h.invoke('createDocument', { user: actor, body: { client_uuid: uuid, delivery_date: h.today, kind: 'bill', product_group_id: productGroupId } });
    const id = String(created.body.data.id);
    await h.invoke('updateDocument', { user: actor, params: { id }, body: { lines: [{ line_no: 1, bill_text: billText, remember_alias: remember,
      unit_text: 'กก.', product_id: productId, quantity_received: '15', unit_price: '139.00' }] } });
    for (const row of h.state.lines.filter(l => l.document_id === Number(id))) row.item_code = itemCode;
    await h.invoke('addSignature', { user: actor, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
    const res = await h.invoke('confirmDocument', { user: actor, params: { id } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  };
  const codeRows = () => h.state.aliases.filter(a => a.item_code === '5002');

  await confirmLine(users.a, 'code-1');
  assert.equal(codeRows().length, 1);
  assert.equal(codeRows()[0].supplier_key, 'pg:3');
  assert.equal(codeRows()[0].product_id, 7);
  assert.equal(codeRows()[0].confirm_count, 1);
  assert.equal(codeRows()[0].normalized_bill_text, '#code:5002', 'keyed by code, never matchable as text');
  assert.equal(h.state.aliases.length, 2, 'the text alias is still learned as before');
  assert.equal(h.state.aliasEvents.filter(e => e.normalized_bill_text === '#code:5002').at(-1).decision, 'created');

  await confirmLine(users.a, 'code-2', { billText: 'ไข่เบอร์ 1' });
  assert.equal(codeRows().length, 1, 'same code, different text: still one code alias');
  assert.equal(codeRows()[0].confirm_count, 2);
  assert.equal(h.state.aliasEvents.filter(e => e.normalized_bill_text === '#code:5002').at(-1).decision, 'confirmed_same');

  await confirmLine(users.b, 'code-3', { productId: 8 });
  assert.equal(codeRows()[0].product_id, 7, 'one non-admin cannot re-point a confirmed code');
  assert.equal(codeRows()[0].candidate_product_id, 8);
  assert.equal(h.state.aliasEvents.filter(e => e.normalized_bill_text === '#code:5002').at(-1).decision, 'candidate_recorded');

  await confirmLine(users.admin, 'code-4', { productId: 11 });
  assert.equal(codeRows()[0].product_id, 11);
  assert.equal(h.state.aliasEvents.filter(e => e.normalized_bill_text === '#code:5002').at(-1).decision, 'admin_override');
});

test('code learning is skipped without remember_alias, without a code, and without a supplier', async () => {
  const h = await createReceivingHarness();
  const actor = { id: 12, name: 'A', role: 'user', branch_id: 1, department_id: 10 };
  const confirmLine = async (uuid, { itemCode, remember = true, productGroupId = 3 }) => {
    const created = await h.invoke('createDocument', { user: actor, body: { client_uuid: uuid, delivery_date: h.today, kind: 'bill', product_group_id: productGroupId, supplier_name_text: '' } });
    const id = String(created.body.data.id);
    await h.invoke('updateDocument', { user: actor, params: { id }, body: { lines: [{ line_no: 1, bill_text: 'สินค้า', remember_alias: remember,
      unit_text: 'กก.', product_id: 7, quantity_received: '1', unit_price: '10.00' }] } });
    for (const row of h.state.lines.filter(l => l.document_id === Number(id))) row.item_code = itemCode;
    await h.invoke('addSignature', { user: actor, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
    assert.equal((await h.invoke('confirmDocument', { user: actor, params: { id } })).statusCode, 200);
  };
  await confirmLine('skip-1', { itemCode: '5002', remember: false });
  await confirmLine('skip-2', { itemCode: null });
  await confirmLine('skip-3', { itemCode: '0812345678' });
  await confirmLine('skip-4', { itemCode: '5002', productGroupId: null });
  assert.equal(h.state.aliases.filter(a => a.item_code).length, 0);
});

test('schema adds item_code columns and an index additively, with no destructive statements', async () => {
  const { read } = await import('./helpers/receiving-fake-db.mjs');
  const schema = await read('../src/models/receiving-documents-schema.js');
  assert.match(schema, /table: 'supplier_product_aliases',\s*column: 'item_code',\s*definition: 'VARCHAR\(40\) NULL AFTER is_active'/);
  assert.match(schema, /table: 'receiving_document_lines',\s*column: 'item_code',\s*definition: 'VARCHAR\(40\) NULL AFTER bill_text'/);
  assert.match(schema, /ADD INDEX idx_supplier_alias_item_code \(supplier_key, item_code\)/);
  assert.match(schema, /INDEX idx_supplier_alias_item_code \(supplier_key, item_code\)/);
  assert.ok(!/DROP\s+(TABLE|COLUMN|INDEX)/i.test(schema));
});
