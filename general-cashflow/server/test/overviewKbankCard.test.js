import test from 'node:test';
import assert from 'node:assert/strict';
import { matchKbankCardSale } from '../src/domain/overviewStatement.js';

const deposit = (date, amount) => ({ channel:'บัตรกสิกร', date, amount });
const sale = (id, date, cashier_amount, branch_id = 2) => ({ id, code:'CREDIT_CARD_KBANK', branch_id, sale_date:date, cashier_amount });

test('KBank card deposit pairs with the same-day sale and derives the fee',()=>{
  const row = deposit('2026-09-27', 26919.25);
  const result = matchKbankCardSale(row, [row], [sale(1,'2026-09-27','27641.00')], 2);
  assert.equal(result.line.id, 1);
  assert.equal(result.gross, 27641);
  assert.equal(result.fee, 721.75);
});

test('KBank card pairing refuses fees outside the normal range',()=>{
  for (const amount of [27641, 27500, 25000]) {
    const row = deposit('2026-09-27', amount);
    assert.equal(matchKbankCardSale(row, [row], [sale(1,'2026-09-27',27641)], 2), null);
  }
});

test('KBank card pairing refuses ambiguous days, other branches and missing sales',()=>{
  const row = deposit('2026-09-27', 26919.25);
  assert.equal(matchKbankCardSale(row, [row, deposit('2026-09-27', 100)], [sale(1,'2026-09-27',27641)], 2), null);
  assert.equal(matchKbankCardSale(row, [row], [sale(1,'2026-09-27',27641), sale(2,'2026-09-27',100)], 2), null);
  assert.equal(matchKbankCardSale(row, [row], [sale(1,'2026-09-27',27641,1)], 2), null);
  assert.equal(matchKbankCardSale(row, [row], [sale(1,'2026-09-26',27641)], 2), null);
  assert.equal(matchKbankCardSale(row, [row], [sale(1,'2026-09-27',0)], 2), null);
  assert.equal(matchKbankCardSale({ ...row, channel:'QR กสิกร' }, [row], [sale(1,'2026-09-27',27641)], 2), null);
});
