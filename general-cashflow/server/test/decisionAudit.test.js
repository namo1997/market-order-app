import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { redactForShadow } from '../src/agents/decisionAudit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(here, '../src/server.js'), 'utf8');
const clientSource = fs.readFileSync(path.resolve(here, '../../client/src/api.js'), 'utf8');

const parseActions = (source) => {
  const actions = new Map();
  for (const match of source.matchAll(/'((?:post|put|patch|delete):\/[^']+)'\s*:\s*'([^']+)'/g)) {
    actions.set(match[1], match[2]);
  }
  return actions;
};

test('client and server use the same semantic action keys', () => {
  const serverActions = parseActions(serverSource);
  const clientActions = parseActions(clientSource);
  assert.ok(serverActions.size >= 20);
  for (const [route, actionKey] of serverActions) {
    assert.equal(clientActions.get(route), actionKey, `action drift for ${route}`);
  }
  assert.match(serverSource, /decisions\/:id\/cancel/);
  assert.match(clientSource, /rawRequest\('\/decision-contexts'/);
  assert.match(clientSource, /X-Decision-Reason-Code': 'shadow_observed_human_action'/);
  assert.doesNotMatch(clientSource, /askDecisionReason|decision-reason-dialog/);
});

test('Shadow snapshot removes secrets but preserves operational evidence', () => {
  const input = {
    amount: 15399,
    account_number: '1234567193',
    nested: { authorization: 'Bearer private', api_key: 'sk-proj-private-value-1234567890' },
    memo: 'ยอดตรงกับหลักฐาน'
  };
  const redacted = redactForShadow(input);
  assert.equal(redacted.amount, 15399);
  assert.equal(redacted.memo, 'ยอดตรงกับหลักฐาน');
  assert.equal(redacted.account_number, '[REDACTED]');
  assert.equal(redacted.nested.authorization, '[REDACTED]');
  assert.equal(redacted.nested.api_key, '[REDACTED]');
});
