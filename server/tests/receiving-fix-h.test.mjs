import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
import { computeDocumentWarnings, setCustomOcrProvider, resetOcrRateLimit } from '../src/services/receiving-ocr.service.js';

const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });

test('H1 branch OCR omits products without fabricating low confidence, preserves counts and retains genuine row/bill warnings', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-18' });
  h.state.orderItems.forEach(row => { row.order_date = h.today; });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'h1-missing', scope: 'branch',
    delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.data.id;
  assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: {
    page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  const ordered = h.state.orderItems.find(row => row.id === 50);
  const counts = h.state.lines.map(row => row.quantity_received);
  let confidence = 0.99;
  setCustomOcrProvider(async () => ({ doc_kind: 'bill', confidence, total: 20,
    lines: [{ bill_text: ordered.product_name, quantity_billed: 2, unit_text: 'กก.', unit_price: 10, amount: 20, confidence }] }));
  const run = body => h.invoke('runOcr', { user, params: { id }, body });
  const first = await run({});
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const absent = first.body.data.lines.find(row => row.order_item_id === 51);
  assert.ok(absent);
  assert.equal(absent.quantity_billed, null);
  assert.equal(absent.unit_price, null);
  assert.equal(absent.match.confidence, null);
  assert.deepEqual(h.state.lines.map(row => row.quantity_received), counts);
  assert.equal(first.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE'), false);
  const cached = await run({});
  assert.equal(cached.statusCode, 200);
  assert.equal(cached.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE'), false);

  // Existing round-G drafts may contain the old synthetic confidence.
  const old = h.state.lines.find(row => row.order_item_id === 51);
  old.match_confidence = 0.4;
  const refreshed = await h.invoke('updateDocument', { user, params: { id }, body: { doc_ref: 'H1-REVIEW' } });
  assert.equal(refreshed.statusCode, 200);
  const reopened = await h.invoke('getDocumentById', { user, params: { id } });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE'), false);

  confidence = 0.3;
  assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: {
    page_no: 2, image_data_url: makeJpegDataUrl(800, 600) } })).statusCode, 201);
  const low = await run({});
  assert.equal(low.statusCode, 200, JSON.stringify(low.body));
  assert.ok(low.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE' && w.line_no == null));
  assert.ok(low.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE' && w.line_no === 1));
  assert.equal(low.body.data.warnings.some(w => w.code === 'LOW_CONFIDENCE' && w.line_no === absent.line_no), false);
});

test('H1 suppresses only branch rows absent from bill, preserves unreadable/zero-price evidence and document-level warnings', () => {
  const missing = { line_no: 1, order_item_id: 50, product_id: 7, bill_text: '', quantity_billed: null,
    quantity_received: 2, unit_price: null, amount: null, match_confidence: 0.4 };
  const warnings = (document, row = missing) => computeDocumentWarnings({ document, lines: [row] }).warnings
    .filter(w => w.code === 'LOW_CONFIDENCE');
  assert.equal(warnings({ receiving_scope: 'branch', ocr_confidence: 0.99 }).length, 0);
  assert.equal(warnings({ receiving_scope: 'branch', ocr_confidence: 0.3 }).length, 1);
  assert.equal(warnings({ receiving_scope: 'department' }).length, 1, 'legacy department behavior preserved');
  for (const patch of [{ bill_text: 'อ่านได้บางส่วน' }, { quantity_billed: 0 }, { unit_price: 0 }, { amount: 0 }]) {
    assert.equal(warnings({ receiving_scope: 'branch' }, { ...missing, ...patch }).length, 1);
  }
});
