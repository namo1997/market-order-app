import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sources = {
  server: await fs.readFile(path.join(root, 'src/server.js'), 'utf8'),
  desktop: await fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
  mobileV3: await fs.readFile(path.join(root, 'mobile-admin-v3/src/api.ts'), 'utf8')
};

const parseActions = (source) => {
  const actions = new Map();
  for (const match of source.matchAll(/'((?:post|put|patch|delete):\/[^']+)'\s*:\s*'([^']+)'/g)) {
    actions.set(match[1], match[2]);
  }
  return actions;
};

const serverActions = parseActions(sources.server);
assert.ok(serverActions.size >= 23, `expected at least 23 audited actions, found ${serverActions.size}`);
for (const [name, source] of Object.entries({ desktop: sources.desktop, mobileV3: sources.mobileV3 })) {
  const actions = parseActions(source);
  for (const [route, actionKey] of serverActions) {
    assert.equal(actions.get(route), actionKey, `${name} action drift for ${route}`);
  }
  assert.match(source, /X-Decision-Id/, `${name} must attach a decision log id`);
  assert.match(source, /X-Decision-Reason-Code['"]?:\s*['"]user_action/, `${name} must classify silent user-action logs`);
  assert.doesNotMatch(source, /agents\/runs|AI กำลังวิเคราะห์เอกสารนี้|ใช้เหตุผล AI เป็นร่าง/, `${name} must not run Shadow AI`);
}
assert.doesNotMatch(sources.server, /runShadowDecision|\/api\/admin\/agents\//);
assert.match(sources.mobileV3, /live:\s*1/, 'mobile V3 work queue must exclude unsent and duplicate evidence');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-decision-audit-'));
process.env.CAPTURE_DATA_DIR = tempDir;
process.env.CAPTURE_DB_PATH = path.join(tempDir, 'audit.sqlite');
const db = await import(`../src/db.js?audit=${Date.now()}`);

const created = await db.createDecisionEvent({
  actionKey: 'document.metadata.update',
  entityType: 'item',
  entityId: '42',
  actor: 'สา',
  pageUrl: '/admin?item=42',
  contextSnapshot: { route: '/items/42', method: 'PATCH', request: { amount: 2970 } }
});
assert.equal(created.shadow_run_id, undefined);
const beforeCommit = await db.getDecisionEvent(created.id);
assert.equal(beforeCommit.actor, 'สา');
assert.equal(beforeCommit.context_snapshot.context.request.amount, 2970);

const committed = await db.commitDecisionEvent({
  id: created.id,
  actionKey: 'document.metadata.update',
  route: '/api/admin/items/42',
  method: 'PATCH',
  reasonCode: 'user_action',
  reasonText: '',
  requestPayload: { amount: 2970 }
});
assert.equal(committed.status, 'committed');
await db.finishDecisionEvent({ id: created.id, success: true, httpStatus: 200 });
const completed = await db.getDecisionEvent(created.id);
assert.equal(completed.status, 'completed');
assert.equal(completed.reason_code, 'user_action');
assert.equal(completed.request_payload.amount, 2970);

const rows = await db.listDecisionEvents({ limit: 10 });
assert.equal(rows.length, 1);
assert.equal(rows[0].actor, 'สา');

console.log(`decision audit: ${serverActions.size} actions aligned; silent user log passed`);
