import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveAuthMode } from '../src/receiving-app/auth-mode.mjs';
import { harness } from './receiving-harness.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const open = props => harness('PilotLogin', { online: true, busy: false, onLogin() {}, ...props }, {}, {}, {}, {}, null, '../src/receiving-app/PilotLogin.jsx');
const api = overrides => ({ branches: async () => [{ id: 1, name: 'สาขา A' }, { id: 2, name: 'สาขา B' }],
  departments: async () => [{ id: 10, name: 'ครัว' }], login: async () => ({ id: 7, branch_id: 1, department_id: 10 }), ...overrides });
const submit = h => h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('APK r3 auth build: missing/blank ID selects pilot; configured ID selects Google; explicit mode is validated', () => {
  for (const clientId of ['', '  ']) assert.equal(resolveAuthMode({ clientId }), 'pilot');
  assert.equal(resolveAuthMode({ clientId: 'test-only' }), 'google');
  assert.equal(resolveAuthMode({ mode: 'pilot', clientId: 'test-only' }), 'pilot');
  assert.equal(resolveAuthMode({ mode: 'google', clientId: 'test-only' }), 'google');
  assert.throws(() => resolveAuthMode({ mode: 'google' }), /requires/);
  assert.throws(() => resolveAuthMode({ mode: 'invalid' }), /Invalid/);
});

test('APK pilot: concise login, real branch/department selection and server user scope; duplicate submits are locked', async () => {
  const pending = deferred(), calls = [], users = [], busy = [];
  const h = await open({ api: api({ departments: async id => { calls.push(['departments', id]); return [{ id: 10, name: 'ครัว' }]; },
    login: async id => { calls.push(['login', id]); return pending.promise; } }), onLogin: user => users.push(user), onBusy: value => busy.push(value) });
  assert.ok(h.text(h.all()).includes('เลือกสาขาและแผนก'));
  assert.ok(h.all().some(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน'));
  assert.doesNotMatch(h.text(h.all()), /DEBUG|PILOT|ทดลองภายใน/); // The shell owns the single pilot label.
  await submit(h); assert.equal(calls.length, 0);
  await h.select('สาขา', '1'); await h.select('แผนก', '10');
  const work = submit(h); await submit(h); await h.settle();
  assert.deepEqual(calls, [['departments', '1'], ['login', 10]]);
  assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'กำลังเข้าสู่ระบบ…').props.disabled);
  const user = { id: 7, branch_id: 1, department_id: 10, role: 'user' };
  pending.resolve(user); await work; await h.settle();
  assert.deepEqual(users, [user]); assert.deepEqual(busy, [true, false]);
});

test('APK r3 pilot: branch change clears department and ignores stale department response', async () => {
  const first = deferred(), second = deferred(); let logins = 0;
  const h = await open({ api: api({ departments: id => id === '1' ? first.promise : second.promise, login: async () => logins++ }) });
  await h.select('สาขา', '1');
  // Change while the previous request is pending to exercise effect cleanup.
  await h.select('สาขา', '2');
  second.resolve([{ id: 20, name: 'ครัว B' }]); await h.settle();
  first.resolve([{ id: 10, name: 'ครัว A' }]); await h.settle();
  assert.ok(h.all().some(node => node.type === 'option' && node.props.value === '20'));
  assert.ok(!h.all().some(node => node.type === 'option' && node.props.value === '10'));
  await h.select('แผนก', '10'); await submit(h); assert.equal(logins, 0);
  await h.select('แผนก', '20'); await h.select('สาขา', '1');
  assert.equal(h.find(node => node.type === 'select' && node.props.children[0]?.props?.value === '' && node.props.required && node.props.value === '').props.value, '');
  await submit(h); assert.equal(logins, 0);
});

test('APK r3 pilot: branch/department errors expose no internals and retry loads real lists', async () => {
  for (const stage of ['branches', 'departments']) {
    let fail = true, calls = 0;
    const h = await open({ api: api({ [stage]: async () => { calls++; if (fail) throw Error('private SQL details'); return [{ id: 1, name: 'รายการจำลอง' }]; } }) });
    if (stage === 'departments') await h.select('สาขา', '1');
    assert.ok(h.all().some(node => node.props.role === 'alert'));
    assert.ok(!h.text(h.all()).includes('private SQL'));
    fail = false; await h.click('ลองใหม่');
    if (stage === 'departments') await h.select('สาขา', '1');
    assert.equal(calls, 2); assert.ok(!h.all().some(node => node.props.role === 'alert'));
  }
});

test('APK r3 pilot: rejected login releases lock for retry; offline never calls API', async () => {
  let calls = 0; const users = [];
  const h = await open({ api: api({ login: async () => { if (++calls === 1) throw Error('private details'); return { id: 7 }; } }), onLogin: user => users.push(user) });
  await h.select('สาขา', '1'); await h.select('แผนก', '10');
  await submit(h); await h.settle(); assert.ok(h.all().some(node => node.props.role === 'alert'));
  assert.ok(!h.text(h.all()).includes('private details')); assert.equal(users.length, 0);
  await submit(h); await h.settle(); assert.equal(calls, 2); assert.deepEqual(users, [{ id: 7 }]);
  let branchRequests = 0;
  const offline = await open({ api: api({ branches: async () => { branchRequests++; return []; }, login: async () => calls++ }), online: false });
  await submit(offline); assert.equal(calls, 2);
  assert.equal(branchRequests, 0);
  assert.ok(offline.find(node => node.type === 'button').props.disabled);
});

test('APK r3 native branding: every density matches supplied brand bytes; adaptive and light/night splash reference correct resources', async () => {
  const root = new URL('../', import.meta.url), read = path => readFile(new URL(path, root));
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher', 'ic_launcher_background', 'ic_launcher_foreground']) {
      assert.deepEqual(await read(`android/app/src/main/res/mipmap-${density}/${name}.png`), await read(`src/assets/brand/android/mipmap-${density}/${name}.png`));
    }
    assert.deepEqual(await read(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`), await read(`src/assets/brand/android/mipmap-${density}/ic_launcher.png`));
    for (const variant of ['drawable', 'drawable-night']) assert.deepEqual(await read(`android/app/src/main/res/${variant}-${density}/splash_icon.png`), await read(`src/assets/brand/android/${variant}-${density}/splash_icon.png`));
  }
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const xml = (await read(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`)).toString();
    assert.match(xml, /@mipmap\/ic_launcher_background/); assert.match(xml, /@mipmap\/ic_launcher_foreground/);
  }
  const styles = (await read('android/app/src/main/res/values/styles.xml')).toString();
  assert.match(styles, /Theme.AppCompat.DayNight.NoActionBar/);
  assert.match(styles, /windowSplashScreenBackground">@color\/splashBackground/);
  assert.match(styles, /windowSplashScreenAnimatedIcon">@drawable\/splash_icon/);
  assert.match((await read('android/app/src/main/res/values/colors.xml')).toString(), /splashBackground">#F7F5F0/);
  assert.match((await read('android/app/src/main/res/values-night/colors.xml')).toString(), /splashBackground">#101522/);
});
