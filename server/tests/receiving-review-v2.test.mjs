import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as ocr from '../src/services/receiving-ocr.service.js';
import { createReceivingHarness, createLinkedDraft, deltaActor as user, makeJpegDataUrl, makePngDataUrl, settlementRows } from './helpers/receiving-fake-db.mjs';

const expectedItems = [
  { order_item_id: 50, product_id: 7, product_name: 'อกไก่', unit_name: 'กก.', unit_id: 2, quantity_ordered: 10 },
  { order_item_id: 51, product_id: 8, product_name: 'ขา B', unit_name: 'กก.', unit_id: 2, quantity_ordered: 10 }
];
const raw = { bill_text: 'ทB', suggested_product_name: 'อกไก่', suggestion_reason: 'คล้ายรายการที่สั่ง', quantity_billed: 10, unit_price: 60, amount: 600, confidence: .99 };
const alias = { supplier_key: 'pg:3', bill_text: 'ทB', product_id: 8, unit_id: 2, unit_multiplier: 1 };
const match = (lines = [raw], aliases = []) => ocr.matchOcrLinesToCatalog({ ocrLines: lines, expectedItems, aliases, supplierKey: 'pg:3' });

test('review v2: supplier raw alias beats conflicting AI suggestion and avoids breast price warning', () => {
  const [line] = match([raw], [alias]);
  assert.equal(line.bill_text, 'ทB'); assert.equal(line.product_id, 8); assert.equal(line.product_name, 'ขา B');
  assert.equal(line.match.source, 'alias'); assert.equal(line.order_item_id, 51);
  const warnings = ocr.computeDocumentWarnings({ lines: [line], latestPricesByProductId: new Map([[7, 80], [8, 60]]) });
  assert.ok(!warnings.warningCodes.includes('PRICE_CHANGE'));
  assert.equal(match([{ ...raw, bill_text: ' ทb ' }], [alias])[0].product_id, 8);
  assert.equal(match([raw], [{ ...alias, supplier_key: 'pg:4' }])[0].match.source, 'ai');
  assert.equal(match([{ ...raw, bill_text: 'ทBB', suggested_product_name: null }], [alias])[0].product_id, null);
});

test('review v2: exact order precedes AI; AI is low confidence; unknown and duplicate links stay safe', () => {
  assert.equal(match([{ ...raw, bill_text: 'ขา B' }])[0].match.source, 'order');
  const guessed = match(); assert.equal(guessed[0].match.source, 'ai'); assert.equal(guessed[0].product_id, 7);
  assert.ok(guessed[0].match.confidence <= .4);
  assert.ok(ocr.computeDocumentWarnings({ lines: guessed }).warningCodes.includes('LOW_CONFIDENCE'));
  assert.equal(match([{ ...raw, suggested_product_name: 'สินค้านอกระบบ' }])[0].product_id, null);
  assert.equal(match([{ ...raw, suggested_product_name: null }])[0].match.source, 'none');
  const twice = match([raw, raw]); assert.equal(twice[1].order_item_id, null);
});

test('review v2: normalizer never substitutes catalog name for raw text; preserves original versus derived money', () => {
  const result = ocr.normalizeOcrPayload({ lines: [raw, { product_name: 'อกไก่', quantity: 2, unit_price: 60 },
    { text: 'ทB', suggested_product_name: 'x'.repeat(300), suggestion_reason: 'y'.repeat(300), quantity: '0.3', unit_price: '1,000.10' }] });
  assert.equal(result.lines[0].bill_text, 'ทB'); assert.equal(result.lines[1].bill_text, '');
  assert.equal(result.lines[2].bill_text, 'ทB'); assert.equal(result.lines[2].suggested_product_name.length, 255);
  assert.equal(result.lines[2].suggestion_reason.length, 255); assert.equal(result.lines[2].amount, 300.03);
  assert.equal(result.lines[2].bill_read.amount, null); assert.equal(result.lines[2].bill_read.unit_price, 1000.1);
  assert.ok(ocr.BILL_OCR_SYSTEM_PROMPT.includes('ห้ามแทนด้วยชื่อจาก expected_items'));
  for (const key of ['suggested_product_name', 'suggestion_reason']) {
    assert.ok(ocr.BILL_OCR_JSON_SCHEMA.schema.properties.lines.items.required.includes(key));
    assert.deepEqual(ocr.BILL_OCR_JSON_SCHEMA.schema.properties.lines.items.properties[key].type, ['string', 'null']);
  }
});

test('review v2: OCR raw summary/suggestion persist through GET and hash cache using mock provider only', async () => {
  const h = await createReceivingHarness();
  h.state.orderItems.find(row => row.id === 50).product_name = 'อกไก่';
  h.state.orderItems.find(row => row.id === 51).product_name = 'ขา B';
  const created = await createLinkedDraft(h, user, 'review-v2-raw'); const id = String(created.body.data.id);
  assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl(640, 480) } })).statusCode, 201);
  let calls = 0;
  ocr.setCustomOcrProvider(async () => { calls++; return { doc_kind: 'bill', doc_date: '17/10/2569', total: 600, lines: [raw] }; });
  try {
    const result = await h.invoke('runOcr', { user, params: { id } }); assert.equal(result.statusCode, 200);
    const line = result.body.data.lines.find(line => line.bill_text === 'ทB');
    assert.equal(line.match.source, 'ai'); assert.equal(line.suggested_product_name, 'อกไก่');
    assert.equal(line.suggestion_reason, raw.suggestion_reason); assert.equal(line.bill_read.amount, 600);
    for (const handler of ['getDocumentById', 'runOcr']) {
      const saved = await h.invoke(handler, { user, params: { id } }); assert.equal(saved.statusCode, 200);
      assert.equal(saved.body.data.ocr.raw_read.doc_date, '2026-10-17');
      assert.equal(saved.body.data.ocr.raw_read.total, 600); assert.equal(saved.body.data.ocr.raw_read.line_count, 1);
      assert.equal(saved.body.data.lines.find(line => line.bill_text === 'ทB').suggested_product_name, 'อกไก่');
    }
    assert.equal(calls, 1);
  } finally { ocr.setCustomOcrProvider(null); }
});

test('review v2: unconfirmed AI cannot settle; remember=false persists, validates and suppresses alias only', async () => {
  const h = await createReceivingHarness(); const created = await createLinkedDraft(h, user, 'review-v2-choice');
  const id = String(created.body.data.id), lineId = created.body.data.lines[0].id;
  const update = values => h.invoke('updateDocument', { user, params: { id }, body: { lines: [{ id: lineId, bill_text: 'ทB', product_id: 7, order_item_id: 50, quantity_received: '10', unit_price: '60', ...values }] } });
  assert.equal((await update({ remember_alias: 'false' })).statusCode, 422);
  assert.equal((await update({ match: { source: 'ai', confidence: .4 }, remember_alias: false })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  const before = settlementRows(h.state);
  const rejected = await h.invoke('confirmDocument', { user, params: { id } });
  assert.equal(rejected.statusCode, 422); assert.deepEqual(settlementRows(h.state), before);
  const accepted = await update({ match: { source: 'manual', confidence: 1 } }); assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.lines[0].remember_alias, false);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(h.state.aliases.length, 0); assert.equal(h.state.aliasEvents.length, 0);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 15);
  assert.equal(h.state.orderItems.find(item => item.id === 50).received_quantity, 10);
});

test('review v2: explicit remember=true learns raw abbreviation; false on new unlinked row roundtrips', async () => {
  const h = await createReceivingHarness(); const created = await createLinkedDraft(h, user, 'review-v2-remember');
  const id = String(created.body.data.id);
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [
    { id: created.body.data.lines[0].id, bill_text: 'ทB', product_id: 7, order_item_id: 50, quantity_received: '10', unit_price: '60', remember_alias: true, match: { source: 'manual' } },
    { line_no: 2, bill_text: 'ไม่จำ', product_id: 8, quantity_received: '1', unit_price: '40', remember_alias: false, match: { source: 'manual' } }
  ] } });
  assert.equal(updated.statusCode, 200); assert.equal(updated.body.data.lines[1].remember_alias, false);
  await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(h.state.aliases.length, 1); assert.equal(h.state.aliases[0].bill_text, 'ทB');
  assert.equal(h.state.aliases[0].supplier_key, 'pg:3');
});

test('review v2: additive enum/remember migration is idempotent and retains every original source', async () => {
  let enumType = "enum('alias','order','manual','none')", remember = false;
  const alterations = [];
  const db = { query: async (sql, params = []) => {
    if (sql.startsWith('SHOW COLUMNS')) {
      if (params[0] === 'match_source') return [[{ Type: enumType }]];
      if (params[0] === 'remember_alias') return [remember ? [{ Type: 'tinyint(1)' }] : []];
      return [[{ Type: 'decimal(12,6)' }]];
    }
    if (sql.startsWith('ALTER TABLE')) { alterations.push(sql); if (sql.includes('remember_alias')) remember = true; if (sql.includes('match_source')) enumType = "enum('alias','order','manual','none','ai')"; }
    return [{}];
  } };
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await readFile(new URL('../src/models/receiving-documents-schema.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', db); }, { context })); await module.evaluate();
  await module.namespace.ensureReceivingDocumentsTables(db); await module.namespace.ensureReceivingDocumentsTables(db);
  assert.equal(alterations.length, 2); assert.ok(alterations.some(sql => sql.includes("'alias', 'order', 'manual', 'none', 'ai'")));
  assert.ok(alterations.every(sql => sql.startsWith('ALTER TABLE receiving_document_lines')));
});

test('review v2: remember-only and acknowledgement-only edits survive OCR reread without row deletion', async () => {
  for (const values of [{ remember_alias: false }, { match: { source: 'manual', confidence: 1 } }]) {
    const h = await createReceivingHarness(); const created = await createLinkedDraft(h, user, 'review-v2-reread');
    const id = String(created.body.data.id), oldLine = created.body.data.lines[0];
    const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [{ id: oldLine.id, ...values }] } });
    assert.equal(updated.statusCode, 200); assert.equal(h.state.lines[0].is_user_edited, true);
    await h.invoke('uploadImage', { user, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl(640, 480) } });
    ocr.setCustomOcrProvider(async () => ({ doc_kind: 'bill', lines: [{ bill_text: 'เปลี่ยนจาก AI', quantity: 99, unit_price: 999 }] }));
    try {
      const reread = await h.invoke('runOcr', { user, params: { id } }); assert.equal(reread.statusCode, 200);
      assert.equal(reread.body.data.lines.length, 1); assert.equal(reread.body.data.lines[0].id, oldLine.id);
      assert.equal(reread.body.data.lines[0].bill_text, oldLine.bill_text);
      if ('remember_alias' in values) assert.equal(reread.body.data.lines[0].remember_alias, false);
      else assert.equal(reread.body.data.lines[0].match.source, 'manual');
    } finally { ocr.setCustomOcrProvider(null); }
  }
});

test('review v2: late confirm failure rolls back raw alias, order, inventory, document and audit together', async () => {
  const h = await createReceivingHarness(); const created = await createLinkedDraft(h, user, 'review-v2-rollback');
  const id = String(created.body.data.id);
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [{
    id: created.body.data.lines[0].id, bill_text: 'ทB', product_id: 7, order_item_id: 50,
    quantity_received: '10', unit_price: '60', remember_alias: true, match: { source: 'manual' }
  }] } }); assert.equal(updated.statusCode, 200);
  await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  const before = settlementRows(h.state); h.state.failOnConfirmAudit = true;
  const result = await h.invoke('confirmDocument', { user, params: { id } }); assert.equal(result.statusCode, 500);
  assert.deepEqual(settlementRows(h.state), before);
  h.state.failOnConfirmAudit = false;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(h.state.aliases.length, 1); assert.equal(h.state.aliases[0].bill_text, 'ทB');
  assert.equal(h.state.orderItems.find(item => item.id === 50).received_quantity, 10);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 15);
});
