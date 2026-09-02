import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDateRange,
  cashierMiscForSheets,
  cashPlusChangeForSheets,
  closedAmountOrCashierForSheets,
  decideBackfillAction,
  grabAmountsForSheets,
  googleSheetsStatusLabel,
  morningChangeForSheets,
  positiveAmountForSheets,
  parseMonthRange
} from '../src/domain/googleSheets.js';

test('cashier misc export totals every item and keeps each label in the cell note', () => {
  const result = cashierMiscForSheets({
    status: 'SUBMITTED',
    items: [
      { label: 'เครดิต พี่จุ๋ม', amount: 315 },
      { label: 'น้ำฟรี', amount: 3 },
      { label: 'สมาชิก', amount: 1 }
    ]
  });
  assert.equal(result.amount, 319);
  assert.equal(result.note, [
    'รายการอื่น ๆ ที่แคชเชียร์เพิ่ม',
    '- เครดิต พี่จุ๋ม: 315.00',
    '- น้ำฟรี: 3.00',
    '- สมาชิก: 1.00'
  ].join('\n'));
  assert.deepEqual(result.categories, {
    foodStaff: {
      amount: 3,
      note: 'ค่าอาหารรถตู้/พนักงาน (รายการที่ไม่ตรงหมวดอื่น)\n- น้ำฟรี: 3.00'
    },
    houseJum: { amount: 0, note: '' },
    housePen: { amount: 0, note: '' },
    grandma: { amount: 0, note: '' },
    creditJumPen: {
      amount: 315,
      note: 'เครดิตพี่จุ๋ม/พี่เพ็ญ\n- เครดิต พี่จุ๋ม: 315.00'
    },
    member: {
      amount: 1,
      note: 'สมาชิก / แลกแต้ม / รีวิว\n- สมาชิก: 1.00'
    }
  });
});

test('cashier misc sheet categories follow the six-column business rule', () => {
  const result = cashierMiscForSheets({
    status: 'CLOSED',
    items: [
      { label: 'จ่ายหน้าร้าน', amount: 466.5 },
      { label: 'รถตู้', amount: 100 },
      { label: 'ลงบิลเจ๊จุ๋ม', amount: 315 },
      { label: 'ลงบิลพี่เพ็ญ', amount: 70 },
      { label: 'คุณย่า', amount: 140 },
      { label: 'เครดิต พี่จุ๋ม', amount: 200 },
      { label: 'เครดิต พี่เพ็ญ', amount: 50 },
      { label: 'สมาชิก', amount: 2 },
      { label: 'แลกแต้ม1', amount: 1 },
      { label: 'รีวิว', amount: 3 },
      { label: 'เช็คอิน', amount: 4 },
      { label: 'เครดิต คุณโม', amount: 86.75 }
    ]
  });

  assert.deepEqual(Object.fromEntries(
    Object.entries(result.categories).map(([key, value]) => [key, value.amount])
  ), {
    foodStaff: 657.25,
    houseJum: 315,
    housePen: 70,
    grandma: 140,
    creditJumPen: 250,
    member: 6
  });
});

test('cashier misc export preserves manual sheet data for an empty draft', () => {
  assert.deepEqual(cashierMiscForSheets({ status: 'DRAFT', items: [] }), {
    amount: '',
    note: '',
    categories: {
      foodStaff: { amount: '', note: '' },
      houseJum: { amount: '', note: '' },
      housePen: { amount: '', note: '' },
      grandma: { amount: '', note: '' },
      creditJumPen: { amount: '', note: '' },
      member: { amount: '', note: '' }
    }
  });
  assert.deepEqual(cashierMiscForSheets({ status: 'CLOSED', items: [] }), {
    amount: 0,
    note: '',
    categories: {
      foodStaff: { amount: 0, note: '' },
      houseJum: { amount: 0, note: '' },
      housePen: { amount: 0, note: '' },
      grandma: { amount: 0, note: '' },
      creditJumPen: { amount: 0, note: '' },
      member: { amount: 0, note: '' }
    }
  });
});

test('Grab sheet amounts follow the existing four-column accounting rule', () => {
  assert.deepEqual(grabAmountsForSheets({
    reportPayload: {
      gross_amount: 5835,
      merchant_promotion_amount: 338,
      cashier_amount: 5497,
      commission_and_tax_amount: 989.33,
      additional_commission_amount: 147.04,
      marketing_fee_amount: 112.35,
      merchant_delivery_discount_amount: 0,
      income_adjustment_amount: 0,
      net_amount: 4248.28
    },
    cashierAmount: 5400,
    status: 'SUBMITTED'
  }), {
    source: 'GRAB_REPORT',
    salesAmount: 5497,
    fee20Amount: 1136.37,
    adsPromotionAmount: 112.35,
    bankAmount: 4248.28
  });
});

test('Grab bank income uses the report net after income adjustments', () => {
  const amounts = grabAmountsForSheets({
    reportPayload: {
      gross_amount: 6771,
      cashier_amount: 6350,
      commission_and_tax_amount: 1142.83,
      additional_commission_amount: 271.81,
      marketing_fee_amount: 0,
      merchant_delivery_discount_amount: 0,
      income_adjustment_amount: 905.49,
      net_amount: 5840.85
    },
    cashierAmount: 6350,
    status: 'CLOSED'
  });
  assert.equal(amounts.bankAmount, 5840.85);
});

test('matched bank statement overrides only Grab money received', () => {
  const amounts = grabAmountsForSheets({
    reportPayload: {
      gross_amount: 6771,
      cashier_amount: 6350,
      commission_and_tax_amount: 1142.83,
      additional_commission_amount: 271.81,
      marketing_fee_amount: 0,
      merchant_delivery_discount_amount: 0,
      income_adjustment_amount: 905.49,
      net_amount: 5840.85
    },
    cashierAmount: 6350,
    status: 'CLOSED',
    hasBankStatement: true,
    bankStatementAmount: 5839.85
  });
  assert.equal(amounts.source, 'BANK_STATEMENT');
  assert.equal(amounts.salesAmount, 6350);
  assert.equal(amounts.fee20Amount, 1414.64);
  assert.equal(amounts.bankAmount, 5839.85);
});

test('bank statement keeps the actual Grab deposit when only cashier sales are available', () => {
  assert.deepEqual(grabAmountsForSheets({
    cashierAmount: 9700,
    status: 'SUBMITTED',
    hasBankStatement: true,
    bankStatementAmount: 7312.45
  }), {
    source: 'BANK_STATEMENT',
    salesAmount: 9700,
    fee20Amount: '',
    adsPromotionAmount: '',
    bankAmount: 7312.45
  });
});

test('an incomplete Grab report falls back only to submitted cashier sales', () => {
  assert.deepEqual(grabAmountsForSheets({
    reportPayload: { gross_amount: 10249, cashier_amount: 10249, net_amount: 0 },
    cashierAmount: 9700,
    status: 'SUBMITTED'
  }), {
    source: 'CASHIER',
    salesAmount: 9700,
    fee20Amount: '',
    adsPromotionAmount: '',
    bankAmount: ''
  });
});

test('parseMonthRange returns every July 2026 business date', () => {
  const range = parseMonthRange('2026-07');
  assert.equal(range.from, '2026-07-01');
  assert.equal(range.to, '2026-07-31');
  assert.equal(range.days.length, 31);
  assert.equal(range.days[1], '2026-07-02');
});

test('buildDateRange validates and builds an inclusive range', () => {
  assert.deepEqual(buildDateRange('2026-07-30', '2026-08-02'), [
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
    '2026-08-02'
  ]);
  assert.throws(() => buildDateRange('2026-02-30', '2026-03-01'), /valid date/);
  assert.throws(() => buildDateRange('2026-08-02', '2026-08-01'), /on or before/);
});

test('backfill only creates missing receipts or refreshes editable statuses', () => {
  assert.equal(decideBackfillAction(null), 'create');
  assert.equal(decideBackfillAction('DRAFT'), 'update');
  assert.equal(decideBackfillAction('NEEDS_CORRECTION'), 'update');
  assert.equal(decideBackfillAction('SUBMITTED'), 'skip_status');
  assert.equal(decideBackfillAction('CHECKED_OK'), 'skip_status');
  assert.equal(decideBackfillAction('CHECKED_VARIANCE'), 'skip_status');
  assert.equal(decideBackfillAction('CLOSED'), 'skip_closed');
});

test('Google Sheets status labels match the reporting contract', () => {
  assert.equal(googleSheetsStatusLabel('DRAFT'), 'ร่าง / ยังไม่กรอก');
  assert.equal(googleSheetsStatusLabel('CHECKED_VARIANCE'), 'ตรวจแล้ว มีส่วนต่าง');
  assert.equal(googleSheetsStatusLabel('CLOSED'), 'ปิดยอดแล้ว');
  assert.equal(googleSheetsStatusLabel(''), 'ยังไม่สร้าง');
});

test('cash plus change uses the cashier CASH amount without adding morning change twice', () => {
  assert.equal(cashPlusChangeForSheets({ status: '', cashCashierAmount: 0, morningChangeAmount: 0 }), '');
  assert.equal(cashPlusChangeForSheets({ status: 'DRAFT', cashCashierAmount: 0, morningChangeAmount: 0 }), '');
  assert.equal(cashPlusChangeForSheets({ status: 'DRAFT', cashCashierAmount: 1200, morningChangeAmount: 500 }), 1200);
  assert.equal(cashPlusChangeForSheets({ status: 'SUBMITTED', cashCashierAmount: 0, morningChangeAmount: 0 }), 0);
  assert.equal(cashPlusChangeForSheets({ status: 'CLOSED', cashCashierAmount: 1234.565, morningChangeAmount: 500 }), 1234.57);
});

test('morning change is blank only for receipts that are not filled yet', () => {
  assert.equal(morningChangeForSheets({ status: '', morningChangeAmount: 0 }), '');
  assert.equal(morningChangeForSheets({ status: 'DRAFT', morningChangeAmount: 0 }), '');
  assert.equal(morningChangeForSheets({ status: 'DRAFT', morningChangeAmount: 500 }), 500);
  assert.equal(morningChangeForSheets({ status: 'SUBMITTED', morningChangeAmount: 0 }), 0);
});

test('payment channel exports keep only rows that have an amount', () => {
  assert.equal(positiveAmountForSheets(null), '');
  assert.equal(positiveAmountForSheets(0), '');
  assert.equal(positiveAmountForSheets(-10), '');
  assert.equal(positiveAmountForSheets(1234.565), 1234.57);
});

test('closed channel amount always wins, otherwise use only a submitted cashier amount', () => {
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: true,
    closedAmount: 1234.565,
    cashierAmount: 1200,
    status: 'SUBMITTED'
  }), 1234.57);
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: true,
    closedAmount: 0,
    cashierAmount: 1200,
    status: 'SUBMITTED'
  }), 0);
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    closedAmount: 0,
    cashierAmount: 1200.125,
    status: 'SUBMITTED'
  }), 1200.13);
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    cashierAmount: 1200,
    status: 'DRAFT'
  }), '');
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    cashierAmount: 0,
    status: ''
  }), '');
});

test('SCB card gross can use the cashier submission before a card closing report arrives', () => {
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    cashierAmount: 15076,
    status: 'SUBMITTED'
  }), 15076);
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    cashierAmount: 0,
    status: 'SUBMITTED'
  }), 0);
  assert.equal(closedAmountOrCashierForSheets({
    hasClosedAmount: false,
    cashierAmount: 3749,
    status: 'DRAFT'
  }), '');
});
