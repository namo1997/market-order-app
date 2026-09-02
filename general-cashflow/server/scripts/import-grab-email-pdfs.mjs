import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseGrabDailyReport } from '../src/domain/grab.js';

const { values } = parseArgs({ options: {
  directory: { type: 'string' }, 'message-id': { type: 'string' }, sender: { type: 'string' },
  subject: { type: 'string' }, 'base-url': { type: 'string' }, apply: { type: 'boolean', default: false }
} });
for (const key of ['directory', 'message-id', 'sender', 'subject', 'base-url']) assert.ok(values[key], `Missing --${key}`);
const directory = path.resolve(values.directory);
const before = JSON.parse(await fs.readFile(path.join(directory, 'before.json'), 'utf8'));
assert.equal(before.branches.length, 1);
const branch = before.branches[0];
assert.equal(branch.code, 'KK');
const attachments = JSON.parse(await fs.readFile(path.join(directory, 'attachments.json'), 'utf8'));
const unique = new Map();
for (const entry of [...attachments].sort((a, b) => a.filename.length - b.filename.length)) {
  assert.equal(path.basename(entry.filename), entry.filename);
  if (!unique.has(entry.sha256)) unique.set(entry.sha256, entry);
}
const plans = [];
for (const entry of unique.values()) {
  const bytes = await fs.readFile(path.join(directory, entry.filename));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const report = await parseGrabDailyReport(bytes, entry.filename);
  assert.equal(report.storeId, branch.grab_store_id);
  assert.match(report.text, /Hello solao/i);
  const date = report.salesDate;
  assert.match(date, /^2026-07-\d{2}$/);
  assert.ok(report.text.includes(`${Number(date.slice(-2))} กรกฎาคม 2026`), `PDF date mismatch: ${entry.filename}`);
  const detailsNet = report.cashierAmount - report.commissionAndTaxAmount - report.additionalCommissionAmount
    - report.marketingFeeAmount - report.merchantDeliveryDiscountAmount + report.incomeAdjustmentAmount;
  assert.ok(Math.abs(detailsNet - report.netAmount) < 0.02, `Deductions mismatch: ${entry.filename}`);
  const line = before.lines.find(line => line.receipt_date === date);
  assert.ok(line, `Receipt missing for ${date}`);
  assert.ok(Math.abs(Number(line.statement_amount) - report.netAmount) < 0.01, `Bank amount differs on ${date}`);
  const existing = before.imports.find(item => item.archive_checksum === entry.sha256);
  if (existing) assert.equal(existing.receipt_line_id, line.line_id, `Existing evidence belongs elsewhere: ${date}`);
  if (!existing) assert.notEqual(line.status, 'CLOSED', `Closed receipt: ${date}`);
  plans.push({ ...entry, report, line, existing, bytes });
}
plans.sort((a, b) => a.report.salesDate.localeCompare(b.report.salesDate));
assert.equal(new Set(plans.map(plan => plan.report.salesDate)).size, plans.length);
const results = [];
for (const plan of plans) {
  const result = { date: plan.report.salesDate, filename: plan.filename, receiptId: plan.line.receipt_id,
    lineId: plan.line.line_id, cashierAmount: Number(plan.line.cashier_amount), reference: plan.report.cashierAmount,
    deductions: plan.report.feeAmount, net: plan.report.netAmount,
    action: plan.existing ? 'ALREADY_IMPORTED' : values.apply ? 'IMPORT' : 'WOULD_IMPORT' };
  if (values.apply && !plan.existing) {
    assert.ok(process.env.CASHFLOW_GMAIL_INBOX_TOKEN, 'Gmail inbox token is required');
    const form = new FormData();
    form.set('message_id', `${values['message-id']}:${plan.filename}`);
    form.set('sender_email', values.sender);
    form.set('subject', values.subject);
    form.set('file', new Blob([plan.bytes], { type: 'application/pdf' }), plan.filename);
    const response = await fetch(`${values['base-url'].replace(/\/$/, '')}/api/inbox-imports/grab`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.CASHFLOW_GMAIL_INBOX_TOKEN}` },
      body: form, signal: AbortSignal.timeout(60000)
    });
    const body = await response.json();
    assert.ok(response.ok && body.success, `Import ${result.date} failed (${response.status}): ${body.message}`);
    if (!body.duplicate) {
      assert.equal(body.data.linked, true, `Report not linked on ${result.date}`);
      assert.equal(body.data.receipt_line_id, plan.line.line_id);
      assert.equal(body.data.netAmount, plan.report.netAmount);
    }
    result.importId = body.data.id;
    result.action = body.duplicate ? 'DUPLICATE_SKIPPED' : 'IMPORTED';
  }
  results.push(result);
  await fs.writeFile(path.join(directory, values.apply ? 'import-results.json' : 'import-plan.json'),
    JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
}
console.log(JSON.stringify({ apply: values.apply, pdfFiles: attachments.length, uniqueReports: plans.length,
  imported: results.filter(row => row.action === 'IMPORTED').length,
  skipped: results.filter(row => ['ALREADY_IMPORTED', 'DUPLICATE_SKIPPED'].includes(row.action)).length }));
