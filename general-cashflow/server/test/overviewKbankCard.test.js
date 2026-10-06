import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDepositsToSales, qrSettles, kbankCardSettles, allocateOverviewGrab } from '../src/domain/overviewStatement.js';

let index = 0;
const deposit = (date, amount, channel = 'บัตรกสิกร') => ({ channel, date, amount, row_index: ++index });
const sale = (id, sale_date, cashier_amount, expected = cashier_amount) => ({ id, sale_date, cashier_amount, expected });
const pairs = (matched) => Object.fromEntries([...matched].map(([row, line]) => [row, line.id]));

test('KBank card deposit pairs with the same-day sale within the fee range',()=>{
  const row = deposit('2026-09-27', 26919.25);
  assert.deepEqual(pairs(matchDepositsToSales([row], [sale(1,'2026-09-27','27641.00')], kbankCardSettles)), { [row.row_index]: 1 });
  for (const amount of [27641, 27500, 25000]) {
    const other = deposit('2026-09-27', amount);
    assert.equal(matchDepositsToSales([other], [sale(1,'2026-09-27',27641)], kbankCardSettles).size, 0);
  }
});

test('late card money pairs with the earlier sale and leaves today for its own deposit',()=>{
  const late = deposit('2026-09-28', 9750);   // Saturday sale 10,000 paid Monday
  const own = deposit('2026-09-28', 4875);    // Monday sale 5,000
  const matched = matchDepositsToSales([late, own], [sale(1,'2026-09-26',10000), sale(2,'2026-09-28',5000)], kbankCardSettles);
  assert.deepEqual(pairs(matched), { [late.row_index]: 1, [own.row_index]: 2 });
});

test('a sale paid in several transfers is matched as one day',()=>{
  const a = deposit('2026-09-10', 6000), b = deposit('2026-09-10', 3750);
  assert.deepEqual(pairs(matchDepositsToSales([a, b], [sale(1,'2026-09-10',10000)], kbankCardSettles)), { [a.row_index]: 1, [b.row_index]: 1 });
  const qa = deposit('2026-09-10', 29.89, 'QR กสิกร'), qb = deposit('2026-09-10', 29.89, 'QR กสิกร');
  assert.deepEqual(pairs(matchDepositsToSales([qa, qb], [sale(5,'2026-09-10',59.78)], qrSettles)), { [qa.row_index]: 5, [qb.row_index]: 5 });
});

test('late QR money never lands on the deposit date when amounts disagree',()=>{
  const late = deposit('2026-09-02', 1200, 'QR กสิกร'), own = deposit('2026-09-02', 800, 'QR กสิกร');
  const matched = matchDepositsToSales([late, own], [sale(1,'2026-09-01',1200), sale(2,'2026-09-02',800)], qrSettles);
  assert.deepEqual(pairs(matched), { [late.row_index]: 1, [own.row_index]: 2 });
  const unknown = deposit('2026-09-02', 999, 'QR กสิกร');
  assert.equal(matchDepositsToSales([unknown], [sale(2,'2026-09-02',800)], qrSettles).size, 0);
});

test('ambiguous, out-of-window, split-across-days and already settled sales stay for review',()=>{
  const same = deposit('2026-09-05', 500, 'QR กสิกร');
  assert.equal(matchDepositsToSales([same], [sale(1,'2026-09-03',500), sale(2,'2026-09-04',500)], qrSettles).size, 0);
  const old = deposit('2026-09-10', 500, 'QR กสิกร');
  assert.equal(matchDepositsToSales([old], [sale(1,'2026-09-05',500)], qrSettles).size, 0);
  const partA = deposit('2026-09-05', 600, 'QR กสิกร'), partB = deposit('2026-09-06', 400, 'QR กสิกร');
  assert.equal(matchDepositsToSales([partA, partB], [sale(1,'2026-09-05',1000)], qrSettles).size, 0);
  const settled = deposit('2026-09-05', 500, 'QR กสิกร');
  assert.equal(matchDepositsToSales([settled], [sale(1,'2026-09-05',500)], qrSettles, { used: new Set([1]) }).size, 0);
  const future = deposit('2026-09-05', 500, 'QR กสิกร');
  assert.equal(matchDepositsToSales([future], [sale(1,'2026-09-06',500)], qrSettles).size, 0);
});

test('QR same-day fallback keeps a typo visible but never steals late money',()=>{
  const typo = deposit('2026-09-16', 48523.2, 'QR กสิกร');
  assert.equal(matchDepositsToSales([typo], [sale(1,'2026-09-16',48523)], qrSettles).size, 0);
  assert.deepEqual(pairs(matchDepositsToSales([typo], [sale(1,'2026-09-16',48523)], qrSettles, { sameDayFallback:true })), { [typo.row_index]: 1 });
  const late = deposit('2026-09-02', 1200, 'QR กสิกร');
  assert.deepEqual(pairs(matchDepositsToSales([late], [sale(1,'2026-09-01',1200), sale(2,'2026-09-02',800)], qrSettles, { sameDayFallback:true })), { [late.row_index]: 1 });
  const card = deposit('2026-09-16', 100);
  assert.equal(matchDepositsToSales([card], [sale(1,'2026-09-16',5000)], kbankCardSettles).size, 0);
});

test('Grab pays next day normally and later only on a unique exact report',()=>{
  const report = (line_id, sale_date, net) => ({ line_id, sale_date, net, branch_code:'KK', branch_name:'คันคลอง', receipt_id:line_id });
  const normal = deposit('2026-09-02', 100, 'GRAB food');
  const late = deposit('2026-09-02', 250, 'GRAB food');
  const [a, b] = allocateOverviewGrab([normal, late], [report(1,'2026-09-01',100), report(2,'2026-08-30',250)]);
  assert.equal(a.line_id, 1); assert.match(a.reason, /1 วัน/);
  assert.equal(b.line_id, 2); assert.match(b.reason, /3 วัน/);
  const twice = deposit('2026-09-03', 100, 'GRAB food');
  const [c] = allocateOverviewGrab([twice], [report(1,'2026-09-01',100), report(3,'2026-09-02',100)]);
  assert.equal(c.line_id, 3, 'nearest unique day wins');
  const [d] = allocateOverviewGrab([deposit('2026-09-04', 100, 'GRAB food')], [report(1,'2026-09-02',100), report(4,'2026-09-02',100)]);
  assert.equal(d.line_id, null);
});
