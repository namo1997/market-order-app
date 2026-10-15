import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AP_THEME_KEY, formatApReference, readApThemePreference, saveApTheme, systemApTheme } from '../src/apLedgerUi.js';

test('AP references expose readable document numbers and conceal internal table/source keys', () => {
  assert.equal(formatApReference('lbc:bill:2320'), 'บิล LBC #2320');
  assert.equal(formatApReference('cashflow:statement:42'), 'รายการธนาคาร #42');
  assert.equal(formatApReference('pnl_credit_suppliers:10'), 'ทะเบียนซัพเครดิต');
  for (const key of ['pnl_private_table:123', 'lbc:bill:2320:paid', '', null]) {
    assert.equal(formatApReference(key), 'เอกสารต้นทาง');
  }
});

test('AP uses the system theme by default and lets a saved choice override it', () => {
  for (const dark of [true, false]) {
    const host = { matchMedia: query => {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return { matches: dark };
    }, localStorage: { getItem: () => null } };
    assert.equal(readApThemePreference(host) || systemApTheme(host), dark ? 'dark' : 'light');
    for (const saved of ['light', 'dark']) {
      host.localStorage.getItem = key => { assert.equal(key, AP_THEME_KEY); return saved; };
      assert.equal(readApThemePreference(host) || systemApTheme(host), saved);
    }
  }
});

test('invalid preferences and denied localStorage fall back safely; persistence uses the AP key', () => {
  assert.equal(readApThemePreference({ localStorage: { getItem: () => 'invalid' } }), null);
  const denied = { get localStorage() { throw new Error('SecurityError'); }, matchMedia: () => ({ matches: true }) };
  assert.equal(readApThemePreference(denied) || systemApTheme(denied), 'dark');
  assert.doesNotThrow(() => saveApTheme('light', denied));
  assert.equal(systemApTheme({}), 'light');
  assert.equal(systemApTheme({ matchMedia() { throw new Error('unavailable'); } }), 'light');
  const stored = new Map();
  const host = { localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } };
  saveApTheme('dark', host);
  assert.equal(readApThemePreference(host), 'dark');
  saveApTheme('light', host);
  assert.equal(readApThemePreference(host), 'light');
});

test('AP reference cells and the theme control use the presentation helpers', async () => {
  const source = await readFile(new URL('../src/ApLedger.jsx', import.meta.url), 'utf8');
  assert.match(source, /formatApReference\(r\.reference\)/);
  assert.match(source, /formatApReference\(r\.sourceKey\)/);
  assert.match(source, /formatApReference\(r\.key\)/);
  assert.doesNotMatch(source, />\{r\.(?:reference|sourceKey|key)\}</);
  assert.match(source, /useState\(readApThemePreference\)/);
  assert.match(source, /useState\(systemApTheme\)/);
  assert.match(source, /onClick=\{toggleTheme\}/);
  assert.match(source, /saveApTheme\(next\)/);
});

function luminance(hex) {
  const rgb = hex.length === 4 ? [...hex.slice(1)].map(c => c + c) : hex.slice(1).match(/../g);
  const linear = rgb.map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

test('AP normal, secondary and status text meet 4.5:1 in both themes', async () => {
  const css = (await readFile(new URL('../src/apLedger.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const colors = selector => Object.fromEntries([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].trim() === selector)
    .flatMap(m => [...m[2].matchAll(/--ap-([\w-]+):\s*(#[\da-f]+)/gi)].map(v => [v[1], v[2]])));
  for (const mode of ['light', 'dark']) {
    const tokens = { ...colors('.ap-page'), ...(mode === 'dark' ? colors('.ap-page[data-mode=dark]') : {}) };
    for (const [fg, bg] of [['ink','bg'], ['ink','surface'], ['muted','bg'], ['muted','surface'], ['accent','bg'], ['accent','tint'], ['warn','surface'], ['warn','warn-bg']]) {
      assert.ok(tokens[fg] && tokens[bg], `missing color: ${fg}/${bg}`);
      const [a,b] = [luminance(tokens[fg]), luminance(tokens[bg])].sort((x,y) => y-x);
      const ratio = (a + .05) / (b + .05);
      assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}:1`);
    }
  }
});
