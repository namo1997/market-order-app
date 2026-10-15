import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise real page/component handlers with mocked API/browser surfaces only.
// This is a component harness, not browser or visual acceptance.
export async function harness(page, props = {}, apiOverrides = {}, auth = {}, browser = {}, runtime = {}, captureImage = null, entryPath = `../src/pages/receiving/${page}.jsx`) {
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
    useCallback: (fn, deps) => {
      const [prior, setPrior] = hook(() => ({ fn, deps }));
      if (deps.some((item, index) => item !== prior.deps[index])) { setPrior({ fn, deps }); return fn; }
      return prior.fn;
    },
    useEffect: (callback, deps) => {
      const [prior, setPrior] = hook(null);
      if (!prior || deps.some((item, index) => item !== prior.deps[index])) {
        const next = { deps, cleanup: undefined };
        effects.push(() => { prior?.cleanup?.(); next.cleanup = callback(); }); setPrior(next);
      }
    },
  };
  const jsx = (type, values, key) => ({ type, props: values || {}, key });
  const storage = new Map();
  const context = vm.createContext({
    __mocks: { api, captureImage, auth: { user: { id: 1, role: 'admin', branch_id: 1, department_id: 1, name: 'ผู้รับ' }, isAdmin: false, ...auth } },
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, ...browser },
    document: { title: 'SOLAO', getElementById: id => { const node = all().find(item => item.props.id === id); return node ? { closest: () => all().some(item => item.type === 'details' && all(item).includes(node)) ? { set open(value) { if (value) opened.push(id); } } : null, focus: () => focused.push(id), scrollIntoView() {} } : null; }, createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (done) => done(new Blob(['mock-image'])) }) }, createImageBitmap: async () => ({ width: 100, height: 100, close() {} }), FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,c3ludGhldGlj'; this.onload(); } }, navigator: { onLine: true },
    crypto: { randomUUID: () => 'stable-client-uuid' }, Intl, Date, Blob, URL, setTimeout, clearTimeout, ...runtime,
  });
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(entryPath, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'receiving-test-surfaces', setup(builder) {
      builder.onResolve({ filter: /\/api\/|AuthContext|react-router-dom|image-capture/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: args.path.includes('image-capture') ? 'export const captureImage = globalThis.__mocks.captureImage;' : args.path.includes('AuthContext')
        ? 'export const useAuth = () => globalThis.__mocks.auth;'
        : args.path.includes('react-router-dom') ? 'export const Link = "a";'
        : 'export const receivingDocumentsAPI = globalThis.__mocks.api; export const productsAPI = { getProducts: async () => ({data: []}) }; export const masterAPI = { getBranches: async () => [], getDepartmentsByBranch: async () => [] };' }));
      builder.onResolve({ filter: /\.css$|\.svg|\.webp$/ }, (args) => ({ path: args.path, namespace: 'asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, args => ({ contents: `export default ${JSON.stringify(args.path)};` }));
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
  const focused = [];
  const opened = [];
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
  return { focused, opened, storage, calls, click, select, radio, find, all, visible: activeNodes, text, budget, settle, api };
}

