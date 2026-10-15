import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server, Preview;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()],
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Preview = (await server.ssrLoadModule('/src/design/DesignPreview.jsx')).default;
});
after(async () => { await server?.close(); });

test('r3 preview: SSR catalog has paired themes, motion switch and critical action flow without stale success', () => {
  const html = renderToStaticMarkup(React.createElement(Preview));
  assert.ok(html.includes('data-theme="light"')); assert.ok(html.includes('data-theme="dark"'));
  assert.ok(html.includes('role="switch"')); assert.ok(html.includes('งานสำคัญ'));
  assert.ok(!html.includes('บันทึกฉบับร่างตัวอย่างแล้ว'));
  assert.equal((html.match(/>ตรงกัน</g) || []).length, 2);
  assert.ok(!/class="[^"]*sg-primary[^"]*sg-glass/.test(html));
  assert.ok(!/class="[^"]*sg-sheet[^"]*sg-glass/.test(html));
});

test('r3 preview: mobile follows OS even if storage denied; fixed bar and sticky segmented alone get glass', () => {
  globalThis.window = { location: { search: '?view=mobile&theme=dark' },
    matchMedia: () => ({ matches: true }), get localStorage() { throw Error('storage unavailable'); } };
  try {
    const html = renderToStaticMarkup(React.createElement(Preview));
    assert.ok(html.includes('data-motion="reduce"')); assert.ok(html.includes('role="switch" checked=""'));
    assert.equal((html.match(/<article/g) || []).length, 9);
    assert.equal((html.match(/class="[^"]*sg-glass/g) || []).length, 2);
    assert.ok(html.includes('sg-segmented-sticky')); assert.ok(!html.includes('sg-bar-inline'));
    assert.ok(html.includes('การแสดงผล')); assert.ok(!html.includes('บันทึกฉบับร่างตัวอย่างแล้ว'));
  } finally { delete globalThis.window; }
});

test('r3 preview: saved user motion overrides system default', () => {
  globalThis.window = { location: { search: '?view=mobile' }, matchMedia: () => ({ matches: true }), localStorage: { getItem: () => 'full' } };
  try { assert.ok(renderToStaticMarkup(React.createElement(Preview)).includes('data-motion="full"')); }
  finally { delete globalThis.window; }
});

test('r3 type: every CSS font size uses shared tokens; fluid rem scale exists only in tokens', async () => {
  const root = new URL('../src/design/', import.meta.url);
  const tokens = await readFile(new URL('tokens.css', root), 'utf8');
  for (const [, name, value] of tokens.matchAll(/--sg-type-([a-z]+):\s*([^;]+);/g)) {
    assert.ok(value.includes('rem'), name); assert.ok(!value.includes('px'), name);
    if (!['body', 'caption'].includes(name)) assert.ok(value.startsWith('clamp('), name);
  }
  for (const file of ['styles.css', 'preview.css']) {
    const css = await readFile(new URL(file, root), 'utf8');
    assert.ok(!css.includes('clamp('), file);
    for (const [, size] of css.matchAll(/font-size:\s*([^;\n}]+)/g)) assert.ok(size.trim() === 'inherit' || size.includes('var(--sg-type-'), `${file}: ${size}`);
  }
});
