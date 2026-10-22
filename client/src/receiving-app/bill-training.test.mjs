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

test('test scan: one paid read on a fresh department draft, rows counted 0 to open the read, never confirmed', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /resume_draft: false, client_uuid: uuid\(\)/);
  assert.match(source, /receiving_scope: 'department'/);
  assert.match(source, /counted_quantity: '0'/);
  assert.doesNotMatch(source, /\.confirm\(|\.void\(/);
});

test('test scan uses the same capture as receiving a bill (document scanner), not the browser stub', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /\(await import\('\.\/native-capture\.mjs'\)\)\.captureImage/);
  assert.doesNotMatch(source, /pages\/receiving\/image-capture/);
  assert.match(source, /import \{ compressImage \} from '\.\.\/pages\/receiving\/image-utils';/);
});

test('test scan creates the test receipt where the shop can be received (own department first, admins may pick another)', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /if \(await canReceive\(own\)\) return own;/);
  assert.match(source, /if \(!\['admin', 'super_admin'\]\.includes\(user\.role\)\) return null;/);
  assert.match(source, /user: \{ \.\.\.user, \.\.\.scope, receiving_scope: 'department' \}/);
  assert.ok(source.indexOf('findTestScope(d, user, detail)') < source.indexOf('d.create('));
});

test('customer names: taught per shop -> branch from the training page and the test scan shows the read addressee', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /api\.createCustomerName\(key, body\)/);
  assert.match(source, /const body = \{ customer_name: customer\.name\.trim\(\), branch_id: Number\(customer\.branch\) \}/);
  assert.match(source, /api\.setCustomerNameActive\(key, row\.id, !row\.is_active\)/);
  assert.match(source, /addressee: full\.ocr\?\.addressee \|\| null/);
  assert.match(source, /สอนชื่อลูกค้านี้/);
  const admin = await read('../api/receiving-admin.js');
  assert.match(admin, /customer-names\/\$\{encodeURIComponent\(id\)\}\/\$\{active \? 'enable' : 'disable'\}/);
});

test('training: zero-row reads still open (one taught product counted 0, hidden from the result); suggestions, doc kind and format note are shown', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /lines: \[\{ product_id: placeholder, unit_text: '', counted_quantity: '0' \}\]/);
  assert.match(source, /filter\(line => !\(line\.match\?\.source === 'manual' && !line\.bill_text\)\)/);
  assert.match(source, /AI เสนอ: \{line\.suggested_product_name\}/);
  assert.match(source, /AI มองว่าเป็น/);
  assert.match(source, /api\.saveSupplierProfile\(key, \{ bill_format_note: formatNote\.trim\(\) \|\| null \}\)/);
});

test('training: bill number shape is taught per shop and hidden on a server that does not support it', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /api\.saveBillRefPattern\(key, refPattern\.value\.trim\(\) \|\| null\)/);
  assert.match(source, /catch \{ setRefPattern\(\{ value: '', saved: '', unavailable: true \}\); \}/);
  assert.match(source, /\{!refPattern\.unavailable && <form onSubmit=\{saveRefPattern\}/);
});

test('training: bill unit and "1 bill unit = N product units" are taught with the name (case of 24 -> 24 cans)', async () => {
  const source = await read('./BillTraining.jsx');
  assert.match(source, /if \(form\.multiplier\.trim\(\) && Number\(form\.multiplier\) !== 1\) body\.unit_multiplier = form\.multiplier\.trim\(\)/);
  assert.match(source, /if \(form\.unit_text\.trim\(\)\) body\.unit_text = form\.unit_text\.trim\(\)/);
  assert.match(source, /1 หน่วยในบิล = กี่/);
});
