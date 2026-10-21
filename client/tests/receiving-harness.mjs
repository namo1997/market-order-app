import assert from 'node:assert/strict';
import { afterEach } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Match React unmount at the end of every test, including assertion failures.
// Receiving now owns a day-rollover timer; old callers did not all unmount.
const mounted = new Set();
afterEach(() => { for (const unmount of [...mounted]) unmount(); });

// Exercise real page/component handlers with mocked API/browser surfaces only.
// This is a component harness, not browser or visual acceptance.
export async function harness(page, props = {}, apiOverrides = {}, auth = {}, browser = {}, runtime = {}, captureImage = null, entryPath = `../src/pages/receiving/${page}.jsx`, rootTheme) {
  // The page harness passes a root preference in slot 7; APK callers pass a
  // capture function (or null) there and an optional custom entry in slot 8.
  if (typeof captureImage === 'string') { rootTheme = captureImage; captureImage = null; }
  const calls = [];
  const expected = [{ supplier_key: 'pg:1', supplier_name: 'ตลาด', items: [{ order_item_id: 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' }] }];
  let document = props.initialDocument;
  const api = {
    products: async filters => (await api.getProducts?.({ search: filters.q }) || { data: [] }).data,
    suppliers: async () => [], supplierProducts: async () => [],
    expected: async () => expected, list: async () => [],
    setLead: async (...args) => { calls.push(['setLead', ...args]); },
    followups: async () => ({ items: [], pending_count: 0 }),
    followup: async body => { calls.push(['followup', body]); return { created: true }; },
    followupStatus: async (...args) => { calls.push(['followupStatus', ...args]); return {}; },
    get: async () => document,
    update: async (id, body) => { calls.push(['update', id, body]); document = { ...document, ...body, has_receiver_signature: false, lines: body.lines?.map(line => ({ ...document?.lines?.find(old => old.id === line.id), ...line })) || document.lines }; return document; },
    count: async (id, body) => { if (body.check_only) return { count_warnings: [] }; calls.push(['count', id, body]); document = { ...document, blind: false, counted_complete_at: '2026-10-18T13:00:00Z', lines: document.lines.map(line => ({ ...line, counted_quantity: body.lines.find(input => input.id === line.id).counted_quantity, quantity_received: body.lines.find(input => input.id === line.id).counted_quantity })) }; return document; },
    uploadImage: async (...args) => { calls.push(['upload', ...args]); return { image_id: 9 }; },
    ocr: async (id) => { calls.push(['ocr', id]); document = { ...document, ocr: { status: 'done' } }; return document; },
    signature: async (...args) => { calls.push(['signature', ...args]); document = { ...document, [`has_${args[1]}_signature`]: true }; },
    signatureImage: async () => new Blob(['fixture-signature'], { type: 'image/png' }),
    confirm: async (...args) => { calls.push(['confirm', ...args]); document = { ...document, status: 'confirmed' }; return document; },
    void: async (...args) => { calls.push(['void', ...args]); document = { ...document, status: 'void' }; return document; },
    create: async (body) => { calls.push(['create', body]); return { ...body, id: 11 }; }, ...apiOverrides,
  };
  const createRequest = api.create;
  api.create = async body => { document = await createRequest(body); return document; };
  const states = new Map();
  const setters = new Map();
  let current;
  const effects = [];
  const effectRecords = new Map();
  let visited = new Set();
  const hook = (initial) => {
    const key = `${current.path}:${current.index++}`;
    visited.add(key);
    if (!states.has(key)) states.set(key, typeof initial === 'function' ? initial() : initial);
    if (!setters.has(key)) setters.set(key, (next) => states.set(key, typeof next === 'function' ? next(states.get(key)) : next));
    return [states.get(key), setters.get(key)];
  };
  let ids = 0;
  const react = {
    createContext: initial => {
      const context = { value: initial };
      context.Provider = { receivingContext: context };
      return context;
    },
    useContext: context => context.value,
    useState: hook,
    useRef: (value) => hook(() => ({ current: value }))[0],
    useId: () => hook(() => `field-${++ids}`)[0],
    useCallback: (fn, deps) => {
      const [prior, setPrior] = hook(() => ({ fn, deps }));
      if (deps.some((item, index) => item !== prior.deps[index])) { setPrior({ fn, deps }); return fn; }
      return prior.fn;
    },
    useMemo: (fn, deps) => {
      const [prior, setPrior] = hook(() => ({ value: fn(), deps }));
      if (deps.some((item, index) => item !== prior.deps[index])) { const next = { value: fn(), deps }; setPrior(next); return next.value; }
      return prior.value;
    },
    useEffect: (callback, deps) => {
      const key = `${current.path}:${current.index}`;
      const [record] = hook(() => ({ deps: null, cleanup: null }));
      effectRecords.set(key, record);
      if (!record.deps || !deps || deps.some((item, index) => item !== record.deps[index])) {
        effects.push(() => { record.cleanup?.(); record.cleanup = callback(); });
        record.deps = deps;
      }
    },
  };
  const jsx = (type, values, key) => ({ type, props: values || {}, key });
  const storage = new Map();
  const events = new Map();
  const browserDocument = { documentElement: { dataset: rootTheme ? { theme: rootTheme } : {} } };
  const dispatch = event => { for (const listener of events.get(event.type) || []) listener(event); return true; };
  const context = vm.createContext({
    __mocks: { api, captureImage, auth: { user: { id: 1, role: 'admin', branch_id: 1, department_id: 1, name: 'ผู้รับ' }, isAdmin: false, ...auth } },
    window: { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); }, removeEventListener(type, fn) { events.get(type)?.delete(fn); }, dispatchEvent: dispatch, scrollTo() {}, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, ...browser },
    document: { ...browserDocument, title: 'SOLAO', getElementById: id => { const node = all().find(item => item.props.id === id); return node ? { closest: () => all().some(item => item.type === 'details' && all(item).includes(node)) ? { set open(value) { if (value) opened.push(id); } } : null, focus: () => focused.push(id), scrollIntoView() { scrolled.push(id); } } : null; }, createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (done) => done(new Blob(['mock-image'])) }) }, createImageBitmap: async () => ({ width: 100, height: 100, close() {} }), FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,c3ludGhldGlj'; this.onload(); } }, navigator: { onLine: true },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    requestAnimationFrame: callback => setTimeout(callback, 0), crypto: { randomUUID: () => 'stable-client-uuid', getRandomValues: array => { array[0] = 67; return array; } }, atob, Intl, Date, Blob, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, ...runtime,
  });
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(entryPath, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    define: runtime.__shell ? { 'import.meta.env.VITE_RECEIVING_AUTH_MODE': '"pilot"' } : {},
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'receiving-test-surfaces', setup(builder) {
      if (runtime.__shell) {
        builder.onResolve({ filter: /@capacitor\/|\/Receiving$|\.\/runtime\.mjs$|\.\/google-auth\.mjs$|\.\/native-shell\.mjs$|\.\/client\.mjs$/ }, args => args.path.endsWith('/Receiving') && runtime.__shell.realReceiving ? undefined : ({ path: args.path, namespace: 'shell' }));
        builder.onLoad({ filter: /.*/, namespace: 'shell' }, args => {
          const code = args.path.endsWith('/Receiving') ? 'export function Receiving(props) { globalThis.__shell.page(props); return null; }'
            : args.path.endsWith('/runtime.mjs') ? 'export const ReceivingAuth = ({children, value}) => { if (globalThis.__shell.realReceiving) globalThis.__mocks.auth = value; return children; };'
            : args.path.includes('native-shell') ? 'export const { exitReceivingApp, setBackHandlerReady, setSystemTheme } = globalThis.__shell;'
            : args.path.includes('google-auth') ? 'export const { signInGoogle, signOutGoogle } = globalThis.__shell;'
            : args.path.endsWith('/client.mjs') ? 'export function setApiClient(value) { globalThis.__shell.client = value; } export default {};'
            : args.path.endsWith('/camera') ? 'export const Camera = globalThis.__shell.Camera || {};'
            : args.path.endsWith('/preferences') ? 'export const Preferences = globalThis.__shell.Preferences;'
            : args.path.endsWith('/network') ? 'export const Network = globalThis.__shell.Network;'
            : 'export const { Capacitor, CapacitorHttp } = globalThis.__shell; export const registerPlugin = name => name === "App" ? (globalThis.__shell.App || { addListener: async () => ({remove() {}}) }) : globalThis.__shell.alerts;';
          return { contents: code };
        });
      }
      builder.onResolve({ filter: /\/api\/|AuthContext|react-router-dom|image-capture|\/components\/layout\/Layout$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: args.path.endsWith('/layout/Layout') ? 'export const Layout = ({children}) => children;' : args.path.includes('image-capture') ? 'export const captureImage = globalThis.__mocks.captureImage;' : args.path.includes('AuthContext')
        ? 'export const useAuth = () => globalThis.__mocks.auth;'
        : args.path.includes('react-router-dom') ? 'export const Link = "a"; export const MemoryRouter = ({children}) => children; export const useLocation = () => globalThis.window.location; export const useParams = () => ({id: globalThis.window.location?.pathname?.match(/^\\/admin\\/receiving\\/(\\d+)$/)?.[1]});'
        : 'export const receivingAdminAPI = globalThis.__mocks.api; export const receivingIssuesAPI = globalThis.__mocks.api; export const receivingFollowupsAPI = globalThis.__mocks.api; export const receivingDocumentsAPI = globalThis.__mocks.api; export const productsAPI = { getProducts: async params => globalThis.__mocks.api.getProducts ? globalThis.__mocks.api.getProducts(params) : ({data: []}) }; export const masterAPI = { getBranches: async () => [], getDepartmentsByBranch: async () => [] };' }));
      builder.onResolve({ filter: /\.css$|\.svg|\.webp$|\.png$/ }, (args) => ({ path: args.path, namespace: 'asset' }));
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
    visited = new Set();
    const visit = (node, path = 'root') => {
      if (node == null || node === false) return null;
      if (Array.isArray(node)) return node.map((child, index) => visit(child, `${path}.${child?.key ?? index}`));
      if (typeof node !== 'object') return node;
      if (node.type?.receivingContext) {
        const context = node.type.receivingContext, previous = context.value;
        context.value = node.props.value;
        const output = visit(node.props.children, path);
        context.value = previous;
        return output;
      }
      if (typeof node.type === 'function') {
        const parent = current; current = { path: `${path}.${node.type.name}${node.key == null ? '' : `:${node.key}`}`, index: 0 };
        const output = node.type(node.props); current = parent;
        return visit(output, `${path}.${node.type.name}${node.key == null ? '' : `:${node.key}`}`);
      }
      if (node.props.ref) node.props.ref.current = {
        open: false, showModal() { this.open = true; }, close() { this.open = false; }, click() {},
        width: 760, height: 240, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 380, height: 120 }),
        getContext: () => ({ beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {} }), toDataURL: () => 'synthetic-signature',
      };
      return { ...node, props: { ...node.props, children: visit(node.props.children, `${path}.children`) } };
    };
    const result = visit(jsx(Component, props));
    for (const [key, record] of effectRecords) {
      if (!visited.has(key)) { record.cleanup?.(); effectRecords.delete(key); }
    }
    for (const key of states.keys()) if (!visited.has(key)) { states.delete(key); setters.delete(key); }
    return result;
  };
  let tree;
  const focused = [];
  const scrolled = [];
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
  const acceptAi = async title => { await click(`แก้ ${title}`); await click('ใช้ AI รายการนี้'); };
  const select = async (label, value) => { const field = find((node) => node.type === 'label' && text(node).startsWith(label)); const input = field.props.htmlFor ? find((node) => node.props.id === field.props.htmlFor) : all(field).find((node) => ['input', 'select', 'textarea'].includes(node.type)); assert.ok(input, label); input.props.onChange({ target: { value } }); await settle(); };
  const radio = async (value) => { find((node) => node.type === 'input' && node.props.type === 'radio' && node.props.value === value).props.onChange(); await settle(); };
  const budget = () => {
    // Concept A has explicit row actions and four stage tabs. Its footer owns
    // one primary; row decisions intentionally do not share the legacy 1+2 budget.
    if (activeNodes().some(node => node.props.className?.includes('ra-document'))) {
      const footers = activeNodes().filter(node => node.type === 'footer' && node.props.className === 'ra-footer');
      for (const footer of footers) assert.equal(all(footer).filter(node => node.type === 'button' && node.props.className?.includes('sg-primary')).length, 1);
      return;
    }

    const dialogs = all().filter((node) => node.type === 'dialog');
    const active = dialogs.at(-1) || tree;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(walk);
      if (node.props.hidden) return [];
      return [node, ...walk(node.props.children)];
    };
    const contentControls = walk(active).filter(node => node.type === 'button' && /\brc-(document-card|review-trigger|check-row|text-action)\b/.test(node.props.className || ''));
    for (const control of contentControls) {
      assert.equal(control.props.type, 'button');
      assert.equal(typeof control.props.onClick, 'function');
      assert.ok(text(control) || control.props['aria-label'], 'content navigation has an accessible name');
      assert.ok(!control.props.className.includes('sg-primary'), 'content navigation never competes with primary');
    }
    // Ledger row/filter/undo controls are content interactions. Bulk actions
    // have their own explicit three-action budget; the workflow keeps 1+2.
    const bulk = walk(active).find(node => node.props['aria-label'] === 'จัดการรายการที่เลือก');
    if (bulk) assert.equal(walk(bulk).filter(node => node.type === 'button').length, 3);
    // Card navigation and the warning disclosure are content interactions.
    // Keep the existing one-primary/two-secondary budget for workflow actions.
    const buttons = walk(active).filter((node) => !contentControls.includes(node) && (node.type === 'button' || (node.type === 'a' && node.props.to)));
    const primary = buttons.filter((node) => node.props.className?.includes('sg-primary'));
    assert.ok(primary.length <= 1, `${primary.length} primary actions`);
    assert.ok(buttons.length - primary.length <= 2, `${buttons.length - primary.length} secondary actions`);
  };
  const unmount = () => { for (const record of effectRecords.values()) record.cleanup?.(); effectRecords.clear(); states.clear(); setters.clear(); tree = null; mounted.delete(unmount); };
  mounted.add(unmount);
  await settle();
  return { document: browserDocument, events, dispatch, unmount, focused, scrolled, opened, storage, calls, click, acceptAi, select, radio, find, all, visible: activeNodes, text, budget, settle, api };
}

// Inline signature pads only take ink inside the signing sheet, so tests open it first.
export const armPad = async (h, index = 0) => {
  // Index 0 is the required receiver pad even though the optional courier pad is rendered first.
  const pads = h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('แตะเพื่อเซ็น'));
  const open = [...pads.filter(n => n.props['data-role'] !== 'courier'), ...pads.filter(n => n.props['data-role'] === 'courier')][index];
  assert.ok(open, 'signature open button');
  await open.props.onClick(); await h.settle();
};
