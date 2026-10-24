import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { billShopMismatch } from '../src/services/receiving-ocr-checks.js';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
import { setCustomOcrProvider, resetOcrRateLimit } from '../src/services/receiving-ocr.service.js';
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });

// Owner 2026-10-24 "ข้อ 2 ทำเตือนบิลผิดร้านด้วย": the shop printed on the bill header against the receipt's shop.
const masters = [{ id: 3, name: 'Asiamart | เอเซียเกษตรรุ่งวิไล ขายส่งสินค้าอุปโภค' }, { id: 4, name: 'บริษัท สุพรค้าหมูเจริญ จำกัด' },
  { id: 9, name: 'หจก.บาบาเบคอน กรุ๊ป' }, { id: 12, name: 'makro' }];
const check = patch => billShopMismatch({ masters, ...patch });

test('the receipt\'s own shop under its legal or short name never warns', () => {
  assert.equal(check({ printedName: 'บริษัท เอเซียเกษตรรุ่งวิไล จำกัด', receiptNames: [masters[0].name], receiptMasterId: 3 }), null);
  assert.equal(check({ printedName: 'Asiamart', receiptNames: [masters[0].name], receiptMasterId: 3 }), null);
  assert.equal(check({ printedName: 'บจก.สุพรค้าหมูเจริญ', receiptNames: [masters[1].name], receiptMasterId: 4 }), null);
  assert.equal(check({ printedName: 'ร้าน', receiptNames: [masters[1].name], receiptMasterId: 4 }), null, 'too short to be evidence');
  assert.equal(check({ printedName: '', receiptNames: [masters[1].name], receiptMasterId: 4 }), null);
});

test('another registered shop on a registered shop\'s receipt warns with that shop', () => {
  assert.deepEqual(check({ printedName: 'หจก. บาบาเบคอน กรุ๊ป (สำนักงานใหญ่)', receiptNames: [masters[1].name], receiptMasterId: 4 }),
    { bill_shop: 'หจก.บาบาเบคอน กรุ๊ป', registered: true });
});

test('an unregistered printed name warns once; after a confirmed receipt printed it, the same name is known', () => {
  const first = check({ printedName: 'บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน)', receiptNames: ['makro'], receiptMasterId: 12 });
  assert.deepEqual(first, { bill_shop: 'บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน)', registered: false });
  assert.equal(check({ printedName: 'บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน)', receiptNames: ['makro'], receiptMasterId: 12,
    knownBillNames: ['บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน)'] }), null);
});

test('ordering groups that are not shops and new shops with a nickname stay quiet', () => {
  assert.equal(check({ printedName: 'หจก.บาบาเบคอน กรุ๊ป', receiptNames: ['ซัพอื่นๆ (ครัวสันกำแพง)'], receiptGroupId: 5 }), null);
  assert.equal(check({ printedName: 'นิวสตาร์ ฟู้ดเซอร์วิส', receiptNames: ['ร้านป้าเนื้อ'] }), null, 'unregistered header on a new shop');
  // A group named after a shop behaves like that shop.
  assert.deepEqual(check({ printedName: 'หจก.บาบาเบคอน กรุ๊ป', receiptNames: ['บริษัท สุพรค้าหมูเจริญ จำกัด'], receiptGroupId: 4, groupIsShop: true }),
    { bill_shop: 'หจก.บาบาเบคอน กรุ๊ป', registered: true });
  // A new shop whose bill is a registered shop: probably the wrong shop was typed.
  assert.deepEqual(check({ printedName: 'Asiamart', receiptNames: ['ร้านป้าเนื้อ'] }), { bill_shop: masters[0].name, registered: true });
});

const read = supplierName => async () => ({ doc_kind: 'bill', supplier_name: supplierName, total: '0.50', confidence: .95, lines: [
  { bill_text: 'หลอดใหญ่', quantity_billed: '10', unit_text: 'กก.', unit_price: '0.05', amount: '0.50', confidence: .95 }] });
async function scanned() {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20', serializeTransactions: true });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'shop-1', kind: 'bill', delivery_date: h.today, supplier_master_id: 8, order_item_ids: [] } });
  const params = { id: created.body.data.id };
  assert.equal((await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  return { h, params };
}

test('early read (before the count) keeps the wrong-shop warning visible but nothing else from the bill', async () => {
  const { h, params } = await scanned();
  setCustomOcrProvider(read('หจก.บาบาเบคอน กรุ๊ป'));
  const early = await h.invoke('runOcr', { user, params });
  assert.equal(early.statusCode, 200, JSON.stringify(early.body));
  assert.deepEqual(early.body.data.shop_mismatch, { bill_shop: 'หจก.บาบาเบคอน กรุ๊ป', registered: true });
  assert.equal(early.body.data.total, null); assert.equal(early.body.data.ocr.status, 'locked'); assert.equal(Object.keys(early.body.data.ocr).length, 1);
  const stored = JSON.parse(h.state.documents.find(d => d.id === params.id).ocr_result_json);
  assert.equal(stored.bill_shop_name, 'หจก.บาบาเบคอน กรุ๊ป'); assert.ok(stored.warnings.includes('SUPPLIER_MISMATCH'));
});

test('the receipt\'s own shop on the bill gives no warning', async () => {
  const { h, params } = await scanned();
  setCustomOcrProvider(read('บริษัท ซัพพลายเออร์หลัก จำกัด'));
  const early = await h.invoke('runOcr', { user, params });
  assert.equal(early.statusCode, 200);
  assert.equal(early.body.data.shop_mismatch, null);
});

test('retaking the bill (page 1 replaced) re-reads it: the warning follows the new bill, rows only the old read made are removed', async () => {
  const { h, params } = await scanned();
  setCustomOcrProvider(async () => ({ doc_kind: 'bill', supplier_name: 'หจก.บาบาเบคอน กรุ๊ป', total: '1.00', confidence: .95, lines: [
    { bill_text: 'สามชั้นลอกหนังแผ่น', quantity_billed: '9.4', unit_text: 'กก.', unit_price: '0.05', amount: '0.47', confidence: .9 },
    { bill_text: 'สันคอ (MBB-013)', quantity_billed: '10.19', unit_text: 'กก.', unit_price: '0.05', amount: '0.51', confidence: .9 }] }));
  assert.equal((await h.invoke('runOcr', { user, params })).statusCode, 200);
  const before = h.state.lines.filter(l => l.document_id === params.id).length;
  assert.equal(before, 2);
  // Retake: the same page number again, another image (another hash), then the read runs again.
  assert.equal((await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl(800, 600) } })).statusCode, 201);
  setCustomOcrProvider(read('บริษัท ซัพพลายเออร์หลัก จำกัด'));
  const again = await h.invoke('runOcr', { user, params });
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.shop_mismatch, null, 'the right bill clears the warning');
  const rows = h.state.lines.filter(l => l.document_id === params.id);
  assert.deepEqual(rows.map(l => l.bill_text), ['หลอดใหญ่'], 'no nameless rows from the wrong bill');
});
