import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCalendarReceipts, receiptCalendarMonthlyVariance, receiptCalendarRefreshKey,
  receiptCalendarVariance, receiptDateState
} from '../src/receiptCalendar.js';

test('calendar shows each workflow status instead of grouping all counted receipts', () => {
  assert.deepEqual(receiptDateState({ status: 'DRAFT' }), { className: 'draft', label: 'ยังไม่ส่ง' });
  assert.deepEqual(receiptDateState({ status: 'SUBMITTED' }), { className: 'submitted', label: 'รอตรวจ' });
  assert.deepEqual(receiptDateState({ status: 'CHECKED_OK' }), { className: 'checked-ok', label: 'ตรวจครบ' });
  assert.deepEqual(receiptDateState({ status: 'CHECKED_VARIANCE' }), { className: 'checked-variance', label: 'มีส่วนต่าง' });
  assert.deepEqual(receiptDateState({ status: 'NEEDS_CORRECTION' }), { className: 'correction', label: 'ต้องแก้' });
  assert.deepEqual(receiptDateState({ status: 'CLOSED' }), { className: 'closed', label: 'ปิดแล้ว' });
});

test('calendar refresh key changes when an existing receipt status or totals change', () => {
  const receipt = {
    id: 7,
    status: 'SUBMITTED',
    updated_at: '2026-08-07T01:00:00.000Z',
    cashier_variance_total: '0.00',
    statement_total: '100.00',
    variance_total: '0.00'
  };

  const originalKey = receiptCalendarRefreshKey([receipt]);
  assert.notEqual(receiptCalendarRefreshKey([{ ...receipt, status: 'CHECKED_OK' }]), originalKey);
  assert.notEqual(receiptCalendarRefreshKey([{ ...receipt, statement_total: '99.00' }]), originalKey);
  assert.notEqual(receiptCalendarRefreshKey([{ ...receipt, confirmed_variance_total: 0 }]), originalKey);
});

test('closed dates use the confirmed variance including zero, never the cashier variance', () => {
  const receipt = { status: 'CLOSED', cashier_variance_total: '721.00' };
  assert.equal(receiptCalendarVariance({ ...receipt, confirmed_variance_total: 0 }), 0);
  assert.equal(receiptCalendarVariance({ ...receipt, confirmed_variance_total: '-50.25' }), -50.25);
  assert.equal(receiptCalendarVariance({ ...receipt, confirmed_variance_total: 2.5 }), 2.5);
  for (const missing of [undefined, null, '', 'invalid']) {
    assert.equal(receiptCalendarVariance({ ...receipt, confirmed_variance_total: missing }), null);
  }
});

test('open dates keep the cashier variance and drafts are excluded from monthly variance', () => {
  for (const status of ['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION']) {
    assert.equal(receiptCalendarVariance({ status, cashier_variance_total: '12.50', confirmed_variance_total: 9 }), 12.5);
  }
  assert.equal(receiptCalendarVariance({ status: 'DRAFT', cashier_variance_total: -1000 }), 0);
  assert.equal(receiptCalendarMonthlyVariance([
    { status: 'CLOSED', cashier_variance_total: 721, confirmed_variance_total: -50.25 },
    { status: 'CLOSED', cashier_variance_total: 800, confirmed_variance_total: 0 },
    { status: 'SUBMITTED', cashier_variance_total: '12.50' },
    { status: 'DRAFT', cashier_variance_total: -1000 }
  ]), -37.75);
});

test('daily and monthly totals agree when branches have different closing states', () => {
  const receipts = [
    { receipt_date: '2026-08-01', status: 'CLOSED', cashier_variance_total: 100, confirmed_variance_total: -20 },
    { receipt_date: '2026-08-01', status: 'SUBMITTED', cashier_variance_total: 5 },
    { receipt_date: '2026-08-02', status: 'CLOSED', cashier_variance_total: 900, confirmed_variance_total: 0 }
  ];
  const days = groupCalendarReceipts(receipts);
  assert.equal(days.get('2026-08-01').status, 'SUBMITTED');
  assert.equal(days.get('2026-08-01').calendar_variance_total, -15);
  assert.equal(days.get('2026-08-02').calendar_variance_total, 0);
  assert.equal(receiptCalendarMonthlyVariance(receipts), [...days.values()].reduce((sum, day) => sum + day.calendar_variance_total, 0));
  assert.deepEqual(groupCalendarReceipts([...receipts].reverse()).get('2026-08-01'), days.get('2026-08-01'));
});

test('missing closing confirmation cannot silently appear as a balanced day or month', () => {
  const receipts = [
    { receipt_date: '2026-08-01', status: 'CLOSED', cashier_variance_total: 0 },
    { receipt_date: '2026-08-01', status: 'SUBMITTED', cashier_variance_total: 10 }
  ];
  assert.equal(groupCalendarReceipts(receipts).get('2026-08-01').calendar_variance_total, null);
  assert.equal(receiptCalendarMonthlyVariance(receipts), null);
});

test('post-close adjustments refresh the confirmed day and month without reopening', () => {
  const original = { id: 1, status: 'CLOSED', confirmed_variance_total: -50, confirmed_reconciled_total: 950 };
  const adjusted = { ...original, confirmed_variance_total: 0, confirmed_reconciled_total: 1000, post_close_adjustment_count: 1 };
  assert.equal(receiptDateState(adjusted).label, 'ปิด/ปรับแล้ว');
  assert.equal(receiptCalendarMonthlyVariance([adjusted]), 0);
  assert.notEqual(receiptCalendarRefreshKey([original]), receiptCalendarRefreshKey([adjusted]));
});
