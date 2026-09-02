import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sources = {
  server: await fs.readFile(path.join(root, 'src/server.js'), 'utf8'),
  desktop: await fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
  mobileV2: await fs.readFile(path.join(root, 'mobile-admin-v2/src/api.ts'), 'utf8'),
  mobileV3: await fs.readFile(path.join(root, 'mobile-admin-v3/src/api.ts'), 'utf8'),
  mobileV2App: await fs.readFile(path.join(root, 'mobile-admin-v2/src/App.tsx'), 'utf8'),
  mobileV3App: await fs.readFile(path.join(root, 'mobile-admin-v3/src/App.tsx'), 'utf8'),
  mobileLegacy: await fs.readFile(path.join(root, 'mobile-admin/src/api.ts'), 'utf8')
};
const decisionStyles = {
  mobileV2: await fs.readFile(path.join(root, 'mobile-admin-v2/src/styles.css'), 'utf8'),
  mobileV3: await fs.readFile(path.join(root, 'mobile-admin-v3/src/styles.css'), 'utf8')
};

for (const [name, source] of Object.entries({ desktop: sources.desktop, mobileV2: sources.mobileV2, mobileV3: sources.mobileV3 })) {
  assert.match(source, /กดแล้วบันทึก/, `${name} must explain that preset reasons submit immediately`);
  assert.match(source, /ai_learning_approved/, `${name} must carry approved match reasons into AI learning`);
}
for (const [name, source] of Object.entries({ mobileV2: sources.mobileV2, mobileV3: sources.mobileV3 })) {
  assert.match(source, /headers: \{ 'Content-Type': 'application\/json', \.\.\.\(headers \|\| \{\}\) \}/, `${name} must retain JSON content type when decision headers are added`);
}

const parseActions = (source) => {
  const actions = new Map();
  for (const match of source.matchAll(/'((?:post|put|patch|delete):\/[^']+)'\s*:\s*'([^']+)'/g)) {
    actions.set(match[1], match[2]);
  }
  return actions;
};

const serverActions = parseActions(sources.server);
assert.ok(serverActions.size >= 23, `expected at least 23 guarded actions, found ${serverActions.size}`);
for (const [name, source] of Object.entries(sources)) {
  if (name === 'server' || name.endsWith('App')) continue;
  const actions = parseActions(source);
  for (const [route, actionKey] of serverActions) {
    assert.equal(actions.get(route), actionKey, `${name} action drift for ${route}`);
  }
}
assert.match(sources.server, /decisions\/:id\/cancel/);
assert.match(sources.desktop, /decisions\/\$\{context\.data\.id\}\/cancel/);
assert.match(sources.mobileV2, /decisions\/\$\{decision\.id\}\/cancel/);
assert.match(sources.mobileLegacy, /decisions\/\$\{decision\.id\}\/cancel/);
assert.match(sources.desktop, /X-Decision-Evidence-Ids/);
assert.match(sources.mobileV2, /X-Decision-Evidence-Ids/);
assert.match(sources.mobileV2, /live:\s*1/, 'mobile V2 work queue must exclude unsent and duplicate evidence');
assert.match(sources.mobileLegacy, /live:\s*1/, 'legacy mobile work queue must exclude unsent and duplicate evidence');
assert.match(sources.desktop, /\.decisionactions\{position:sticky;bottom:0/, 'desktop decision actions must remain visible while long reasons scroll');
for (const [name, styles] of Object.entries(decisionStyles)) {
  assert.match(styles, /\.decision-sheet-actions\{position:sticky;/, `${name} decision actions must remain visible above long content and the keyboard`);
  assert.match(styles, /max-height:94dvh;overflow:auto;overscroll-behavior:contain/, `${name} decision sheet must scroll inside the visible viewport`);
  assert.match(styles, /\.decision-sheet label\[hidden\]\{display:none!important\}/, `${name} custom reason must stay hidden until selected`);
}
assert.match(sources.mobileV2App, /bill\?\.id \|\| match\?\.bill_item_id/, 'mobile V2 must retain match ids while the reason dialog is open');
assert.match(sources.mobileV3App, /bill\?\.id \|\| match\?\.bill_item_id/, 'mobile V3 must retain match ids while the reason dialog is open');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-decision-audit-'));
process.env.CAPTURE_DATA_DIR = tempDir;
process.env.CAPTURE_DB_PATH = path.join(tempDir, 'audit.sqlite');
const db = await import(`../src/db.js?audit=${Date.now()}`);

const created = await db.createDecisionEvent({
  actionKey: 'document.metadata.update',
  entityType: 'item',
  entityId: '42',
  contextSnapshot: {
    amount: 2970,
    account_number: '7193',
    chat_text: 'โอนไปบัญชี 123-4-56789-0 แล้ว',
    nested: { api_key: 'test-secret-this-must-never-leave-the-audit-store' }
  }
});
const beforeCancel = await db.getDecisionEvent(created.id);
assert.equal(beforeCancel.context_snapshot.context.account_number, '7193');
assert.equal(beforeCancel.input_snapshot.context.account_number, '[REDACTED]');
assert.equal(beforeCancel.input_snapshot.context.nested.api_key, '[REDACTED]');
assert.equal(beforeCancel.input_snapshot.context.chat_text, 'โอนไปบัญชี [REDACTED_NUMBER] แล้ว');
assert.equal(beforeCancel.input_snapshot.context.amount, 2970);

const cancelled = await db.cancelDecisionEvent({ id: created.id });
assert.equal(cancelled.cancelled, true);
const afterCancel = await db.getDecisionEvent(created.id);
assert.equal(afterCancel.status, 'cancelled');
const reused = await db.commitDecisionEvent({
  id: created.id,
  actionKey: 'document.metadata.update',
  route: '/api/admin/items/42',
  method: 'PATCH',
  reasonCode: 'manual_review',
  reasonText: 'ตรวจแล้ว',
  requestPayload: {}
});
assert.equal(reused.error, 'decision_already_used');

await db.recordLineEvent({
  type: 'message', webhookEventId: 'decision-evidence-event', timestamp: 1787385600000,
  source: { type: 'group', groupId: 'Gdecision', userId: 'Ureviewer' },
  message: { id: 'decision-evidence-message', type: 'text', text: 'ยอดและชื่อร้านตรงกับบิลในแชท' }
});
const evidenceMessage = (await db.listMessages({ sourceId: 'Gdecision', limit: 10 }))[0];
const evidenceDecision = await db.createDecisionEvent({
  actionKey: 'match.review', entityType: 'match', entityId: '99',
  contextSnapshot: { evidence_candidates: [{ id: evidenceMessage.id, text: evidenceMessage.text }] }
});
const committed = await db.commitDecisionEvent({
  id: evidenceDecision.id,
  actionKey: 'match.review',
  route: '/api/admin/matches',
  method: 'POST',
  reasonCode: 'chat_context',
  reasonText: 'ยึดข้อความแจ้งในกลุ่ม',
  evidenceMessageIds: [evidenceMessage.id],
  requestPayload: { bill_item_id: 1, slip_item_id: 2 }
});
assert.equal(committed.evidence_count, 1);
const storedEvidence = await db.getDecisionEvent(evidenceDecision.id);
assert.equal(storedEvidence.evidence.length, 1);
assert.equal(storedEvidence.evidence[0].text, 'ยอดและชื่อร้านตรงกับบิลในแชท');
assert.equal(storedEvidence.evidence[0].sender_user_id, 'Ureviewer');

console.log(`decision audit: ${serverActions.size} actions aligned; cancellation, Shadow redaction, and chat evidence passed`);
