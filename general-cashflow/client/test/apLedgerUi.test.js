import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ApBalanceStatus from '../src/ApBalanceStatus.js';
import ApLoadStatus from '../src/ApLoadStatus.js';
import { AP_MONTHS, AP_THEME_KEY, apBalanceStatus, formatApDate, formatApMonth, formatApNote, formatApCapturedAt, formatApReference, readApThemePreference, saveApTheme, systemApTheme, matchesApSearch, apLoadErrorState, parseApYear, apReceivingCoverage, apSupplierEvidence, formatApAmount } from '../src/apLedgerUi.js';

test('AP Buddhist year accepts only whole years in the supported ISO range', () => {
  for (const [input, expected] of [['2569','2026'], ['544','0001'], ['10542','9999']]) assert.equal(parseApYear(input), expected);
  for (const input of ['', '543', '10543', '-2569', '2569.5', '2e3', ' 2569 ', 'abc']) assert.equal(parseApYear(input), null, input);
});

test('AP recovery guidance follows observed connectivity and HTTP status without exposing errors', () => {
  for (const [error, state, message] of [
    [{ status:401 }, 'auth', 'เข้าสู่ระบบใหม่'],
    [{ status:403 }, 'forbidden', 'ไม่มีสิทธิ์'],
    [{ status:503 }, 'server', 'ระบบขัดข้อง'],
    [new TypeError('private upstream'), 'network', 'ติดต่อระบบไม่ได้'],
    [new Error('private upstream'), 'error', 'ติดต่อผู้ดูแล']
  ]) {
    assert.equal(apLoadErrorState(error, {navigator:{onLine:true}}), state);
    const html = renderToStaticMarkup(createElement(ApLoadStatus, {state, onRetry(){}}));
    assert.ok(html.includes(message));
    assert.match(html, /role="alert"/);
    assert.match(html, /ลองใหม่/);
    assert.doesNotMatch(html, /private upstream/);
    assert.equal(apLoadErrorState(error, {navigator:{onLine:false}}), 'offline');
  }
  const offline = renderToStaticMarkup(createElement(ApLoadStatus, {state:'offline', onRetry(){}}));
  assert.match(offline, /role="status"/);
  assert.match(offline, /ออฟไลน์ ตรวจการเชื่อมต่อแล้วลองใหม่/);
  assert.match(offline, /ลองใหม่<\/button>/);
  assert.equal(apLoadErrorState(new TypeError('fetch'), {}), 'network');
});

test('AP search finds the displayed supplier outside the description and uses readable references', () => {
  const supplier = 'ผู้ขายสมมติ Lotus';
  const row = { sourceKey: 'lbc:bill:2320', description: 'ซื้อวัตถุดิบประจำวัน' };
  assert.ok(!row.description.includes(supplier));
  const matches = query => matchesApSearch(query, supplier, formatApReference(row.sourceKey), row.description);
  for (const query of ['  ผู้ขายสมมติ  ', ' LOTUS ', 'บิลไลน์ #2320', '2320', 'วัตถุดิบ', '  ', '']) assert.equal(matches(query), true, query);
  for (const query of ['ผู้ขายรายอื่น', 'lbc:bill', 'sourceKey']) assert.equal(matches(query), false, query);
});

test('AP_NOT_IMPORTED is a neutral empty month, including the API Error.message contract', () => {
  for (const error of [Object.assign(new Error('AP_NOT_IMPORTED'), { status: 503 }), { code: 'AP_NOT_IMPORTED' }]) {
    const html = renderToStaticMarkup(createElement(ApLoadStatus, { state: apLoadErrorState(error) }));
    assert.match(html, /ap-load-empty/);
    assert.match(html, /role="status"/);
    assert.match(html, /ยังไม่ได้นำเข้าข้อมูลเดือนนี้ เลือกเดือนอื่น/);
    assert.doesNotMatch(html, /role="alert"|ap-load-error|โหลดไม่สำเร็จ|ลองใหม่/);
  }
});

test('AP server and network failures show an alert and a retry button', () => {
  for (const error of [Object.assign(new Error('AP_UNAVAILABLE'), { status: 503 }), new TypeError('Failed to fetch')]) {
    const html = renderToStaticMarkup(createElement(ApLoadStatus, { state: apLoadErrorState(error), onRetry() {} }));
    assert.match(html, /ap-load-error/);
    assert.match(html, /role="alert"/);
    assert.match(html, /โหลดไม่สำเร็จ/);
    assert.match(html, /<button type="button">ลองใหม่<\/button>/);
    assert.doesNotMatch(html, /ไม่มีข้อมูลเดือนนี้/);
  }
  assert.equal(renderToStaticMarkup(createElement(ApLoadStatus, { state: '' })), '');
});

test('AP references expose readable document numbers and conceal internal table/source keys', () => {
  assert.equal(formatApReference('lbc:bill:2320'), 'บิลไลน์ #2320');
  assert.equal(formatApReference('cashflow:statement:42'), 'รายการธนาคาร #42');
  assert.equal(formatApReference('pnl_credit_suppliers:10'), 'ทะเบียนผู้ขายเครดิต');
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
  const host = { localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } };
  saveApTheme('dark', host);
  assert.equal(readApThemePreference(host), 'dark');
  saveApTheme('light', host);
  assert.equal(readApThemePreference(host), 'light');
  saveApTheme(null, host);
  assert.equal(stored.has(AP_THEME_KEY), false);
  assert.equal(readApThemePreference(host), null);
  for (const dark of [true, false]) {
    host.matchMedia = () => ({ matches: dark });
    assert.equal(readApThemePreference(host) || systemApTheme(host), dark ? 'dark' : 'light');
  }
  assert.doesNotThrow(() => saveApTheme(null, denied));
});

test('AP reference cells and the theme control use the presentation helpers', async () => {
  const source = await readFile(new URL('../src/ApLedger.jsx', import.meta.url), 'utf8');
  assert.match(source, /formatApReference\(r\.reference\)/);
  assert.match(source, /formatApReference\(r\.sourceKey\)/);
  assert.match(source, /formatApReference\(r\.key\)/);
  assert.doesNotMatch(source, />\{r\.(?:reference|sourceKey|key)\}</);
  assert.match(source, /useState\(readApThemePreference\)/);
  assert.match(source, /useState\(systemApTheme\)/);
  assert.match(source, /selectTheme\(value\)/);
  for (const label of ['ตามระบบ', 'สว่าง', 'มืด']) assert.ok(source.includes(label));
  assert.match(source, /saveApTheme\(next\)/);
});

function luminance(hex) {
  const rgb = hex.length === 4 ? [...hex.slice(1)].map(c => c + c) : hex.slice(1).match(/../g);
  const linear = rgb.map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

test('AP normal, secondary and status text meet 4.5:1 in both themes', async () => {
  const css = (await readFile(new URL('../src/apLedger.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const colors = selector => Object.fromEntries([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].trim() === selector)
    .flatMap(m => [...m[2].matchAll(/--((?:ap|sg)-[\w-]+):\s*([^;]+);/gi)].map(v => [v[1], v[2].trim()])));
  for (const mode of ['light', 'dark']) {
    const raw = { ...colors('.ap-page'), ...(mode === 'dark' ? colors('.ap-page[data-mode=dark]') : {}) };
    const resolve = key => raw[key]?.startsWith('var(') ? resolve(raw[key].slice(6, -1)) : raw[key];
    const tokens = Object.fromEntries(Object.keys(raw).filter(k => k.startsWith('ap-')).map(k => [k.slice(3), resolve(k)]));
    for (const [fg, bg] of [['ink','bg'], ['ink','surface'], ['muted','bg'], ['muted','surface'], ['accent','bg'], ['accent','tint'], ['warn','surface'], ['warn','warn-bg'], ['muted','warn-bg'], ['success','success-bg'], ['error','error-bg']]) {
      assert.ok(tokens[fg] && tokens[bg], `missing color: ${fg}/${bg}`);
      const [a,b] = [luminance(tokens[fg]), luminance(tokens[bg])].sort((x,y) => y-x);
      const ratio = (a + .05) / (b + .05);
      assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}:1`);
    }
  }
});


test('AP renders an abnormal balance and its exact difference instead of a success badge', () => {
  for (const [difference, amount] of [['0.01','0.01'], ['-0.01','-0.01'], ['1250.10','1,250.10'], ['9007199254740993.01','9,007,199,254,740,993.01']]) {
    const html = renderToStaticMarkup(createElement(ApBalanceStatus, { balance: { dr: '10.00', cr: '10.00', difference } }));
    assert.match(html, /role="alert"/);
    assert.match(html, /ap-balance-error/);
    assert.ok(html.includes(`ดุลผิดปกติ ต่าง ${amount} บาท`));
    assert.match(html, /ดุลรายการบัญชีเท่านั้น/);
    assert.doesNotMatch(html, /เดบิตเท่ากับเครดิต|ap-balance-balanced/);
  }
});

test('AP confirms only a zero difference; absent or invalid differences remain pending', () => {
  for (const difference of ['0.00', '0', '-0.00', 0]) {
    const html = renderToStaticMarkup(createElement(ApBalanceStatus, { balance: { difference } }));
    assert.match(html, /ap-balance-balanced/);
    assert.match(html, /เดบิตเท่ากับเครดิต/);
    assert.match(html, /ดุลรายการบัญชีเท่านั้น/);
    assert.doesNotMatch(html, /role="alert"/);
  }
  for (const difference of [null, undefined, '', 'NaN', NaN, Infinity, false, '0.001']) {
    assert.equal(apBalanceStatus({ difference }).state, 'pending');
    const html = renderToStaticMarkup(createElement(ApBalanceStatus, { balance: { difference } }));
    assert.match(html, /ยังตรวจดุลไม่ได้/);
    assert.doesNotMatch(html, /เดบิตเท่ากับเครดิต|ap-balance-balanced/);
  }
  assert.equal(apBalanceStatus(null).state, 'pending');
});

test('AP uses Buddhist years and Bangkok dates while month values remain ISO', () => {
  assert.equal(AP_MONTHS.length, 12);
  assert.equal(formatApMonth('2026-09'), 'กันยายน 2569');
  assert.equal(formatApMonth('2027-01'), 'มกราคม 2570');
  assert.equal(formatApDate('2026-09-05'), '5 ก.ย. 2569');
  assert.equal(formatApDate('2026-12-31'), '31 ธ.ค. 2569');
  assert.equal(formatApCapturedAt('2026-09-30T18:00:00Z'), '1 ต.ค. 2569 01:00');
  assert.equal(formatApCapturedAt('2026-09-30 18:00:00'), formatApCapturedAt('2026-09-30T18:00:00Z'));
  assert.equal(formatApDate('2026-02-31'), 'ไม่ระบุวันที่');
  assert.equal(formatApDate(null), 'ไม่ระบุวันที่');
  assert.equal(formatApMonth('2026-13'), 'ไม่ระบุเดือน');
  assert.equal(formatApCapturedAt(null), 'ไม่ระบุเวลา');
});

test('Thai notes retain the report exclusions and accounting limitations', () => {
  assert.equal(formatApNote('P&L เฉพาะ LBC/SSO ไม่รวม HRMS, POS ใน snapshot'), 'กำไรขาดทุน เฉพาะ บิลไลน์/ประกันสังคม ไม่รวม ระบบพนักงาน, ระบบขายหน้าร้าน ใน ชุดข้อมูล');
  assert.equal(formatApNote('ไม่มีรายการจ่ายออกที่ยืนยันซัพ จึงไม่หักเจ้าหนี้จาก statement'), 'ไม่มีรายการจ่ายออกที่ยืนยันผู้ขาย จึงไม่หักเจ้าหนี้จาก รายการธนาคาร');
});

test('AP typography stays at least 14px, with stable tabs, local fonts and a 48px theme control', async () => {
  const css = await readFile(new URL('../src/apLedger.css', import.meta.url), 'utf8');
  for (const match of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(match[1]) >= 14, match[0]);
  assert.match(css, /font-variant-numeric:tabular-nums/);
  const active = /\.ap-tabs button\.active\s*\{([^}]+)\}/.exec(css)[1];
  assert.doesNotMatch(active, /font-weight|font-size|padding|width/);
  const theme = /\.ap-theme\s*\{([^}]+)\}/.exec(css)[1];
  assert.match(css, /--sg-touch:3rem/);
  assert.match(theme, /min-width:var\(--sg-touch\)/);
  assert.match(theme, /min-height:var\(--sg-touch\)/);
  const fonts = await readFile(new URL('../src/apLedgerFonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(fonts, /url\(https?:/);
  const paths = [...fonts.matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)].map(m => m[1]);
  assert.equal(paths.length, 12);
  for (const path of paths) {
    const buffer = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.equal(buffer.subarray(0, 4).toString(), 'wOF2');
  }
  const license = await readFile(new URL('../public/fonts/OFL.txt', import.meta.url), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1.1/);
});

test('standalone AP review bundles every local WOFF2 face without external font requests', async () => {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const { apOfflineFontPlugin } = await import('../scripts/apOfflineFonts.js');
  const client = fileURLToPath(new URL('../', import.meta.url));
  const result = await build({ absWorkingDir: client, entryPoints: ['src/ApLedger.jsx'], bundle: true, write: false, outfile: 'review.js', jsx: 'automatic', loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' }, plugins: [apOfflineFontPlugin(client)], define: { 'import.meta.env.VITE_CASHFLOW_API_URL': 'undefined' } });
  const css = result.outputFiles.find(f => f.path.endsWith('.css')).text;
  assert.equal([...css.matchAll(/url\(data:font\/woff2;base64,/g)].length, 12);
  assert.equal([...css.matchAll(/url\(data:font\/ttf;base64,/g)].length, 2);
  assert.doesNotMatch(css, /url\(\/?(?:https?:|fonts\/)/);
  const exporter = await readFile(new URL('../../server/scripts/export-ap-review.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /font-src data:/);
});


test('receiving coverage preserves partial and unknown values and excludes void/reference documents', () => {
  const docs = [
    {amountSatang:10001,matchStatus:'LINKED'},
    {amountSatang:null,matchStatus:'REVIEW',reviewRequired:true},
    {amountSatang:0,matchStatus:'NO_LBC'},
    {amountSatang:900,matchStatus:'VOID'},
    {amountSatang:800,matchStatus:'REFERENCE'}
  ];
  assert.deepEqual(apReceivingCoverage(docs), {total:3,known:2,unknown:1,amount:'100.01',linked:1,review:2});
  assert.equal(apReceivingCoverage([]).amount,null);
  assert.equal(apReceivingCoverage([{amountSatang:null}]).amount,null);
  for (const amountSatang of [NaN, Infinity, '', '100', -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(apReceivingCoverage([{amountSatang}]).known,0);
  }
  assert.equal(formatApAmount('9007199254740993.01'),'9,007,199,254,740,993.01');
  assert.equal(formatApAmount('-0.01'),'-0.01');
  assert.equal(formatApAmount(null),'ยังไม่ทราบ');
});

test('supplier evidence remains scoped by supplier key across branches', () => {
  const journals = [{sourceKey:'lbc:bill:1',lines:[{supplier:'X:1'}]}, {sourceKey:'lbc:bill:2',lines:[{supplier:'Y:1'}]}];
  const sources = [{key:'lbc:bill:1'}, {key:'lbc:bill:2'}];
  assert.deepEqual(apSupplierEvidence({journals,sources},'X:1'),{journals:[journals[0]],sources:[sources[0]]});
  assert.deepEqual(apSupplierEvidence({},'X:1'),{journals:[],sources:[]});
});
