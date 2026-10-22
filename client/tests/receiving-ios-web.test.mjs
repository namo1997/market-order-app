import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { installHintKey, isReceivingPath, receivingThemeColor, shouldShowInstallHint, dismissInstallHint } from '../src/pages/receiving/receiving-web-app.js';
import { compressImage, MAX_SOURCE_BYTES } from '../src/pages/receiving/image-utils.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ios = { userAgent: safari, maxTouchPoints: 5 };
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
};
const browser = () => {
  const media = new Map();
  return { location: { pathname: '/receiving' }, localStorage: storage(), matchMedia(query) {
    if (!media.has(query)) {
      const listeners = new Set();
      media.set(query, { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
        change(value) { this.matches = value; listeners.forEach(fn => fn({ type: 'change' })); }, listeners });
    }
    return media.get(query);
  } };
};
// Minimal head surface: exercise real runtime effects without claiming a Safari device test.
function documentHead() {
  const nodes = [];
  const doc = { documentElement: { dataset: {} }, createElement(tag) {
    const attributes = new Map();
    return { tagName: tag, attributes, getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => attributes.set(key, value), remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); } };
  } };
  doc.head = { appendChild(node) { nodes.push(node); }, querySelectorAll(selector) {
    const [, tag, key, value] = selector.match(/^(\w+)\[(\w+)="([^"]+)"\]$/);
    return nodes.filter(node => node.tagName === tag && node.getAttribute(key) === value);
  } };
  const add = (tag, attrs) => { const node = doc.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); doc.head.appendChild(node); return node; };
  add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  add('link', { rel: 'apple-touch-icon', href: '/vite.svg' });
  add('link', { rel: 'icon', href: '/vite.svg', type: 'image/svg+xml' });
  add('meta', { name: 'theme-color', content: '#6d28d9' });
  add('meta', { name: 'theme-color', content: '#222222', media: '(prefers-color-scheme: dark)' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'SOLAO' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  add('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0, viewport-fit=cover' });
  return { doc, nodes, snapshot: () => nodes.map(node => [node.tagName, [...node.attributes]]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}
const meta = (doc, name) => doc.head.querySelectorAll(`meta[name="${name}"]`)[0]?.getAttribute('content');
const href = (doc, rel) => doc.head.querySelectorAll(`link[rel="${rel}"]`)[0]?.getAttribute('href');

test('iOS web: real route effect swaps head, restores exact original tags, handles re-entry and unmount', async () => {
  const win = browser(), head = documentHead(), original = head.snapshot();
  win.location.pathname = '/order';
  const h = await harness('ReceivingWebAppHead', {}, {}, {}, win, { document: head.doc });
  assert.deepEqual(head.snapshot(), original);
  win.location.pathname = '/receiving'; await h.settle();
  assert.equal(href(head.doc, 'manifest'), '/receiving.webmanifest');
  assert.equal(href(head.doc, 'apple-touch-icon'), '/receiving-icons/apple-touch-icon.png');
  assert.equal(meta(head.doc, 'apple-mobile-web-app-title'), 'รับสินค้า');
  assert.equal(meta(head.doc, 'apple-mobile-web-app-capable'), 'yes');
  assert.equal(meta(head.doc, 'mobile-web-app-capable'), 'yes');
  assert.equal(head.doc.head.querySelectorAll('meta[name="theme-color"]').length, 1);
  for (const path of ['/order', '/apps', '/receiving-other', '/order/receive']) {
    win.location.pathname = path; await h.settle(); assert.deepEqual(head.snapshot(), original);
    win.location.pathname = '/receiving/'; await h.settle(); assert.equal(href(head.doc, 'manifest'), '/receiving.webmanifest');
  }
  h.unmount(); assert.deepEqual(head.snapshot(), original);
  assert.equal(win.matchMedia('(prefers-color-scheme: dark)').listeners.size, 0);
  assert.equal(h.events.get('solao:theme-change').size, 0);
});

test('iOS web: theme and readable status-bar follow explicit light/dark, system auto and storage changes', async () => {
  const win = browser(), { doc } = documentHead();
  const h = await harness('ReceivingWebAppHead', {}, {}, {}, win, { document: doc });
  assert.equal(meta(doc, 'theme-color'), '#f7f5f0'); assert.equal(meta(doc, 'apple-mobile-web-app-status-bar-style'), 'default');
  win.matchMedia('(prefers-color-scheme: dark)').change(true);
  // Owner 2026-10-22: light by default, so a dark phone keeps the light bar until the person picks auto/dark.
  assert.equal(meta(doc, 'theme-color'), '#f7f5f0'); assert.equal(meta(doc, 'apple-mobile-web-app-status-bar-style'), 'default');
  doc.documentElement.dataset.theme = 'light'; h.dispatch({ type: 'solao:theme-change', detail: 'light' });
  assert.equal(meta(doc, 'theme-color'), '#f7f5f0');
  h.dispatch({ type: 'solao:theme-change', detail: 'dark' }); assert.equal(meta(doc, 'theme-color'), '#101522');
  win.localStorage.setItem('solao.receiving.theme.v1', 'auto'); h.dispatch({ type: 'storage' });
  assert.equal(meta(doc, 'theme-color'), '#101522');
  doc.documentElement.dataset.theme = 'auto'; win.matchMedia('(prefers-color-scheme: dark)').change(false);
  assert.equal(meta(doc, 'theme-color'), '#f7f5f0'); h.unmount();
  assert.equal(receivingThemeColor('dark', false), '#101522');
  assert.equal(receivingThemeColor('light', true), '#f7f5f0');
});

test('iOS web: head owner is outside lazy/auth page and only receiving path matches', async () => {
  const app = await read('../src/App.jsx');
  assert.ok(app.indexOf('<ReceivingWebAppHead />') < app.indexOf('<Suspense'));
  for (const path of ['/receiving', '/receiving/']) assert.equal(isReceivingPath(path), true);
  for (const path of ['/order', '/receiving-other', '/receiving/123', undefined]) assert.equal(isReceivingPath(path), false);
});

test('iOS web: manifest identity, isolated scope, SOLAO colors and actual PNG sizes', async () => {
  const manifest = JSON.parse(await read('../public/receiving.webmanifest'));
  assert.equal(manifest.name, 'รับสินค้า โซลาว'); assert.equal(manifest.short_name, 'รับสินค้า');
  for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], '/receiving');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#1e3168'); assert.equal(manifest.background_color, '#f7f5f0');
  assert.deepEqual(manifest.icons.map(icon => [icon.sizes, icon.purpose]), [['192x192','any'], ['512x512','any'], ['512x512','maskable']]);
  for (const icon of [...manifest.icons, { src: '/receiving-icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]) {
    assert.equal(icon.type, 'image/png');
    const png = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

test('iOS web: hint is exclusive to Safari on iPhone/iPad, outside standalone and APK', () => {
  const win = browser(); assert.equal(shouldShowInstallHint(win, ios, win.localStorage), true);
  for (const userAgent of [safari.replace('Version/18.0', 'CriOS/129.0'), safari.replace('Version/18.0', 'FxiOS/130.0'), safari + ' EdgiOS/129.0', safari + ' Line/14.0', safari.replace('Version/18.0 ', ''), 'Mozilla/5.0 Android Chrome/129 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15']) {
    assert.equal(shouldShowInstallHint(win, { userAgent }, win.localStorage), false, userAgent);
  }
  assert.equal(shouldShowInstallHint(win, { ...ios, userAgent: safari.replace('iPhone', 'iPad') }, win.localStorage), true);
  assert.equal(shouldShowInstallHint(win, { ...ios, userAgent: safari.replace('iPhone', 'Macintosh') }, win.localStorage), true);
  assert.equal(shouldShowInstallHint(win, { ...ios, standalone: true }, win.localStorage), false);
  win.matchMedia('(display-mode: standalone)').change(true); assert.equal(shouldShowInstallHint(win, ios, win.localStorage), false);
  win.matchMedia('(display-mode: standalone)').change(false);
  win.Capacitor = { isNativePlatform: () => true }; assert.equal(shouldShowInstallHint(win, ios, win.localStorage), false);
  delete win.Capacitor; win.location.pathname = '/order'; assert.equal(shouldShowInstallHint(win, ios, win.localStorage), false);
});

test('iOS web: hint close persists across real component remounts; standalone change hides it', async () => {
  const win = browser();
  const h = await harness('ReceivingInstallHint', {}, {}, {}, win, { navigator: ios });
  assert.ok(h.visible().some(node => node.type === 'aside'));
  assert.ok(h.all().some(node => h.text(node) === 'แตะ แชร์ → เพิ่มไปยังหน้าจอโฮม'));
  await h.click('ปิดคำแนะนำติดตั้ง'); assert.equal(h.visible().length, 0);
  assert.equal(win.localStorage.getItem(installHintKey), 'dismissed'); h.unmount();
  const again = await harness('ReceivingInstallHint', {}, {}, {}, win, { navigator: ios });
  assert.equal(again.visible().length, 0); again.unmount();
  const fresh = browser(), live = await harness('ReceivingInstallHint', {}, {}, {}, fresh, { navigator: ios });
  fresh.matchMedia('(display-mode: standalone)').change(true); await live.settle();
  assert.equal(live.visible().length, 0); live.unmount();
  assert.equal(fresh.matchMedia('(display-mode: standalone)').listeners.size, 0);
});

test('iOS web: denied storage still allows hint dismissal without crashing', async () => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const win = { ...browser(), localStorage: denied };
  assert.equal(shouldShowInstallHint(win, ios, denied), true); assert.doesNotThrow(() => dismissInstallHint(denied));
  const h = await harness('ReceivingInstallHint', {}, {}, {}, win, { navigator: ios });
  await h.click('ปิดคำแนะนำติดตั้ง'); assert.equal(h.visible().length, 0); h.unmount();
});

test('iOS web: scoped top/landscape insets, bottom bar clearance, >=16px controls and signature touch lock', async () => {
  const page = postcss.parse(await read('../src/pages/receiving/receiving.css'));
  const tokens = await read('../src/design/tokens.css'), shared = await read('../src/design/styles.css');
  let inset = {}, font, touch;
  page.walkRules(rule => {
    if (rule.selector === ".solao.rc-app[data-chrome='standalone']") rule.walkDecls(d => { inset[d.prop] = d.value; });
    if (rule.selector === '.solao.rc-app :is(input, select, textarea)') rule.walkDecls('font-size', d => { font = d.value; });
    if (rule.selector === '.solao .rc-signature canvas') rule.walkDecls('touch-action', d => { touch = d.value; });
  });
  for (const edge of ['top','left','right']) {
    assert.equal(inset[`padding-${edge}`], `var(--sg-safe-${edge})`);
    assert.ok(tokens.includes(`--sg-safe-${edge}: env(safe-area-inset-${edge}, 0px)`));
  }
  assert.equal(font, 'max(16px, 1rem)'); assert.equal(touch, 'none');
  assert.match(tokens, /--sg-safe-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(tokens, /--sg-bar-clearance: calc\(100px \+ var\(--sg-safe-bottom\)\)/);
  assert.match(shared, /bottom: calc\(var\(--sg-space-3\) \+ var\(--sg-safe-bottom\)\)/);
  assert.match(shared, /padding-bottom: var\(--sg-bar-clearance\)/);
  assert.match(await read('../index.html'), /viewport-fit=cover/);
  assert.doesNotMatch(await read('../index.html'), /user-scalable=no|maximum-scale=1/);
});

test('iOS web: existing camera capture input and touch pointer signature handlers remain usable', async () => {
  const h = await harness('ImagePages', { doc: { status: 'draft', images: [] }, pending: [], setPending() {}, setProcessing() {}, inputRef: { current: null } });
  const input = h.find(node => node.type === 'input' && node.props.type === 'file');
  assert.equal(input.props.accept, 'image/*'); assert.equal(input.props.capture, 'environment'); h.unmount();
  let saved;
  const pad = await harness('SignaturePad', { label: 'ผู้รับ', onSave: async value => { saved = value; return true; } });
  const canvas = pad.find(node => node.type === 'canvas'); let prevented = 0;
  canvas.props.onPointerDown({ pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10, preventDefault() { prevented++; } });
  canvas.props.onPointerMove({ pointerType: 'touch', pointerId: 3, clientX: 20, clientY: 20, preventDefault() { prevented++; } });
  canvas.props.onPointerUp(); await pad.settle(); await pad.click('บันทึกเซ็น');
  assert.equal(saved, 'synthetic-signature'); assert.ok(prevented >= 1); pad.unmount();
});

const heic = () => new Blob([new Uint8Array([0,0,0,24]), 'ftypheic', new Uint8Array(4), 'mif1heic'], { type: 'image/heic' });
function imageEnvironment(t, { bitmap = false, error = false } = {}) {
  const originals = new Map();
  const replace = (key, value) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  t.after(() => originals.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]));
  const calls = { encoded: [], urls: [], revoked: [], decoded: 0, closed: 0 };
  replace('createImageBitmap', bitmap ? async () => ({ width: 4000, height: 3000, close() { calls.closed++; } }) : async () => { throw Error('unsupported'); });
  replace('Image', class { naturalWidth = 4000; naturalHeight = 3000; set src(value) { calls.decoded++; if (error) this.onerror(); else this.onload(); } });
  replace('URL', { createObjectURL(file) { calls.urls.push(file); return 'blob:fixture'; }, revokeObjectURL(url) { calls.revoked.push(url); } });
  replace('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob(done, type, quality) { calls.encoded.push([this.width,this.height,type,quality]); done(new Blob([new Uint8Array([255,216,255])], { type })); } }) });
  replace('FileReader', class { readAsDataURL(blob) { this.result = `data:${blob.type};base64,/9j/`; this.onload(); } });
  return calls;
}

test('iOS web: HEIC native img fallback encodes bounded JPEG, releases object URL; regular JPEG stays supported', async t => {
  const calls = imageEnvironment(t);
  for (const file of [heic(), new Blob([new Uint8Array([255,216,255])], { type: 'image/jpeg' })]) {
    const result = await compressImage(file);
    assert.equal(result.blob.type, 'image/jpeg'); assert.match(result.dataUrl, /^data:image\/jpeg/);
  }
  assert.deepEqual(calls.encoded, [[2400,1800,'image/jpeg',.86], [2400,1800,'image/jpeg',.86]]);
  assert.equal(calls.decoded, 2); assert.equal(calls.revoked.length, 2);
});

test('iOS web: ImageBitmap JPEG path still closes bitmap and needs no object URL', async t => {
  const calls = imageEnvironment(t, { bitmap: true });
  await compressImage(new Blob([new Uint8Array([255,216,255])], { type: 'image/jpeg' }));
  assert.equal(calls.closed, 1); assert.equal(calls.urls.length, 0);
});

test('iOS web: HEIC spoof/MP4 and oversized source are rejected before decoding', async t => {
  const calls = imageEnvironment(t);
  await assert.rejects(compressImage({ size: MAX_SOURCE_BYTES + 1, type: 'image/heic', slice() { throw Error('must not read'); } }), /25 MB/);
  await assert.rejects(compressImage(new Blob(['fake'], { type: 'image/heic' })), /ไม่ใช่รูป/);
  await assert.rejects(compressImage(new Blob([new Uint8Array([0,0,0,24]),'ftypmp42',new Uint8Array(4),'mp42isom'], { type: 'image/heic' })), /ไม่ใช่รูป/);
  assert.equal(calls.decoded, 0); assert.equal(calls.encoded.length, 0);
});

test('iOS web: unsupported HEIC decode returns Thai guidance and releases URL without uploading', async t => {
  const calls = imageEnvironment(t, { error: true });
  await assert.rejects(compressImage(heic()), /JPG.*Safari 17/);
  assert.equal(calls.revoked.length, 1); assert.equal(calls.encoded.length, 0);
});
