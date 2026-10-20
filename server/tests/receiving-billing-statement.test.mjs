import * as branchOcr from '../src/models/receiving-branch-ocr.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as ocr from '../src/services/receiving-ocr.service.js';
import * as helpers from '../src/models/receiving-documents-helpers.js';
import * as bangkokDate from '../src/utils/bangkok-date.js';
import { makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';

// SYNTHETIC data only. No real supplier, tax id, bank account or phone number.
const line = (i = 0, extra = {}) => ({ bill_text: `สินค้าทดลอง ${i + 1}`, quantity_billed: 1,
  unit_price: 10, amount: 10, confidence: 0.95, ...extra });

// Run the real OCR flow, warning persistence and response mapper against an in-memory
// SQL adapter. No database module, credentials, real network or shared test harness.
async function createHarness() {
  ocr.resetOcrRateLimit();
  const row = { counted_complete_at: '2026-10-16T00:00:00Z', id: 901, status: 'draft', kind: 'bill', branch_id: 1, department_id: 10,
    receiver_user_id: 12, delivery_date: '2026-10-16', supplier_name_text: '',
    ocr_status: 'none', ocr_attempt_count: 0 };
  const images = [{ id: 1, page_no: 1, mime_type: 'image/jpeg', size_bytes: 4,
    sha256: 'synthetic-image', image_data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }];
  const lines = [];
  const transactions = [];
  let snapshot;
  const db = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT') && q.includes('FROM receiving_documents rd')) return [[{ ...row }]];
      if (q.startsWith('SELECT') && q.includes('FROM receiving_document_images')) return [images];
      if (q.startsWith('SELECT') && q.includes('FROM receiving_document_lines')) return [lines.map((l) => ({ ...l }))];
      if (q.startsWith('SELECT') && (q.includes('FROM order_items oi') || q.includes('FROM units'))) return [[]];
      if (q.includes('FROM supplier_product_aliases')) return [[]];
      if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'pending\'')) {
        row.ocr_status = 'pending'; row.ocr_attempt_count++; return [{ affectedRows: 1 }];
      }
      if (q.startsWith('UPDATE receiving_documents SET supplier_name_text')) {
        const fields = ['supplier_name_text', 'doc_ref', 'doc_date', 'subtotal', 'discount', 'vat', 'total',
          'ocr_model', 'ocr_confidence', 'ocr_images_hash', 'ocr_result_json'];
        fields.forEach((field, i) => { row[field] = params[i]; });
        row.ocr_status = 'done'; return [{ affectedRows: 1 }];
      }
      if (q.startsWith('UPDATE receiving_document_lines SET review_decision = NULL') || q.startsWith('UPDATE receiving_documents SET receiver_signature = NULL')) return [{ affectedRows: 1 }];
      if (q.startsWith('DELETE FROM receiving_document_lines')) { lines.length = 0; return [{ affectedRows: 0 }]; }
      if (q.startsWith('INSERT INTO receiving_document_lines')) {
        const fields = ['document_id', 'line_no', 'bill_text', 'product_id', 'product_name', 'order_item_id',
          'unit', 'unit_text', 'unit_id', 'unit_multiplier', 'quantity_billed', 'quantity_received',
          'unit_price', 'base_unit_price', 'amount', 'match_source', 'match_confidence'];
        lines.push({ id: lines.length + 1, ...Object.fromEntries(fields.map((field, i) => [field, params[i]])) });
        return [{ insertId: lines.length }];
      }
      if (q.startsWith('UPDATE receiving_documents SET warnings_json')) {
        [row.warnings_json, row.ocr_warnings_json] = params; return [{ affectedRows: 1 }];
      }
      if (q.startsWith('INSERT INTO receiving_document_audits')) return [{ insertId: 1 }];
      throw new Error(`Unexpected mock SQL: ${q}`);
    },
    async getConnection() { return db; },
    async beginTransaction() { snapshot = { ...row }; transactions.push('begin'); },
    async commit() { transactions.push('commit'); },
    async rollback() { Object.assign(row, snapshot); lines.length = 0; transactions.push('rollback'); },
    release() { transactions.push('release'); }
  };
  const context = vm.createContext({ Buffer });
  const synthetic = (values) => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const source = await readFile(new URL('../src/models/receiving-documents-ocr-flow.js', import.meta.url), 'utf8');
  const flow = new vm.SourceTextModule(source, { context });
  await flow.link((specifier) => {
    if (specifier.endsWith('/receiving-branch-ocr.js')) return synthetic(branchOcr);
    if (specifier.endsWith('/database.js')) return synthetic({ default: db });
    if (specifier.endsWith('/bangkok-date.js')) return synthetic(bangkokDate);
    if (specifier.endsWith('/order.model.js')) return synthetic({ ensureOrderReceivingColumns: async () => {} });
    if (specifier.endsWith('/receiving-documents-schema.js')) return synthetic({ ensureReceivingDocumentsTables: async () => {} });
    if (specifier.endsWith('/receiving-documents-helpers.js')) return synthetic(helpers);
    if (specifier.endsWith('/receiving-documents-alias.js')) return synthetic({ fetchSupplierConfirmedAliases: async () => [] });
    if (specifier.endsWith('/receiving-ocr.service.js')) return synthetic(ocr);
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await flow.evaluate();
  const user = { id: 12, name: 'SYNTHETIC', role: 'user', branch_id: 1, department_id: 10 };
  return { row, db, transactions, run: () => flow.namespace.runDocumentOcr({ user, documentId: row.id }) };
}


test('statement: prompt and wire schema know doc_kind statement; old kinds still work', () => {
  assert.ok(ocr.BILL_OCR_SYSTEM_PROMPT.includes('bill | slip | other | statement'));
  for (const token of ['ใบรับวางบิล', 'Bill Acceptance', 'รับสินค้าวันที่', 'บริษัท โซลาว', 'ติดลบ']) {
    assert.ok(ocr.BILL_OCR_SYSTEM_PROMPT.includes(token), token);
  }
  const props = ocr.BILL_OCR_JSON_SCHEMA.schema.properties;
  assert.deepEqual(props.doc_kind.enum, ['bill', 'slip', 'other', 'statement']);
  assert.ok(ocr.BILL_OCR_JSON_SCHEMA.schema.required.includes('doc_title'));
  assert.deepEqual(Object.keys(props).sort(), [...ocr.BILL_OCR_JSON_SCHEMA.schema.required].sort());
  for (const kind of ['bill', 'slip', 'other']) {
    assert.equal(ocr.normalizeOcrPayload({ doc_kind: kind, lines: [line()] }).doc_kind, kind);
  }
});

test('statement: provider doc_kind statement drops every line, money and header facts, and warns BILL_IS_STATEMENT', () => {
  const result = ocr.normalizeOcrPayload({ doc_kind: 'statement', supplier_name: 'ร้านทดลอง', doc_ref: 'PB000000-001',
    doc_date: '16/9/2569', subtotal: 100, total: 100, confidence: 0.9, lines: [line(0), line(1)] }, null,
  { deliveryDate: '2026-10-16' });
  assert.equal(result.doc_kind, 'statement');
  assert.equal(result.statement_reason, 'doc_kind');
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.warnings, ['BILL_IS_STATEMENT']);
  assert.equal(result.unreadable_line_count, 0);
  assert.equal(result.line_sum_proposal, null);
  for (const key of ['total', 'subtotal', 'discount', 'vat', 'doc_ref', 'doc_date', 'supplier_name']) assert.equal(result[key], null, key);
});

test('statement: heuristic safety net catches SOLAO header, Bill Acceptance text, period summary and invoice lists', () => {
  const cases = {
    solao_header: { doc_kind: 'bill', supplier_name: 'บริษัท โซลาว จำกัด', lines: [line()] },
    statement_text: { doc_kind: 'bill', doc_title: 'ใบรับวางบิล / Bill Acceptance', lines: [line()] },
    statement_text2: { doc_kind: 'bill', supplier_name: 'ร้านทดลอง', doc_ref: 'ใบวางบิล AR-000001', lines: [line()] },
    period_summary: { doc_kind: 'bill', supplier_name: 'ร้านทดลอง', total: 25926,
      lines: [line(0, { bill_text: 'รับสินค้าวันที่ 1-15/9/69', amount: 25926, unit_price: 25926 })] },
    invoice_list: { doc_kind: 'bill', lines: [line(0, { bill_text: 'PU000000001' }), line(1, { bill_text: 'PU000000002' })] },
    no_doc_kind: { supplier_name: 'บริษัท โซลาว จำกัด', lines: [line()] },
  };
  for (const [name, payload] of Object.entries(cases)) {
    const result = ocr.normalizeOcrPayload(payload);
    assert.equal(result.doc_kind, 'statement', name);
    assert.deepEqual(result.lines, [], name);
    assert.deepEqual(result.warnings, ['BILL_IS_STATEMENT'], name);
  }
  assert.equal(ocr.normalizeOcrPayload(cases.period_summary).statement_reason, 'period_summary');
  assert.equal(ocr.normalizeOcrPayload(cases.invoice_list).statement_reason, 'invoice_list');
});

test('statement: ordinary delivery notes are never mistaken for statements', () => {
  const ordinary = [
    { doc_kind: 'bill', supplier_name: 'ร้านทดลองผัก', ship_to: 'ร้านโซลาวบ้านแจ้', addressee: 'บริษัท โซลาว จำกัด', lines: [line(0), line(1)] },
    { doc_kind: 'bill', supplier_name: 'ร้านทดลอง', lines: [line(0, { bill_text: 'รับสินค้าวันที่ 1-15/9/69' }), line(1)] },
    { doc_kind: 'bill', lines: [line(0, { bill_text: 'PU000000001' }), line(1, { bill_text: 'ผักกาด' })] },
    { lines: [line(0, { bill_text: 'น้ำแข็งหลอด' })] },
  ];
  for (const payload of ordinary) {
    const result = ocr.normalizeOcrPayload(payload);
    assert.notEqual(result.doc_kind, 'statement');
    assert.ok(result.lines.length >= 1);
    assert.ok(!result.warnings.includes('BILL_IS_STATEMENT'));
  }
});

// Synthetic beverage invoice: negative-price discount row ("ลด 26.-", qty 4, price -24.30).
const beverage = (extra = {}) => ({ doc_kind: 'bill', supplier_name: 'บริษัทเครื่องดื่มทดลอง จำกัด', subtotal: 1000, vat: 0, total: 902.8,
  confidence: 0.95, lines: [
    line(0, { bill_text: 'น้ำอัดลมทดลอง CAN325', quantity_billed: 40, unit_price: 20, amount: 800 }),
    line(1, { bill_text: 'น้ำดื่มทดลอง 600', quantity_billed: 20, unit_price: 10, amount: 200 }),
    { bill_text: 'LH CAN325 ... ลด 26.-', quantity_billed: 4, unit_price: -24.3, amount: -97.2, confidence: 0.9 },
  ], ...extra });

test('discount: negative rows are not product lines, fold into the bill discount and keep totals reconciled', () => {
  const result = ocr.normalizeOcrPayload(beverage());
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.every((l) => !/ลด/.test(l.bill_text)));
  assert.deepEqual(result.lines.map((l) => l.line_no), [1, 2]);
  assert.deepEqual(result.discount_lines, [{ kind: 'discount', bill_text: 'LH CAN325 ... ลด 26.-', amount: 97.2 }]);
  assert.equal(result.discount, 97.2);
  assert.equal(result.has_schema_warnings, false);
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.unreadable_line_count, 0);
  const { warningCodes } = ocr.computeDocumentWarnings({ document: { subtotal: result.subtotal, discount: result.discount,
    vat: result.vat, total: result.total }, lines: result.lines });
  assert.ok(!warningCodes.includes('SUM_MISMATCH'));
  assert.ok(!warningCodes.includes('TOTAL_EQUATION_MISMATCH'));
});

test('discount: amount derived from qty x negative price, header discount never doubled, text-only labels recognised', () => {
  const derived = ocr.normalizeOcrPayload(beverage({ lines: beverage().lines.map((l) => (l.unit_price < 0 ? { ...l, amount: null } : l)) }));
  assert.equal(derived.discount, 97.2);
  assert.equal(derived.lines.length, 2);
  const printed = ocr.normalizeOcrPayload(beverage({ discount: 97.2 }));
  assert.equal(printed.discount, 97.2);
  assert.equal(printed.discount_lines.length, 1);
  const labelled = ocr.normalizeOcrPayload({ lines: [line(0), { bill_text: 'ส่วนลดการค้า', amount: 5 }] });
  assert.equal(labelled.lines.length, 1);
  assert.equal(labelled.discount, 5);
  // A product whose name merely contains the word is still a product.
  assert.equal(ocr.normalizeOcrPayload({ lines: [line(0, { bill_text: 'นมลดน้ำตาล' })] }).lines.length, 1);
  // A discount-only document is still not a delivery note.
  assert.deepEqual(ocr.normalizeOcrPayload({ lines: [{ bill_text: 'ลด 26.-', quantity_billed: 4, unit_price: -24.3 }] }).warnings, ['NOT_A_BILL']);
});

test('discount: other invalid negatives remain schema warnings (quantity) and cannot create money', () => {
  const result = ocr.normalizeOcrPayload({ lines: [line(0, { quantity_billed: -2 })], total: -5 });
  assert.equal(result.has_schema_warnings, true);
  assert.equal(result.total, null);
});

test('statement: real provider path with a mocked HTTP response creates no lines (no network)', async () => {
  const payload = { doc_kind: 'bill', doc_title: 'ใบรับวางบิล Bill Acceptance', supplier_name: 'บริษัท โซลาว จำกัด', lines: [line()] };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ model: 'mock-model',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }] }) });
  const image = { page_no: 1, mime_type: 'image/jpeg', size_bytes: 4, image_data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
  const result = await ocr.extractBillWithVision({ images: [image], document: { delivery_date: '2026-10-16' },
    apiKey: 'SYNTHETIC-not-a-key', fetchImpl });
  assert.equal(result.doc_kind, 'statement');
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.warnings, ['BILL_IS_STATEMENT']);
});

for (const [name, provider] of [
  ['provider statement', { doc_kind: 'statement', total: 25926, lines: [line()] }],
  ['heuristic header', { doc_kind: 'bill', supplier_name: 'บริษัท โซลาว จำกัด', total: 10, lines: [line()] }],
]) {
  test(`statement flow (${name}): no bill lines, warning persisted, image evidence kept, counting untouched`, async (t) => {
    const h = await createHarness();
    ocr.setCustomOcrProvider(async () => ({ model: 'SYNTHETIC-mock', ...provider }));
    t.after(() => { ocr.setCustomOcrProvider(null); ocr.resetOcrRateLimit(); });
    const result = await h.run();
    assert.equal(result.lines.length, 0);
    assert.equal(result.ocr.status, 'done');
    assert.equal(result.ocr.doc_kind, 'statement');
    assert.deepEqual(result.ocr.warnings, ['BILL_IS_STATEMENT']);
    assert.ok(result.warnings.some((w) => w.code === 'BILL_IS_STATEMENT' && /ใบวางบิล/.test(w.message)));
    assert.ok(!result.warnings.some((w) => w.code === 'NOT_A_BILL'));
    assert.equal(result.total, null);
    assert.equal(result.images.length, 1);
    assert.deepEqual(JSON.parse(h.row.ocr_result_json).warnings, ['BILL_IS_STATEMENT']);
    assert.deepEqual(h.transactions, ['begin', 'commit', 'release']);
    // Reload from storage and from the list mapper: the warning survives header edits.
    h.row.total = 999;
    await helpers.recalculateAndPersistWarnings(h.db, h.row, result.lines);
    const edited = await helpers.loadDocumentBundleById(h.db, h.row.id);
    assert.deepEqual(edited.ocr.warnings, ['BILL_IS_STATEMENT']);
    assert.ok(edited.warnings.some((w) => w.code === 'BILL_IS_STATEMENT'));
    assert.deepEqual(helpers.mapReceivingDocumentRow(h.row, { includeLines: false }).ocr.warnings, ['BILL_IS_STATEMENT']);
  });
}

test('discount flow: discount rows never become receiving lines; discount saved on the document', async (t) => {
  const h = await createHarness();
  ocr.setCustomOcrProvider(async () => ({ model: 'SYNTHETIC-mock', ...beverage() }));
  t.after(() => { ocr.setCustomOcrProvider(null); ocr.resetOcrRateLimit(); });
  const result = await h.run();
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.every((l) => !/ลด/.test(l.bill_text)));
  assert.equal(Number(result.discount), 97.2);
  assert.equal(Number(result.total), 902.8);
  const codes = result.warnings.map((w) => w.code);
  for (const code of ['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'BILL_TOTAL_MISMATCH']) assert.ok(!codes.includes(code), code);
  assert.deepEqual(JSON.parse(h.row.ocr_result_json).discount_lines, [{ kind: 'discount', bill_text: 'LH CAN325 ... ลด 26.-', amount: 97.2 }]);
});
