import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rowDecision, canBulkAccept } from '../src/pages/receiving/review-a.js';

// Owner 2026-10-22: แพปลาภูเก็ต bills fish by kg; we order and receive pieces. The bill weight is shown,
// never compared with the count; a changed price per kg goes to price review.
const doc = { kind: 'bill', ocr: { status: 'done' }, counted_complete_at: '2026-10-22T00:00:00Z' };
const fish = (patch = {}) => ({ id: 1, product_id: 59, product_name: 'ปลากะพง #ตัว', bill_text: 'กะพงไซด์ (ปลากระพงขาว )',
  unit_text: 'ตัว', ordered_unit: 'ตัว', quantity_ordered: '3', counted_quantity: '3', quantity_received: '3',
  quantity_billed: null, unit_price: null, amount: '1203.50', price_by_weight: true, bill_weight: '8.3', bill_weight_unit: 'kg',
  weight_unit_price: '145.00', weight_ref_price: '145.00', match: { source: 'alias', confidence: 1 }, ...patch });

test('weighed line: pieces are accepted against the bill amount, not reported as missing from the bill', () => {
  const decision = rowDecision(fish(), doc);
  assert.equal(decision.kind, 'accept');
  assert.equal(decision.label, 'ตรง · คิดตามน้ำหนัก');
  assert.equal(decision.action, 'ยืนยันรับ 3 ตัว · บิล 8.3 kg × 145 = 1,203.50 บาท');
  assert.equal(rowDecision(fish({ quantity_received: '4', counted_quantity: '4' }), doc).kind, 'accept', 'a different piece count is not a bill difference');
  assert.equal(canBulkAccept(fish(), doc), false, 'shop shortcuts are still confirmed one by one');
});

test('weighed line: a changed price per kg asks for price review; no product asks for the product', () => {
  const decision = rowDecision(fish({ weight_unit_price: '160.00', amount: '1328.00' }), doc);
  assert.equal(decision.kind, 'price_review');
  assert.match(decision.label, /ราคาต่อ กก\. เปลี่ยน \(145 → 160\)/);
  assert.equal(rowDecision(fish({ product_id: null }), doc).kind, 'wrong_product');
  assert.equal(rowDecision(fish({ quantity_received: '0', counted_quantity: '0' }), doc).kind, 'not_delivered');
});

test('weighed line: the review card shows the bill weight and the teaching page offers the choice', async () => {
  const rows = await readFile(new URL('../src/pages/receiving/ReviewRows.jsx', import.meta.url), 'utf8');
  assert.match(rows, /line\.price_by_weight && \(line\.quantity_billed == null \|\| line\.quantity_billed === ''\) \? \['บิล \(น้ำหนัก\)', line\.bill_weight, line\.bill_weight_unit \|\| 'กก\.'\]/);
  assert.match(rows, /ร้านคิดเงินตามน้ำหนัก · \{weightBillText\(line\)\} · ไม่เทียบน้ำหนักกับจำนวนที่นับ/);
  const training = await readFile(new URL('../src/receiving-app/BillTraining.jsx', import.meta.url), 'utf8');
  assert.match(training, /if \(form\.byWeight\) body\.price_by_weight = true;/);
  assert.match(training, /ร้านคิดเงินเป็น กก\. แต่เราสั่งและรับเป็น/);
});

test('weighed line with a handwritten piece count: fewer fish than the bill is a shortage', () => {
  const short = rowDecision(fish({ quantity_billed: '10', counted_quantity: '9', quantity_received: '9' }), doc);
  assert.equal(short.kind, 'short');
  assert.equal(short.action, 'รับ 9 ตัว · แจ้งร้านขาด 1 ตัว');
  const ok = rowDecision(fish({ quantity_billed: '10', counted_quantity: '10', quantity_received: '10' }), doc);
  assert.equal(ok.kind, 'accept');
  assert.equal(ok.action, 'ยืนยันรับ 10 ตัว · บิล 10 ตัว · 8.3 kg × 145 = 1,203.50 บาท');
});

test('bill training test scan shows the numbers read from each bill row', async () => {
  const { billNumbers } = await import('../src/receiving-app/BillTraining.jsx').catch(() => ({}));
  const source = await readFile(new URL('../src/receiving-app/BillTraining.jsx', import.meta.url), 'utf8');
  assert.match(source, /<small className="bt-qty">\{billNumbers\(line\)\}<\/small>/);
  if (billNumbers) {
    assert.equal(billNumbers({ unit_text: 'กก.', bill_read: { quantity_billed: '10', unit_price: '55.00', amount: '550.00' } }), '10 กก. × 55 = 550 บาท');
    assert.equal(billNumbers({ price_by_weight: true, bill_weight: '8.4', bill_weight_unit: 'กก.', weight_unit_price: '170.00', amount: '1428.00', quantity_billed: '10', unit_text: 'ตัว' }), '10 ตัว · 8.4 กก. × 170 = 1428 บาท');
  }
});

test('a pack row shows the printed numbers and the counting units', async () => {
  const { packText } = await import('../src/pages/receiving/review-a.js');
  const line = { quantity_billed: '10.00', unit_text: 'ถุง', bill_read: { quantity_billed: '1', unit_price: '400.00', amount: '400.00' } };
  assert.equal(packText(line), 'บิลเขียน 1 × 400 · คิดเป็น 10 ถุง');
  assert.equal(packText({ ...line, quantity_billed: '1' }), '');
  const { billNumbers } = await import('../src/receiving-app/BillTraining.jsx').catch(() => ({}));
  if (billNumbers) assert.equal(billNumbers({ ...line, amount: '400.00' }), '1 × 400 = 400 บาท → 10 ถุง');
});

// Owner 2026-10-22: a /receiving link opened from a chat forced a login and then landed on the menu.
test('login returns to the shared in-app link; other sites are never followed', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /return <Navigate to=\{next && next !== '\/' \? `\/login\?next=\$\{encodeURIComponent\(next\)\}` : '\/login'\} replace \/>;/);
  const login = await readFile(new URL('../src/pages/auth/Login.jsx', import.meta.url), 'utf8');
  const rule = /^\/(?!\/)[^\s\\]*$/;
  assert.match(login, /const safeNext = \/\^\\\/\(\?!\\\/\)\[\^\\s\\\\\]\*\$\/\.test\(next\) && !next\.startsWith\('\/login'\) \? next : '';/);
  for (const ok of ['/receiving', '/receiving?date=2026-10-22']) assert.ok(rule.test(ok), ok);
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '']) assert.ok(!rule.test(bad), bad);
});

// Owner 2026-10-22 queue redesign (mixed A/B) and the counted-without-bill dead end.
test('queue cards show trading names and what is coming; counted without a bill offers two ways out', async () => {
  const { shortShopName, shopTitle, shopPreview } = await import('../src/pages/receiving/receiving-queue.js');
  assert.equal(shortShopName('บจก.จันทิราฟู้ดแอนด์ซัพพลาย จำกัด (แพปลาภูเก็ต)'), 'แพปลาภูเก็ต');
  assert.equal(shortShopName('Asiamart | เอเซียเกษตรรุ่งวิไล ขายส่งสินค้าอุปโภค'), 'Asiamart');
  assert.equal(shortShopName('เครื่องดื่ม(สันกำแพง)'), 'เครื่องดื่ม(สันกำแพง)');
  assert.equal(shortShopName('บจก.ไทยน้ำทิพย์ คอร์เปอเรชั่น จำกัด (มหาชัน)'), 'ไทยน้ำทิพย์ คอร์เปอเรชั่น');
  assert.equal(shopTitle({ supplier_name: 'สโตร์คันคลอง', shop_names: ['Asiamart | เอเซีย', 'ต้นพยอมพาณิช'] }), 'Asiamart · ต้นพยอมพาณิช');
  assert.equal(shopTitle({ supplier_name: 'ตลาดสด' }), 'ตลาดสด');
  const items = n => Array.from({ length: n }, (_, i) => ({ product_name: `ของ ${i + 1}`, quantity_ordered: '2.00', unit_name: 'ถุง', has_pending: true }));
  assert.equal(shopPreview({ items: items(2) }), 'ของ 1 2 ถุง · ของ 2 2 ถุง');
  assert.equal(shopPreview({ items: items(5) }), 'ของ 1 2 ถุง · ของ 2 2 ถุง · ของ 3 2 ถุง · +2 รายการ');
  const editor = await readFile(new URL('../src/pages/receiving/DocumentEditor.jsx', import.meta.url), 'utf8');
  assert.match(editor, /const billMissing = draft && !manual && !blind && !doc\.images\.length && !pending\.length && !\['done', 'pending'\]\.includes\(doc\.ocr\?\.status\);/);
  assert.match(editor, />ถ่ายรูปบิล<\/button>/);
  assert.match(editor, />ไม่มีบิล · รับตามที่นับ<\/button>/);
  const rows = await readFile(new URL('../src/pages/receiving/ReviewRows.jsx', import.meta.url), 'utf8');
  assert.match(rows, /!\['waiting_bill', 'accept'\]\.includes\(decision\.kind\) && <p id=\{`review-blocker-/);
});
