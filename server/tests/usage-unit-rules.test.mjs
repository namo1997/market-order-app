import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundBaseQuantity,
  normalizeUsageUnitConfig,
  convertUsageToBase
} from '../src/utils/usage-unit-rules.js';

// น้ำปลา: หน่วยฐาน แกลลอน (id 22), หน่วยใช้ มล. (id 50), 1 แกลลอน = 4500 มล.
const fishSauce = { base_unit_id: 22, usage_unit_id: 50, usage_per_base: '4500.000000' };

test('roundBaseQuantity ปัดทศนิยม 2 ตำแหน่งตามคอลัมน์สต๊อก', () => {
  assert.equal(roundBaseQuantity(3200 / 4500), 0.71);
  assert.equal(roundBaseQuantity(9000 / 4500), 2);
  assert.equal(roundBaseQuantity(1.005), 1.01);
});

test('normalizeUsageUnitConfig', () => {
  assert.deepEqual(normalizeUsageUnitConfig({ usageUnitId: '', usagePerBase: '', baseUnitId: 22 }), { value: null });
  assert.deepEqual(normalizeUsageUnitConfig({ usageUnitId: 22, usagePerBase: 1, baseUnitId: 22 }), { value: null });
  assert.deepEqual(
    normalizeUsageUnitConfig({ usageUnitId: '50', usagePerBase: '4500', baseUnitId: 22 }),
    { value: { usage_unit_id: 50, usage_per_base: 4500 } }
  );
  assert.match(normalizeUsageUnitConfig({ usageUnitId: 50, usagePerBase: 0, baseUnitId: 22 }).error, /มากกว่า 0/);
  assert.match(normalizeUsageUnitConfig({ usageUnitId: 50, usagePerBase: 'abc', baseUnitId: 22 }).error, /มากกว่า 0/);
  assert.match(normalizeUsageUnitConfig({ usageUnitId: 'x', usagePerBase: 1, baseUnitId: 22 }).error, /ไม่ถูกต้อง/);
});

test('convertUsageToBase: ไม่ส่งหน่วย หรือส่งหน่วยฐาน = จำนวนเดิม', () => {
  assert.deepEqual(convertUsageToBase({ quantity: 2, product: fishSauce }), { quantity: 2, input: null });
  assert.deepEqual(convertUsageToBase({ quantity: 2, inputUnitId: 22, product: fishSauce }), { quantity: 2, input: null });
  assert.deepEqual(convertUsageToBase({ quantity: 2, product: undefined }), { quantity: 2, input: null });
});

test('convertUsageToBase: มล. → แกลลอน', () => {
  assert.deepEqual(
    convertUsageToBase({ quantity: 9000, inputUnitId: 50, product: fishSauce }),
    { quantity: 2, input: { quantity: 9000, unit_id: 50 } }
  );
  assert.equal(convertUsageToBase({ quantity: 3200, inputUnitId: '50', product: fishSauce }).quantity, 0.71);
});

test('convertUsageToBase: กรณีผิด', () => {
  assert.match(convertUsageToBase({ quantity: 0, inputUnitId: 50, product: fishSauce, productName: 'น้ำปลา' }).error, /มากกว่า 0/);
  assert.match(convertUsageToBase({ quantity: 10, inputUnitId: 50, product: fishSauce }).error, /น้อยเกินไป/);
  assert.match(convertUsageToBase({ quantity: 100, inputUnitId: 99, product: fishSauce }).error, /ไม่ตรงกับหน่วยใช้/);
  // หน่วยใช้ถูกลบออกจากสินค้าระหว่างที่หน้ายังเปิดอยู่
  assert.match(
    convertUsageToBase({ quantity: 100, inputUnitId: 50, product: { base_unit_id: 22, usage_unit_id: null, usage_per_base: null } }).error,
    /ไม่ตรงกับหน่วยใช้/
  );
});
