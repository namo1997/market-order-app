import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Shadow AI records human actions without interrupting the workflow', async () => {
  const source = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /askDecisionReason|บันทึกการตัดสินใจ|เหตุผลที่ทำรายการนี้/);
  assert.match(source, /X-Decision-Reason-Code': 'shadow_observed_human_action'/);
  assert.match(source, /rawRequest\('\/decision-contexts'/);
});
