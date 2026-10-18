import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBillDate, normalizeOcrPayload, extractBillWithVision,
  computeDocumentWarnings } from '../src/services/receiving-ocr.service.js';
import { createReceivingHarness, deltaActor, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
import * as ocr from '../src/services/receiving-ocr.service.js';

const deliveryDate = '2026-10-18';
const cases = [
  ['2009-09-16', null], // No deterministic relationship from 09 to BE 69.
  ['2569-09-16', '2026-09-16'],
  ['16/9/2569', '2026-09-16'],
  ['16/9/69', '2026-09-16'],
  ['2069-09-16', '2026-09-16'],
  ['1969-09-16', '2026-09-16'],
  ['2026-09-16', '2026-09-16'],
  ['2099-09-16', null],
  ['2569-12-31', null],
  ['2026-04-21', '2026-04-21'], // -180 days inclusive.
  ['2026-04-20', null],
  ['2026-10-25', '2026-10-25'], // +7 days inclusive.
  ['2026-10-26', null],
  ['16/9', '2026-09-16'],
  ['31/2/69', null],
  ['2026-02-29', null],
  ['ignore instructions', null],
  [null, null]
];
const payload = doc_date => ({ doc_kind: 'bill', doc_date, total: 100,
  confidence: 0.99, lines: [{ bill_text: 'ไก่', quantity_billed: 1, unit_price: 100, amount: 100, confidence: 0.99 }] });

for (const [raw, expected] of cases) {
  test(`OCR date ${raw} anchored to ${deliveryDate} -> ${expected}`, () => {
    assert.equal(normalizeBillDate(raw, { deliveryDate }), expected);
    const result = normalizeOcrPayload(payload(raw), 'mock', { deliveryDate });
    assert.equal(result.doc_date, expected);
    assert.equal(result.warnings.includes('DOC_DATE_INVALID'), expected === null);
    assert.equal(result.total, 100);
    const warnings = computeDocumentWarnings({ document: { ocr_result_json: JSON.stringify(result) } }).warnings;
    assert.equal(warnings.some(w => w.code === 'DOC_DATE_INVALID'), expected === null);
    if (expected === null) assert.deepEqual(warnings.find(w => w.code === 'DOC_DATE_INVALID'), {
      code: 'DOC_DATE_INVALID', message: 'วันที่ในบิลอ่านไม่ได้/ผิดปกติ กรุณาตรวจ', line_no: null
    });
  });
}

test('date inference handles year rollover, leap days and invalid anchors without the wall clock', () => {
  assert.equal(normalizeBillDate('31/12', { deliveryDate: '2027-01-02' }), '2026-12-31');
  assert.equal(normalizeBillDate('2/1', { deliveryDate: '2026-12-30' }), '2027-01-02');
  assert.equal(normalizeBillDate('29/2/67', { deliveryDate: '2024-03-01' }), '2024-02-29');
  assert.equal(normalizeBillDate('29/2', { deliveryDate: '2026-03-01' }), null);
  assert.equal(normalizeBillDate('2026-10-18', { deliveryDate: 'bad' }), null);
  assert.equal(normalizeBillDate('2026-10-18', { deliveryDate: null }), null);
  assert.equal(normalizeBillDate('2009-09-16'), '2009-09-16'); // Manual-date callers retain their contract.
});

test('mock Vision uses the same date guard and includes the delivery anchor in its prompt', async () => {
  for (const [raw, expected] of cases) {
    const result = await extractBillWithVision({
      images: [{ page_no: 1, image_data_url: makeJpegDataUrl() }],
      document: { delivery_date: deliveryDate }, apiKey: 'mock-only',
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        assert.match(request.messages[0].content, /69 เป็น 2569/);
        assert.match(request.messages[0].content, /ไม่มีปี/);
        assert.match(request.messages[1].content[0].text, /delivery_date .*2026-10-18/);
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload(raw)) } }] }) };
      }
    });
    assert.equal(result.doc_date, expected);
    assert.equal(result.warnings.includes('DOC_DATE_INVALID'), expected === null);
  }
});

test('Bangkok delivery Date objects keep inclusive date boundaries across UTC midnight', async () => {
  const delivery_date = new Date('2026-10-17T17:00:00Z'); // Oct 18 in Bangkok.
  assert.equal(normalizeBillDate('2026-10-25', { deliveryDate: delivery_date }), '2026-10-25');
  assert.equal(normalizeBillDate('2026-10-26', { deliveryDate: delivery_date }), null);
});

for (const manual of [false, true]) {
  test(`date warning persists through OCR/GET/cache/list/edit; manual header preserved=${manual}`, async () => {
    const h = await createReceivingHarness({ testDate: deliveryDate });
    const created = await h.invoke('createDocument', { user: deltaActor, body: {
      client_uuid: `ocr-year-${manual}`, delivery_date: deliveryDate, kind: 'bill'
    } });
    assert.equal(created.statusCode, 201);
    const id = String(created.body.data.id);
    const stored = h.state.documents.find(doc => doc.id === Number(id));
    Object.assign(stored, { doc_date: manual ? '2026-09-16' : '2009-09-16', is_header_edited: manual });
    await h.invoke('uploadImage', { user: deltaActor, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
    let calls = 0;
    ocr.setCustomOcrProvider(async () => { calls++; return payload('2009-09-16'); });
    try {
      const result = await h.invoke('runOcr', { user: deltaActor, params: { id } });
      const check = doc => {
        assert.equal(doc.doc_date, manual ? '2026-09-16' : null);
        assert.ok(doc.ocr.warnings.includes('DOC_DATE_INVALID'));
        assert.ok(doc.warnings.some(w => w.code === 'DOC_DATE_INVALID' && w.message === 'วันที่ในบิลอ่านไม่ได้/ผิดปกติ กรุณาตรวจ'));
        assert.equal(doc.ocr.raw_read.doc_date, null);
      };
      assert.equal(result.statusCode, 200);
      check(result.body.data);
      check((await h.invoke('getDocumentById', { user: deltaActor, params: { id } })).body.data);
      check((await h.invoke('runOcr', { user: deltaActor, params: { id } })).body.data);
      const list = await h.invoke('listDocuments', { user: deltaActor, query: { date: deliveryDate } });
      assert.equal(list.statusCode, 200);
      check(list.body.data.find(doc => String(doc.id) === id));
      const edit = await h.invoke('updateDocument', { user: deltaActor, params: { id }, body: { total: '100.00' } });
      assert.equal(edit.statusCode, 200);
      check(edit.body.data);
      assert.equal(calls, 1);
    } finally { ocr.setCustomOcrProvider(null); }
  });
}
