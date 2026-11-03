import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { baht, billState, canCollectPayables, currentPeriod, formBody, lineText, rateLimited } from './payables-logic.mjs';

// Owner 2026-11-02 "ระบบรวบรวมเจ้าหนี้": accounting picks a supplier, photographs the bill, the AI reads it with
// quantities and prices, and the month shows the amount owed per supplier.
const read = name => readFile(new URL(name, import.meta.url), 'utf8');

test('payables: only accounting/admin roles get the menu; staff never do', async () => {
  for (const role of ['admin', 'super_admin', 'accounting', 'accountant']) assert.equal(canCollectPayables({ role }), true, role);
  for (const role of ['staff', 'user', 'manager', undefined]) assert.equal(canCollectPayables({ role }), false, String(role));
  const app = await read('./ReceivingApp.jsx');
  assert.match(app, /\{canCollectPayables\(user\) && <button className="secondary" disabled=\{busy\} onClick=\{onPayables\}>รวบรวมเจ้าหนี้<\/button>\}/);
  assert.match(app, /if \(!guard\.isDirty\(\)\) \{ setTrainPage\(false\); setPayPage\(true\); \}/, 'unsaved receiving work is never hidden');
  assert.match(app, /hidden=\{settings \|\| trainPage \|\| payPage\}/);
  assert.match(app, /if \(payPage\) \{ setPayPage\(false\); return; \}/, 'Back closes the page');
});

test('payables: the flow is pick shop → photograph → read with prices → save → next bill of the same shop', async () => {
  const page = await read('./Payables.jsx');
  assert.match(page, /payablesAPI\.create\(picked\.supplier_key\)/);
  assert.match(page, /payablesAPI\.uploadPage\(target\.id, pageNo, image\.dataUrl\)/);
  assert.match(page, /payablesAPI\.read\(target\.id\)/);
  assert.match(page, /if \(next\) await newBill\(shop \|\| /, 'saving with "ถ่ายใบถัดไป" opens the camera for the same shop');
  assert.match(page, /if \(!read\) \{ await payablesAPI\.remove\(created\.id\)/, 'a cancelled camera leaves no empty bill');
  assert.doesNotMatch(page, /receivingDocumentsAPI|count\(|confirm\(/, 'never creates receipts or touches stock');
});

test('payables: "ถ่ายบิลเพิ่ม" photographs bill after bill of the same shop; reads queue behind the camera, one at a time', async () => {
  const page = await read('./Payables.jsx');
  assert.equal((page.match(/onClick=\{captureMore\}>ถ่ายบิลเพิ่ม<\/button>/g) || []).length, 2, 'on the bill and on the shop list');
  assert.match(page, /for \(let count = 1; ; count \+= 1\) \{\s+const file = await capture\(\);\s+if \(!file\) break;/, 'closing the camera ends the run');
  assert.match(page, /readLater\(created\.id\);/, 'no waiting for the AI between photos');
  assert.match(page, /reads\.current = reads\.current\.then\(/, 'one read at a time');
  assert.match(page, /catch \(err\) \{ await payablesAPI\.remove\(created\.id\)/, 'a failed upload leaves no empty bill');
  assert.match(page, /JSON\.stringify\(form\) !== JSON\.stringify\(formOf\(bill\)\)\) await payablesAPI\.update\(bill\.id, formBody\(form, bill\.status\)\)/, 'edits on the open bill are kept, its status unchanged');
  assert.match(page, /\['none', 'failed'\]\.includes\(bill\.ocr_status\) && !queued\.current\.has\(bill\.id\)/, 'an unread bill can be read by hand unless already queued');
  assert.equal(billState({ status: 'saved', ocr_status: 'done' }), '');
  assert.deepEqual(['none', 'pending', 'failed', 'done'].map(ocr_status => billState({ status: 'draft', ocr_status })), ['รออ่าน', 'กำลังอ่าน', 'อ่านไม่ได้', 'ยังไม่บันทึก']);
  assert.equal(rateLimited({ response: { status: 429 } }), true); assert.equal(rateLimited({ response: { status: 500 } }), false);
});

test('payables: money and rows read plainly; the form sends edits with "" to clear', () => {
  assert.equal(baht(2280), '2,280.00'); assert.equal(baht(null), '—'); assert.equal(baht('830.5'), '830.50');
  assert.equal(lineText({ quantity: 19, unit: 'กก.', unit_price: 120 }), '19 กก. × 120.00');
  assert.equal(lineText({ quantity: null, unit_price: null }), '');
  assert.deepEqual(formBody({ doc_ref: ' INV-1 ', doc_date: '', total: '1,234.50' }, 'saved'), { doc_ref: 'INV-1', doc_date: '', total: 1234.5, status: 'saved' });
  assert.deepEqual(formBody({ doc_ref: '', doc_date: '2026-11-01', total: ' ' }, 'saved'), { doc_ref: '', doc_date: '2026-11-01', total: '', status: 'saved' });
  assert.equal(currentPeriod(new Date('2026-10-31T17:30:00Z')), '2026-11', 'Bangkok month');
});
