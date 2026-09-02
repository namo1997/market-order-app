import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignKasikornGrabStatementRows,
  findGrabSettlement,
  parseGrabDailyReportText,
  parseGrabTransactionReport
} from '../src/domain/grab.js';

test('Grab transaction report totals the transferred amount by store and sales date', () => {
  const csv = [
    'ชื่อร้าน,Merchant ID,รหัสร้านค้า,วันที่สร้าง,วันที่โอน,ยอด,ทั้งหมด',
    'ร้านคันคลอง,merchant-1,store-kk,1 Jul 2026 8:00 PM,2 Jul 2026 1:46 AM,1000,800.10',
    'ร้านคันคลอง,merchant-1,store-kk,1 Jul 2026 9:00 PM,2 Jul 2026 1:46 AM,500,400.20',
    'ร้านสันกำแพง,merchant-1,store-sk,1 Jul 2026 8:30 PM,2 Jul 2026 3:57 AM,900,700.30'
  ].join('\n');

  const groups = parseGrabTransactionReport(Buffer.from(csv));
  const settlement = findGrabSettlement({ groups, storeId: 'store-kk', receiptDate: '2026-07-01' });

  assert.equal(groups.length, 2);
  assert.equal(settlement.transactionCount, 2);
  assert.equal(settlement.grossAmount, 1500);
  assert.equal(settlement.netAmount, 1200.3);
  assert.equal(settlement.feeAmount, 299.7);
  assert.equal(settlement.transferDate, '2026-07-02');
});

test('Grab daily PDF text uses gross sales as the primary amount and resolves Kanklong store', () => {
  const report = parseGrabDailyReportText(
    'สมตํา Hello solao (ฮัลโหล โซลาว) รายรับท้ังหมด คางชําระ Grab THB 5,840.85 THB 0.00 ยอดรายการ VAT คาบริการของราน โปรโมชันราน คาคอมมิชชันและภาษีทั้งหมด คาคอมมิชชันเพิ่มเติม สวนลดคาจัดสงโดยราน การปรับรายได รายรับท้ังหมด คางชําระ Grab 6,771.00 0.00 0.00 -421.00 -1,142.83 -271.81 0.00 905.49 5,840.85 0.00 คําสั่งซื้อจากแอปฯ และเว็บไซต',
    'THGFIST000009lx-20260721.pdf'
  );

  assert.equal(report.storeId, 'c30f837b-0067-41ce-9d19-767cca330e94');
  assert.equal(report.salesDate, '2026-07-21');
  assert.equal(report.grossAmount, 6771);
  assert.equal(report.merchantPromotionAmount, 421);
  assert.equal(report.cashierAmount, 6350);
  assert.equal(report.netAmount, 5840.85);
  assert.equal(report.feeAmount, 509.15);
  assert.equal(report.commissionAndTaxAmount, 1142.83);
  assert.equal(report.additionalCommissionAmount, 271.81);
  assert.equal(report.incomeAdjustmentAmount, 905.49);
});

test('Grab reconciliation uses POS after merchant promotion and bank income after commissions', () => {
  const report = parseGrabDailyReportText(
    'รายรับท้ังหมด THB 65.00 ยอดรายการ VAT คาบริการของราน โปรโมชันราน คาคอมมิชชันและภาษีทั้งหมด คาคอมมิชชันเพิ่มเติม รายรับท้ังหมด คางชําระ Grab 100.00 0.00 0.00 -10.00 -20.00 -5.00 65.00 0.00 คําสั่งซื้อจากแอปฯ และเว็บไซต',
    'THGFIST000009lx-20260805.pdf'
  );

  assert.equal(report.grossAmount, 100);
  assert.equal(report.merchantPromotionAmount, 10);
  assert.equal(report.cashierAmount, 90);
  assert.equal(report.commissionAndTaxAmount, 20);
  assert.equal(report.additionalCommissionAmount, 5);
  assert.equal(report.feeAmount, 25);
  assert.equal(report.netAmount, 65);
  assert.equal(report.netAmount + report.feeAmount, report.cashierAmount);
});

test('Grab daily PDF text keeps an unmapped store pending instead of rejecting its report', () => {
  const report = parseGrabDailyReportText(
    'ครัวโซลาว - ตลาดเจริญ เจริญ รายรับท้ังหมด คางชําระ Grab THB 0.00 THB 0.00 ยอดรายการ VAT 0.00 0.00',
    '3-C2LXJ3EVLNDDG6-20260721.pdf'
  );

  assert.equal(report.storeId, null);
  assert.equal(report.grossAmount, 0);
  assert.equal(report.netAmount, 0);
});

test('KBank Grab statement learns the two-store settlement order from exact report nets', () => {
  const makeRows = (date, early, late) => [
    { transactionDate: date, amount: early, rawPayload: { 'เวลา': '01:30' } },
    { transactionDate: date, amount: late, rawPayload: { 'เวลา': '03:30' } }
  ];
  const rows = [
    ...makeRows('2026-07-22', 100, 200),
    ...makeRows('2026-07-23', 110, 210),
    ...makeRows('2026-07-24', 120, 220),
    ...makeRows('2026-07-25', 130, 230)
  ];
  const evidenceByDate = {
    '2026-07-21': [
      { branchCode: 'KK', reportNetAmount: 100, hasSalesActivity: true },
      { branchCode: 'SK', reportNetAmount: 200, hasSalesActivity: true }
    ],
    '2026-07-22': [
      { branchCode: 'KK', reportNetAmount: 110, hasSalesActivity: true },
      { branchCode: 'SK', reportNetAmount: 210, hasSalesActivity: true }
    ],
    '2026-07-23': [
      { branchCode: 'KK', reportNetAmount: 120, hasSalesActivity: true },
      { branchCode: 'SK', reportNetAmount: 220, hasSalesActivity: true }
    ],
    '2026-07-24': [
      { branchCode: 'KK', reportNetAmount: null, hasSalesActivity: true },
      { branchCode: 'SK', reportNetAmount: null, hasSalesActivity: true }
    ]
  };

  const result = assignKasikornGrabStatementRows({ rows, evidenceByDate, month: '2026-07' });
  assert.deepEqual(result.verifiedSequence, ['KK', 'SK']);
  assert.equal(result.sequenceSupport, 3);
  const fallback = result.assignments.filter((item) => item.saleDate === '2026-07-24');
  assert.deepEqual(fallback.map((item) => [item.branchCode, item.row.amount, item.reason]), [
    ['KK', 130, 'VERIFIED_SETTLEMENT_ORDER'],
    ['SK', 230, 'VERIFIED_SETTLEMENT_ORDER']
  ]);
});

test('KBank Grab statement records a proven zero for the inactive branch', () => {
  const result = assignKasikornGrabStatementRows({
    month: '2026-07',
    rows: [{ transactionDate: '2026-07-03', amount: 6240.34, rawPayload: { 'เวลา': '01:30' } }],
    evidenceByDate: {
      '2026-07-02': [
        { branchCode: 'KK', reportNetAmount: null, hasSalesActivity: true },
        { branchCode: 'SK', reportNetAmount: null, hasSalesActivity: false }
      ]
    }
  });

  assert.equal(result.pending.length, 0);
  assert.deepEqual(result.assignments.map((item) => [item.branchCode, item.row?.amount ?? item.amount, item.reason]), [
    ['KK', 6240.34, 'ONLY_ACTIVE_BRANCH'],
    ['SK', 0, 'NO_DEPOSIT_AND_ZERO_SALES']
  ]);
});

test('KBank Grab statement keeps prior-month settlements pending', () => {
  const result = assignKasikornGrabStatementRows({
    month: '2026-07',
    rows: [{ transactionDate: '2026-07-01', amount: 7845.91, rawPayload: { 'เวลา': '01:24' } }],
    evidenceByDate: {}
  });
  assert.equal(result.assignments.length, 0);
  assert.equal(result.pending[0].reason, 'SALE_DATE_OUTSIDE_MONTH');
});
