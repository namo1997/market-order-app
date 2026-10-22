import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');

test('bill training (MVP): only accounting/admin roles see it; staff never do', async () => {
  const source = await read('./BillTraining.jsx');
  const roles = source.match(/canTrainBills = user => \[(.*?)\]\.includes/)[1];
  assert.equal(roles, "'admin', 'super_admin', 'accounting', 'accountant'");
  const app = await read('./ReceivingApp.jsx');
  assert.match(app, /\{canTrainBills\(user\) && <button className="secondary" disabled=\{busy\} onClick=\{onTrain\}>สอนอ่านบิล<\/button>\}/);
});

test('bill training (MVP): saves through the audited alias endpoint with optional item code, never OCR', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /api\.createAlias\(key, body\)/);
  assert.match(source, /if \(form\.item_code\.trim\(\)\) body\.item_code = form\.item_code\.trim\(\)/);
  assert.match(source, /api\.setAliasActive\(key, alias\.id, !alias\.is_active\)/);
  assert.doesNotMatch(source, /api\.(ocr|uploadImage)\(/);
});

test('bill training (MVP): opening it never hides unsaved receiving work; Back closes it first', async () => {
  const app = await read('./ReceivingApp.jsx');
  assert.match(app, /if \(!guard\.isDirty\(\)\) setTrainPage\(true\); else setError\(/);
  assert.ok(app.indexOf('if (trainPage) { setTrainPage(false); return; }') < app.indexOf('if (pageBack.current)'));
  assert.match(app, /hidden=\{settings \|\| trainPage\}/);
  assert.match(app, /setIssuePage\(false\); setTrainPage\(false\); setUser\(null\)/);
});
