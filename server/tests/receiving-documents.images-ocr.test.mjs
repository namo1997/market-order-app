import test from 'node:test';
import assert from 'node:assert/strict';
import * as ocrService from '../src/services/receiving-ocr.service.js';
import { makeJpegDataUrl, createReceivingHarness, deltaActor } from './helpers/receiving-fake-db.mjs';

test("Upload rejects page 11 above the ten-page document limit", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const created = await h.invoke('createDocument', {
    user,
    body: {
      client_uuid: 'ocr-race-test',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50]
    }
  });
  const docId = String(created.body.data.id);

  // ข้อ 5: อัปโหลดหน้าเกินเพดาน 10 หน้า (page_no = 11) ต้องได้ 422 VALIDATION_FAILED
  const page11Res = await h.invoke('uploadImage', {
    user,
    params: { id: docId },
    body: { page_no: 11, image_data_url: makeJpegDataUrl(400, 300) }
  });
  assert.equal(page11Res.statusCode, 422);
  assert.equal(page11Res.body.code, 'VALIDATION_FAILED');
});

test("OCR cache, claim races and recovery", async (t) => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const created = await h.invoke('createDocument', {
    user,
    body: {
      client_uuid: 'ocr-race-test',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50]
    }
  });
  const docId = String(created.body.data.id);

  await h.invoke('uploadImage', {
    user,
    params: { id: docId },
    body: { page_no: 1, image_data_url: makeJpegDataUrl(640, 480) }
  });

  let aiCallCount = 0;
  ocrService.setCustomOcrProvider(async () => {
    aiCallCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      supplier_name: 'ตลาดสดสันกำแพง',
      doc_ref: 'INV-DEDUPE-1',
      doc_date: '14/10/2569',
      subtotal: 1500,
      total: 1500,
      confidence: 0.96,
      lines: [
        {
          line_no: 1,
          bill_text: 'หมูสามชั้น',
          quantity_billed: 10,
          unit_text: 'กก.',
          unit_price: 150,
          amount: 1500,
          confidence: 0.96
        }
      ]
    };
  });

  let docObj, docAfterRace;
  try {
    await t.test("Concurrent OCR claims the document once and calls the provider once", async () => {
      // ทดสอบยิง OCR พร้อมกัน 2 คำขอจริงด้วย Promise.all:
      // คำขอแรกได้ claim และสำเร็จ (200), คำขอที่สองชน pending ได้ 409 NOT_DRAFT
      const [concurrent1, concurrent2] = await Promise.all([
        h.invoke('runOcr', { user, params: { id: docId } }),
        h.invoke('runOcr', { user, params: { id: docId } })
      ]);
      const statuses = [concurrent1.statusCode, concurrent2.statusCode].sort();
      assert.deepEqual(statuses, [200, 409]);
      assert.equal(aiCallCount, 1);
    });
    await t.test("Identical image hash returns cached OCR without another provider call", async () => {
      // กด OCR ซ้ำด้วยรูปเดิม -> คืนผลเดิมทันทีจาก sha256 โดยไม่เรียก AI ซ้ำ
      const cachedOcr = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(cachedOcr.statusCode, 200);
      assert.equal(aiCallCount, 1, 'Second OCR with identical image hash must not call AI again');
    });
    await t.test("Recent pending OCR is blocked and stale pending can be reclaimed", async () => {
      // R2-3: หาก process ตายและเอกสารค้าง pending:
      // - ถ้ายังไม่ถึง 2 นาที ต้องได้ 409 NOT_DRAFT
      // - ถ้าเกิน 2 นาที (ocr_last_requested_at < NOW() - 2 นาที) ต้องอนุญาตให้ claim ใหม่และอ่านสำเร็จ!
      docObj = h.state.documents.find((d) => d.id === Number(docId));
      docObj.ocr_status = 'pending';
      docObj.ocr_images_hash = null;
      docObj.ocr_last_requested_at = new Date().toISOString();

      const blockedRecentPending = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(blockedRecentPending.statusCode, 409);
      assert.equal(blockedRecentPending.body.code, 'NOT_DRAFT');

      docObj.ocr_last_requested_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const reclaimedStalePending = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(reclaimedStalePending.statusCode, 200);
      assert.equal(docObj.ocr_status, 'done');
    });
    await t.test("Post-claim alias lookup failure resets OCR status to failed", async () => {
      // R2-3: หากขั้นตอนนอก transaction หลัง claim ล้มเหลว (เช่น query alias ล้มเหลว)
      // ocr_status ต้องถูกคืนเป็น 'failed' ไม่ค้าง 'pending'
      docObj.ocr_status = 'none';
      docObj.ocr_images_hash = null;
      h.state.failOnAliasLookupAfterClaim = true;
      const aliasLookupFailRes = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(aliasLookupFailRes.statusCode, 500);
      assert.equal(aliasLookupFailRes.body.code, 'INTERNAL_ERROR');
      assert.equal(docObj.ocr_status, 'failed', 'ocr_status must be reset to failed when post-claim query fails');
      h.state.failOnAliasLookupAfterClaim = false;
    });
    await t.test("Late OCR never overwrites a concurrently confirmed document", async () => {
      // ทดสอบ Race Condition ข้อ 2: เอกสารถูก confirm ระหว่างรอผล AI -> ต้องไม่เขียนทับเอกสารที่ confirm แล้ว
      docObj.ocr_status = 'none';
      docObj.ocr_images_hash = null;
      ocrService.setCustomOcrProvider(async () => {
        docObj.status = 'confirmed';
        return {
          supplier_name: 'ไม่ควรเขียนทับ',
          doc_ref: 'OVERWRITE-ATTEMPT',
          total: 9999,
          confidence: 0.95,
          lines: [{ line_no: 1, bill_text: 'หมูสามชั้น', quantity_billed: 99, unit_price: 100, amount: 9900 }]
        };
      });

      const ocrDuringConfirm = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(ocrDuringConfirm.statusCode, 409);
      assert.equal(ocrDuringConfirm.body.code, 'NOT_DRAFT');
      docAfterRace = h.state.documents.find((d) => d.id === Number(docId));
      assert.equal(docAfterRace.doc_ref, 'INV-DEDUPE-1', 'Confirmed document must not be overwritten by late OCR');
    });
    await t.test("Document OCR attempt ceiling returns 429 RATE_LIMITED", async () => {
      // R2-10: ทดสอบเพดาน DB ocr_attempt_count >= 10 -> ตอบ 429 RATE_LIMITED
      docAfterRace.status = 'draft';
      docAfterRace.ocr_status = 'none';
      docAfterRace.ocr_images_hash = null;
      docAfterRace.ocr_attempt_count = 10;
      const dbRateLimited = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(dbRateLimited.statusCode, 429);
      assert.equal(dbRateLimited.body.code, 'RATE_LIMITED');
    });
  } finally {
    ocrService.setCustomOcrProvider(null);
  }
});

test('R2 pilot OCR custom provider with priced line, two linked items and missing doc_kind completes and caches', async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  const created = await h.invoke('createDocument', { user, body: {
    client_uuid: 'r2-pilot-priced-ocr', delivery_date: h.today, kind: 'bill', order_item_ids: [50, 51]
  } });
  assert.equal(created.statusCode, 201);
  const id = String(created.body.data.id);
  assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: {
    page_no: 1, image_data_url: makeJpegDataUrl()
  } })).statusCode, 201);
  let calls = 0;
  ocrService.setCustomOcrProvider(async ({ document, expectedItems }) => {
    calls++;
    assert.equal(expectedItems.length, 2);
    return { model: 'SYNTHETIC-mock', supplier_name: 'SYNTHETIC supplier',
      doc_ref: `SYNTHETIC-${document.id}`, doc_date: document.delivery_date,
      subtotal: '25.00', discount: '0.00', vat: '0.00', total: '25.00', confidence: 1,
      lines: [{ bill_text: expectedItems[0].product_name, unit_text: expectedItems[0].unit_name,
        quantity_billed: '2.50', unit_price: '10.00', amount: '25.00', confidence: 1 }] };
  });
  try {
    const result = await h.invoke('runOcr', { user, params: { id } });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.ocr.status, 'done');
    assert.equal(result.body.data.ocr.doc_kind, 'unknown');
    assert.equal(result.body.data.ocr.warnings.includes('NOT_A_BILL'), false);
    assert.equal(result.body.data.ocr.warnings.includes('DOC_KIND_UNCERTAIN'), false);
    assert.equal(result.body.data.total, '25.00');
    assert.equal(result.body.data.lines.length, 2);
    const priced = result.body.data.lines.find(line => line.order_item_id === 50);
    assert.equal(Number(priced.quantity_received), 10);
    assert.equal(Number(priced.counted_quantity), 10);
    assert.equal(Number(priced.quantity_billed), 2.5);
    assert.equal(priced.unit_price, '10.00');
    assert.equal(priced.amount, '25.00');
    assert.equal(Number(result.body.data.lines.find(line => line.order_item_id === 51).quantity_received), 4);
    assert.equal(result.body.data.lines.find(line => line.order_item_id === 51).quantity_billed, null);
    const cached = await h.invoke('runOcr', { user, params: { id } });
    assert.equal(cached.statusCode, 200);
    assert.deepEqual(cached.body.data, result.body.data);
    assert.equal(calls, 1);
  } finally { ocrService.setCustomOcrProvider(null); }
});

test('F2 OCR flow sends only scoped linked items as data, persists zero for X, and keeps omitted lines', async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  const created = await h.invoke('createDocument', { user, body: {
    client_uuid: 'ocr-market-context', delivery_date: h.today, kind: 'bill', order_item_ids: [50, 51]
  } });
  assert.equal(created.statusCode, 201);
  const docId = String(created.body.data.id);
  await h.invoke('uploadImage', { user, params: { id: docId },
    body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  // Linked carryover orders still provide context even when their order date differs.
  h.state.orderItems.find((item) => item.id === 50).order_date = '2026-01-01';
  let calls = 0;
  ocrService.setCustomOcrProvider(async ({ expectedItems }) => {
    calls += 1;
    assert.deepEqual(JSON.parse(JSON.stringify(expectedItems)), [
      { product_name: 'หมูสามชั้น', unit_name: 'กก.', quantity_ordered: 10 },
      { product_name: 'ผักกาดขาว', unit_name: 'กก.', quantity_ordered: 4 }
    ]);
    return { overall_confidence: 0.95, lines: [{
      bill_text: 'หมูสามชั้น', quantity_billed: 10, unit_text: 'กก.', unit_price: 'X', amount: null, confidence: 0.95
    }] };
  });
  try {
    const denied = await h.invoke('runOcr', { user: { ...user, id: 99, branch_id: 2, department_id: 20 }, params: { id: docId } });
    assert.equal(denied.statusCode, 403);
    assert.equal(calls, 0);
    const result = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(result.statusCode, 200);
    assert.equal(calls, 1);
    assert.equal(result.body.data.lines.length, 2);
    for (const row of result.body.data.lines) {
      assert.equal(Number(row.quantity_received), Number(row.counted_quantity));
      assert.equal(row.unit_price, null);
      assert.equal(row.amount, null);
    }
    assert.ok(result.body.data.ocr.warnings.includes('LOW_CONFIDENCE'));
    assert.equal(result.body.data.lines[0].quantity_billed, '10');
    assert.equal(result.body.data.lines[1].quantity_billed, null);
    assert.equal(result.body.data.warnings.some(warning => warning.code === 'QTY_SHORT'), false);
  } finally {
    ocrService.setCustomOcrProvider(null);
  }
});

for (const total of [392, 472]) {
  test(`F3 F4 OCR flow persists capped confidence after preserving manual edits (total=${total})`, async () => {
    const h = await createReceivingHarness();
    const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
    const created = await h.invoke('createDocument', { user, body: {
      client_uuid: `ocr-financial-persistence-${total}`, delivery_date: h.today, kind: 'bill', order_item_ids: [50]
    } });
    const docId = String(created.body.data.id);
    await h.invoke('uploadImage', { user, params: { id: docId },
      body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
    const existing = h.state.lines.find((row) => row.document_id === Number(docId));
    Object.assign(existing, { amount: 100, quantity_billed: 1, quantity_received: 1,
      unit_price: 100, base_unit_price: 100, is_user_edited: true, match_source: 'manual' });
    // OCR itself has consistent line sums; the preserved edit introduces SUM_MISMATCH.
    ocrService.setCustomOcrProvider(async () => ({
      subtotal: 392, total, discount: 0, vat: 0, overall_confidence: 0.95,
      lines: [{ bill_text: 'หมูสามชั้น', quantity_billed: 1, unit_price: 392, amount: 392, confidence: 0.95 }]
    }));
    try {
      const result = await h.invoke('runOcr', { user, params: { id: docId } });
      assert.equal(result.statusCode, 200);
      assert.ok(result.body.data.ocr.confidence <= 0.6);
      assert.ok(h.state.documents.find((row) => row.id === Number(docId)).ocr_confidence <= 0.6);
      for (const code of ['SUM_MISMATCH', 'LOW_CONFIDENCE']) {
        assert.ok(result.body.data.ocr.warnings.includes(code), `Missing persisted warning: ${code}`);
      }
      assert.equal(result.body.data.ocr.warnings.includes('TOTAL_EQUATION_MISMATCH'), total === 472);
      assert.equal(Number(result.body.data.lines[0].amount), 100);
      // Re-read verifies stored confidence, not just the immediate OCR result.
      const reread = await h.invoke('getDocumentById', { user, params: { id: docId } });
      assert.equal(reread.body.data.ocr.confidence, result.body.data.ocr.confidence);
    } finally {
      ocrService.setCustomOcrProvider(null);
    }
  });
}

for (const payload of [
  { doc_kind: 'bill', total: null, lines: [{ bill_text: 'ผัก', quantity_billed: 1, amount: 0.1 },
    { bill_text: 'หมู', quantity_billed: 1, amount: 0.2 }, { bill_text: 'อ่านราคาไม่ได้', amount: null }] },
  { doc_kind: 'slip', total: 100, lines: [] },
  { doc_kind: 'bill', total: null, lines: [] }
]) {
  test(`G1 G2 ${payload.doc_kind} with ${payload.lines.length} lines preserves metadata through GET/cache/edit`, async () => {
    const h = await createReceivingHarness();
    const created = await h.invoke('createDocument', { user: deltaActor, body: {
      client_uuid: 'ocr-gaps', delivery_date: h.today, kind: 'bill'
    } });
    const id = String(created.body.data.id);
    await h.invoke('uploadImage', { user: deltaActor, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
    let calls = 0;
    ocrService.setCustomOcrProvider(async () => { calls++; return payload; });
    try {
      const result = await h.invoke('runOcr', { user: deltaActor, params: { id } });
      assert.equal(result.statusCode, 200);
      const metadata = result.body.data.ocr;
      assert.equal(metadata.doc_kind, payload.doc_kind);
      assert.equal(metadata.line_sum_proposal, payload.lines.length ? '0.30' : null);
      assert.equal(metadata.unreadable_line_count, payload.lines.length ? 1 : 0);
      assert.equal(result.body.data.total, payload.total == null ? null : '100.00');
      const warning = payload.lines.length ? 'TOTAL_MISSING_LINE_SUM' : 'NOT_A_BILL';
      assert.ok(metadata.warnings.includes(warning));
      assert.ok(result.body.data.warnings.some(w => w.code === warning));
      const get = await h.invoke('getDocumentById', { user: deltaActor, params: { id } });
      assert.deepEqual(get.body.data.ocr, metadata);
      const cached = await h.invoke('runOcr', { user: deltaActor, params: { id } });
      assert.deepEqual(cached.body.data.ocr, metadata);
      assert.equal(calls, 1);
      const edited = await h.invoke('updateDocument', { user: deltaActor, params: { id }, body: { total: '200.00' } });
      assert.equal(edited.statusCode, 200);
      assert.equal(edited.body.data.ocr.doc_kind, payload.doc_kind);
      assert.equal(edited.body.data.ocr.line_sum_proposal, metadata.line_sum_proposal);
      assert.ok(edited.body.data.ocr.warnings.includes(warning));
    } finally { ocrService.setCustomOcrProvider(null); }
  });
}
