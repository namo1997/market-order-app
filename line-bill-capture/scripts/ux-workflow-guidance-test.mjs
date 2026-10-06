import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/workflow-guidance.js', import.meta.url), 'utf8');
const context = vm.createContext({ document: { getElementById: () => null } });
vm.runInContext(source, context);
const plan = (bucket, problem) => JSON.parse(JSON.stringify(context.workflowProblemPlan(bucket, problem)));

test('non-purchase money cannot offer expense creation, classification or matching', () => {
  for (const bucket of ['bill', 'slip', 'review']) {
    const result = plan(bucket, 'non_purchase');
    assert.deepEqual(result.controls, []);
    assert.ok(!result.receipt);
    assert.match(result.text, /โอนระหว่างบัญชี/);
    assert.match(result.text, /อย่าสร้างใบแทน/);
    assert.match(result.text, /อย่าย้ายหลักฐานการเงิน/);
  }
});

test('missing evidence offers receipt only for unmatched slips and searches the opposite document', () => {
  assert.deepEqual(plan('bill', 'missing').controls, ['selected-pick-slip']);
  assert.deepEqual(plan('slip', 'missing').controls, ['selected-pick-bill']);
  assert.equal(plan('slip', 'missing').receipt, true);
  assert.equal(plan('bill', 'missing').receipt, false);
  assert.equal(plan('review', 'missing').receipt, false);
  assert.match(plan('slip', 'missing').text, /กลุ่มอื่น/);
});

test('incomplete evidence offers navigation and explicitly discloses no persisted parking', () => {
  for (const bucket of ['bill', 'slip', 'review']) {
    const result = plan(bucket, 'incomplete');
    assert.deepEqual(result.controls, ['skip-current']);
    assert.ok(!result.receipt);
    assert.match(result.text, /ไม่บันทึกสถานะพักหรือเหตุผล/);
  }
});

test('amount conflicts retain original evidence and use the correct existing editor', () => {
  assert.deepEqual(plan('bill', 'amount').controls, ['workflow-bill-amount']);
  assert.deepEqual(plan('slip', 'amount').controls, ['selected-edit-amount']);
  assert.deepEqual(plan('review', 'amount').controls, ['workflow-pair-amount']);
  assert.match(plan('slip', 'amount').text, /อย่าแก้ยอดต้นฉบับ/);
  assert.deepEqual(plan('review', 'wrong_pair').controls, ['change', 'reject', 'combine-match']);
});

test('unknown problems return null', () => {
  for (const problem of ['', 'unknown', 'toString', 'constructor', '__proto__', null, undefined]) {
    assert.equal(context.workflowProblemPlan('slip', problem), null);
  }
});

test('page includes guidance and retains original controls instead of cloning handlers', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/admin\/workflow-guidance\.js"/);
  assert.match(html, /href="\/admin\/workflow-guidance\.css"/);
  assert.match(source, /moreBody\.append\(node\)/);
  assert.match(source, /routes\.append\(node\)/);
  assert.doesNotMatch(source, /cloneNode|innerHTML|fetch\s*\(/);
  assert.match(source, /panel\.querySelector\('#review-next'\)/);
  assert.match(source, /receiptChecks\.hidden = !plan\.receipt/);
  assert.match(source, /receipt\.disabled = !checkboxes\.every\(check => check\.checked\)/);
  assert.match(source, /checkboxes\.forEach\(input => \{ input\.checked = false; \}\)/);
});
