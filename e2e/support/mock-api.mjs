import assert from 'node:assert/strict';

export const DATE = '2026-10-15';
export const NOW = '2026-10-15T15:10:00.000Z';
export const USER = { id: 801, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 71, department_id: 72, branch: 'สาขาทดสอบ', department: 'ครัวทดสอบ' };
// Synthetic session marker only. Never read real credentials or contact an auth server.
export const SESSION = 'e2e-local-synthetic-session';
export const LINE = {
  id: 11, line_no: 1, bill_text: 'ผักรวม', product_id: 91, product_name: 'ผักรวม', order_item_id: 101,
  unit_text: 'กก.', unit_id: 2, quantity_billed: '2.5', quantity_received: '2.5', unit_price: '156.80', amount: '392.00',
  match: { source: 'order', confidence: 0.96 },
};
// 392/472 is taken from the existing real-bill-shaped test in receiving-ocr-findings.test.mjs.
// Names, IDs, reference, date and quantities are synthetic; no original bill was available.
export function documentFixture(patch = {}) {
  return {
    id: 501, status: 'draft', branch_id: 71, department_id: 72, supplier_master_id: 81, product_group_id: null,
    supplier_name_text: 'ผู้ขายทดสอบ', delivery_date: DATE, doc_ref: null, doc_date: null, kind: 'bill',
    subtotal: null, discount: null, vat: null, total: null,
    ocr: { status: 'none', model: null, confidence: null, warnings: [] }, receiver_user_id: 801,
    receiver_name: USER.name, courier_name: null, has_receiver_signature: false, has_courier_signature: false,
    images: [], lines: [], warnings: [], created_at: NOW, updated_at: NOW, confirmed_at: null,
    client_uuid: '00000000-0000-4000-8000-000000000501', ...structuredClone(patch),
  };
}
export function ocrDocument(patch = {}) {
  return documentFixture({ doc_ref: 'ANON-001', doc_date: DATE, subtotal: '392.00', discount: '0.00', vat: '0.00', total: '392.00',
    images: [{ id: 601, page_no: 1, mime: 'image/jpeg', width: 320, height: 200 }], lines: [LINE],
    ocr: { status: 'done', model: 'mock-provider', confidence: 0.96, warnings: [] }, ...patch });
}

export async function mockAPI(page, origin, initialDocument = null) {
  let doc = initialDocument && structuredClone(initialDocument);
  const calls = [], unexpected = [], blocked = [], faults = [], gates = [];
  let jpeg;
  const waiters = [];
  const publish = () => { for (const resolve of waiters.splice(0)) resolve(); };
  const api = {
    calls, unexpected, blocked,
    get doc() { return doc; },
    failNext(method, suffix, status, code, { abort = false, commit = false } = {}) {
      faults.push({ method, suffix, status, code, abort, commit });
    },
    pauseNext(method, suffix) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      gates.push({ method, suffix, promise }); return release;
    },
    async waitFor(method, suffix, count = 1) {
      while (calls.filter(c => c.method === method && c.path.endsWith(suffix)).length < count) await new Promise(resolve => waiters.push(resolve));
      return calls.filter(c => c.method === method && c.path.endsWith(suffix)).at(-1);
    },
  };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === origin) return route.continue();
      blocked.push(`${method} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient');
    }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*' } });
    const body = request.postData() ? request.postDataJSON() : {};
    // Keep assertions in memory, never persist image/signature/session data into logs.
    calls.push({ method, path: url.pathname, body }); publish();
    const ok = data => route.fulfill({ status: 200, json: { success: true, data: structuredClone(data) } });
    const error = (status, code) => route.fulfill({ status, json: { success: false, code, message: 'ข้อมูลทดสอบ: กรุณาตรวจรายการ' } });
    const gate = gates.findIndex(g => g.method === method && url.pathname.endsWith(g.suffix));
    if (gate >= 0) await gates.splice(gate, 1)[0].promise;
    const faultIndex = faults.findIndex(f => f.method === method && url.pathname.endsWith(f.suffix));
    const fault = faultIndex >= 0 ? faults.splice(faultIndex, 1)[0] : null;
    if (fault && !fault.commit) return fault.abort ? route.abort('internetdisconnected') : error(fault.status, fault.code);
    if (url.pathname === '/api/auth/branches') return ok([{ id: 71, name: USER.branch, code: 'KK' }]);
    if (url.pathname === '/api/auth/departments/71') return ok([{ id: 72, name: USER.department }]);
    if (url.pathname === '/api/auth/line/super-admin/status') return ok({ enabled: false });
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      assert.equal(body.departmentId, 72); return ok({ token: SESSION, user: USER });
    }
    if (url.pathname === '/api/auth/me') return ok(USER);
    const base = '/api/receiving-documents';
    if (url.pathname === `${base}/expected`) {
      assert.equal(url.searchParams.get('date'), DATE);
      return ok([{ supplier_key: 'sm:81', supplier_name: 'ผู้ขายทดสอบ', items: [{ order_item_id: 101, product_id: 91,
        product_name: 'ผักรวม', unit_name: 'กก.', quantity_ordered: '2.5', received_quantity: doc?.status === 'confirmed' ? doc.lines[0]?.quantity_received : '0', is_received: doc?.status === 'confirmed' }] }]);
    }
    if (url.pathname === base && method === 'GET') {
      assert.equal(url.searchParams.get('date'), DATE);
      if (!doc) return ok([]);
      const { lines, ...summary } = doc; return ok([summary]);
    }
    if (url.pathname === base && method === 'POST') {
      assert.match(body.client_uuid, /^[0-9a-f-]{36}$/i);
      assert.equal(body.delivery_date, DATE); assert.equal(body.kind, 'bill');
      if (!doc) doc = documentFixture(body);
      assert.equal(doc.client_uuid, body.client_uuid);
      if (fault?.commit) return route.abort('internetdisconnected');
      return ok(doc);
    }
    if (url.pathname === '/api/products' && method === 'GET') return ok([{ id: 91, name: 'ผักรวม', unit_id: 2, unit_name: 'กก.' }]);
    if (url.pathname.startsWith(`${base}/501`)) {
      if (!doc) return error(404, 'NOT_FOUND');
      const action = url.pathname.slice(`${base}/501`.length);
      if (method === 'GET' && action === '') return ok(doc);
      if (method === 'GET' && action === '/images/601') {
        assert.ok(jpeg || doc.images.length);
        // Valid tiny PNG when a document was seeded instead of uploaded.
        return route.fulfill({ status: 200, contentType: jpeg ? 'image/jpeg' : 'image/png', body: jpeg || Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      }
      if (action !== '/void' && method !== 'GET' && doc.status !== 'draft') return error(409, 'NOT_DRAFT');
      if (action === '/images' && method === 'POST') {
        assert.equal(body.page_no, 1); assert.match(body.image_data_url, /^data:image\/jpeg;base64,/);
        jpeg = Buffer.from(body.image_data_url.split(',')[1], 'base64');
        assert.ok(jpeg.length <= 3 * 1024 * 1024); assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff');
        doc.images = [{ id: 601, page_no: 1, mime: 'image/jpeg', width: 320, height: 200 }]; return ok({ image_id: 601 });
      }
      if (action === '/ocr' && method === 'POST') {
        assert.equal(doc.images.length, 1);
        doc = { ...doc, ...ocrDocument(), client_uuid: doc.client_uuid }; return ok(doc);
      }
      if (!action && method === 'PUT') {
        assert.ok(Array.isArray(body.lines)); assert.ok(Array.isArray(body.deleted_line_ids));
        assert.equal(Number(body.lines[0].quantity_received), 2.5);
        const quantity = value => value == null ? null : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
        doc = { ...doc, ...body, lines: body.lines.map(line => ({ ...line,
          quantity_billed: quantity(line.quantity_billed), quantity_received: quantity(line.quantity_received) })), updated_at: NOW };
        return ok(doc);
      }
      if (action === '/signatures' && method === 'POST') {
        assert.ok(['receiver', 'courier'].includes(body.role)); assert.match(body.image_data_url, /^data:image\/png;base64,/);
        doc[`has_${body.role}_signature`] = true; if (body.role === 'courier') doc.courier_name = body.name;
        return ok({ saved: true });
      }
      if (action === '/confirm' && method === 'POST') {
        if (!doc.has_receiver_signature) return error(422, 'SIGNATURE_REQUIRED');
        assert.ok(doc.lines.some(line => Number(line.quantity_received) > 0));
        doc.status = 'confirmed'; doc.confirmed_at = NOW; return ok(doc);
      }
      if (action === '/void' && method === 'POST') {
        if (!body.reason?.trim()) return error(422, 'VALIDATION_FAILED');
        if (doc.status === 'void') return error(409, 'NOT_DRAFT');
        doc.status = 'void'; return ok(doc);
      }
    }
    unexpected.push(`${method} ${url.pathname}`); return error(500, 'UNMOCKED_ENDPOINT');
  });
  return api;
}
