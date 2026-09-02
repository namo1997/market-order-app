import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kplusShopSettlementKey, parseKplusShopEmail } from '../src/domain/kplusShop.js';

test('K SHOP daily email reads its merchant ID and settlement amount', () => {
  const report = parseKplusShopEmail('รหัสร้านค้า : KB000001590548\nยอดเงินจำนวน(บาท) : 24,969.30');
  assert.equal(report.merchantId, 'KB000001590548');
  assert.equal(report.amount, 24969.3);
});

test('K SHOP settlement key is stable across duplicate Gmail messages', () => {
  assert.equal(
    kplusShopSettlementKey({ merchantId: ' kb000001927650 ', sourceDate: '2026-08-04' }),
    'kplus-shop:KB000001927650:2026-08-04'
  );
});
