import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Component/API harness only; no Google calls, real tokens or browser claims.
async function harness({ clientId = 'web.test', response, fail, loadFail = false } = {}) {
  const effects = [], states = [], sessions = [], requests = [], scripts = [], rendered = [];
  let callback;
  const gis = { initialize(options) { assert.equal(options.client_id, clientId); callback = options.callback; },
    renderButton(target, options) { assert.ok(target); assert.equal(options.locale, 'th'); rendered.push(options); } };
  const context = vm.createContext({ setTimeout, clearTimeout, window: {},
    document: { createElement() { return { remove() {} }; }, head: { appendChild(script) {
      scripts.push(script.src); queueMicrotask(() => { if (loadFail) script.onerror();
        else { context.window.google = { accounts: { id: gis } }; script.onload(); } });
    } } },
    __api: { async post(path, body) { requests.push({ path, body });
      if (fail) throw fail;
      return { data: response || { success: true, data: { token: 'mock-session', user: { id: 7, branch_id: 3 } } } };
    } }, __accept: value => sessions.push(value),
  });
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/pages/auth/GoogleLoginButton.jsx', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    define: { 'import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID': JSON.stringify(clientId) }, external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'google-mocks', setup(builder) {
      builder.onResolve({ filter: /AuthContext|api\/client$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('AuthContext')
        ? 'export const useAuth = () => ({acceptGoogleSession: globalThis.__accept});'
        : 'export default globalThis.__api;' }));
    } }],
  });
  const jsx = (type, props) => { if (props?.ref) props.ref.current = { replaceChildren() {} }; return { type, props }; };
  const react = { useRef: value => ({ current: value }), useState: value => [value, next => states.push(next)],
    useEffect: fn => effects.push(fn) };
  const module = new vm.SourceTextModule(compiled.outputFiles[0].text, { context });
  await module.link(name => {
    const values = name === 'react' ? react : { jsx, jsxs: jsx };
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate(); const tree = module.namespace.GoogleLoginButton();
  const cleanup = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  return { tree, states, sessions, requests, scripts, rendered, callback: (...args) => callback(...args),
    unmount() { cleanup.forEach(fn => fn?.()); } };
}
test('web Google button absent without build client ID; no GIS script loaded', async () => {
  const h = await harness({ clientId: '' }); assert.equal(h.tree, null); assert.equal(h.scripts.length, 0);
});
test('web GIS renders official Thai button, exchanges ID token and accepts mapped session', async () => {
  const h = await harness();
  assert.deepEqual(h.scripts, ['https://accounts.google.com/gsi/client']); assert.equal(h.rendered.length, 1);
  await h.callback({ credential: 'mock-google-id' });
  assert.equal(h.requests[0].path, '/auth/google'); assert.equal(h.requests[0].body.id_token, 'mock-google-id');
  assert.equal(h.sessions[0].token, 'mock-session'); assert.equal(h.sessions[0].user.branch_id, 3);
  assert.equal(h.states.at(-1), false); h.unmount();
});
test('web account denied/provider failure/malformed session display safe errors and never accept session', async () => {
  for (const options of [{ fail: { response: { data: { code: 'GOOGLE_ACCOUNT_NOT_ALLOWED', message: 'SQL private' } } } },
    { fail: new Error('private token') }, { response: { success: true, data: {} } }]) {
    const h = await harness(options); await h.callback({ credential: 'mock-google-id' });
    assert.equal(h.sessions.length, 0); assert.ok(h.states.some(v => typeof v === 'string' && v.length));
    assert.ok(!h.states.some(v => typeof v === 'string' && /SQL|private|token/.test(v))); h.unmount();
  }
});
test('web GIS loading error is safe; callback after unmount cannot create a session', async () => {
  const failed = await harness({ loadFail: true }); assert.equal(failed.sessions.length, 0);
  assert.ok(failed.states.some(v => typeof v === 'string' && v.includes('โหลด Google')));
  const h = await harness(); h.unmount(); await h.callback({ credential: 'mock-google-id' });
  assert.equal(h.requests.length, 0); assert.equal(h.sessions.length, 0);
});
