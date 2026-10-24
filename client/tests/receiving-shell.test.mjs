import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLeaveGuard } from '../src/receiving-app/leave-guard.mjs';
import { connectShellTheme, resolvedTheme } from '../src/receiving-app/shell-theme.mjs';
import { themePreferenceKey } from '../src/design/theme-preference.js';
import { harness, armPad } from './receiving-harness.mjs';

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
    dispatchEvent: event => { events[event.type]?.(event); return true; },
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

async function openShell({ reportsDirty = true, signOut = async () => {}, realReceiving = false, apiOverrides = {}, stored, autoLogin = true, authStatus = 200, role = 'user', tapId = null } = {}) {
  const s = themeSurfaces(), calls = [], preferences = stored || new Map([['receiving.apiBaseUrl', 'https://mock.test']]);
  let page, unauthorized = false;
  const shell = {
    realReceiving,
    Preferences: { get: async ({ key }) => ({ value: preferences.get(key) }), set: async ({ key, value }) => { calls.push([key === 'receiving.apiBaseUrl' ? 'preference' : 'session', value]); preferences.set(key, value); }, remove: async ({ key }) => { preferences.delete(key); } },
    Network: { getStatus: async () => ({ connected: true }), addListener: async () => ({ remove() {} }) },
    App: { addListener: async (name, back) => { assert.equal(name, 'backButton'); s.events.capacitorBack = back; return { remove() { delete s.events.capacitorBack; calls.push(['appBackRemoved']); } }; } },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true },
    alerts: { ensureAlertPermission: async () => { calls.push(['alertPermission']); return { granted: true }; }, notifyUrgent: async data => { calls.push(['alert', data]); }, cancelAlert: async data => { calls.push(['cancelAlert', data]); },
      sync: async () => calls.push(['pushSync']), stop: async () => calls.push(['pushStop']),
      consumeTap: async () => { const id = tapId; tapId = null; return { followup_id: id }; } },
    CapacitorHttp: { request: async options => {
      calls.push(['http', options]);
      if ((unauthorized && !options.url.endsWith('/branches') && !options.url.includes('/departments/')) || (options.url.endsWith('/auth/me') && authStatus !== 200)) return { status: authStatus !== 200 ? authStatus : 401, data: { code: 'UNAUTHORIZED' } };
      if (options.url.includes('/receiving-push/followups/')) return { status: 200, data: { success: true, data: {
        id: 17, status: 'open', supplier_name: 'ร้านจากแจ้งเตือน', pending_items: [{ order_item_id: 42, product_name: 'ผัก', remaining_quantity: '2', unit_name: 'กก.' }] } } };
      if (options.url.endsWith('/auth/me')) return { status: 200, data: { success: true, data: { id: 7, branch: 'สาขา A', department: 'ครัว', role } } };
      const data = options.url.endsWith('/branches') ? [{ id: 1, name: 'สาขา A' }]
        : options.url.includes('/departments/') ? [{ id: 10, name: 'ครัว' }]
        : { token: 'mock-session', user: { id: 7, branch: 'สาขา A', department: 'ครัว', role, branch_id: 1, department_id: 10, name: 'ผู้รับทดสอบ' } };
      return { status: 200, data: { success: true, data } };
    } },
    signInGoogle: async () => 'mock-id', signOutGoogle: async () => { calls.push(['signOut']); await signOut(); },
    exitReceivingApp: async () => { calls.push(['exit']); }, setBackHandlerReady: async ready => { calls.push(['backReady', ready]); }, setSystemTheme: async theme => { calls.push(['theme', theme]); },
    page: props => { page = props; },
  };
  const h = await harness('ReceivingApp', {}, apiOverrides, {}, s.window, { __shell: shell, document: s.document,
    fetch: () => { throw Error('Shell tests must use the mocked native transport'); }, URLSearchParams, Event }, null, '../src/receiving-app/ReceivingApp.jsx');
  s.document.getElementById = id => h.all().some(node => node.props.id === id)
    ? { closest: () => null, focus: () => calls.push(['focus', id]), scrollIntoView() {} } : null;
  if (autoLogin) {
    const branchBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'สาขา A'));
    if (branchBtn && !branchBtn.props['aria-pressed']) await branchBtn.props.onClick?.();
    const deptBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'ครัว'));
    if (deptBtn && !deptBtn.props['aria-pressed']) await deptBtn.props.onClick?.();
    await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  } else await h.settle();
  if (!realReceiving && page) {
    assert.equal(page.chrome, 'embedded'); assert.equal(typeof page.onDirtyChange, 'function');
    if (reportsDirty) page.onDirtyChange(false);
  }
  return { ...h, ...s, calls, preferences, dirty: value => page.onDirtyChange(value), page: () => page, apiClient: () => shell.client, unauthorized: (value = true) => { unauthorized = Boolean(value); } };
}
const hasLeave = h => h.all().some(node => node.props.id === 'apk-leave-title');
const count = (h, type) => h.calls.filter(call => call[0] === type).length;

test('K1 Capacitor App backButton and native receivingBack share editor destinations, guard and listener cleanup', async () => {
  const h = await createRealEditor();
  h.events.capacitorBack(); await h.settle();
  assert.equal(count(h, 'exit'), 0); assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'images');
  h.events.receivingBack(); await h.settle();
  assert.equal(count(h, 'exit'), 0); assert.match(h.text(h.all()), /รอรับ 1 ร้าน/);
  h.events.capacitorBack(); await h.settle(); assert.equal(count(h, 'exit'), 1, h.text(h.all()));
  h.unmount(); assert.equal(h.events.capacitorBack, undefined); assert.equal(count(h, 'appBackRemoved'), 1);
});

test('K1 hardware Back in initial bill stage returns to queue, while unsent count/image/ink requires existing leave guard', async () => {
  const h = await openShell({ realReceiving: true, apiOverrides: { create: async () => ({ ...draftDocument(), counted_complete_at: null, ocr: { status: 'locked' }, lines: draftDocument().lines.map(line => ({ ...line, counted_quantity: null })) }) } });
  await h.click('สแกนบิล ตลาด'); await h.settle();
  h.events.capacitorBack(); await h.settle(); assert.equal(count(h, 'exit'), 0); assert.match(h.text(h.all()), /รอรับ 1 ร้าน/);
  await h.click('สแกนบิล ตลาด'); await h.settle();
  await h.click('นับ'); await h.select('นับได้ ผัก', '1.25');
  h.events.capacitorBack(); await h.settle(); assert.ok(hasLeave(h));
  await h.click('อยู่ต่อ'); assert.equal(h.find(n => n.props.id === 'count-3').props.value, '1.25');
  h.events.capacitorBack(); await h.settle(); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'exit'), 0); assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'images');
  h.unmount();
});

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
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน ข้อมูลที่ยังไม่ส่งยังอยู่ในหน้านี้ กรุณาออกแล้วเข้าใช้งานใหม่'));
  assert.equal(count(h, 'signOut'), 0);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'signOut'), 0);
});
test('shell integration: expired auth while dirty updates message on discard and clears on re-login', async () => {
  const h = await openShell(); h.dirty(true);
  h.unauthorized();
  await assert.rejects(h.apiClient().get('/receiving-documents/1'), error => error.status === 401);
  await h.settle();
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน ข้อมูลที่ยังไม่ส่งยังอยู่ในหน้านี้ กรุณาออกแล้วเข้าใช้งานใหม่'));

  // Discard and leave to login screen
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ'); await h.click('ทิ้งและออก');
  await h.settle();

  // On login screen: message updated to not say "กรุณาออก..."
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน กรุณาเข้าใช้งานใหม่'));
  assert.ok(!h.text(h.all()).includes('กรุณาออก'));

  // Re-login: restore mock auth and select branch and department
  h.unauthorized(false);
  const branchBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'สาขา A'));
  if (branchBtn && !branchBtn.props['aria-pressed']) await branchBtn.props.onClick?.();
  const deptBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'ครัว'));
  if (deptBtn && !deptBtn.props['aria-pressed']) await deptBtn.props.onClick?.();
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await h.settle();

  // Logged in: error message must be cleared
  assert.ok(!h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));

  // Subsequent normal logout after dirty expired session must not show expired error
  h.dirty(false);
  await h.click('เมนูแอป'); await h.click('ออกจากระบบ');
  await h.settle();
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เข้าใช้งาน'));
  assert.ok(!h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));
});
test('shell integration: expired auth while clean shows login message immediately and clears on re-login', async () => {
  const h = await openShell({ reportsDirty: true }); h.dirty(false);
  h.unauthorized();
  await assert.rejects(h.apiClient().get('/receiving-documents/1'), error => error.status === 401);
  await h.settle();

  // Immediately on login screen: message does not say "กรุณาออก..."
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน กรุณาเข้าใช้งานใหม่'));
  assert.ok(!h.text(h.all()).includes('กรุณาออก'));

  // Re-login: restore mock auth
  h.unauthorized(false);
  const branchBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'สาขา A'));
  if (branchBtn && !branchBtn.props['aria-pressed']) await branchBtn.props.onClick?.();
  const deptBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'ครัว'));
  if (deptBtn && !deptBtn.props['aria-pressed']) await deptBtn.props.onClick?.();
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await h.settle();

  // Logged in: error message must be cleared
  assert.ok(!h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));
});

test('shell integration: หมดเวลา -> login ใหม่ -> ออกจากระบบปกติ -> ต้องไม่มีข้อความหมดเวลา', async () => {
  const h = await openShell({ reportsDirty: true }); h.dirty(false);
  h.unauthorized();
  await assert.rejects(h.apiClient().get('/receiving-documents/1'), error => error.status === 401);
  await h.settle();

  // On login screen after session expired
  assert.ok(h.text(h.all()).includes('หมดเวลาเข้าใช้งาน กรุณาเข้าใช้งานใหม่'));

  // Re-login: restore mock auth
  h.unauthorized(false);
  const branchBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'สาขา A'));
  if (branchBtn && !branchBtn.props['aria-pressed']) await branchBtn.props.onClick?.();
  const deptBtn = h.all().find(node => node.type === 'button' && (node.props['aria-pressed'] || h.text(node) === 'ครัว'));
  if (deptBtn && !deptBtn.props['aria-pressed']) await deptBtn.props.onClick?.();
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await h.settle();

  // Logged in: error banner cleared
  assert.ok(!h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));

  // Normal logout
  h.dirty(false);
  await h.click('เมนูแอป');
  await h.click('ออกจากระบบ');
  await h.settle();

  // On login screen: must not show session expired message
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เข้าใช้งาน'));
  assert.ok(!h.text(h.all()).includes('หมดเวลาเข้าใช้งาน'));
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
  assert.match(activity, /WindowInsetsCompat.Type.ime\(\)/);
  assert.match(activity, /ViewCompat.requestApplyInsets/);
  const gradle = await read('../android/app/build.gradle');
  const defaultConfig = gradle.match(/\bdefaultConfig\s*\{([^}]+)\}/)?.[1];
  assert.ok(defaultConfig, 'APK version must be declared in defaultConfig');
  const codes = [...defaultConfig.matchAll(/^\s*versionCode\s+([1-9]\d*)\s*$/gm)];
  const names = [...defaultConfig.matchAll(/^\s*versionName\s+"((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-debug)"\s*$/gm)];
  assert.equal(codes.length, 1, 'Declare one positive integer versionCode');
  assert.equal(names.length, 1, 'Declare one major.minor.patch-debug versionName');
  assert.ok(Number(codes[0][1]) <= 2100000000, 'versionCode must fit the Android limit');
  assert.equal(Number(codes[0][1]), 21);
  assert.equal(names[0][1], '0.7.2-debug');
  const shell = await read('../src/receiving-app/ReceivingApp.jsx');
  assert.ok(shell.includes(`รุ่น ${names[0][1]} (${codes[0][1]})`), 'About menu must match APK metadata');
  const css = await read('../src/receiving-app/style.css'); assert.match(css, /@import '\.\.\/design\/tokens.css'/);
  assert.doesNotMatch(css, /prefers-color-scheme/); assert.match(css, /var\(--sg-space-4\) \* 2/);
});


const draftDocument = () => ({ counted_complete_at: '2026-10-18T00:00:00Z', id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', images: [], ocr: { status: 'done' }, warnings: [], total: '20', discount: '0', vat: '0',
  lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', counted_quantity: '2', quantity_received: '2', quantity_billed: '2', unit_price: '10' }] });
async function createRealEditor(apiOverrides = {}) {
  const h = await openShell({ realReceiving: true, apiOverrides: { create: async () => draftDocument(), ...apiOverrides } });
  await h.click('สแกนบิล ตลาด'); await h.settle();
  await h.click('แก้');
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
test('shell real page: B home queue selects capture context without dirtying or writing; footer scan creates once; menu shows APK version', async () => {
  const groups = ['ร้านแรก', 'ร้านถัดไป'].map((supplier_name, index) => ({ supplier_key: `pg:${index + 1}`, supplier_name,
    items: [{ order_item_id: index + 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' }] }));
  const creates = [];
  const h = await openShell({ realReceiving: true, apiOverrides: { expected: async () => groups, create: async body => { creates.push(body); return draftDocument(); } } });
  await h.click('เลือกร้าน ร้านถัดไป');
  assert.equal(creates.length, 0);
  await h.click('เมนูแอป'); assert.match(h.text(h.all()), /รุ่น 0\.7\.2-debug \(21\)/); await h.click('ปิดเมนู');
  assert.equal(creates.length, 0, 'selecting and opening the menu never creates a document');
  await h.click('สแกนบิล ร้านถัดไป');
  assert.equal(h.all().some(node => node.type === 'form' && node.props.id === 'rc-create'), false, 'scan-first has no setup form');
  assert.equal(creates.length, 1); assert.equal(creates[0].product_group_id, 2); assert.deepEqual(Array.from(creates[0].order_item_ids), [43]);
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 0);
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'images');
  h.events.receivingBack(); await h.settle(); assert.match(h.text(h.all()), /รอรับ 2 ร้าน/);
  h.events.receivingBack(); await h.settle(); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});
// Emulates the real DOM lookup in backAction: the topmost open <dialog> receives a cancel event, which the
// design Sheet turns into onDismiss. Class names come from the rendered sheet so the rc-back-dismiss marker is real.
const openDialogs = h => h.all().filter(node => node.type === 'dialog')
  .map(node => ({ classList: { contains: name => String(node.props.className).split(/\s+/).includes(name) }, dispatchEvent() { node.props.onCancel({ preventDefault() {} }); } }));
test('shell real page: Android Back inside the signing sheet asks about the ink only, never the editor leave guard (P9)', async () => {
  const h = await createRealEditor();
  // 2026-10-24: one matching row has no green bulk button; accept the row with its own button.
  const accept = h.find(node => node.type === 'button' && /^ยืนยันรับ /.test(h.text(node))); await accept.props.onClick(); await h.settle();
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ');
  await armPad(h);
  h.document.querySelectorAll = () => openDialogs(h);
  const pad = h.find(node => node.type === 'canvas');
  pad.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  pad.props.onPointerUp(); await h.settle();
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false, 'the shell leave guard must not open from the signing sheet'); assert.equal(count(h, 'exit'), 0);
  assert.match(h.text(h.all()), /ทิ้งลายเซ็นนี้\?/);
  assert.equal(h.all().find(node => node.type === 'button' && h.text(node) === 'เซ็นและยืนยันรับ').props.disabled, false, 'ink is kept while asking');
  await h.click('เซ็นต่อ');
  assert.doesNotMatch(h.text(h.all()), /ทิ้งลายเซ็นนี้\?/); assert.equal(h.all().some(node => node.type === 'canvas'), true);
  h.events.receivingBack(); await h.settle(); assert.equal(hasLeave(h), false); assert.match(h.text(h.all()), /ทิ้งลายเซ็นนี้\?/);
  await h.click('ทิ้งลายเซ็น');
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 0);
  assert.equal(h.all().some(node => node.type === 'canvas'), false, 'only the sheet closed');
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'sign', 'the editor stays on the sign step');
  // Without ink Back simply closes the sheet.
  await armPad(h); h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(h.all().some(node => node.type === 'canvas'), false);
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'sign');
  h.document.querySelectorAll = () => [];
  h.unmount();
});
test('shell real page: create edits drive Android Back guard; stay preserves input and discard returns to queue', async () => {
  const h = await openShell({ realReceiving: true });
  await h.radio('documents'); await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'); await h.select('ผู้ส่งของ', 'ข้อมูลที่ยังไม่ส่ง');
  h.document.querySelectorAll = () => [{ dispatchEvent() { assert.fail('native dialog cancel must not bypass dirty create guard'); } }];
  h.events.receivingBack(); await h.settle();
  assert.ok(hasLeave(h)); assert.equal(count(h, 'exit'), 0);
  await h.click('อยู่ต่อ');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === 'ข้อมูลที่ยังไม่ส่ง').props.value, 'ข้อมูลที่ยังไม่ส่ง');
  h.events.receivingBack(); await h.settle(); await h.click('ทิ้งและออก');
  assert.equal(count(h, 'exit'), 0); assert.equal(hasLeave(h), false);
  assert.equal(h.all().some(n => n.props.id === 'rc-create'), false);
  h.document.querySelectorAll = () => [];
  h.events.receivingBack(); await h.settle(); assert.equal(count(h, 'exit'), 1);
  h.unmount();
});
test('shell real page: quantity edits protect API settings; discard and remount report clean again', async () => {
  const h = await createRealEditor();
  await h.select('แก้จำนวนหลังเปิดบิล ผัก', '1.5');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.5').props.inputMode, 'decimal');
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API');
  assert.ok(hasLeave(h)); assert.equal(count(h, 'preference'), 0);
  await h.click('อยู่ต่อ');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.5').props.value, '1.5');
  await h.click('เมนูแอป'); await h.click('ตั้งค่า API'); await h.click('ทิ้งและออก');
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'signOut'), 0);
  assert.ok(h.all().some(node => node.type === 'h2' && h.text(node) === 'เชื่อมต่อเซิร์ฟเวอร์'));
  await h.click('กลับ'); h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 1);
  assert.match(h.text(h.all()), /รอรับ 1 ร้าน/);
  h.unmount();
});
test('shell real page: pending save blocks Back; successful save clears dirty state and Back goes to previous step', async () => {
  const request = deferred(), updates = [];
  const h = await createRealEditor({ update: (id, body) => { updates.push({ id, body }); return request.promise; } });
  await h.select('แก้จำนวนหลังเปิดบิล ผัก', '1.5');
  const saving = h.find(node => node.type === 'button' && h.text(node) === 'รับ 1.5 กก. · แจ้งร้านขาด 0.5 กก.').props.onClick(); await h.settle();
  assert.equal(updates.length, 1); assert.equal(updates[0].id, 5);
  assert.equal(updates[0].body.lines[0].quantity_received, '1.50');
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 0);
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'compare');
  const saved = draftDocument(); saved.lines[0].quantity_received = '1.5'; request.resolve(saved);
  await saving; await h.settle();
  h.events.receivingBack(); await h.settle();
  assert.equal(hasLeave(h), false); assert.equal(count(h, 'exit'), 0);
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'images');
  h.unmount();
});


test('shell real page: unsaved quantity drives logout guard and stay preserves editor data', async () => {
  const h = await createRealEditor(); await h.select('แก้จำนวนหลังเปิดบิล ผัก', '1.5');
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

test('shell + bell: new open followup rings once on launch/focus, remembers IDs across restart and gates staff', async () => {
  let items = [{ id: 91, status: 'open', branch_id: 1, supplier_name: 'ร้านไก่', pending_items: [] }];
  const apiOverrides = { followups: async () => ({ items, pending_count: items.length }) };
  const h = await openShell({ realReceiving: true, role: 'accounting', apiOverrides });
  await h.settle(); assert.equal(count(h, 'alert'), 1);
  h.events.focus(); await h.settle(); assert.equal(count(h, 'alert'), 1);
  items = [...items, { id: 92, status: 'open', branch_id: 1, supplier_name: 'ร้านผัก', pending_items: [] }];
  h.events.focus(); await h.settle(); assert.equal(count(h, 'alert'), 2);
  const stored = h.preferences; h.unmount();
  const restarted = await openShell({ realReceiving: true, role: 'accounting', stored, autoLogin: false, apiOverrides });
  assert.equal(count(restarted, 'alert'), 0); restarted.unmount();
  const staff = await openShell({ realReceiving: true, role: 'user', apiOverrides });
  staff.events['receiving:followups']({ detail: { items } }); await staff.settle();
  assert.equal(count(staff, 'alert'), 0); staff.unmount();
});

test('shell push tap: cold launch opens exact authorized issue without navigating away or changing status', async () => {
  const h = await openShell({ role: 'accounting', tapId: '17' });
  await h.settle();
  assert.match(h.text(h.all()), /เรื่องตามของ #17/); assert.match(h.text(h.all()), /ร้านจากแจ้งเตือน/);
  assert.ok(h.calls.some(call => call[0] === 'http' && call[1].url.endsWith('/receiving-push/followups/17')));
  assert.ok(h.page(), 'Receiving page remains mounted below the detail dialog');
  assert.equal(h.calls.filter(call => call[0] === 'http' && ['PATCH', 'PUT', 'DELETE'].includes(call[1].method)).length, 0);
  await h.click('ปิด'); assert.doesNotMatch(h.text(h.all()), /เรื่องตามของ #17/);
  h.events.receivingPushTap(); await h.settle(); assert.doesNotMatch(h.text(h.all()), /เรื่องตามของ #17/, 'tap is consumed once');
  h.unmount();
});

test('shell menu: logout button uses destructive class and header styles have safe area and background', async () => {
  const h = await openShell({ autoLogin: true });
  await h.click('เมนูแอป');
  const logoutBtn = h.all().find(node => node.type === 'button' && h.text(node) === 'ออกจากระบบ');
  assert.ok(logoutBtn, 'Logout button must be present in menu');
  assert.equal(logoutBtn.props.className, 'destructive', 'Logout button in menu must be destructive');
  await h.click('ปิดเมนู');
  h.unmount();

  const css = await readFile(new URL('../src/receiving-app/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.apk-header\s*\{[^}]*background:\s*var\(--sg-bg\)/, 'Header must have background: var(--sg-bg)');
  assert.match(css, /\.apk-header\s*\{[^}]*env\(safe-area-inset-top,\s*0px\)/, 'Header must include safe area top inset');
  assert.match(css, /\.apk-actions\s+button\.destructive\s*\{[^}]*margin-top:\s*var\(--sg-space-2\)/, 'Destructive button must have margin-top separation');
  assert.match(css, /\.apk-shell:has\(\.rc-document\)[^}]*padding-top:\s*var\(--sg-space-1\)/, 'Header padding-top must shrink when .rc-document is open');
  assert.match(css, /\.apk-shell:has\(\.rc-document\)\s+\.apk-header[^}]*gap:\s*var\(--sg-space-2\)/, 'Header gap must shrink when .rc-document is open');
  assert.match(css, /\.apk-shell:has\(\.rc-document\)\s+\.mark[^}]*width:\s*var\(--sg-space-6\)/, 'App icon mark must shrink when .rc-document is open');
  assert.match(css, /\.apk-shell:has\(\.rc-document\)\s+h1[^}]*font-size:\s*var\(--sg-type-body\)/, 'Header title h1 must shrink when .rc-document is open');
  assert.match(css, /\.apk-shell:has\(\.rc-document\)\s+:is\(\.pilot-notice,\s*\.apk-scope\)[^}]*display:\s*none/, 'Subtitles must be hidden when .rc-document is open');
});
