import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSettingsRow,
  hasUnitConversion,
  getRecipeUnitMismatchMessage,
  summarizeUnitReferences,
  buildBaseUnitChangeMessage,
  isForceUnitChange,
  isBaseUnitChanging
} from '../src/utils/unit-rules.js';

// UNIT-01
test('UNIT-01 findSettingsRow หาแถวจาก array ตรง ๆ (ไม่ destructure)', () => {
  const rows = [{ id: 1 }, { id: '7', name: 'x' }];
  assert.equal(findSettingsRow(rows, 7).name, 'x');
  assert.equal(findSettingsRow(rows, 9), null);
  assert.equal(findSettingsRow(undefined, 1), null);
});

// UNIT-02
test('UNIT-02 hasUnitConversion รองรับทั้งสองทิศและหน่วยเดียวกัน', () => {
  const conv = [{ from_unit_id: 2, to_unit_id: 1, multiplier: '1000' }];
  assert.equal(hasUnitConversion(2, 1, conv), true);
  assert.equal(hasUnitConversion(1, 2, conv), true);
  assert.equal(hasUnitConversion(3, 1, conv), false);
  assert.equal(hasUnitConversion(5, 5, []), true);
  assert.equal(hasUnitConversion(2, 1, [{ from_unit_id: 2, to_unit_id: 1, multiplier: 0 }]), false);
});

test('UNIT-02 getRecipeUnitMismatchMessage', () => {
  const base = { productName: 'หมู', productUnitId: 1, productUnitName: 'กก.', unitName: 'ชิ้น', conversions: [] };
  assert.equal(getRecipeUnitMismatchMessage({ ...base, unitId: 1 }), null);
  const msg = getRecipeUnitMismatchMessage({ ...base, unitId: 2 });
  assert.match(msg, /ชิ้น/);
  assert.match(msg, /กก\./);
  assert.equal(
    getRecipeUnitMismatchMessage({ ...base, unitId: 2, conversions: [{ from_unit_id: 1, to_unit_id: 2, multiplier: 5 }] }),
    null
  );
});

// UNIT-05
test('UNIT-05 summarize / message / flags', () => {
  assert.deepEqual(summarizeUnitReferences({}), []);
  const refs = summarizeUnitReferences({ inventory_transactions: 3, menu_recipe_items: 2, stock_checks: 0 });
  assert.equal(refs.length, 2);
  assert.equal(buildBaseUnitChangeMessage('หมู', []), null);
  assert.match(buildBaseUnitChangeMessage('หมู', refs), /รายการเคลื่อนไหวสต๊อก 3 รายการ/);
  assert.equal(isForceUnitChange(true), true);
  assert.equal(isForceUnitChange('false'), false);
  assert.equal(isBaseUnitChanging(1, '1'), false);
  assert.equal(isBaseUnitChanging(1, 2), true);
  assert.equal(isBaseUnitChanging(1, undefined), false);
});
