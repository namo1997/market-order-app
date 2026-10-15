import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ApOpeningStatus from '../src/ApOpeningStatus.js';
import { apOpeningState, sumApAmounts, visibleApSuppliers, apAgingTotals } from '../src/apOpeningUi.js';
import { loadApPreview } from '../src/apPreviewLoad.js';
import { apLoadErrorState } from '../src/apLedgerUi.js';

test('no opening, partial import including all blanks, and selected complete branch are distinct', () => {
  const missingSuppliers = [{ key: 'X:1', name: 'ซัพสมมติ', branch: 'X' }, { key: 'Y:1', name: 'ซัพสมมติ', branch: 'Y' }];
  const report = { controls: { openingComplete: false, missingSuppliers, byBranch: [] }, ledger: [] };
  assert.equal(apOpeningState(report).state, 'none');
  let html = renderToStaticMarkup(createElement(ApOpeningStatus, { report }));
  assert.match(html, /ยังไม่มียอดยกมา/);
  assert.match(html, /<details><summary>วิธีกรอก CSV/);
  assert.match(html, /ใส่ 0 เมื่อยืนยันว่าไม่มีหนี้ เว้นว่างเมื่อยังไม่ทราบ/);
  assert.match(html, /ซัพสมมติ — X/);
  report.controls.byBranch = [{ branch: 'X', openingImportId: 1, openingDate: '2026-08-31' }];
  assert.deepEqual(apOpeningState(report), { state: 'partial', missing: 2, label: 'ยอดยกมายังขาด 2 รายการผู้ขายแยกสาขา' });
  html = renderToStaticMarkup(createElement(ApOpeningStatus, { report }));
  assert.match(html, /31 ส.ค. 2569/);
  report.controls.openingComplete = true;
  assert.equal(apOpeningState(report).state, 'complete');
  html = renderToStaticMarkup(createElement(ApOpeningStatus, { report }));
  assert.match(html, /ยอดยกมาครบ/);
  assert.match(html, /ค่าประมาณ ไม่ใช่อายุเกินกำหนดของบิลเดิม/);
});

test('closing totals never coerce unknown branches to zero and keep exact cents and advances', () => {
  assert.equal(sumApAmounts(['100.10', '-20.01', '0.00']), '80.09');
  assert.equal(sumApAmounts(['-0.01']), '-0.01');
  assert.equal(sumApAmounts(['9007199254740993.01', '0.01']), '9007199254740993.02');
  for (const value of [null, undefined, '', 'NaN', '0', 0]) assert.equal(sumApAmounts(['100.00', value]), null);
  assert.equal(sumApAmounts([]), null);
});

test('opening-only and unpaid suppliers stay visible; all option retains certified zero rows', () => {
  const ledger = [{ key: 'opening', opening: '100.00', paid: '0.00' },
    { key: 'paid', opening: '0.00', paid: '20.00' }, { key: 'unknown', missingOpening: true, paid: '0.00' },
    { key: 'zero', opening: '0.00', closing: '0.00', paid: '0.00' }];
  assert.deepEqual(visibleApSuppliers(ledger, false).map(r => r.key), ['opening', 'paid', 'unknown']);
  assert.deepEqual(visibleApSuppliers(ledger, true), ledger);
});

test('aging uses API buckets, preserves unknown due dates and does not net advance against debt', () => {
  const bucket = { current: '0.00', days1_30: '20.10', days31_60: '0.00', days61_90: '0.00', days91plus: '0.00' };
  const report = { controls: { openingComplete: false }, ledger: [{ aging: bucket }, { aging: bucket }] };
  assert.equal(apAgingTotals(report), null);
  report.controls.openingComplete = true;
  assert.equal(apAgingTotals(report).days1_30, '40.20');
  report.ledger[1] = { closing: '-10.00', advance: '10.00', aging: { ...bucket, days1_30: '0.00' } };
  assert.equal(apAgingTotals(report).days1_30, '20.10');
  report.ledger[1].aging = null;
  assert.equal(apAgingTotals(report).days1_30, null);
});

test('local preview preserves API status/code for missing month and forwards report controls', async () => {
  const params = new URLSearchParams({ month: '2026-09', branch: 'X' });
  await assert.rejects(loadApPreview(params, async url => {
    assert.equal(url, '/api/ap/report?month=2026-09&branch=X');
    return { ok: false, status: 503, json: async () => ({ code: 'AP_NOT_IMPORTED' }) };
  }), e => apLoadErrorState(e) === 'empty');
  const data = { controls: { openingComplete: true } };
  assert.deepEqual(await loadApPreview(params, async () => ({ ok: true, json: async () => ({ data }) })), data);
  await assert.rejects(loadApPreview(params, async () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError(); } })), e => apLoadErrorState(e) === 'server');
});
