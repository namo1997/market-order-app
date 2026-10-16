import test from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, makeJpegDataUrl, createReceivingHarness, createLinkedDraft } from './helpers/receiving-fake-db.mjs';

test("Malformed JSON is mapped to 422 VALIDATION_FAILED", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  // R2-11: JSON เสียจาก body-parser ต้องได้ 422 VALIDATION_FAILED ไม่ใช่ 500
  const badJsonErr = new SyntaxError('Unexpected token } in JSON at position 10');
  badJsonErr.status = 400;
  badJsonErr.type = 'entity.parse.failed';
  badJsonErr.body = '{bad';
  const badJsonRes = h.invokeErrorMiddleware(badJsonErr, { params: { id: '5' } });
  assert.equal(badJsonRes.statusCode, 422);
  assert.equal(badJsonRes.body.code, 'VALIDATION_FAILED');
});

test("GET document returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const get404 = await h.invoke('getDocumentById', { user, params: { id: '9999' } });
  assert.equal(get404.statusCode, 404);
  assert.equal(get404.body.code, 'NOT_FOUND');
});

test("PUT document returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const put404 = await h.invoke('updateDocument', {
    user,
    params: { id: '9999' },
    body: { doc_ref: 'X' }
  });
  assert.equal(put404.statusCode, 404);
  assert.equal(put404.body.code, 'NOT_FOUND');
});

test("POST image returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const imgUpload404 = await h.invoke('uploadImage', {
    user,
    params: { id: '9999' },
    body: { page_no: 1, image_data_url: makeJpegDataUrl() }
  });
  assert.equal(imgUpload404.statusCode, 404);
  assert.equal(imgUpload404.body.code, 'NOT_FOUND');
});

test("GET image binary returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const imgGet404 = await h.invoke('getImageBinary', {
    user,
    params: { id: '9999', imageId: '1' }
  });
  assert.equal(imgGet404.statusCode, 404);
  assert.equal(imgGet404.body.code, 'NOT_FOUND');
});

test("POST OCR returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const ocr404 = await h.invoke('runOcr', { user, params: { id: '9999' } });
  assert.equal(ocr404.statusCode, 404);
  assert.equal(ocr404.body.code, 'NOT_FOUND');
});

test("POST signature returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const sig404 = await h.invoke('addSignature', {
    user,
    params: { id: '9999' },
    body: { role: 'receiver', image_data_url: makePngDataUrl() }
  });
  assert.equal(sig404.statusCode, 404);
  assert.equal(sig404.body.code, 'NOT_FOUND');
});

test("POST confirm returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const confirm404 = await h.invoke('confirmDocument', { user, params: { id: '9999' } });
  assert.equal(confirm404.statusCode, 404);
  assert.equal(confirm404.body.code, 'NOT_FOUND');
});

test("POST void returns 404 NOT_FOUND for a missing document", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const void404 = await h.invoke('voidDocument', {
    user,
    params: { id: '9999' },
    body: { reason: 'ไม่มีเอกสาร' }
  });
  assert.equal(void404.statusCode, 404);
  assert.equal(void404.body.code, 'NOT_FOUND');
});

test('Edit validates money, text, decimals, multiplier, confidence and cancelled orders', async (t) => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };

  const docId = String((await createLinkedDraft(h, userBranch1, 'split-linked-draft')).body.data.id);
  // ข้อ 7, R2-4, R2-8, R2-12: ทดสอบการดักค่าผิดกติกาใน PUT /:id
  for (const invalidBody of [
    { subtotal: '-10' }, // เงินติดลบ (ข้อ 7)
    { total: '999999999999.99' }, // เงินเกินเพดาน (ข้อ 7)
    { doc_ref: 'X'.repeat(101) }, // เลขที่บิลยาวเกิน 100 ตัวอักษร (ข้อ 7)
    { lines: [{ line_no: 1, bill_text: 'หมู', quantity_received: '9.125' }] }, // ทศนิยมเกิน 2 ตำแหน่ง (R2-4)
    { lines: [{ line_no: 1, bill_text: 'หมู', quantity_received: '1', unit_multiplier: 0 }] }, // multiplier <= 0 (R2-8)
    { lines: [{ line_no: 1, bill_text: 'หมู', quantity_received: '1', unit_multiplier: 99999 }] }, // multiplier เกินเพดาน (R2-8)
    { lines: [{ line_no: 1, bill_text: 'หมู', quantity_received: '1', match: { source: 'manual', confidence: 1.5 } }] }, // confidence > 1 (R2-8)
    { lines: [{ line_no: 1, bill_text: 'หมู', product_id: 7, order_item_id: 53, quantity_received: '1' }] } // ผูกใบสั่งที่ถูกยกเลิก (R2-12)
  ]) {
    await t.test(`Invalid PUT returns 422: ${JSON.stringify(invalidBody)}`, async () => {
      const res = await h.invoke('updateDocument', {
        user: userBranch1,
        params: { id: docId },
        body: invalidBody
    });
    assert.equal(res.statusCode, 422, `Expected 422 for invalid PUT body: ${JSON.stringify(invalidBody)}`);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    });
  }
});

test("Edit rejects 200 new lines when one line already exists", async () => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };

  const docId = String((await createLinkedDraft(h, userBranch1, 'split-linked-draft')).body.data.id);
  // R2-12: ทดสอบเพดานจำนวนบรรทัดรวมต่อเอกสาร (มีอยู่แล้ว 1 บรรทัด ถ้าส่งบรรทัดใหม่เพิ่มอีก 200 บรรทัด รวมเป็น 201 > 200 ต้องได้ 422)
  const twoHundredNewLines = Array.from({ length: 200 }, (_, idx) => ({
    line_no: idx + 1,
    bill_text: `รายการที่ ${idx + 1}`,
    product_id: 7,
    quantity_received: '1',
    unit_price: '10.00'
  }));
  const tooManyTotalLines = await h.invoke('updateDocument', {
    user: userBranch1,
    params: { id: docId },
    body: { lines: twoHundredNewLines }
  });
  assert.equal(tooManyTotalLines.statusCode, 422);
  assert.equal(tooManyTotalLines.body.code, 'VALIDATION_FAILED');
});
