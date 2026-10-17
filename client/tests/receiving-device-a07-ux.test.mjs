import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a07 UX: tokens.css supports :root.solao[data-theme="dark"] and :root.solao[data-theme="auto"]', async () => {
  const cssText = await read('../src/design/tokens.css');
  const root = postcss.parse(cssText);

  let autoDarkFound = false;
  let manualDarkFound = false;

  root.walkAtRules('media', atRule => {
    if (atRule.params.includes('prefers-color-scheme: dark')) {
      atRule.walkRules(rule => {
        const selectors = rule.selectors || rule.selector.split(',').map(s => s.trim());
        if (selectors.includes(":root.solao[data-theme='auto']")) {
          autoDarkFound = true;
          let hasBg = false;
          rule.walkDecls('--sg-bg', () => { hasBg = true; });
          assert.ok(hasBg, 'auto dark theme defines --sg-bg');
        }
      });
    }
  });

  root.walkRules(rule => {
    const selectors = rule.selectors || rule.selector.split(',').map(s => s.trim());
    if (selectors.includes(":root.solao[data-theme='dark']")) {
      manualDarkFound = true;
      let hasBg = false;
      rule.walkDecls('--sg-bg', () => { hasBg = true; });
      assert.ok(hasBg, 'explicit dark theme defines --sg-bg');
    }
  });

  assert.ok(autoDarkFound, "tokens.css must contain :root.solao[data-theme='auto'] inside dark media query");
  assert.ok(manualDarkFound, "tokens.css must contain :root.solao[data-theme='dark'] selector");
});

test('a07 UX: ImagePages hides add-page button when empty, but renders when images or pending exist', async () => {
  const emptyDoc = { id: 1, status: 'draft', images: [] };
  const mockApi = { image: async () => new Blob(['synthetic-image']) };

  const hEmpty = await harness('ImagePages', {
    doc: emptyDoc,
    pending: [],
    setPending: () => {},
    setProcessing: () => {},
    inputRef: { current: null },
  }, mockApi);

  const hasAddButton = h => h.all().some(node => node.type === 'button' && h.text(node) === 'เพิ่มหน้า');
  const hasPhotosSection = h => h.all().some(node => node.props?.className === 'rc-photos');
  const hasSectionHeading = h => h.all().some(node => node.props?.className === 'rc-section-heading' && h.text(node).includes('รอส่ง'));

  assert.equal(hasAddButton(hEmpty), false, 'Empty bill step (0/10) must not show duplicate เพิ่มหน้า button');
  assert.equal(hasPhotosSection(hEmpty), false, 'Empty bill step must not show .rc-photos container');
  assert.equal(hasSectionHeading(hEmpty), false, 'Empty bill step must not show empty pending heading');
  hEmpty.unmount();

  const savedDoc = { id: 2, status: 'draft', images: [{ id: 101, page_no: 1 }] };
  const hSaved = await harness('ImagePages', {
    doc: savedDoc,
    pending: [],
    setPending: () => {},
    setProcessing: () => {},
    inputRef: { current: null },
  }, mockApi);
  assert.equal(hasAddButton(hSaved), true, 'When doc has images, เพิ่มหน้า button must be shown');
  assert.equal(hasPhotosSection(hSaved), true, 'When doc has images, .rc-photos container must be shown');
  hSaved.unmount();

  const pendingItem = {
    key: 'pending-1',
    dataUrl: 'data:image/jpeg;base64,synthetic',
    quality: { warnings: [] },
    blob: new Blob(['synthetic']),
  };
  const hPending = await harness('ImagePages', {
    doc: emptyDoc,
    pending: [pendingItem],
    setPending: () => {},
    setProcessing: () => {},
    inputRef: { current: null },
  }, mockApi);
  assert.equal(hasAddButton(hPending), true, 'When pending photos exist, เพิ่มหน้า button must be shown');
  assert.equal(hasPhotosSection(hPending), true, 'When pending photos exist, .rc-photos container must be shown');
  assert.equal(hasSectionHeading(hPending), true, 'When pending photos exist, pending heading must be shown');
  hPending.unmount();
});

test('a07 UX: receiving.css contains queue clearance, bill button shrink prevention, and warning icon gap', async () => {
  const cssText = await read('../src/pages/receiving/receiving.css');
  const root = postcss.parse(cssText);

  const rules = {};
  root.walkRules(rule => {
    const decls = {};
    rule.walkDecls(decl => { decls[decl.prop] = decl.value; });
    rules[rule.selector] = { ...rules[rule.selector], ...decls };
  });

  const queueClearance = rules['.solao.rc-app.sg-with-bar:not(:has(.rc-document))'];
  assert.ok(queueClearance, 'Rule .solao.rc-app.sg-with-bar:not(:has(.rc-document)) must exist');
  assert.equal(queueClearance['padding-bottom'], 'calc(var(--sg-bar-clearance) + var(--sg-space-6))');

  const billRawButton = rules['.solao .rc-bill-raw > button'];
  assert.ok(billRawButton, 'Rule .solao .rc-bill-raw > button must exist');
  assert.equal(billRawButton['flex-shrink'], '0');
  assert.equal(billRawButton['white-space'], 'nowrap');

  const lineNameSmall = rules['.solao .rc-line-name small'];
  assert.ok(lineNameSmall, 'Rule .solao .rc-line-name small must exist');
  assert.equal(lineNameSmall.display, 'flex');
  assert.equal(lineNameSmall['align-items'], 'center');
  assert.equal(lineNameSmall.gap, 'var(--sg-space-1)');

  const reviewedLineNameSmall = rules[".solao .rc-compact-item[data-reviewed='true'] .rc-line-name small"];
  assert.ok(reviewedLineNameSmall, "Rule .solao .rc-compact-item[data-reviewed='true'] .rc-line-name small must exist");
  assert.equal(reviewedLineNameSmall.display, 'flex');
  assert.equal(reviewedLineNameSmall['align-items'], 'center');
  assert.equal(reviewedLineNameSmall.gap, 'var(--sg-space-1)');
});
