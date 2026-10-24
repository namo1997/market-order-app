import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseGrabDailyReport } from '../src/domain/grab.js';

// Private originals stay on SSD, outside Git; hashes pin the exact evidence.
const root = process.env.CASHFLOW_GRAB_FIXTURE_DIR;
for (const fixture of [
  { name: 'THGFIST000009lx-20261023.pdf', sha256: 'ad2e58b71cd5e4d7978d94be7e0f1dadc921d1ec119d1fe9db2d0d57902fbe4e',
    expected: { salesDate: '2026-10-23', grossAmount: 12301, merchantPromotionAmount: 605, cashierAmount: 11696,
      commissionAndTaxAmount: 2104.96, additionalCommissionAmount: 187.76, marketingFeeAmount: 770.44,
      netAmount: 8632.84, feeAmount: 3063.16, storeId: 'c30f837b-0067-41ce-9d19-767cca330e94' } },
  { name: '3-C6CELAM2TCAUVX-20261013.pdf', sha256: '65cc58815166a1fb7d054dddaef0f57f39097d5267a3a07c73a2c037d86fc692',
    expected: { salesDate: '2026-10-13', grossAmount: 11484, merchantPromotionAmount: 544, cashierAmount: 10940,
      commissionAndTaxAmount: 1968.89, additionalCommissionAmount: 0, marketingFeeAmount: 1045.42,
      netAmount: 7925.69, feeAmount: 3014.31, storeId: 'ff32e3d6-5cea-4517-b543-4d7db1e528c6' } }
]) {
  test(`original PDF regression: ${fixture.name}`, { skip: !root }, async () => {
    const buffer = await fs.readFile(path.join(root, fixture.name));
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), fixture.sha256);
    const report = await parseGrabDailyReport(buffer, fixture.name);
    for (const [key, value] of Object.entries(fixture.expected)) assert.equal(report[key], value, key);
    assert.equal(report.vatAmount, 0);
    assert.equal(report.incomeAdjustmentAmount, 0);
    assert.equal(report.outstandingAmount, 0);
  });
}

test('malformed PDF fails with a sanitized validation error', async () => {
  await assert.rejects(parseGrabDailyReport(Buffer.from('%PDF-broken-report'), 'THGFIST000009lx-20261023.pdf'),
    { statusCode: 422, message: 'อ่านไฟล์ PDF รายงาน Grab ไม่ได้' });
});
