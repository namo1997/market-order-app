import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rowDecision, qtyText, orderDifference } from '../src/pages/receiving/review-a.js';
import { row, doc, signed, text, btn, open, sign, draw, deferred, cleanup, clock } from './review-a-port-harness.mjs';
afterEach(cleanup);

for (const [count, bill, order, kind, label] of [
  ['10', '10', '12', 'accept', 'ตรง'],
  ['4.5', '5', '4.5', 'short', 'ขาด (จากบิล)'],
  ['6.5', '6', '10', 'over', 'เกิน'],
  ['10', null, '10', 'missing_bill', 'ไม่มีในบิล'],
  ['2', null, null, 'missing_bill', 'ไม่มีในบิล'],
  ['0', '', '10', 'not_delivered', 'ไม่ได้มาส่ง'],
  ['0', '0', '10', 'not_delivered', 'ไม่ได้มาส่ง'],
]) test(`A1: counted ${count}, bill ${bill}, order ${order} compares only with bill`, () => {
  const line = row(1, { quantity_received: count, counted_quantity: count, quantity_billed: bill, quantity_ordered: order });
  assert.equal(rowDecision(line, doc()).kind, kind);
  assert.equal(rowDecision(line, doc()).label, label);
});
test('A1: before OCR even matching prefilled numbers wait for bill; manual bill entry is explicit', async () => {
  const h = await open(doc({ ocr: { status: 'none' } }));
  const card = h.find(n => n.props.id === 'review-row-1');
  assert.match(h.text(card), /รออ่านบิล/); assert.doesNotMatch(h.text(card), /ยืนยันรับ 2/);
  assert.equal(h.visible().some(n => n.type === 'button' && h.text(n) === 'ยืนยันทั้งหมดที่ตรง'), false);
  await h.click('แก้'); await h.select('จำนวนบิล ผัก 1', '2');
  assert.equal(btn(h, 'ยืนยันรับ 2').props.disabled, false);
});
test('A1: order shortage is separate when bill differs; price differences never hide bill shortage', async () => {
  const line = row(1, { quantity_ordered: '10', quantity_billed: '5', quantity_received: '4.5', unit_price: '12' });
  assert.equal(rowDecision(line, doc()).kind, 'short');
  assert.equal(orderDifference(line), 'ขาดจากใบสั่ง 5.5 kg');
  const h = await open(doc({ lines: [line] })); assert.match(text(h), /ขาด \(จากบิล\)/); assert.match(text(h), /ขาดจากใบสั่ง 5.5 kg \(ข้อมูลประกอบ\)/);
});
test('A1 A2: persisted manual bill entry can be reviewed after reopening, without inventing a raw bill alias', async () => {
  const h = await open(doc({ ocr: { status: 'none' }, lines: [row(1, { bill_entered_manually: true, bill_text: 'ชื่อจากใบสั่ง' })] }));
  assert.equal(btn(h, 'ยืนยันรับ 2').props.disabled, false);
  assert.doesNotMatch(text(h), /ในบิลเขียน|จำชื่อย่อร้านนี้/);
});
for (const receive of [true, false]) test(`A1: missing bill ${receive ? 'receive and ask accounting' : 'reject'} persists explicit choice and immutable count`, async () => {
  const h = await open(doc({ lines: [row(1, { quantity_billed: null, bill_text: '' })] }), {}, {}, {}, { confirm: () => true });
  assert.equal(h.visible().some(n => n.type === 'button' && h.text(n) === 'ยืนยันทั้งหมดที่ตรง'), false);
  await h.click(receive ? 'รับ 2 กก. · ให้บัญชีขอบิลจากร้าน' : 'ไม่รับ · คืนร้าน 2 กก.');
  if (!receive) await h.click('ยืนยันไม่รับและคืนร้าน');
  const saved = h.calls.find(c => c[0] === 'update')[2].lines[0];
  assert.equal(saved.review_decision, receive ? 'missing_bill' : 'not_received');
  assert.equal(Number(saved.quantity_received), receive ? 2 : 0);
  assert.equal(saved.remember_alias, false);
  const card = h.find(n => n.props.id === 'review-row-1'); assert.match(h.text(card), /นับได้2/);
});
for (const [raw, billed, status, show] of [['', null, 'done', false], ['—', null, 'done', false], ['ผัก 1', null, 'none', false], ['ผัก 1', '2', 'done', false], ['ดิบ 1', '2', 'done', true]])
  test(`A2: raw ${raw || 'empty'} / ${status} shows alias only for a real different bill name`, async () => {
    const h = await open(doc({ ocr: { status }, lines: [row(1, { bill_text: raw, quantity_billed: billed })] }));
    assert.equal(/ในบิลเขียน/.test(text(h)), show);
    assert.equal(h.visible().some(n => n.type === 'input' && n.props.type === 'checkbox'), show);
  });
test('A3: count completion starts one OCR, shows animation, blocks duplicate and retains original counts', async () => {
  const gate = deferred(); let reads = 0;
  // early_read 'done': the names-only early read already ran (072s #15 would otherwise start it on open).
  const initial = doc({ counted_complete_at: null, ocr: { status: 'locked' }, early_read: 'done', images: [{ id: 7, page_no: 1 }], lines: [row(1, { counted_quantity: null, quantity_received: null, quantity_billed: null })] });
  const counted = doc({ ocr: { status: 'none' }, images: initial.images, lines: [row(1, { counted_quantity: '4.5', quantity_received: '4.5', quantity_billed: null })] });
  const h = await open(initial, { count: async () => counted, ocr: () => { reads++; return gate.promise; } });
  assert.equal(reads, 0); await h.click('นับ'); await h.select('นับได้ ผัก 1', '4.5'); await h.click('ยืนยันการนับและเทียบบิล'); await h.click('ถูกต้อง ยืนยันการนับ');
  assert.equal(reads, 1); assert.match(text(h), /AI กำลังอ่านบิล/);
  const again = btn(h, 'อ่านบิลด้วย AI (คงจำนวนนับ)'); assert.equal(again.props.disabled, true); await again.props.onClick(); assert.equal(reads, 1);
  gate.resolve({ ...counted, ocr: { status: 'done' } }); await h.settle();
  assert.match(text(h), /ไม่มีในบิล/); assert.match(text(h), /นับได้4.5/);
  await h.click('ดู / เพิ่มรูปบิล'); await h.click('กลับเทียบบิล'); assert.equal(reads, 1);
});
test('072s #15: opening a blind department bill draft with saved, never-read pages starts exactly one early read', async () => {
  let reads = 0;
  const initial = doc({ counted_complete_at: null, ocr: { status: 'locked' }, images: [{ id: 7, page_no: 1 }], lines: [row(1, { counted_quantity: null, quantity_received: null, quantity_billed: null })] });
  const h = await open(initial, { ocr: async () => { reads++; return { ...initial, early_read: 'done' }; } });
  await h.settle(); await h.settle(); assert.equal(reads, 1);
  assert.match(text(h), /แนบรูปแล้ว · อ่านชื่อสินค้าให้ทันที ตัวเลขบิลเปิดหลังนับครบ/);
  assert.doesNotMatch(text(h), /อ่านหลังนับครบ/);
});
test('A3 integration: branch reads after count; no image, failed OCR and terminal documents never auto-submit', async () => {
  for (const patch of [{ images: [] }, { ocr: { status: 'failed' } }, { scope: 'branch' }, { status: 'confirmed' }]) {
    let reads = 0; const initial = doc({ ocr: { status: 'none' }, images: [{ id: 7, page_no: 1 }], ...patch });
    const h = await open(initial, { ocr: async () => { reads++; return { ...initial, ocr: { status: 'done' } }; } });
    await h.settle(); assert.equal(reads, patch.scope === 'branch' ? 1 : 0); h.unmount();
  }
});
test('A3: ambiguous auto OCR requires GET recovery and never loops another paid write', async () => {
  let reads = 0; const initial = doc({ ocr: { status: 'none' }, images: [{ id: 7, page_no: 1 }] });
  const h = await open(initial, { ocr: async () => { reads++; throw { request: {} }; }, get: async () => initial });
  assert.equal(reads, 1); assert.match(text(h), /ยังไม่ทราบผลอ่านบิล/);
  await h.click('ตรวจผลล่าสุด'); await h.settle(); assert.equal(reads, 1);
});
test('A3: server pending retains reading animation until read-only polling finishes, without resubmission', async () => {
  const timers = clock(); let paid = 0;
  const h = await open(doc({ ocr: { status: 'pending' }, images: [{ id: 7, page_no: 1 }] }), {
    ocr: async () => { paid++; }, get: async () => doc(),
  }, {}, timers.runtime);
  assert.match(text(h), /AI กำลังอ่านบิล/);
  assert.equal(btn(h, 'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled, true);
  await timers.tick(3000); await h.settle();
  assert.ok(!h.visible().some(n => n.props['aria-label'] === 'สถานะอ่านบิล'));
  assert.equal(paid, 0);
});
test('A4 A5: bill tools are closed per step; signing shows compact disclosure before first canvas and save action', async () => {
  const h = await open(signed({ has_receiver_signature: false, warnings: Array.from({ length: 10 }, () => ({ code: 'LOW_CONFIDENCE' })) }));
  assert.ok(!h.find(n => n.props.className === 'ra-bill-tools').props.open);
  await sign(h);
  // Owner 2026-10-24: the receiver sheet opens by itself; the port helper sign() closes it to read the page underneath.
  const nodes = h.visible(); const summary = h.find(n => n.props.className === 'ra-sign-summary');
  assert.ok(h.all(summary).some(n => n.type === 'details' && !n.props.open));
  const opens = nodes.filter(n => n.type === 'button' && h.text(n).startsWith('แตะเพื่อเซ็น'));
  assert.ok(nodes.indexOf(summary) < nodes.indexOf(opens[0]));
  assert.equal(opens.length, 2); assert.equal(nodes.filter(n => n.type === 'canvas').length, 0);
  await draw(h); assert.equal(btn(h, 'เซ็นและยืนยันรับ').props.disabled, false);
});
test('A6 A7: confirm scrolls to full success with receipt number and receipt/next actions; receipt stays readable during queue wait', async () => {
  const scrolls = []; const h = await open(signed(), {}, { nextShopStatus: 'loading' }, {}, { scrollTo: position => scrolls.push(position) });
  await sign(h); const before = scrolls.length; await h.click('ยืนยันรับสินค้า');
  assert.ok(scrolls.length > before); assert.equal(scrolls.at(-1).top, 0);
  assert.equal(h.find(n => n.props['aria-label'] === 'ใบรับสินค้า').props['data-step'], 'success');
  assert.match(text(h), /ใบรับ #5.*รับของเรียบร้อย/); assert.equal(btn(h, 'กลับหน้ารับสินค้า').props.disabled, true);
  assert.ok(h.find(n => n.props['data-illustration'] === 'received-success'));
  await h.click('ดูเอกสาร'); assert.ok(h.visible().some(n => n.props['data-collapsed'] === false));
  assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 1);
});
test('A7: every step change resets page scroll, ordinary field edits do not', async () => {
  const scrolls = []; const h = await open(doc(), {}, {}, {}, { scrollTo: p => scrolls.push(p) });
  const before = scrolls.length; await h.click('แก้'); await h.select('แก้จำนวนหลังเปิดบิล ผัก 1', '1.5'); assert.equal(scrolls.length, before);
  await h.click('ดู / เพิ่มรูปบิล'); assert.equal(scrolls.length, before + 1); await h.click('กลับเทียบบิล'); assert.equal(scrolls.length, before + 2);
});
test('A8 A9: accessible compact count labels; prominent capture precedes illustration and single blind instruction', async () => {
  const h = await open(doc({ counted_complete_at: null, ocr: { status: 'locked' } }));
  const nodes = h.visible(); assert.ok(nodes.indexOf(btn(h, 'ถ่าย / เพิ่มรูปบิล')) < nodes.findIndex(n => n.props['data-illustration'] === 'capture-bill'));
  assert.equal(btn(h, 'ถ่าย / เพิ่มรูปบิล').props.className, 'ra-capture-primary'); assert.doesNotMatch(text(h), /ภาพบิลถูกปิด/);
  await h.click('นับ'); const label = h.find(n => n.type === 'label' && h.text(n) === 'นับได้ ผัก 1');
  assert.ok(h.find(n => n.type === 'input' && n.props.id === label.props.htmlFor));
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /ra-count-row input[^}]*height:48px/); assert.match(css, /ra-count-row \.sg-number-field>label[^}]*clip-path:inset\(50%\)/);
});
test('A10: display quantities consistently without trailing zeroes, retaining unknown and explicit zero', () => {
  for (const [value, expected] of [['0.000001', '0.000001'], ['4.50', '4.5'], ['4.5', '4.5'], ['10.00', '10'], ['0.00', '0'], [null, '—'], ['', '—'], ['invalid', 'ตรวจค่า']]) assert.equal(qtyText(value), expected);
});
test('A11: only main receiving Android activity is locked portrait', async () => {
  const xml = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const activity = xml.match(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>/)?.[0];
  assert.ok(activity); assert.match(activity, /android:screenOrientation="portrait"/);
  assert.match(activity, /android:configChanges="[^"]*uiMode/);
});
