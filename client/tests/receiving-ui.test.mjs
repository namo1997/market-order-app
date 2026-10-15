import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise real page/component handlers with mocked API/browser surfaces only.
// This is a component harness, not browser or visual acceptance.
async function harness(page, props = {}, apiOverrides = {}, auth = {}, captureImage = null) {
  const calls = [];
  const expected = [{ supplier_key: 'pg:1', supplier_name: 'ตลาด', items: [{ order_item_id: 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' }] }];
  let document = props.initialDocument;
  const api = {
    expected: async () => expected, list: async () => [],
    get: async () => document,
    update: async (id, body) => { calls.push(['update', id, body]); document = { ...document, ...body }; return document; },
    uploadImage: async (...args) => { calls.push(['upload', ...args]); return { image_id: 9 }; },
    ocr: async (id) => { calls.push(['ocr', id]); document = { ...document, ocr: { status: 'done' } }; return document; },
    signature: async (...args) => { calls.push(['signature', ...args]); document = { ...document, has_receiver_signature: true }; },
    confirm: async (...args) => { calls.push(['confirm', ...args]); document = { ...document, status: 'confirmed' }; return document; },
    void: async (...args) => { calls.push(['void', ...args]); document = { ...document, status: 'void' }; return document; },
    create: async (body) => { calls.push(['create', body]); return { ...body, id: 11 }; }, ...apiOverrides,
  };
  const states = new Map();
  let current;
  const effects = [];
  const hook = (initial) => {
    const key = `${current.path}:${current.index++}`;
    if (!states.has(key)) states.set(key, typeof initial === 'function' ? initial() : initial);
    return [states.get(key), (next) => states.set(key, typeof next === 'function' ? next(states.get(key)) : next)];
  };
  let ids = 0;
  const react = {
    useState: hook,
    useRef: (value) => hook(() => ({ current: value }))[0],
    useId: () => hook(() => `field-${++ids}`)[0],
    useCallback: (fn) => fn,
    useEffect: (callback, deps) => {
      const [prior, setPrior] = hook(null);
      if (!prior || deps.some((item, index) => item !== prior[index])) { effects.push(callback); setPrior(deps); }
    },
  };
  const jsx = (type, values, key) => ({ type, props: values || {}, key });
  const storage = new Map();
  const context = vm.createContext({
    __mocks: { api, captureImage, auth: { user: { id: 1, role: 'admin', branch_id: 1, department_id: 1, name: 'ผู้รับ' }, isAdmin: false, ...auth } },
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } },
    document: { title: 'SOLAO', createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (done) => done(new Blob(['mock-image'])) }) }, createImageBitmap: async () => ({ width: 100, height: 100, close() {} }), FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,c3ludGhldGlj'; this.onload(); } }, navigator: { onLine: true },
    crypto: { randomUUID: () => 'stable-client-uuid' }, Intl, Date, Blob, URL, setTimeout, clearTimeout,
  });
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(`../src/pages/receiving/${page}.jsx`, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'receiving-test-surfaces', setup(builder) {
      builder.onResolve({ filter: /\/api\/|AuthContext|react-router-dom|image-capture/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: args.path.includes('image-capture') ? 'export const captureImage = globalThis.__mocks.captureImage;' : args.path.includes('AuthContext')
        ? 'export const useAuth = () => globalThis.__mocks.auth;'
        : args.path.includes('react-router-dom') ? 'export const Link = "a";'
        : 'export const receivingDocumentsAPI = globalThis.__mocks.api; export const productsAPI = { getProducts: async () => ({data: []}) }; export const masterAPI = { getBranches: async () => [], getDepartmentsByBranch: async () => [] };' }));
      builder.onResolve({ filter: /\.css$|\.svg/ }, (args) => ({ path: args.path, namespace: 'asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: 'export default "sprite.svg";' }));
    } }],
  });
  const module = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
  await module.link((name) => {
    const exports = name === 'react' ? react : { jsx, jsxs: jsx, Fragment: 'fragment' };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const Component = module.namespace[page];
  const render = () => {
    const visit = (node, path = 'root') => {
      if (node == null || node === false) return null;
      if (Array.isArray(node)) return node.map((child, index) => visit(child, `${path}.${child?.key ?? index}`));
      if (typeof node !== 'object') return node;
      if (typeof node.type === 'function') {
        const parent = current; current = { path: `${path}.${node.type.name}`, index: 0 };
        const output = node.type(node.props); current = parent;
        return visit(output, `${path}.${node.type.name}`);
      }
      if (node.props.ref) node.props.ref.current = {
        open: false, showModal() { this.open = true; }, close() { this.open = false; }, click() {},
        width: 760, height: 240, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 380, height: 120 }),
        getContext: () => ({ beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {} }), toDataURL: () => 'synthetic-signature',
      };
      return { ...node, props: { ...node.props, children: visit(node.props.children, `${path}.children`) } };
    };
    return visit(jsx(Component, props));
  };
  let tree;
  const settle = async () => {
    for (let i = 0; i < 4; i++) { tree = render(); while (effects.length) effects.shift()(); await new Promise((resolve) => setImmediate(resolve)); }
    tree = render(); return tree;
  };
  const all = (node = tree) => node == null ? [] : Array.isArray(node) ? node.flatMap((child) => all(child)) : typeof node === 'object' ? [node, ...all(node.props.children)] : [];
  const text = (node) => node == null || node === false ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props.children) : String(node);
  const visible = (node) => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(visible);
    if (node.props.hidden) return [];
    return [node, ...visible(node.props.children)];
  };
  const activeNodes = () => { const dialog = all().filter((node) => node.type === 'dialog').at(-1); return visible(dialog || tree); };
  const find = (predicate) => { const result = activeNodes().find(predicate); assert.ok(result, 'missing UI target'); return result; };
  const click = async (label) => { const button = find((node) => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)); assert.ok(!button.props.disabled, `${label} disabled`); await button.props.onClick?.(); await settle(); };
  const select = async (label, value) => { const field = find((node) => node.type === 'label' && text(node).startsWith(label)); const input = field.props.htmlFor ? find((node) => node.props.id === field.props.htmlFor) : all(field).find((node) => ['input', 'select', 'textarea'].includes(node.type)); assert.ok(input, label); input.props.onChange({ target: { value } }); await settle(); };
  const radio = async (value) => { find((node) => node.type === 'input' && node.props.type === 'radio' && node.props.value === value).props.onChange(); await settle(); };
  const budget = () => {
    const dialogs = all().filter((node) => node.type === 'dialog');
    const active = dialogs.at(-1) || tree;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(walk);
      if (node.props.hidden) return [];
      return [node, ...walk(node.props.children)];
    };
    const buttons = walk(active).filter((node) => node.type === 'button' || (node.type === 'a' && node.props.to));
    const primary = buttons.filter((node) => node.props.className?.includes('sg-primary'));
    assert.ok(primary.length <= 1, `${primary.length} primary actions`);
    assert.ok(buttons.length - primary.length <= 2, `${buttons.length - primary.length} secondary actions`);
  };
  await settle();
  return { calls, click, select, radio, find, all, text, budget, settle, api };
}

const doc = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', receiver_user_id: 1, receiver_name: 'ผู้รับ', has_receiver_signature: false,
  images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0', lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', unit_price: '10' }] });
const user = { id: 1, role: 'admin' };

test('UI: overview and create use one primary/two secondary actions; retry keeps client UUID', async () => {
  let attempts = 0;
  const h = await harness('Receiving', {}, { create: async (body) => { h.calls.push(['create', JSON.parse(JSON.stringify(body))]); attempts++; throw { request: {} }; } });
  h.budget();
  await h.click('ตัวเลือก'); h.budget(); await h.click('เสร็จ');
  await h.click('สร้างใบรับ'); h.budget();
  const form = h.find((node) => node.type === 'form');
  await form.props.onSubmit({ preventDefault() {} }); await h.settle(); h.budget();
  await form.props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(attempts, 2); assert.deepEqual(h.calls[0][1], h.calls[1][1]); assert.equal(h.calls[0][1].client_uuid, 'stable-client-uuid');
});

test('UI: photo OCR -> edit -> receiver signature -> confirm -> void preserves API flow and action budget', async () => {
  const document = doc(); document.images = [{ id: 1, page_no: 1 }];
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} }, { image: async () => new Blob(['image']) });
  h.budget(); await h.click('อ่านบิล'); h.budget();
  await h.select('รับจริง', '1.5');
  assert.ok(h.all().some((node) => h.text(node) === 'ต่าง 0.5 กก.'));
  await h.click('ต่อไป'); h.budget();
  const canvas = h.find((node) => node.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle(); h.budget();
  await h.click('บันทึกเซ็น'); h.budget(); await h.click('ตรวจรับ'); h.budget();
  await h.click('ยืนยัน'); h.budget();
  assert.deepEqual(h.calls.filter((call) => call[0] === 'confirm'), [['confirm', 5, false]]);
  assert.equal(h.calls.find((call) => call[0] === 'update')[2].lines[0].quantity_received, '1.50');
  assert.equal(h.calls.find((call) => call[0] === 'signature')[2], 'receiver');
  await h.click('รายละเอียด'); h.budget(); await h.select('ทำรายการ', 'void'); await h.click('เลือก'); h.budget();
  await h.select('เหตุผล', 'ส่งผิด'); await h.click('ยกเลิกใบรับ'); h.budget();
  assert.deepEqual(h.calls.filter((call) => call[0] === 'void'), [['void', 5, 'ส่งผิด']]);
});

test('UI: manual additions, header editing, deletion and courier signature remain reachable', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} });
  for (const action of ['header', 'add', 'delete', 'courier']) {
    await h.click('รายละเอียด'); await h.select('ทำรายการ', action); await h.click('เลือก'); h.budget();
    if (action === 'header') { await h.select('เลขบิล', 'B-7'); await h.click('เสร็จ'); }
    if (action === 'delete') await h.click('ลบรายการ');
    if (action === 'courier') {
      await h.select('ชื่อ', 'ผู้ส่ง');
      h.find((node) => node.type === 'canvas').props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} });
      await h.settle(); await h.click('บันทึกเซ็น');
      assert.equal(h.calls.find((call) => call[0] === 'signature')[2], 'courier');
      await h.click('ปิด');
    }
  }
  assert.ok(h.calls.find((call) => call[0] === 'update')[2].doc_ref === 'B-7');
});

test('UI: ambiguous confirm switches to a single recovery action and never retries the write', async () => {
  const document = doc(); document.has_receiver_signature = true;
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} }, { confirm: async () => { h.calls.push(['confirm']); throw { request: {} }; } });
  await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน'); h.budget();
  assert.equal(h.calls.filter((call) => call[0] === 'confirm').length, 1);
  await h.click('ตรวจผลล่าสุด'); h.budget();
});

test('UI: camera selection and failed upload retain identical page number on retry before OCR', async () => {
  let uploads = 0;
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} }, {
    uploadImage: async (...args) => { h.calls.push(['upload', ...args]); if (++uploads === 1) throw { request: {} }; return { image_id: 9 }; },
    image: async () => new Blob(['mock']),
  });
  h.budget(); await h.click('ถ่ายบิล');
  const input = h.find((node) => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: 'bill.jpg' } });
  await h.settle(); h.budget(); await h.click('ส่งรูป'); h.budget(); await h.click('ส่งรูป'); h.budget();
  const sent = h.calls.filter((call) => call[0] === 'upload');
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(sent[0][2], 1);
  await h.click('อ่านบิล'); assert.equal(h.calls.filter((call) => call[0] === 'ocr').length, 1); h.budget();
});

test('UI: corrected quantities clear stale quantity warnings and invalid input turns red', async () => {
  const document = doc(); document.warnings = [{ code: 'QTY_SHORT', line_no: 1 }];
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} });
  await h.radio('lines');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'ok' && h.text(node) === 'ตรงใบสั่ง'));
  await h.select('รับจริง', '-1');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'error' && h.text(node) === 'ตรวจตัวเลข'));
  await h.select('รับจริง', '2');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'ok' && h.text(node) === 'ตรงใบสั่ง'));
  h.budget();
});


test('UI: injected native camera feeds ImagePages, prevents file chooser and locks duplicate taps', async () => {
  let release;
  let captures = 0;
  const capture = () => { captures++; return new Promise(resolve => { release = resolve; }); };
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} }, { image: async () => new Blob(['mock-image']) }, {}, capture);
  let prevented = 0;
  const input = h.find(node => node.type === 'input' && node.props.type === 'file');
  const event = { preventDefault() { prevented++; } };
  input.props.onClick(event);
  input.props.onClick(event);
  assert.equal(captures, 1); assert.equal(prevented, 2);
  release({ size: 20, type: 'image/jpeg', name: 'bill.jpeg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) });
  await h.settle();
  await h.click('ส่งรูป');
  assert.deepEqual(h.calls.find(call => call[0] === 'upload'), ['upload', 5, 1, 'data:image/jpeg;base64,c3ludGhldGlj']);
});

test('UI: native cancellation and permission errors release processing without adding pages', async () => {
  for (const fails of [false, true]) {
    const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} }, {}, {}, async () => {
      if (fails) throw Error('กรุณาอนุญาตใช้กล้อง');
      return null;
    });
    h.find(node => node.type === 'input' && node.props.type === 'file').props.onClick({ preventDefault() {} });
    await h.settle();
    assert.equal(h.calls.filter(call => call[0] === 'upload').length, 0);
    assert.ok(!h.find(node => node.type === 'button' && h.text(node) === 'ถ่ายบิล').props.disabled);
    if (fails) assert.ok(h.all().some(node => h.text(node) === 'กรุณาอนุญาตใช้กล้อง'));
  }
});
