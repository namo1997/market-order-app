import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLeaveGuard } from '../src/receiving-app/leave-guard.mjs';
import { connectShellTheme, resolvedTheme } from '../src/receiving-app/shell-theme.mjs';
import { themePreferenceKey } from '../src/design/theme-preference.js';
import { harness } from './receiving-harness.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const type of ['logout', 'server', 'settings', 'exit']) {
  test(`shell guard: dirty ${type} has no effects until discard; stay preserves data`, async () => {
    const prompts = [], exits = [];
    const guard = createLeaveGuard({ onPrompt: value => prompts.push(value), onLeave: value => exits.push(value) });
    guard.setDirty(true);
    await guard.request({ type });
    assert.deepEqual(exits, []); assert.equal(prompts.at(-1).type, type);
    guard.stay(); assert.equal(guard.isDirty(), true); assert.equal(prompts.at(-1), null);
    await guard.discard(); assert.deepEqual(exits, []);
    await guard.request({ type }); await guard.discard();
    assert.deepEqual(exits, [{ type }]); assert.equal(guard.isDirty(), false);
  });
}
test('shell guard: clean exits immediately; simultaneous requests/discards execute once', async () => {
  const pending = deferred(); let count = 0;
  const guard = createLeaveGuard({ onPrompt() {}, onLeave: async () => { count++; await pending.promise; } });
  guard.setDirty(true); await guard.request({ type: 'logout' });
  const first = guard.discard(); await guard.discard(); await guard.request({ type: 'server' });
  assert.equal(count, 1); pending.resolve(); await first;
  await guard.request({ type: 'exit' }); assert.equal(count, 2);
});
test('shell guard: failed exit retains dirty state and pending confirmation for retry', async () => {
  let fail = true;
  const guard = createLeaveGuard({ onPrompt() {}, onLeave() { if (fail) throw Error('mock failure'); } });
  guard.setDirty(true); await guard.request({ type: 'server' });
  await assert.rejects(guard.discard()); assert.equal(guard.isDirty(), true);
  fail = false; await guard.discard(); assert.equal(guard.isDirty(), false);
});

function themeSurfaces(preference = 'auto', dark = false) {
  const values = new Map([[themePreferenceKey, preference]]), events = {}, mediaEvents = {};
  const root = { dataset: {}, classList: { add() {} } }, meta = {};
  let observe, disconnected = false;
  const media = { matches: dark, addEventListener: (key, fn) => { mediaEvents[key] = fn; }, removeEventListener: key => { delete mediaEvents[key]; } };
  const document = { documentElement: root, querySelector: () => meta, activeElement: { focus() {} } };
  const window = {
    matchMedia: () => media,
    addEventListener: (key, fn) => { events[key] = fn; }, removeEventListener: key => { delete events[key]; },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() { disconnected = true; } },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
  };
  return { window, document, storage: window.localStorage, root, meta, events, media, mediaEvents, values,
    mutate: records => observe(records), disconnected: () => disconnected };
}
for (const systemDark of [false, true]) for (const preference of ['auto', 'light', 'dark']) {
  test(`shell theme: ${preference} on system ${systemDark ? 'dark' : 'light'} controls root and native bars`, () => {
    const surfaces = themeSurfaces(preference, systemDark), themes = [];
    const controller = connectShellTheme({ ...surfaces, onTheme: theme => themes.push(theme) });
    const expected = resolvedTheme(preference, systemDark);
    assert.equal(surfaces.root.dataset.theme, preference);
    assert.equal(themes.at(-1), expected);
    assert.equal(surfaces.meta.content, expected === 'dark' ? '#101522' : '#f7f5f0');
    controller.set('light'); assert.equal(surfaces.values.get(themePreferenceKey), 'light'); assert.equal(themes.at(-1), 'light');
    controller.destroy(); assert.equal(surfaces.disconnected(), true); assert.deepEqual(surfaces.events, {}); assert.deepEqual(surfaces.mediaEvents, {});
  });
}
test('shell theme: OS, storage, root and pre-merge page changes synchronize without reload', () => {
  const s = themeSurfaces(), themes = [];
  connectShellTheme({ ...s, onTheme: value => themes.push(value) });
  s.media.matches = true; s.mediaEvents.change(); assert.equal(themes.at(-1), 'dark');
  s.root.dataset.theme = 'light'; s.mutate([{ target: s.root }]); assert.equal(themes.at(-1), 'light');
  s.values.set(themePreferenceKey, 'dark'); s.events.storage({ key: themePreferenceKey }); assert.equal(themes.at(-1), 'dark');
  s.values.set(themePreferenceKey, 'light'); s.mutate([{ target: {} }]); assert.equal(s.root.dataset.theme, 'light');
});
test('shell theme: blocked preference storage still keeps the selected root/menu/native appearance', () => {
  const s = themeSurfaces(), calls = [];
  const controller = connectShellTheme({ ...s, storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    onTheme: (appearance, preference) => calls.push([appearance, preference]) });
  controller.set('dark');
  assert.equal(s.root.dataset.theme, 'dark'); assert.deepEqual(calls.at(-1), ['dark', 'dark']);
});

async function openShell({ reportsDirty = true, signOut = async () => {}, realReceiving = false, apiOverrides = {}, stored, autoLogin = true, authStatus = 200 } = {}) {
  const s = themeSurfaces(), calls = [], preferences = stored || new Map([['receiving.apiBaseUrl', 'https://mock.test']]);
  let page, unauthorized = false;
  const shell = {
    realReceiving,
    Preferences: { get: async ({ key }) => ({ value: preferences.get(key) }), set: async ({ key, value }) => { calls.push([key === 'receiving.apiBaseUrl' ? 'preference' : 'session', value]); preferences.set(key, value); }, remove: async ({ key }) => { preferences.delete(key); } },
    Network: { getStatus: async () => ({ connected: true }), addListener: async () => ({ remove() {} }) },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true },
    alerts: { ensureAlertPermission: async () => { calls.push(['alertPermission']); return { granted: true }; }, notifyUrgent: async data => { calls.push(['alert', data]); }, cancelAlert: async data => { calls.push(['cancelAlert', data]); } },
    CapacitorHttp: { request: async options => {
      calls.push(['http', options]);
      if (unauthorized || (options.url.endsWith('/auth/me') && authStatus !== 200)) return { status: authStatus !== 200 ? authStatus : 401, data: { code: 'UNAUTHORIZED' } };
      if (options.url.endsWith('/auth/me')) return { status: 200, data: { success: true, data: { id: 7, branch: 'สาขา A', department: 'ครัว', role: 'user' } } };
      const data = options.url.endsWith('/branches') ? [{ id: 1, name: 'สาขา A' }]
        : options.url.includes('/departments/') ? [{ id: 10, name: 'ครัว' }]
        : { token: 'mock-session', user: { id: 7, branch: 'สาขา A', department: 'ครัว', role: 'user', branch_id: 1, department_id: 10, name: 'ผู้รับทดสอบ' } };
      return { status: 200, data: { success: true, data } };
    } },
    signInGoogle: async () => 'mock-id', signOutGoogle: async () => { calls.push(['signOut']); await signOut(); },
    exitReceivingApp: async () => { calls.push(['exit']); }, setBackHandlerReady: async ready => { calls.push(['backReady', ready]); }, setSystemTheme: async theme => { calls.push(['theme', theme]); },
    page: props => { page = props; },
  };
  const h = await harness('ReceivingApp', {}, apiOverrides, {}, s.window, { __shell: shell, document: s.document,
    fetch: () => { throw Error('Shell tests must use the mocked native transport'); }, URLSearchParams }, null, '../src/receiving-app/ReceivingApp.jsx');
  s.document.getElementById = id => h.all().some(node => node.props.id === id)
    ? { closest: () => null, focus: () => calls.push(['focus', id]), scrollIntoView() {} } : null;
  if (autoLogin) {
    await h.select('สาขา', '1'); await h.select('แผนก', '10');
    await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  } else await h.settle();
  if (!realReceiving && page) {
    assert.equal(page.chrome, 'embedded'); assert.equal(typeof page.onDirtyChange, 'function');
    if (reportsDirty) page.onDirtyChange(false);
  }
  return { ...h, ...s, calls, preferences, dirty: value => page.onDirtyChange(value), page: () => page, apiClient: () => shell.client, unauthorized: () => { unauthorized = true; } };
}
const hasLeave = h => h.all().some(node => node.props.id === 'apk-leave-title');
const count = (h, type) => h.calls.filter(call => call[0] === type).length;

test('shell integration: logout asks, stay keeps editor mounted, discard clears session only once', async () => {
  const h = await openShell(); h.dirty(true);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'signOut'), 0); assert.ok(h.page());
  await h.click('อยู่ต่อ'); assert.equal(hasLeave(h), false); assert.equal(count(h, 'signOut'), 0);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ'); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'signOut'), 1); assert.equal(hasLeave(h), false);
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เข้าใช้งาน'));
});
test('shell integration: dirty server changes keep origin/session until explicit discard; invalid URL never persists', async () => {
  const h = await openShell(); h.dirty(true);
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API'); assert.ok(hasLeave(h));
  assert.equal(count(h, 'preference'), 0); await h.click('อยู่ต่อ');
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API'); await h.click('ทิ้งและออก');
  await h.select('ที่อยู่ API', 'https://new.test/api');
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(count(h, 'preference'), 0); assert.equal(count(h, 'signOut'), 0);
  // Simulate a page reporting new pending work while server settings are open.
  h.dirty(true); await h.select('ที่อยู่ API', 'https://new.test');
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(h.preferences.get('receiving.apiBaseUrl'), 'https://mock.test');
  await h.click('ทิ้งและออก'); assert.equal(h.preferences.get('receiving.apiBaseUrl'), 'https://new.test'); assert.equal(count(h, 'signOut'), 1);
});
test('shell integration: Android Back shares guard, repeated Back stays, clean Back exits', async () => {
  const h = await openShell(); h.dirty(true);
  h.events.receivingBack(); await h.settle(); assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0);
  h.events.receivingBack(); await h.settle(); assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 0);
  h.events.receivingBack(); await h.settle(); await h.click('ทิ้งและออก'); assert.equal(count(h, 'exit'), 1);
  h.dirty(false); h.events.receivingBack(); await h.settle(); assert.equal(count(h, 'exit'), 2);
});
test('shell integration: pre-merge page without callback still asks before leaving; beforeunload warns', async () => {
  const h = await openShell({ reportsDirty: false });
  const event = { preventDefault() { this.prevented = true; } };
  h.events.beforeunload(event); assert.equal(event.prevented, true); assert.equal(event.returnValue, '');
  h.events.receivingBack(); await h.settle(); assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0);
});
test('shell integration: native Back closes secondary menu/settings before considering app exit', async () => {
  const h = await openShell();
  await h.click('เมนูแอป'); h.events.receivingBack(); await h.settle(); assert.equal(count(h, 'exit'), 0);
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API'); h.events.receivingBack(); await h.settle();
  assert.equal(count(h, 'exit'), 0); assert.ok(h.all().some(node => node.props['aria-label'] === 'เมนูแอป'));
  h.events.receivingBack(); await h.settle(); assert.ok(hasLeave(h)); // Pre-merge remount is conservative again.
});
test('shell integration: in-flight discard cannot be duplicated or cancelled by Android Back', async () => {
  const pending = deferred();
  const h = await openShell({ signOut: () => pending.promise }); h.dirty(true);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  const work = h.find(node => node.type === 'button' && h.text(node) === 'ทิ้งและออก').props.onClick();
  await h.settle(); h.events.receivingBack(); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(count(h, 'signOut'), 1);
  assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'อยู่ต่อ').props.disabled);
  pending.resolve(); await work; await h.settle(); assert.equal(hasLeave(h), false);
});
test('shell integration: expired auth does not unmount unsent work or sign out automatically', async () => {
  const h = await openShell(); h.dirty(true); const original = h.page();
  h.unauthorized();
  await assert.rejects(h.apiClient().get('/receiving-documents/1'), error => error.status === 401);
  await h.settle();
  assert.equal(h.page().onDirtyChange, original.onDirtyChange);
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));
  assert.equal(count(h, 'signOut'), 0);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'signOut'), 0);
});

test('Android source: runtime system bars, protected Back and valid APK version remain wired after shrinking', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const activity = await read('../android/app/src/main/java/th/co/solao/receiving/MainActivity.java');
  assert.match(activity, /registerPlugin\(ReceivingShellPlugin.class\)/);
  assert.match(activity, /setAppearanceLightStatusBars\(!dark\)/); assert.match(activity, /setAppearanceLightNavigationBars\(!dark\)/);
  assert.match(activity, /triggerWindowJSEvent\("receivingBack"\)/); assert.match(activity, /setNegativeButton\("อยู่ต่อ"/);
  assert.match(activity, /setPositiveButton\("ทิ้งและออก"/);
  assert.match(activity, /onConfigurationChanged\(Configuration configuration\)/);
  assert.match(activity, /WindowInsetsCompat.Type.systemBars\(\) \| WindowInsetsCompat.Type.displayCutout\(\)/);
  assert.match(activity, /ViewCompat.requestApplyInsets/);
  const gradle = await read('../android/app/build.gradle');
  const defaultConfig = gradle.match(/\bdefaultConfig\s*\{([^}]+)\}/)?.[1];
  assert.ok(defaultConfig, 'APK version must be declared in defaultConfig');
  const codes = [...defaultConfig.matchAll(/^\s*versionCode\s+([1-9]\d*)\s*$/gm)];
  const names = [...defaultConfig.matchAll(/^\s*versionName\s+"((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-debug)"\s*$/gm)];
  assert.equal(codes.length, 1, 'Declare one positive integer versionCode');
  assert.equal(names.length, 1, 'Declare one major.minor.patch-debug versionName');
  assert.ok(Number(codes[0][1]) <= 2100000000, 'versionCode must fit the Android limit');
  assert.equal(Number(codes[0][1]), 16);
  assert.equal(names[0][1], '0.6.7-debug');
  const shell = await read('../src/receiving-app/ReceivingApp.jsx');
  assert.ok(shell.includes(`รุ่น ${names[0][1]} (${codes[0][1]})`), 'About menu must match APK metadata');
  const css = await read('../src/receiving-app/style.css'); assert.match(css, /@import '\.\.\/design\/tokens.css'/);
  assert.doesNotMatch(css, /prefers-color-scheme/); assert.match(css, /var\(--sg-space-4\) \* 2/);
});


const draftDocument = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0',
  lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', unit_price: '10' }] });
async function createRealEditor(apiOverrides = {}) {
  const h = await openShell({ realReceiving: true, apiOverrides: { create: async () => draftDocument(), ...apiOverrides } });
  await h.click('เริ่มรับร้านนี้'); await h.select('ผู้ส่งของ', 'ร้านทดสอบ');
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  await h.radio('lines');
  // The clean fixture is hidden by the default needs-review filter.
  await h.click('ทั้งหมด');
  return h;
}
test('shell real page: embedded shows one heading/scope and clean callback permits Android Back', async () => {
  const h = await openShell({ realReceiving: true });
  assert.equal(h.all().filter(node => node.type === 'h1' && h.text(node) === 'รับสินค้า').length, 1);
  assert.equal(h.all().filter(node => node.props.className === 'rc-topbar').length, 0);
  assert.equal(h.all().filter(node => node.props.className === 'apk-scope').length, 1);
  assert.ok(h.all().some(node => node.props.className?.includes('rc-app')));
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});
test('shell real page: B home queue selects capture context without dirtying or writing; menu shows APK version', async () => {
  const groups = ['ร้านแรก', 'ร้านถัดไป'].map((supplier_name, index) => ({ supplier_key: `pg:${index + 1}`, supplier_name,
    items: [{ order_item_id: index + 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' }] }));
  const creates = [];
  const h = await openShell({ realReceiving: true, apiOverrides: { expected: async () => groups, create: async body => { creates.push(body); return draftDocument(); } } });
  await h.click('เลือกร้าน ร้านถัดไป');
  assert.equal(creates.length, 0);
  await h.click('เมนูแอป'); assert.match(h.text(h.all()), /รุ่น 0\.6\.7-debug \(16\)/); await h.click('ปิดเมนู');
  await h.click('เริ่มรับร้านนี้');
  assert.equal(h.find(node => node.type === 'input' && node.props.maxLength === 255).props.value, 'ร้านถัดไป');
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(creates.length, 1); assert.equal(creates[0].product_group_id, 2); assert.deepEqual(Array.from(creates[0].order_item_ids), [43]);
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});
test('shell real page: new signature step guards unsaved receiver ink and stay preserves the editor', async () => {
  const h = await createRealEditor();
  await h.radio('sign');
  const pad = h.find(node => node.type === 'canvas');
  pad.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  pad.props.onPointerUp(); await h.settle();
  h.events.receivingBack(); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0);
  await h.click('อยู่ต่อ'); assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'บันทึกเซ็น').props.disabled, false);
  h.events.receivingBack(); await h.settle(); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'exit'), 1); assert.equal(hasLeave(h), false);
  h.unmount();
});
test('shell real page: create edits drive Android Back guard; stay preserves input and discard exits once', async () => {
  const h = await openShell({ realReceiving: true });
  await h.radio('documents'); await h.click('เริ่มรับสินค้า'); await h.select('ผู้ส่งของ', 'ข้อมูลที่ยังไม่ส่ง');
  h.events.receivingBack(); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0);
  await h.click('อยู่ต่อ');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === 'ข้อมูลที่ยังไม่ส่ง').props.value, 'ข้อมูลที่ยังไม่ส่ง');
  h.events.receivingBack(); await h.settle(); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'exit'), 1); assert.equal(hasLeave(h), false);
  h.unmount();
});
test('shell real page: quantity edits protect API settings; discard and remount report clean again', async () => {
  const h = await createRealEditor();
  await h.select('รับจริง ผัก', '1.5');
  assert.deepEqual(h.calls.find(call => call[0] === 'focus'), ['focus', 'line-0-inline']);
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'preference'), 0);
  await h.click('อยู่ต่อ');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.5').props.value, '1.5');
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API'); await h.click('ทิ้งและออก');
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'signOut'), 0);
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เชื่อมต่อเซิร์ฟเวอร์'));
  await h.click('กลับ'); h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});
test('shell real page: pending save remains guarded; successful save clears actual editor dirty state', async () => {
  const request = deferred(), updates = [];
  const h = await createRealEditor({ update: (id, body) => { updates.push({ id, body }); return request.promise; } });
  await h.select('รับจริง ผัก', '1.5'); await h.click('บันทึกและตรวจถัดไป');
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'save');
  const saving = h.find(node => node.type === 'button' && h.text(node) === 'เลือก').props.onClick(); await h.settle();
  assert.equal(updates.length, 1); assert.equal(updates[0].id, 5);
  assert.equal(updates[0].body.lines[0].quantity_received, '1.50');
  h.events.receivingBack(); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0); await h.click('อยู่ต่อ');
  const saved = draftDocument(); saved.lines[0].quantity_received = '1.5'; request.resolve(saved);
  await saving; await h.settle();
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});


test('shell real page: unsaved quantity drives logout guard and stay preserves editor data', async () => {
  const h = await createRealEditor(); await h.select('รับจริง ผัก', '1.5');
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'signOut'), 0);
  await h.click('อยู่ต่อ');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.5').props.value, '1.5');
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ'); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'signOut'), 1); assert.equal(hasLeave(h), false);
  assert.equal(h.all().some(node => node.props.className?.includes('rc-app')), false);
  h.unmount();
});


test('shell integration: test urgent sound menu sends chosen sample and acknowledge cancels same id', async () => {
  const h = await openShell();
  await h.click('เมนูแอป'); await h.click('ทดสอบเสียงเตือน');
  const posted = h.calls.find(call => call[0] === 'alert')[1];
  assert.equal(posted.body, 'เจ๊แววไก่สด ยังไม่ส่ง ขา B 10 กก.');
  assert.equal(posted.title, 'เรื่องด่วนรับสินค้า');
  await h.click('รับทราบ / หยุดเสียงเตือน');
  assert.equal(h.calls.find(call => call[0] === 'cancelAlert')[1].id, posted.id);
  h.unmount();
});

test('shell integration: 401 on a clean page returns to login and clears stored session', async () => {
  const h = await openShell();
  assert.ok(h.preferences.has('receiving.session.v1'));
  h.unauthorized(); await assert.rejects(h.apiClient().get('/receiving-documents/1'));
  await h.settle();
  assert.equal(h.preferences.has('receiving.session.v1'), false);
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เข้าใช้งาน'));
  h.unmount();
});


test('shell integration: a new shell restores Preferences and skips login after process restart', async () => {
  const token = `fixture.${Buffer.from(JSON.stringify({exp:4102444800})).toString('base64url')}.fixture`;
  const stored = new Map([['receiving.apiBaseUrl','https://mock.test'],['receiving.session.v1', JSON.stringify({origin:'https://mock.test',token,user:{id:7,branch:'เก่า',department:'เก่า',role:'user'}})]]);
  const h = await openShell({stored,autoLogin:false});
  assert.ok(h.page()); assert.ok(h.apiClient());
  assert.ok(h.text(h.all()).includes('สาขา A / ครัว'));
  assert.equal(h.calls.filter(call=>call[0]==='http' && call[1].method==='POST').length,0);
  assert.equal(h.calls.find(call=>call[0]==='http')[1].headers.Authorization, `Bearer ${token}`);
  h.unmount();
});
for (const expired of [false,true]) {
  test(`shell integration: ${expired ? 'expired JWT' : 'server 401'} on restart displays login`, async () => {
    const token = `fixture.${Buffer.from(JSON.stringify({exp:expired ? 1 : 4102444800})).toString('base64url')}.fixture`;
    const stored = new Map([['receiving.apiBaseUrl','https://mock.test'],['receiving.session.v1', JSON.stringify({origin:'https://mock.test',token,user:{id:7}})]]);
    const h = await openShell({stored,autoLogin:false,authStatus:401});
    assert.ok(h.all().some(node=>node.type==='h2' && h.text(node)==='เข้าใช้งาน'));
    assert.equal(stored.has('receiving.session.v1'),false);
    assert.equal(Boolean(h.page()),false);
    h.unmount();
  });
}
