import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { focusField } from '../src/pages/receiving/receiving-validation.js';

const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
const declaration = (selector, name) => {
  let value;
  css.walkRules(selector, rule => rule.walkDecls(name, decl => { value = decl.value; }));
  return value;
};

test('review focus: focused quantity clears both keyboard viewport and bottom bar', () => {
  const calls = [];
  const input = { closest: () => null, focus: options => calls.push(['focus', options]), scrollIntoView() {}, getBoundingClientRect: () => ({ top: 300, bottom: 380 }) };
  const root = { getElementById: () => input, defaultView: { innerHeight: 800, visualViewport: { offsetTop: 0, height: 400 }, scrollBy: options => calls.push(['scroll', options]) },
    querySelector: selector => ({ getBoundingClientRect: () => selector.includes('toolbar') ? { bottom: 96 } : { top: 300 } }) };
  focusField('quantity', root);
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { top: 80, behavior: 'instant' }]]);
});

test('review layout contract: content and focused fields reserve measured bar height plus safe area', () => {
  assert.match(declaration('.solao .rc-document', '--rc-clearance'), /var\(--rc-bar-height\).*var\(--sg-safe-bottom\)/);
  assert.equal(declaration('.solao .rc-document', 'padding-bottom'), 'var(--rc-clearance)');
  assert.match(declaration('.solao .rc-document :where(input, button, .rc-compact-item)', 'scroll-margin-block'), /var\(--rc-clearance\)/);
  assert.match(declaration('html:has(.rc-document)', 'scroll-padding-bottom'), /var\(--rc-page-bar-height/);
  assert.match(declaration('.solao .rc-document .sg-bar', 'bottom'), /var\(--sg-safe-bottom\).*var\(--rc-keyboard-offset\)/);
});

test('review layout contract: sticky help has an opaque surface, checkbox target is 48px token, icon labels >=14px', async () => {
  assert.equal(declaration('.solao .rc-review-toolbar', 'position'), 'sticky');
  assert.equal(declaration('.solao .rc-review-toolbar', 'background'), 'var(--sg-surface)');
  assert.equal(declaration('.solao .rc-bulk-check', 'width'), 'var(--sg-touch)');
  assert.equal(declaration('.solao .rc-bulk-check', 'height'), 'var(--sg-touch)');
  assert.equal(declaration('.solao .rc-receiving-actions > .sg-labeled-button', 'font-size'), 'var(--sg-type-icon-label)');
  const tokens = await readFile(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--sg-type-icon-label: .875rem/);
});
