import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as ocr from '../src/services/receiving-ocr.service.js';
import * as helpers from '../src/models/receiving-documents-helpers.js';
import * as bangkokDate from '../src/utils/bangkok-date.js';

const line = (i = 0) => ({ bill_text: `สินค้าทดลอง ${i + 1}`, quantity_billed: 1,
  unit_price: 10, amount: 10, confidence: 0.95 });
const classificationWarnings = (codes) => codes.filter((code) =>
  ['NOT_A_BILL', 'DOC_KIND_UNCERTAIN'].includes(code));
const kinds = [undefined, null, 'unknown', 'bill', 'slip', 'other', 'invalid'];

for (const kind of kinds) {
  for (const count of [0, 1, 10]) {
    test(`S doc_kind=${String(kind)}, ${count} normalized lines selects only the appropriate warning`, () => {
      const result = ocr.normalizeOcrPayload({ ...(kind === undefined ? {} : { doc_kind: kind }),
        total: count * 10, confidence: 0.95, lines: Array.from({ length: count }, (_, i) => line(i)) });
      assert.equal(result.doc_kind, ['bill', 'slip', 'other'].includes(kind) ? kind : 'unknown');
      assert.equal(result.lines.length, count);
      assert.deepEqual(classificationWarnings(result.warnings), count === 0 ? ['NOT_A_BILL']
        : ['slip', 'other'].includes(kind) ? ['DOC_KIND_UNCERTAIN'] : []);
      assert.equal(result.has_schema_warnings, kind === 'invalid');
      assert.equal(result.confidence, kind === 'invalid' ? 0.5 : 0.95);
    });
  }
}

test('S counts usable normalized rows, never raw blank/invalid entries', () => {
  for (const kind of kinds) {
    const empty = ocr.normalizeOcrPayload({ doc_kind: kind,
      lines: [null, {}, 'invalid row', { bill_text: '  ', amount: -1, quantity_billed: 'invalid' }] });
    assert.equal(empty.lines.length, 0);
    assert.deepEqual(classificationWarnings(empty.warnings), ['NOT_A_BILL']);
    const mixed = ocr.normalizeOcrPayload({ doc_kind: kind, lines: [null, {}, line()] });
    assert.equal(mixed.lines.length, 1);
    assert.ok(!mixed.warnings.includes('NOT_A_BILL'));
  }
  // Unreadable prices and unmatched catalog names still belong in the review list.
  const named = ocr.normalizeOcrPayload({ lines: [{ bill_text: 'ยังอ่านราคาไม่ได้' }] });
  assert.equal(named.lines.length, 1);
  assert.ok(!named.warnings.includes('NOT_A_BILL'));
});

test('S provider warning strings cannot override classification or existing monetary safeguards', () => {
  const result = ocr.normalizeOcrPayload({ doc_kind: 'slip', doc_date: '16/10/2569',
    warnings: ['NOT_A_BILL'], total: '9,999.00', confidence: 0.99,
    lines: [line(), { ...line(1), amount: '1,000.10' }, { ...line(2), amount: 0.2 }] });
  assert.deepEqual(classificationWarnings(result.warnings), ['DOC_KIND_UNCERTAIN']);
  assert.ok(result.warnings.includes('SUM_MISMATCH'));
  assert.ok(result.warnings.includes('LOW_CONFIDENCE'));
  assert.ok(result.confidence <= 0.6);
  assert.equal(result.doc_date, '2026-10-16');
  const noTotal = ocr.normalizeOcrPayload({ lines: [{ ...line(), amount: 0.1 }, { ...line(1), amount: 0.2 }] });
  assert.equal(noTotal.line_sum_proposal, '0.30');
  assert.ok(noTotal.warnings.includes('TOTAL_MISSING_LINE_SUM'));
  assert.deepEqual(classificationWarnings(noTotal.warnings), []);
});

test('S document warning recalculation preserves uncertainty once at document level', () => {
  const document = { ocr_result_json: JSON.stringify({ warnings: ['DOC_KIND_UNCERTAIN', 'DOC_KIND_UNCERTAIN'] }) };
  const result = ocr.computeDocumentWarnings({ document, lines: [line()] });
  const warnings = result.warnings.filter((w) => w.code === 'DOC_KIND_UNCERTAIN');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].line_no, null);
  assert.match(warnings[0].message, /พบรายการสินค้า/);
  assert.deepEqual(classificationWarnings(result.warningCodes), ['DOC_KIND_UNCERTAIN']);
});

// Run the real OCR flow, warning persistence and response mapper against an in-memory
// SQL adapter. No database module, credentials, real network or shared test harness.
async function createHarness() {
  ocr.resetOcrRateLimit();
  const row = { id: 901, status: 'draft', kind: 'bill', branch_id: 1, department_id: 10,
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
      if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'pending\'')) {
        row.ocr_status = 'pending'; row.ocr_attempt_count++; return [{ affectedRows: 1 }];
      }
      if (q.startsWith('UPDATE receiving_documents SET supplier_name_text')) {
        const fields = ['supplier_name_text', 'doc_ref', 'doc_date', 'subtotal', 'discount', 'vat', 'total',
          'ocr_model', 'ocr_confidence', 'ocr_images_hash', 'ocr_result_json'];
        fields.forEach((field, i) => { row[field] = params[i]; });
        row.ocr_status = 'done'; return [{ affectedRows: 1 }];
      }
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
    if (specifier.endsWith('/database.js')) return synthetic({ default: db });
    if (specifier.endsWith('/bangkok-date.js')) return synthetic(bangkokDate);
    if (specifier.endsWith('/order.model.js')) return synthetic({ ensureOrderReceivingColumns: async () => {} });
    if (specifier.endsWith('/receiving-documents-schema.js')) return synthetic({ ensureReceivingDocumentsTables: async () => {} });
    if (specifier.endsWith('/receiving-documents-helpers.js')) return synthetic(helpers);
    if (specifier.endsWith('/receiving-ocr.service.js')) return synthetic(ocr);
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await flow.evaluate();
  const user = { id: 12, name: 'SYNTHETIC', role: 'user', branch_id: 1, department_id: 10 };
  return { row, db, transactions, run: () => flow.namespace.runDocumentOcr({ user, documentId: row.id }) };
}

for (const kind of [undefined, 'bill', 'slip', 'other']) {
  for (const count of [0, 10]) {
    test(`S mock provider ${String(kind)}/${count}: transaction, metadata, GET/list mapping and hash cache`, async (t) => {
      const h = await createHarness();
      let calls = 0;
      ocr.setCustomOcrProvider(async () => {
        calls++;
        return { ...(kind === undefined ? {} : { doc_kind: kind }), model: 'SYNTHETIC-mock',
          total: count * 10, lines: Array.from({ length: count }, (_, i) => line(i)) };
      });
      t.after(() => { ocr.setCustomOcrProvider(null); ocr.resetOcrRateLimit(); });
      const result = await h.run();
      const expected = count === 0 ? ['NOT_A_BILL']
        : ['slip', 'other'].includes(kind) ? ['DOC_KIND_UNCERTAIN'] : [];
      assert.equal(result.ocr.doc_kind, kind ?? 'unknown');
      assert.equal(result.ocr.status, 'done');
      assert.equal(result.lines.length, count);
      assert.deepEqual(classificationWarnings(result.ocr.warnings), expected);
      assert.deepEqual(classificationWarnings(result.warnings.map((w) => w.code)), expected);
      assert.deepEqual(classificationWarnings(JSON.parse(h.row.ocr_result_json).warnings), expected);
      assert.deepEqual(h.transactions, ['begin', 'commit', 'release']);
      const get = await helpers.loadDocumentBundleById(h.db, h.row.id);
      const listEntry = helpers.mapReceivingDocumentRow(h.row, { includeLines: false });
      assert.deepEqual(get.ocr, result.ocr);
      assert.deepEqual(listEntry.ocr, result.ocr);
      assert.deepEqual(listEntry.warnings, result.warnings);
      // Header edits must not reinterpret the original OCR classification snapshot.
      h.row.total = 999;
      await helpers.recalculateAndPersistWarnings(h.db, h.row, result.lines);
      const edited = await helpers.loadDocumentBundleById(h.db, h.row.id);
      assert.deepEqual(classificationWarnings(edited.ocr.warnings), expected);
      const cached = await h.run();
      assert.deepEqual(cached, edited);
      assert.equal(calls, 1);
      assert.equal(h.row.ocr_attempt_count, 1);
      assert.deepEqual(h.transactions, ['begin', 'commit', 'release']);
    });
  }
}
