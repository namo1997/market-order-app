import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('financial mutations create a local audit context without an AI reviewer', async () => {
  const source = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /shadow|agentHealth|answerDecisionFollowup/i);
  assert.match(source, /X-Decision-Reason-Code': 'human_observed_action'/);
  assert.match(source, /rawRequest\('\/decision-contexts'/);
});
