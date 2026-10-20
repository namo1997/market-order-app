import test from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, makeJpegDataUrl, createReceivingHarness, createLinkedDraft } from './helpers/receiving-fake-db.mjs';

test("Confirmed documents reject all draft-only mutations", async (t) => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  // 2) สร้างเอกสาร ยืนยันเป็น confirmed แล้วทดสอบ 409 NOT_DRAFT บน PUT / images / signatures / ocr / confirm
  const created = await h.invoke('createDocument', {
    user,
    body: {
      client_uuid: '409-test-doc',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50]
    }
  });
  const docId = String(created.body.data.id);

  await t.test('GET image returns 404 when the document exists but image does not', async () => {
    // เอกสารมีอยู่จริงแต่ imageId ไม่มีอยู่ -> 404 NOT_FOUND
    const missingImgOnExistingDoc = await h.invoke('getImageBinary', {
      user,
      params: { id: docId, imageId: '9999' }
    });
    assert.equal(missingImgOnExistingDoc.statusCode, 404);
    assert.equal(missingImgOnExistingDoc.body.code, 'NOT_FOUND');
  });

  await h.invoke('addSignature', {
    user,
    params: { id: docId },
    body: { role: 'receiver', image_data_url: makePngDataUrl() }
  });
  const confirmed = await h.invoke('confirmDocument', { user, params: { id: docId } });
  assert.equal(confirmed.statusCode, 200);
  await t.test("PUT cannot edit a confirmed document", async () => {
    const put409 = await h.invoke('updateDocument', {
      user,
      params: { id: docId },
      body: { doc_ref: 'EDIT-AFTER-CONFIRM' }
    });
    assert.equal(put409.statusCode, 409);
    assert.equal(put409.body.code, 'NOT_DRAFT');
  });
  await t.test("Images cannot be uploaded to a confirmed document", async () => {
    const upload409 = await h.invoke('uploadImage', {
      user,
      params: { id: docId },
      body: { page_no: 1, image_data_url: makeJpegDataUrl() }
    });
    assert.equal(upload409.statusCode, 409);
    assert.equal(upload409.body.code, 'NOT_DRAFT');
  });
  await t.test("Signatures cannot be added to a confirmed document", async () => {
    const sign409 = await h.invoke('addSignature', {
      user,
      params: { id: docId },
      body: { role: 'courier', image_data_url: makePngDataUrl() }
    });
    assert.equal(sign409.statusCode, 409);
    assert.equal(sign409.body.code, 'NOT_DRAFT');
  });
  await t.test("OCR cannot run on a confirmed document", async () => {
    const ocr409 = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(ocr409.statusCode, 409);
    assert.equal(ocr409.body.code, 'NOT_DRAFT');
  });
  await t.test("Confirm cannot apply inventory twice", async () => {
    const confirm409 = await h.invoke('confirmDocument', { user, params: { id: docId } });
    assert.equal(confirm409.statusCode, 409);
    assert.equal(confirm409.body.code, 'NOT_DRAFT');
  });
});

test("Duplicate bill warnings respect branch scope", async (t) => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };
  const userBranch2 = { id: 22, name: 'UserBranch2', role: 'user', branch_id: 2, department_id: 20 };

  const docId = String((await createLinkedDraft(h, userBranch1, 'split-linked-draft')).body.data.id);
  await t.test("Matching reference and total across branches do not warn", async () => {
    // ข้อ 13: สร้างบิลในสาขา 2 ที่มี product_group_id=3, doc_ref='DUP-100', total=1500
    const branch2Doc = await h.invoke('createDocument', {
      user: userBranch2,
      body: {
        client_uuid: 'branch2-dup-check',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3
      }
    });
    await h.invoke('updateDocument', {
      user: userBranch2,
      params: { id: String(branch2Doc.body.data.id) },
      body: {
        doc_ref: 'DUP-100',
        total: '1500.00'
      }
    });

    // เมื่อบิลในสาขา 1 ใช้ doc_ref='DUP-100', total=1500 ต้องไม่เตือน DUPLICATE_BILL ข้ามสาขา!
    const branch1NoDup = await h.invoke('updateDocument', {
      user: userBranch1,
      params: { id: docId },
      body: {
        doc_ref: 'DUP-100',
        total: '1500.00'
      }
    });
    assert.equal(branch1NoDup.statusCode, 200);
    assert.equal(
      branch1NoDup.body.data.warnings.some((w) => w.code === 'DUPLICATE_BILL'),
      false,
      'Must not trigger DUPLICATE_BILL across different branches'
    );
  });
  await t.test("Matching supplier, reference and total within a branch warn", async () => {
    // แต่ถ้ามีบิลอีกใบในสาขา 1 เองที่ใช้ doc_ref='DUP-100', total=1500 และซัพพลายเออร์เดียวกัน ต้องเตือน DUPLICATE_BILL!
    const branch1SecondDoc = await h.invoke('createDocument', {
      user: userBranch1,
      body: {
        client_uuid: 'branch1-dup-check-2',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3
      }
    });
    const branch1DupRes = await h.invoke('updateDocument', {
      user: userBranch1,
      params: { id: String(branch1SecondDoc.body.data.id) },
      body: {
        doc_ref: 'DUP-100',
        total: '1500.00'
      }
    });
    assert.equal(branch1DupRes.statusCode, 200);
    assert.equal(
      branch1DupRes.body.data.warnings.some((w) => w.code === 'DUPLICATE_BILL'),
      true,
      'Same branch + supplier + doc_ref + total must trigger DUPLICATE_BILL'
    );
  });
});
