import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const rule = (css, selector) => {
  const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => m[1].trim().endsWith(selector));
  assert.ok(found.length, `missing rule for ${selector}`);
  return found.at(-1)[2];
};

test('P6: back-to-queue button never wraps and keeps a 48px target', async () => {
  const css = await read('../src/pages/receiving/review-a.css');
  const button = rule(css, '.ra-heading>button');
  assert.match(button, /white-space:nowrap/); assert.match(button, /flex-shrink:0/);
  assert.match(button, /min-height:48px/); assert.match(button, /min-width:48px/);
  const source = await read('../src/pages/receiving/DocumentEditor.jsx');
  assert.match(source, /<header className="ra-heading"><button[^>]*>\{backLabel\}<\/button>/); assert.match(source, /backLabel = 'กลับคิว'/);
});

test('P6: a long shop name wraps and clamps to two lines with ellipsis', async () => {
  const css = await read('../src/pages/receiving/review-a.css');
  const title = rule(css, '.ra-heading h1');
  assert.match(title, /-webkit-line-clamp:2/); assert.match(title, /overflow:hidden/); assert.match(title, /text-overflow:ellipsis/);
  assert.match(css, /\.ra-heading>div \{[^}]*min-width:0/);
});

test('P7: sheet cancel is a styled secondary button using tokens and a 48px target', async () => {
  const css = await read('../src/pages/receiving/receiving.css');
  const cancel = rule(css, '.rc-sign-actions .rc-sign-cancel');
  for (const re of [/min-height: 48px/, /background: var\(--sg-surface\)/, /color: var\(--sg-text\)/,
    /border: 1px solid var\(--sg-control-border\)/, /border-radius: var\(--sg-radius-md\)/, /white-space: nowrap/]) assert.match(cancel, re);
  assert.doesNotMatch(cancel, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /\.rc-sign-cancel:focus-visible/);
  const source = await read('../src/pages/receiving/SignaturePad.jsx');
  assert.match(source, /className="rc-sign-cancel"[^>]*>ยกเลิก<\/button>/);
});
