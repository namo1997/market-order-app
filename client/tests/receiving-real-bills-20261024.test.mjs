import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';

// Real-bill test 2026-10-24 (pilot + Codex OCR, Bababacon bill on the pork supplier's order): bill lines
// that are not matched to a product yet have no product name; every label must fall back to the bill text.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const text = h => h.text(h.visible());
const blindDoc = () => ({ id: 1, client_uuid: 'rb-1', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'บริษัท สุพรค้าหมูเจริญ จำกัด',
  images: [{ id: 1 }], early_read: 'done', ocr: { status: 'none' }, counted_complete_at: null,
  lines: [
    { id: 1, line_no: 1, product_id: 14, product_name: 'ตับหมู', unit_text: 'กิโลกรัม', order_item_id: 8, quantity_received: '0' },
    { id: 3, line_no: 3, product_id: null, product_name: null, bill_name: 'สามชั้นลอกหนังแผ่น', unit_text: 'กก.', order_item_id: null, quantity_received: '0' },
  ] });

test('the count review sheet names a bill-only line by its bill wording', async () => {
  const h = await harness('DocumentEditor', { initialDocument: blindDoc(), user, onBack() {}, scanFirst: true });
  await h.select('นับได้ ตับหมู', '0'); await h.select('นับได้ สามชั้นลอกหนังแผ่น', '9.4');
  await h.click('ยืนยันการนับและเทียบบิล');
  const sheet = h.text(h.find(n => n.props.className === 'ra-count-review-list'));
  assert.match(sheet, /สามชั้นลอกหนังแผ่น9\.4 กก\./);
  assert.match(sheet, /ตับหมูไม่มา/);
});

const reviewDoc = () => ({ id: 1, client_uuid: 'rb-1', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'บริษัท สุพรค้าหมูเจริญ จำกัด',
  images: [{ id: 1 }], ocr: { status: 'done', confidence: 0.64 }, counted_complete_at: '2026-10-24T09:50:00Z', doc_ref: 'INV2026100089', total: '3244.75', warnings: [],
  lines: [
    { id: 3, line_no: 3, product_id: null, product_name: null, bill_text: 'สามชั้นลอกหนังแผ่น', unit_text: 'กก.', order_item_id: null,
      quantity_billed: '9.4', quantity_received: '9.4', counted_quantity: '9.40', unit_price: '188.00', amount: '1767.20' },
  ] });

test('review labels of an unmatched bill line never print null', async () => {
  const h = await harness('DocumentEditor', { initialDocument: reviewDoc(), user, onBack() {} });
  await h.settle();
  const all = h.text(h.all());
  assert.doesNotMatch(all, /null/);
  assert.ok(h.all().some(n => n.props['aria-label'] === 'แก้ข้อมูล สามชั้นลอกหนังแผ่น'), 'edit button is named after the bill line');
});

// Bill #4106 on a new shop: confirm failed with the server's "กรุณากำหนดกลุ่มสินค้า…" but the receiver saw
// only the generic validation line.
test('a validation failure shows the server\'s own message when it has one', async () => {
  const { errorText } = await import('../src/pages/receiving/receiving-utils.js');
  const specific = { response: { status: 422, data: { code: 'VALIDATION_FAILED', message: 'กรุณากำหนดกลุ่มสินค้าเพื่อบันทึกรายการเดินซื้อ' } } };
  assert.equal(errorText(specific), 'กรุณากำหนดกลุ่มสินค้าเพื่อบันทึกรายการเดินซื้อ');
  const bare = { response: { status: 422, data: { code: 'VALIDATION_FAILED' } } };
  assert.match(errorText(bare), /ข้อมูลยังไม่ถูกต้อง/);
  const other = { response: { status: 403, data: { code: 'FORBIDDEN', message: 'ignored' } } };
  assert.equal(errorText(other), 'คุณไม่มีสิทธิ์ใช้งานเอกสารนี้');
});

// Owner 2026-10-24 "ตรงนี้จัด ux ui ใหม่หน่อย" (makro bill, กุ้งขาว ไซส์ L … 1 ลัง unmatched): one status, the bill
// text is not repeated, the likely products are listed from the bill text, and confirming appears after the choice.
const unmatchedDoc = () => ({ ...reviewDoc(), lines: [{ id: 5, line_no: 1, product_id: null, product_name: null, bill_text: 'กุ้งขาว ไซส์ L 10 กก. (41-45 ตัว/กก.) 1 ลัง',
  unit_text: 'กก.', order_item_id: null, quantity_billed: '10', quantity_received: '10', counted_quantity: '10.00', unit_price: '234.00', amount: '2340.00' }] });

test('unmatched bill line: one status, bill text once, products suggested from the bill text', async () => {
  const searched = [];
  const h = await harness('DocumentEditor', { initialDocument: unmatchedDoc(), user, onBack() {} },
    { getProducts: async ({ search }) => { searched.push(search); return { data: [{ id: 35, name: 'กุ้งขาว ไซส์ L', unit_name: 'กิโลกรัม', unit_id: 1 }] }; } });
  await h.settle(); await h.settle();
  const card = h.text(h.find(n => n.props.id === 'review-row-5'));
  assert.equal(card.split('กุ้งขาว ไซส์ L 10 กก.').length - 1, 1, 'bill text shown once');
  assert.match(card, /ยังไม่จับคู่/); assert.doesNotMatch(card, /สินค้าไม่ตรง|ต้องตรวจ: |ในบิลเขียน|ยืนยันสินค้าที่เลือกและรับ/);
  assert.equal(searched[0], 'กุ้งขาว ไซส์ L 10 กก. (41-45 ตัว/กก.) 1 ลัง');
  assert.match(h.text(h.find(n => n.props.className === 'ra-pick-list')), /กุ้งขาว ไซส์ Lกิโลกรัม/);
  await h.click('กุ้งขาว ไซส์ L');
  const after = h.text(h.find(n => n.props.id === 'review-row-5'));
  assert.match(after, /ยืนยันรับ 10/); assert.match(after, /ในบิลเขียน กุ้งขาว ไซส์ L 10 กก\. \(41-45 ตัว\/กก\.\) 1 ลัง → กุ้งขาว ไซส์ L/);
});

// Owner 2026-10-24 "ข้อ 1 ให้รับไปก่อนแล้วตามหลัง": a product that is not in the catalogue can be received now.
test('unmatched bill line: "ไม่มีในระบบ · รับไปก่อน" decides receive_unmatched without remembering an alias', async () => {
  const h = await harness('DocumentEditor', { initialDocument: unmatchedDoc(), user, onBack() {} }, { getProducts: async () => ({ data: [] }) });
  await h.settle();
  await h.click('ไม่มีในระบบ · รับไปก่อน');
  const body = h.calls.find(call => call[0] === 'update')[2];
  assert.equal(body.lines[0].review_decision, 'receive_unmatched'); assert.equal(body.lines[0].remember_alias, false);
  assert.match(h.text(h.all()), /รับไปก่อน · รอบัญชีผูกสินค้า/);
});

test('"รับไปก่อน" is not offered for a line with nothing received or on a branch receipt', async () => {
  for (const patch of [{ lines: [{ ...unmatchedDoc().lines[0], quantity_received: '0', counted_quantity: '0.00' }] }, { scope: 'branch' }]) {
    const h = await harness('DocumentEditor', { initialDocument: { ...unmatchedDoc(), ...patch }, user, onBack() {} }, { getProducts: async () => ({ data: [] }) });
    await h.settle();
    assert.equal(h.all().some(n => n.type === 'button' && h.text(n) === 'ไม่มีในระบบ · รับไปก่อน'), false);
  }
});

test('summary and decided text say the line waits for accounting', async () => {
  const { receiptDecisionText } = await import('../src/pages/receiving/review-a.js');
  assert.equal(receiptDecisionText({ review_decision: 'receive_unmatched', quantity_received: '10.00', unit_text: 'กก.' }), 'รับ 10 กก. · รอบัญชีผูกสินค้า');
});

test('a line received for now says so once: no "ในบิลเขียน … → ยังไม่จับคู่" and no alias checkbox', async () => {
  const doc = unmatchedDoc(); doc.lines[0].review_decision = 'receive_unmatched';
  const h = await harness('DocumentEditor', { initialDocument: doc, user, onBack() {} }, { getProducts: async () => ({ data: [] }) });
  await h.settle();
  const all = h.text(h.all());
  assert.match(all, /รับไปก่อน · รอบัญชีผูกสินค้า/); assert.doesNotMatch(all, /ในบิลเขียน|จำชื่อย่อร้านนี้/);
});

// Owner 2026-10-24 "ข้อ 2 ทำเตือนบิลผิดร้านด้วย".
const wrongShop = { bill_shop: 'หจก.บาบาเบคอน กรุ๊ป', registered: true };
const blindWrongShop = () => ({ id: 1, client_uuid: 'ws-1', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'บริษัท สุพรค้าหมูเจริญ จำกัด',
  images: [{ id: 3, page_no: 1, sha256: 'a' }], early_read: 'done', ocr: { status: 'locked' }, counted_complete_at: null, blind: true, shop_mismatch: wrongShop,
  lines: [{ id: 1, line_no: 1, product_id: null, product_name: null, bill_name: 'สามชั้นลอกหนังแผ่น', unit_text: 'กก.', order_item_id: null, quantity_received: '0' }] });

test('wrong-shop bill: the count shows one notice naming both shops, with retake and keep', async () => {
  const h = await harness('DocumentEditor', { initialDocument: blindWrongShop(), user, onBack() {}, scanFirst: true });
  await h.settle();
  const notice = h.find(n => n.props.className === 'ra-wrong-shop');
  assert.match(h.text(notice), /บิลนี้เป็นของ บาบาเบคอน กรุ๊ป/); assert.match(h.text(notice), /ไม่ใช่ สุพรค้าหมูเจริญ\?/);
  assert.ok(h.visible().some(n => n.type === 'button' && h.text(n) === 'ถ่ายบิลใหม่'));
  await h.click('บิลถูกแล้ว');
  assert.equal(h.all().some(n => n.props.className === 'ra-wrong-shop'), false, 'keep hides it for this bill');
});

test('wrong-shop notice: no retake on a multi-page bill; nothing when the shop matches or the receipt is confirmed', async () => {
  const twoPages = { ...blindWrongShop(), images: [{ id: 3, page_no: 1 }, { id: 4, page_no: 2 }] };
  let h = await harness('DocumentEditor', { initialDocument: twoPages, user, onBack() {}, scanFirst: true }); await h.settle();
  assert.ok(h.all().some(n => n.props.className === 'ra-wrong-shop'));
  assert.equal(h.all().some(n => n.type === 'button' && h.text(n) === 'ถ่ายบิลใหม่'), false);
  for (const doc of [{ ...blindWrongShop(), shop_mismatch: null }, { ...blindWrongShop(), status: 'confirmed', counted_complete_at: '2026-10-24T10:00:00Z', blind: false }]) {
    h = await harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, scanFirst: true }); await h.settle();
    assert.equal(h.all().some(n => n.props.className === 'ra-wrong-shop'), false);
  }
});

test('retake replaces the saved page instead of adding one', async () => {
  const source = await readFile(new URL('../src/pages/receiving/ImagePages.jsx', import.meta.url), 'utf8');
  assert.match(source, /pageNo: savedPage, replacesSaved: true/);
  assert.match(source, /retakeRef\.current = pageNo => \{ replaceSaved\.current = pageNo; openScanner\(\); \}/);
  const { assignPageNumbers } = await import('../src/pages/receiving/image-utils.js');
  assert.deepEqual(assignPageNumbers([{ page_no: 1 }], [{ key: 'k', pageNo: 1, replacesSaved: true }]).map(p => p.pageNo), [1]);
});

// Bug hunt 2026-10-24: summary and bulk button.
test('summary keeps items that did not come apart from the bill differences', async () => {
  const doc = { ...reviewDoc(), lines: [
    { id: 1, line_no: 1, product_id: 14, product_name: 'ตับหมู', bill_text: '', order_item_id: 8, unit_text: 'กก.', quantity_billed: null, quantity_received: '0', counted_quantity: '0.00', quantity_ordered: '5', review_decision: 'not_delivered' },
    { id: 3, line_no: 3, product_id: 34, product_name: 'สามชั้นลอกหนัง', bill_text: 'สามชั้นลอกหนังแผ่น', order_item_id: null, unit_text: 'กก.', quantity_billed: '9.4', quantity_received: '9.0', counted_quantity: '9.00', unit_price: '188.00', amount: '1767.20', review_decision: 'short' }] };
  const h = await harness('ReviewSummary', { doc });
  const diff = h.all().filter(n => n.props.className === 'ra-diff');
  assert.equal(diff.length, 2);
  assert.match(h.text(diff[0]), /สิ่งที่ต่างจากบิล/); assert.match(h.text(diff[0]), /สามชั้นลอกหนัง/); assert.doesNotMatch(h.text(diff[0]), /ตับหมู/);
  assert.match(h.text(diff[1]), /ไม่มาส่ง · ค้างตามใบสั่ง/); assert.match(h.text(diff[1]), /ตับหมู/);
});

test('one matching row has no green "ยืนยันทั้งหมดที่ตรง"; two do', async () => {
  const row = (id, patch = {}) => ({ id, line_no: id, product_id: id + 10, product_name: `สินค้า ${id}`, bill_text: `บิล ${id}`, order_item_id: null, unit_text: 'กก.',
    quantity_billed: '2', quantity_received: '2', counted_quantity: '2.00', unit_price: '10.00', amount: '20.00', match: { source: 'manual', confidence: 1 }, ...patch });
  const one = await harness('DocumentEditor', { initialDocument: { ...reviewDoc(), lines: [row(1)] }, user, onBack() {} }); await one.settle();
  assert.equal(one.all().some(n => n.type === 'button' && one.text(n) === 'ยืนยันทั้งหมดที่ตรง'), false);
  const two = await harness('DocumentEditor', { initialDocument: { ...reviewDoc(), lines: [row(1), row(2)] }, user, onBack() {} }); await two.settle();
  assert.ok(two.all().some(n => n.type === 'button' && two.text(n) === 'ยืนยันทั้งหมดที่ตรง'));
});

// Bug hunt 2026-10-24 (NewStar bill #4106, counted 20 of 21): the short card said "ขาด (จากบิล)" twice, and once
// decided it said only "ตัดสินใจแล้ว" — not that the shop owes 1 กิโลกรัม.
const shortDoc = () => ({ ...reviewDoc(), supplier_name_text: 'นิวสตาร์ ฟู้ดเซอร์วิส', lines: [{ id: 9, line_no: 1, product_id: 34, product_name: 'เสือร้องไห้',
  bill_text: 'เสือร้องไห้ออสกรีนแฮม', unit_text: 'กิโลกรัม', order_item_id: null, quantity_billed: '21.00', quantity_received: '20.00', counted_quantity: '20.00',
  unit_price: '265.00', amount: '5565.00', match: { source: 'manual' }, bill_read: { quantity_billed: 21 }, bill_entered_manually: false }] });

test('a short card says its state once and, decided, says what the shop owes', async () => {
  const h = await harness('DocumentEditor', { initialDocument: shortDoc(), user, onBack() {} });
  await h.settle();
  const card = h.text(h.find(n => n.props.id === 'review-row-9'));
  assert.equal(card.split('ขาด (จากบิล)').length - 1, 1, 'the state is said once');
  assert.doesNotMatch(card, /ต้องตรวจ: |กรอกหรือแก้โดยคน/);
  await h.click('รับ 20 กิโลกรัม · แจ้งร้านขาด 1 กิโลกรัม');
  const decided = h.text(h.find(n => n.props.id === 'review-row-9'));
  assert.match(decided, /ตัดสินใจแล้ว/);
  assert.match(decided, /รับ 20 กิโลกรัม · แจ้งร้านขาด 1 กิโลกรัม/);
});
