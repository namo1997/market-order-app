import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageCapture } from '../src/receiving-app/camera.mjs';

function setup({ permission = 'granted', permissionError, cameraError, pickerError, photo = { webPath: 'blob:photo', format: 'jpeg' }, fetchError, responseOk = true } = {}) {
  const calls = [], notices = [];
  const capture = createImageCapture({ isNative: () => true,
    notify: message => notices.push(message),
    camera: {
      requestPermissions: async options => { calls.push(['permission', options]); if (permissionError) throw Error(permissionError); return { camera: permission }; },
      getPhoto: async options => { calls.push(['photo', options]); const error = options.source === 'CAMERA' ? cameraError : pickerError;
        if (error) throw Error(error); return photo; },
    },
    fetchImpl: async path => { calls.push(['fetch', path]); if (fetchError) throw Error(fetchError);
      return { ok: responseOk, blob: async () => new Blob(['bill'], { type: 'image/jpeg' }) }; },
  });
  return { capture, calls, notices };
}

test('camera: first permission grant and subsequent captures use camera, without notices or gallery saving', async () => {
  const h = setup();
  for (let i = 0; i < 2; i++) { const file = await h.capture(); assert.equal(file.name, 'bill.jpeg'); assert.equal(file.size, 4); }
  assert.equal(h.notices.length, 0);
  assert.deepEqual(h.calls.filter(([type]) => type === 'permission').map(([, value]) => value), [{ permissions: ['camera'] }, { permissions: ['camera'] }]);
  for (const [, options] of h.calls.filter(([type]) => type === 'photo')) {
    assert.equal(options.source, 'CAMERA'); assert.equal(options.saveToGallery, false);
    assert.equal(options.resultType, 'uri'); assert.equal(options.correctOrientation, true);
  }
});

for (const permission of ['denied', 'prompt', 'prompt-with-rationale', undefined]) {
  test(`camera: ${permission} falls back to photos once with a Thai notice and no second permission request`, async () => {
    const h = setup({ permission: permission ?? 'unknown' }); const file = await h.capture();
    assert.equal(file.name, 'bill.jpeg'); assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /ไม่ได้รับสิทธิ์.*เลือกรูปบิลจากเครื่อง.*ตั้งค่า Android/);
    assert.deepEqual(h.calls.map(([type]) => type), ['permission', 'photo', 'fetch']);
    assert.equal(h.calls[1][1].source, 'PHOTOS'); assert.equal(h.calls[1][1].saveToGallery, false);
  });
}

for (const options of [{ permissionError: 'private token stack' }, { cameraError: 'Unable to resolve camera activity' }, { cameraError: 'User denied access to camera' }]) {
  test(`camera: native failure ${Object.keys(options)[0]} safely opens photos`, async () => {
    const h = setup(options); assert.equal((await h.capture()).size, 4);
    assert.deepEqual(h.calls.filter(([type]) => type === 'photo').at(-1)[1].source, 'PHOTOS');
    assert.match(h.notices[0], /เปิดกล้องไม่สำเร็จ.*เลือกรูปบิลจากเครื่อง/);
    assert.doesNotMatch(h.notices[0], /private|token|stack|activity/);
  });
}

test('camera: cancelling camera or fallback picker is quiet and leaves no file', async () => {
  for (const options of [{ cameraError: 'User cancelled photos app' }, { cameraError: 'User canceled' },
    { permission: 'denied', pickerError: 'User cancelled photos app' }]) {
    const h = setup(options); assert.equal(await h.capture(), null);
    assert.equal(h.calls.filter(([type]) => type === 'fetch').length, 0);
    if (options.cameraError) { assert.equal(h.notices.length, 0); assert.equal(h.calls.length, 2); }
  }
});

test('camera: picker and image read failures expose only safe Thai messages and can be retried', async () => {
  for (const options of [{ permission: 'denied', pickerError: 'private token /sdcard/bill' },
    { photo: {} }, { fetchError: 'private token' }, { responseOk: false }]) {
    const h = setup(options);
    for (let i = 0; i < 2; i++) await assert.rejects(h.capture(), error => {
      assert.match(error.message, /(?:เลือกรูปจากเครื่อง|อ่านรูปบิล)ไม่สำเร็จ.*ลองใหม่/);
      assert.doesNotMatch(error.message, /private|token|sdcard/); return true;
    });
  }
});
