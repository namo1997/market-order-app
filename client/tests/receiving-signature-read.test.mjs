import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

const doc = (values = {}) => ({ id: 17, status: 'draft', kind: 'manual_receipt', delivery_date: '2026-10-16',
  receiver_name: 'ผู้รับ', courier_name: 'ผู้ส่ง', has_receiver_signature: true, has_courier_signature: true,
  images: [], lines: [], warnings: [], ocr: { status: 'none' }, ...values });
const user = { id: 1, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const imageNodes = h => h.visible().filter(node => node.type === 'img' && node.props.className === 'rc-saved-signature');
const urls = () => {
  const created = [], revoked = [];
  return { created, revoked, URL: {
    createObjectURL(blob) { const url = `blob:fixture-${created.length}`; created.push({ blob, url }); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  } };
};
const openCourier = async h => { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'courier'); await h.click('เลือก'); };







test('Signature read UI: pending reads show loading; failure 403/404/network has retry, never an empty canvas or signature write', async () => {
  for (const failure of [{ response: { status: 403 } }, { response: { status: 404 } }, { request: {} }]) {
    let finish, reads = 0;
    const pending = new Promise((_resolve, reject) => { finish = reject; });
    const h = await harness('SignaturePad', { label: 'ผู้รับ', saved: true, documentId: 17, role: 'receiver' }, {
      signatureImage: () => { reads++; return reads === 1 ? pending : Promise.resolve(new Blob(['png'])); },
    });
    assert.ok(h.text(h.visible()).includes('กำลังโหลดลายเซ็น'));
    finish(failure); await h.settle();
    assert.ok(h.text(h.visible()).includes('โหลดลายเซ็นไม่สำเร็จ'));
    assert.equal(h.visible().some(node => node.type === 'canvas'), false);
    await h.click('ลองโหลดใหม่');
    assert.equal(reads, 2); assert.equal(imageNodes(h).length, 1);
    assert.equal(h.calls.length, 0); h.unmount();
  }
});

test('Signature read UI: decode retry fetches again and revokes prior URL; read-only retry stays available', async () => {
  let reads = 0;
  const lifecycle = urls();
  const h = await harness('SignaturePad', { label: 'ผู้รับ', saved: true, documentId: 17, role: 'receiver', readOnly: true, showActions: false }, {
    signatureImage: async () => { reads++; return new Blob(['png']); },
  }, {}, {}, { URL: lifecycle.URL });
  imageNodes(h)[0].props.onError(); await h.settle();
  assert.ok(h.text(h.visible()).includes('แสดงภาพลายเซ็นไม่ได้'));
  await h.click('ลองโหลดใหม่');
  assert.equal(reads, 2);
  assert.deepEqual(lifecycle.revoked, ['blob:fixture-0']);
  assert.equal(imageNodes(h)[0].props.src, 'blob:fixture-1');
  h.unmount(); assert.deepEqual(lifecycle.revoked, ['blob:fixture-0', 'blob:fixture-1']);
});

test('Signature read UI: resolving after unmount does not create URL or update the closed page', async () => {
  let finish;
  const lifecycle = urls();
  const h = await harness('SignaturePad', { label: 'ผู้ส่งของ', saved: true, documentId: 17, role: 'courier' }, {
    signatureImage: () => new Promise(resolve => { finish = resolve; }),
  }, {}, {}, { URL: lifecycle.URL });
  h.unmount(); finish(new Blob(['png'])); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(lifecycle.created, []); assert.deepEqual(lifecycle.revoked, []);
});
