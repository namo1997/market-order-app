import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPeriodMonth, normalize } from '../src/pnl/domain.js';

const credit = ['เอเชียเกษตร', 'หมูเจ๊เฉียง'].map((pattern) => ({ pattern: normalize(pattern), active: 1 }));
const ctx = (supplier_name, extra = {}) => ({ supplier_name, payment_method: 'bank_transfer', creditSuppliers: credit, ...extra });
const month = (description, date, context) => suggestPeriodMonth(description, date, context).suggested_period_month;

test('utility bills follow the ledger: paid days 1–7 previous month, later stays', () => {
  assert.equal(month('ค่าไฟ โซลาว', '2026-09-06', ctx('การไฟฟ้าส่วนภูมิภาค')), '2026-08');
  assert.equal(month('ค่าไฟฟ้า', '2026-08-09', ctx('การไฟฟ้าส่วนภูมิภาค')), null);
  assert.equal(month('ค่าน้ำประปา', '2026-08-09', ctx('การประปาส่วนภูมิภาค')), null);
});

test('credit suppliers paid days 1–15 belong to the previous month; day 16+ and cash stay', () => {
  assert.equal(month('รายการจ่าย', '2026-09-12', ctx('บริษัท เอเชียเกษตรรุ่งเรือง จำกัด')), '2026-08');
  assert.equal(month('รายการจ่าย', '2026-08-20', ctx('หมูเจ๊เฉียง')), null);
  assert.equal(month('รายการจ่าย', '2026-09-05', ctx('หมูเจ๊เฉียง', { payment_method: 'cash' })), null);
});

test('multi-slip supplier batches early in the month move to the previous month', () => {
  assert.equal(month('ค่าใช้จ่ายจากบิลตลาด', '2026-08-06', ctx('ชุดรวม 1 บิล · 20 สลิป')), '2026-07');
  assert.equal(month('ค่าใช้จ่ายจากบิลตลาด', '2026-08-15', ctx('ชุดรวม 2 บิล · 1 สลิป')), null);
  assert.equal(month('ค่าใช้จ่ายจากบิลตลาด', '2026-08-20', ctx('ชุดรวม 1 บิล · 7 สลิป')), null);
});
