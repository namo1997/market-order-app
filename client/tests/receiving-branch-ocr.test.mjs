import test from 'node:test';
import assert from 'node:assert/strict';
import { harness as baseHarness } from './receiving-harness.mjs';
const harness = (page, props, api = {}) => baseHarness(page, props, { image: async () => new Blob(['mock'], { type: 'image/jpeg' }), ...api });
const user = { id: 12, name: 'ผู้รับ', branch_id: 1, department_id: 10, role: 'user' };
const doc = (extra = {}) => ({ id: 1, scope: 'branch', status: 'draft', kind: 'bill', counted_complete_at: '2026-10-18T01:00:00Z', supplier_name_text: 'ร้านผัก',
  images: [{ id: 9, page_no: 1 }], ocr: { status: 'failed' }, lines: [{ id: 1, product_id: 7, product_name: 'ผัก',
    unit_text: 'กก.', counted_quantity: '10', quantity_received: '10', quantity_billed: '10', unit_price: '20', amount: '200', departments: [] }], ...extra });

test('branch editor saves pending edits before OCR, displays server allocation and prevents concurrent clicks', async () => {
  let current = doc(), release; const calls = [];
  const h = await harness('BranchDocumentEditor', { initialDocument: current, user, onChanged() {} }, {
    update: async (id, body) => { calls.push('save'); current = { ...current, doc_ref: body.doc_ref }; return current; },
    ocr: async () => { calls.push('ocr'); return new Promise(resolve => { release = () => resolve({ ...current,
      ocr: { status: 'done' }, lines: [{ ...current.lines[0], quantity_received: '10', quantity_billed: '5',
        departments: [{ order_item_id: 50, department_name: 'ครัว', quantity_received: '6' },
          { order_item_id: 60, department_name: 'สโตร์', quantity_received: '4' }] }] }); }); },
  });
  await h.select('เลขที่บิล', 'B-1');
  await h.click('บันทึกหัวบิล');
  const button = h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิลด้วย AI (คงจำนวนนับ)');
  const request = button.props.onClick(); await h.settle(); await button.props.onClick();
  assert.deepEqual(calls, ['save','ocr']); release(); await request; await h.settle();
  assert.match(h.text(h.visible()), /นับของครบแล้ว/); assert.match(h.text(h.visible()), /ครัว/);
  await h.click('แก้ข้อมูลหลังเปิดบิล');
  assert.equal(h.find(node => node.type === 'input' && String(node.props.value) === '10') != null, true);
  assert.match(h.text(h.visible()), /บิล/);
  h.unmount();
});

for (const [label, extra, online] of [['no images', { images: [] }, true], ['offline', {}, false],
  ['pending', { ocr: { status: 'pending' } }, true]]) {
  test(`branch OCR button disabled: ${label}`, async () => {
    const h = await harness('BranchDocumentEditor', { initialDocument: doc(extra), user, online });
    assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled, true);
    h.unmount();
  });
}
test('branch OCR failure leaves document visible and retryable; confirmed document hides OCR', async () => {
  const h = await harness('BranchDocumentEditor', { initialDocument: doc(), user, onChanged() {} }, {
    ocr: async () => { throw {response:{status:422,data:{message:'อ่านไม่สำเร็จ'}}}; },
  });
  await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)'); assert.match(h.text(h.visible()), /อ่านบิลไม่สำเร็จ/);
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled, false); h.unmount();
  const done = await harness('BranchDocumentEditor', { initialDocument: doc({ status: 'confirmed' }), user });
  assert.equal(done.visible().some(node => node.type === 'button' && done.text(node) === 'อ่านบิลด้วย AI (คงจำนวนนับ)'), false); done.unmount();
});

for (const [width, height] of [[360,800],[390,844],[412,915]]) {
  test(`branch editor mobile harness ${width}x${height}: OCR action and manual AI confirmation`, async () => {
    let patch;
    const initialDocument = doc({ ocr: { status: 'done' } });
    initialDocument.lines[0].match = { source: 'ai', confidence: 0.4 };
    const h = await baseHarness('BranchDocumentEditor', { initialDocument, user, onChanged() {} }, {
      image: async () => new Blob(['mock'], { type: 'image/jpeg' }),
      update: async (id, body) => { patch = body.lines[0]; return { ...initialDocument,
        lines: [{ ...initialDocument.lines[0], match: patch.match }] }; },
    }, {}, {}, { innerWidth: width, innerHeight: height });
    assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิลด้วย AI (คงจำนวนนับ)'));
    await h.click('ยืนยันสินค้าที่เลือกและรับ');
    assert.equal(patch.match.source, 'manual'); assert.equal(patch.quantity_received, undefined);
    assert.equal(h.visible().some(node => node.type === 'button' && h.text(node) === 'ยืนยันสินค้าที่เลือกและรับ'), false);
    h.unmount();
  });
}

for (const [width,height] of [[360,800],[390,844],[412,915]]) test(`integration branch count guard ${width}x${height}: no OCR or bill before count`, async()=>{
 const initialDocument=doc({counted_complete_at:null,blind:true});let reads=0;
 const h=await baseHarness('BranchDocumentEditor',{initialDocument,user},{ocr:async()=>{reads++;return initialDocument;}},{},{},{innerWidth:width,innerHeight:height});
 assert.equal(h.visible().some(n=>n.type==='button'&&/อ่านบิลด้วย AI/.test(h.text(n))),false);
 assert.equal(reads,0);assert.doesNotMatch(h.text(h.visible()),/นับของครบแล้ว/);h.unmount();
});
