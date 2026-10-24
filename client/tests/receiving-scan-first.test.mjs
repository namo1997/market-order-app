import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { cleanup, track, fakeFile, deferred } from './review-a-port-harness.mjs';
import { bangkokDate } from '../src/pages/receiving/receiving-utils.js';
afterEach(cleanup);

// Scan-first flow (owner request 2026-10-20): choose the shop, press "สแกนบิล <ร้าน>", the receipt is
// created with defaults and the scanner opens at once; the bill photos stay hidden until the count is complete.
const today = bangkokDate();
const group = { supplier_key: 'pg:3', supplier_name: 'ร้านผัก', items: [
  { order_item_id: 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' },
  { order_item_id: 43, product_id: 8, product_name: 'หอม', quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }] };
const other = { supplier_key: 'pg:4', supplier_name: 'ร้านหมู', items: [{ order_item_id: 50, product_id: 9, product_name: 'หมู', quantity_ordered: '3', received_quantity: '0', unit_name: 'กก.' }] };
const blindDoc = (body, patch = {}) => ({ id: 31, client_uuid: body.client_uuid, status: 'draft', kind: body.kind, scope: 'department', branch_id: 1, department_id: 1,
  product_group_id: body.product_group_id ?? null, supplier_master_id: body.supplier_master_id ?? null, supplier_name_text: body.supplier_name_text, delivery_date: today,
  counted_complete_at: null, blind: true, images: [], warnings: [], ocr: { status: 'locked' }, has_receiver_signature: false,
  lines: (body.order_item_ids?.length ? body.order_item_ids : []).map((id, index) => ({ id: index + 1, line_no: index + 1, product_id: id, product_name: ['ผัก', 'หอม'][index] || 'หมู', unit_text: 'กก.', order_item_id: id })), ...patch });
const dataStep = h => h.find(n => n.props['data-step']).props['data-step'];
const text = h => h.text(h.visible());
const visibleButtons = h => h.visible().filter(n => n.type === 'button').map(n => h.text(n) || n.props['aria-label']);

// Fake server: remembers the single draft, applies uploads/kind switches like the real API.
function fake({ groups = [group, other], existing = null, createError = null, suppliers = [] } = {}) {
  const state = { current: existing, creates: [], updates: [], uploads: [], gets: [], ocr: [], counts: [] };
  const api = {
    expected: async () => groups,
    list: async () => state.current ? [state.current] : [],
    suppliers: async () => suppliers,
    create: async body => {
      state.creates.push(JSON.parse(JSON.stringify(body)));
      const failure = createError?.(); if (failure) throw failure;
      // resume_draft: the server returns the existing draft instead of a duplicate
      if (body.resume_draft && state.current?.status === 'draft') return state.current;
      return state.current = blindDoc(body);
    },
    get: async id => { state.gets.push(id); return state.current; },
    update: async (id, body) => { state.updates.push({ id, body }); state.current = { ...state.current, ...body }; return state.current; },
    uploadImage: async (id, pageNo) => { state.uploads.push([id, pageNo]); state.current = { ...state.current, images: [...state.current.images, { id: 100 + pageNo, page_no: pageNo }] }; return { image_id: 100 + pageNo }; },
    count: async (id, body) => { if (body.check_only) return { count_warnings: [] }; state.counts.push(body); return state.current; },
    ocr: async id => { state.ocr.push(id); return state.current; },
  };
  return { api, state };
}
const open = async (server, capture = null, props = {}) => track(await harness('Receiving', props, server.api, {}, {}, {}, capture));
const scanner = (results) => { const queue = [...results]; const calls = { n: 0 }; return { calls, capture: async () => { calls.n++; const next = queue.length > 1 ? queue.shift() : queue[0]; if (next instanceof Error) throw next; return next ? next() : null; } }; };

test('scan-first: footer CTA creates the bill draft with queue defaults and opens the scanner at once; pages go to the blind count', async () => {
  const s = fake(); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  // Owner 2026-10-22 redesign: the shop card's own scan button starts that shop.
  const cta = h.find(n => n.type === 'button' && n.props.className === 'rc-queue-scan' && n.props['aria-label'] === 'สแกนบิล ร้านผัก');
  assert.ok(cta);
  assert.equal(s.state.creates.length, 0, 'nothing is written before the tap');
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 1);
  const body = s.state.creates[0];
  assert.equal(body.kind, 'bill'); assert.equal(body.resume_draft, true); assert.equal(body.scope, 'department'); assert.equal(body.delivery_date, today);
  assert.equal(body.supplier_name_text, 'ร้านผัก'); assert.equal(body.product_group_id, 3);
  assert.deepEqual([...body.order_item_ids], [42, 43], 'every pending item of the shop is selected');
  assert.equal(h.visible().some(n => n.type === 'form' && n.props.id === 'rc-create'), false, 'the setup sheet is skipped');
  assert.equal(sc.calls.n, 1, 'the document scanner opened without another tap');
  assert.equal(s.state.uploads.length, 1, 'the scanned page is saved'); assert.equal(dataStep(h), 'count', 'lands on the count');
  assert.match(text(h), /อ่านบิลแล้ว · ใส่ชื่อสินค้าให้ ช่องจำนวนว่างไว้ให้นับเอง/);
  assert.doesNotMatch(text(h), /นับของจริงก่อนเสมอ/, 'owner 2026-10-24: the step bar says นับ; no extra heading');
  assert.equal(h.visible().some(n => n.type === 'img'), false, 'bill photos stay hidden during the count');
  assert.equal(s.state.ocr.length, 1, 'owner 2026-10-21: the scanned bill is read once at once (names only while blind)');
});

test('scan-first: Android Back from the count returns to the bill step, which keeps its page and does not open the scanner again', async () => {
  const s = fake(); const sc = scanner([fakeFile]); let registration = null;
  const h = await open(s, sc.capture, { onBackActionChange: next => { registration = next; } });
  await h.click('สแกนบิล ร้านผัก'); await h.settle(); assert.equal(dataStep(h), 'count');
  registration.back(); await h.settle();
  assert.equal(dataStep(h), 'images'); assert.equal(sc.calls.n, 1, 'no automatic second scan');
  assert.equal(s.state.creates.length, 1); assert.equal(s.state.uploads.length, 1);
  assert.ok(visibleButtons(h).includes('ถ่าย / เพิ่มรูปบิล'), 'more pages can still be added from the bill step');
  assert.equal(visibleButtons(h).includes('สแกนบิลอีกครั้ง'), false);
});

test('scan-first: cancelling the scanner keeps the draft on the bill step with scan-again, no-bill and back choices', async () => {
  const s = fake(); const sc = scanner([() => null, fakeFile]);
  const h = await open(s, async () => { const next = await sc.capture(); return next; });
  // first call cancels (returns null), second succeeds
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(sc.calls.n, 1); assert.equal(dataStep(h), 'images'); assert.equal(s.state.uploads.length, 0);
  assert.deepEqual(visibleButtons(h).filter(label => /สแกนบิลอีกครั้ง|รับแบบไม่มีบิล|กลับคิว|ไปนับของจริง/.test(label)), ['กลับคิว', 'สแกนบิลอีกครั้ง', 'รับแบบไม่มีบิล', 'ไปนับของจริง']);
  const again = h.find(n => n.type === 'button' && h.text(n) === 'สแกนบิลอีกครั้ง');
  assert.match(again.props.className, /ra-capture-primary/); assert.equal(again.props.disabled, false);
  assert.equal(s.state.creates.length, 1, 'cancel must not lose or duplicate the draft');
  await h.click('สแกนบิลอีกครั้ง'); await h.settle();
  assert.equal(sc.calls.n, 2); assert.equal(s.state.uploads.length, 1); assert.equal(dataStep(h), 'count');
  assert.equal(s.state.creates.length, 1);
});

test('scan-first: from the cancelled scan, no-bill switches the same draft with a kind-only update and goes to the count', async () => {
  const s = fake(); const sc = scanner([() => null]);
  const h = await open(s, sc.capture);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  await h.click('รับแบบไม่มีบิล'); await h.settle();
  assert.equal(JSON.stringify(s.state.updates), JSON.stringify([{ id: 31, body: { kind: 'manual_receipt' } }]));
  assert.equal(s.state.creates.length, 1); assert.equal(s.state.current.kind, 'manual_receipt');
  assert.equal(dataStep(h), 'count'); assert.match(text(h), /ใบรับไม่มีบิล/);
  assert.equal(s.state.uploads.length, 0);
});

test('scan-first: Back after a cancelled scan returns to the queue; the draft survives and the next tap reuses it and scans again', async () => {
  const s = fake(); const sc = scanner([() => null, fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  await h.click('กลับคิว'); await h.settle();
  assert.match(text(h), /รอรับ 2 ร้าน/); assert.equal(s.state.creates.length, 1);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 1, 'no duplicate draft'); assert.equal(s.state.gets[0], 31, 'the existing draft is opened'); assert.equal(s.state.uploads.length, 1);
  assert.equal(sc.calls.n, 2, 'a draft without pages scans again'); assert.equal(dataStep(h), 'count');
});

test('scan-first: a reused draft that already holds pages goes straight to the count without opening the scanner', async () => {
  const draft = blindDoc({ client_uuid: 'u', kind: 'bill', product_group_id: 3, supplier_name_text: 'ร้านผัก', order_item_ids: [42, 43] }, { images: [{ id: 1, page_no: 1 }, { id: 2, page_no: 2 }] });
  const s = fake({ existing: draft }); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 0); assert.equal(s.state.gets[0], 31);
  assert.equal(sc.calls.n, 0); assert.equal(dataStep(h), 'count');
  assert.doesNotMatch(text(h), /จะอ่านหลังนับครบ/); // 072s #15: the never-read pages start the early read
});

test('scan-first: web file input path — pages picked in the bill step are saved and lead to the count; no scanner adapter needed', async () => {
  const s = fake();
  const h = await open(s, null);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(dataStep(h), 'images', 'the browser cannot report a cancelled picker, so the choices are visible');
  assert.ok(visibleButtons(h).includes('สแกนบิลอีกครั้ง'));
  h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [fakeFile()], value: '' } }); await h.settle();
  assert.equal(s.state.uploads.length, 1); assert.equal(dataStep(h), 'count'); assert.match(text(h), /อ่านบิลแล้ว/);
});

test('no-bill entry: the queue action creates a manual receipt for the same defaults and goes to counting without any scanner', async () => {
  const s = fake(); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  const action = h.find(n => n.type === 'button' && n.props['aria-label'] === 'รับแบบไม่มีบิล ร้านผัก');
  assert.match(h.text(action), /^ไม่มีบิล/); assert.equal(action.props.disabled, false);
  await h.click('รับแบบไม่มีบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 1); assert.equal(s.state.creates[0].kind, 'manual_receipt');
  assert.deepEqual([...s.state.creates[0].order_item_ids], [42, 43]); assert.equal(s.state.creates[0].product_group_id, 3);
  assert.equal(sc.calls.n, 0); assert.equal(s.state.uploads.length, 0); assert.equal(s.state.updates.length, 0);
  assert.equal(dataStep(h), 'count'); assert.match(text(h), /ใบรับไม่มีบิล/);
});

test('no-bill entry follows the selected shop and switches an existing bill draft instead of creating a second one', async () => {
  const draft = blindDoc({ client_uuid: 'u', kind: 'bill', product_group_id: 4, supplier_name_text: 'ร้านหมู', order_item_ids: [50] });
  const s = fake({ existing: draft }); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('เลือกร้าน ร้านหมู');
  assert.ok(h.find(n => n.props['aria-label'] === 'รับแบบไม่มีบิล ร้านหมู'));
  await h.click('รับแบบไม่มีบิล ร้านหมู'); await h.settle();
  assert.equal(s.state.creates.length, 0); assert.equal(JSON.stringify(s.state.updates), JSON.stringify([{ id: 31, body: { kind: 'manual_receipt' } }]));
  assert.equal(sc.calls.n, 0); assert.equal(dataStep(h), 'count');
});

test('scan-first: a failed create shows the problem, keeps the footer and the retry reuses the same request id', async () => {
  let failures = 1; const s = fake({ createError: () => failures-- > 0 ? { request: {} } : null }); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 1); assert.equal(sc.calls.n, 0);
  assert.match(text(h), /เริ่มรับของไม่สำเร็จ/);
  assert.ok(h.find(n => n.type === 'button' && n.props.className === 'rc-queue-scan' && n.props['aria-label'] === 'สแกนบิล ร้านผัก'));
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 2); assert.equal(s.state.creates[1].client_uuid, s.state.creates[0].client_uuid, 'idempotent retry');
  assert.equal(sc.calls.n, 1); assert.equal(dataStep(h), 'count');
});

test('scan-first: a double tap on the footer creates once while the request is in flight', async () => {
  const gate = deferred(); const s = fake(); const create = s.api.create; s.api.create = async body => { await gate.promise; return create(body); };
  const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  const scan = () => h.find(n => n.type === 'button' && n.props.className === 'rc-queue-scan' && n.props['aria-label'] === 'สแกนบิล ร้านผัก');
  const first = scan().props.onClick(); await h.settle();
  assert.equal(scan().props.disabled, true);
  gate.resolve(); await first; await h.settle();
  assert.equal(s.state.creates.length, 1);
});

test('scan-first: a stored unsent request for another receipt falls back to the setup sheet instead of being overwritten', async () => {
  const s = fake(); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  const key = [...h.storage.keys()][0];
  assert.equal(key, undefined);
  h.storage.set('solao.receiving.pending.v1:1:1:1', JSON.stringify({ client_uuid: 'old', delivery_date: today, kind: 'bill', scope: 'department', supplier_name_text: 'ร้านหมู', order_item_ids: [50], product_group_id: 4 }));
  await h.click('สแกนบิล ร้านผัก'); await h.settle();
  assert.equal(s.state.creates.length, 0); assert.equal(sc.calls.n, 0);
  assert.ok(h.find(n => n.type === 'form' && n.props.id === 'rc-create'), 'the sheet shows the resume choice');
  assert.match(text(h), /ใบเดิม: ร้านหมู/);
});

test('manual setup sheet stays reachable from Options for the shop in the footer and keeps the old creation flow', async () => {
  const s = fake(); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('เลือกร้าน ร้านหมู');
  await h.click('ตัวเลือก'); await h.click('ตั้งค่าใบรับเอง');
  assert.equal(h.find(n => n.type === 'input' && n.props.maxLength === 255).props.value, 'ร้านหมู');
  assert.equal(s.state.creates.length, 0);
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(s.state.creates.length, 1);
  assert.equal(sc.calls.n, 0, 'the manual sheet keeps the original bill step with the capture button');
  assert.equal(dataStep(h), 'images'); assert.ok(visibleButtons(h).includes('ถ่าย / เพิ่มรูปบิล')); assert.equal(visibleButtons(h).includes('สแกนบิลอีกครั้ง'), false);
});

test('walk-in: choosing the supplier then the scan action creates a bill receipt without orders and opens the scanner', async () => {
  const supplier = { supplier_key: 'sm:9', name: 'ร้านโทรสั่ง', code: 'SYN-9', supplier_master_id: 9, product_group_id: null };
  const s = fake({ groups: [], suppliers: [supplier] }); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  const create = () => h.find(n => n.type === 'button' && n.props.type === 'submit');
  assert.equal(h.text(create()), 'สแกนบิล'); assert.equal(create().props.disabled, true, 'a supplier must be chosen first');
  await h.select('ผู้ส่งของ', 'โทร'); await new Promise(r => setTimeout(r, 280)); await h.settle();
  await h.click('ร้านโทรสั่ง');
  assert.equal(create().props.disabled, false); assert.equal(s.state.creates.length, 0);
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  const body = s.state.creates[0];
  assert.equal(body.kind, 'bill'); assert.equal(body.supplier_master_id, 9); assert.equal(body.supplier_name_text, 'ร้านโทรสั่ง'); assert.equal(body.order_item_ids.length, 0);
  assert.equal(sc.calls.n, 1, 'the scanner opens right after creating'); assert.equal(s.state.uploads.length, 1); assert.equal(dataStep(h), 'count');
  assert.match(text(h), /อ่านบิลแล้ว · ใส่ชื่อสินค้าให้/);
});

test('walk-in: the no-bill toggle relabels the action and goes to counting without scanning', async () => {
  const supplier = { supplier_key: 'sm:9', name: 'ร้านโทรสั่ง', code: 'SYN-9', supplier_master_id: 9, product_group_id: null };
  const s = fake({ groups: [], suppliers: [supplier] }); const sc = scanner([fakeFile]);
  const h = await open(s, sc.capture);
  await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  await h.radio('manual_receipt');
  assert.equal(h.text(h.find(n => n.type === 'button' && n.props.type === 'submit')), 'เริ่มนับของ');
  await h.select('ผู้ส่งของ', 'โทร'); await new Promise(r => setTimeout(r, 280)); await h.settle();
  await h.click('ร้านโทรสั่ง');
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(s.state.creates[0].kind, 'manual_receipt'); assert.equal(sc.calls.n, 0); assert.equal(dataStep(h), 'count');
});

test('scan-first keeps the footer budget: one primary and two secondary controls, buttons at least 48px by CSS', async () => {
  const s = fake(); const h = await open(s, null);
  h.budget();
  const bar = h.find(n => n.props.className?.includes('rc-receiving-actions'));
  assert.equal(h.all(bar).filter(n => n.type === 'button').length, 3);
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8') + await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /\.rc-nobill-action \{[^}]*min-height: var\(--sg-touch\)/);
  assert.match(css, /\.ra-document \.ra-capture-primary \{[^}]*min-height:56px/);
  assert.match(css, /\.ra-document \.ra-secondary-action \{[^}]*|\.ra-secondary-action[^}]*min-height:48px/s);
});
