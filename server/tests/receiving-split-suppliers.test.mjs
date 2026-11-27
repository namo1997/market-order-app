import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groupQueue, withReceiptSummary, queueSupplierKey, queueSupplierName } from '../src/models/receiving-queue-policy.js';
import { aggregateBranchQueue } from '../src/models/receiving-branch-policy.js';
import { RECEIVING_SPLIT_BY_SUPPLIER_GROUP_IDS } from '../src/config/receiving-split-suppliers.js';

// Owner 2026-11-27: "ไก่บ้าน คือของ เบทาโก" — the catch-all group ซัพอื่น(ผลิตสันกำแพง) (id 17)
// must show one shop per real supplier in the receiving queue.
const row = (id, product, supplier, extra = {}) => ({ order_item_id: id, product_id: id, product_name: product,
  order_date: '2026-11-27', quantity_ordered: '5.00', received_quantity: null, unit_id: 1, unit_name: 'กิโลกรัม',
  branch_id: 4, department_id: 20, department_name: 'ครัว', product_group_id: 17, product_group_name: 'ซัพอื่น(ผลิตสันกำแพง)',
  skip_receiving_required: 1, ...(supplier ? { product_supplier_master_id: supplier[0], product_supplier_name: supplier[1] } : {}), ...extra });
const BETAGRO = [13, 'บจก.เบทาโกรเกษตรอุสาหกรรม'], SUPORN = [5, 'หจก.สุพรค้าหมูเจริญ'];

test('split: catch-all group becomes one shop per real supplier; unlinked items keep the group name', () => {
  const rows = [row(1, 'ไก่บ้านสด', BETAGRO), row(2, 'สันคอก้อน A', BETAGRO), row(3, 'กระดูกอ่อน', SUPORN), row(4, 'ปลากะพง', null)];
  const queue = groupQueue(rows, '2026-11-27');
  const shops = Object.fromEntries(queue.map(g => [g.supplier_key, { name: g.supplier_name, items: g.items.map(i => i.product_name) }]));
  assert.deepEqual(shops, {
    'pg:17:sm:13': { name: 'บจก.เบทาโกรเกษตรอุสาหกรรม', items: ['ไก่บ้านสด', 'สันคอก้อน A'] },
    'pg:17:sm:5': { name: 'หจก.สุพรค้าหมูเจริญ', items: ['กระดูกอ่อน'] },
    'pg:17': { name: 'ซัพอื่น(ผลิตสันกำแพง)', items: ['ปลากะพง'] },
  });
  assert.ok(queue.every(g => g.receiving_optional === true), 'optional receiving follows the group');
});

test('split: ordinary groups are never split, even when products have a supplier master', () => {
  const rows = [row(1, 'ไส้อ่อน', SUPORN, { product_group_id: 8, product_group_name: 'ผลิตสันกำแพง' }), row(2, 'ตับ', BETAGRO, { product_group_id: 8, product_group_name: 'ผลิตสันกำแพง' })];
  assert.equal(RECEIVING_SPLIT_BY_SUPPLIER_GROUP_IDS.has(8), false);
  const queue = groupQueue(rows, '2026-11-27');
  assert.deepEqual(queue.map(g => [g.supplier_key, g.supplier_name, g.items.length]), [['pg:8', 'ผลิตสันกำแพง', 2]]);
  assert.equal(queueSupplierKey({}), 'none');
  assert.equal(queueSupplierName({ product_group_id: 17, product_group_name: 'ซัพอื่น', product_supplier_master_id: 0 }), 'ซัพอื่น');
});

test('split: lead time falls back to the group; receipt summary and branch queue keep the split key', () => {
  const rows = [row(1, 'ไก่บ้านสด', BETAGRO, { order_date: '2026-11-26' }), row(2, 'กระดูกอ่อน', SUPORN, { order_date: '2026-11-26' })];
  const queue = groupQueue(rows, '2026-11-27', [{ supplier_key: 'pg:17', lead_days: 1 }, { supplier_key: 'pg:17:sm:5', lead_days: 3 }]);
  assert.deepEqual(Object.fromEntries(queue.map(g => [g.supplier_key, g.lead_days])), { 'pg:17:sm:13': 1, 'pg:17:sm:5': 3 });

  const confirmed = [...rows, row(9, 'ไก่บ้านสด', BETAGRO, { received_quantity: '6.00', has_confirmed_receipt: 1 })];
  const summary = withReceiptSummary(queue, confirmed);
  assert.deepEqual(summary.find(g => g.supplier_key === 'pg:17:sm:13').receipt_summary, { short: 0, over: 1, received_items: 1 });
  assert.equal(summary.find(g => g.supplier_key === 'pg:17:sm:5').receipt_summary, undefined);

  const branch = aggregateBranchQueue(groupQueue([...rows, row(3, 'ไก่บ้านสด', BETAGRO, { product_id: 1, department_id: 26, department_name: 'กับข้าวพนักงาน' })], '2026-11-27'), rows);
  assert.deepEqual(branch.map(g => [g.supplier_key, g.items.length]).sort(), [['pg:17:sm:13', 1], ['pg:17:sm:5', 1]]);
  assert.equal(branch.find(g => g.supplier_key === 'pg:17:sm:13').items[0].departments.length, 2);
});

test('split: queue SQL reads the product supplier; follow-up key and optional-group filters accept split keys', async () => {
  const helpers = await readFile(new URL('../src/models/receiving-documents-helpers.js', import.meta.url), 'utf8');
  assert.match(helpers, /p\.supplier_master_id AS product_supplier_master_id/);
  assert.match(helpers, /LEFT JOIN supplier_masters psm ON psm\.id = p\.supplier_master_id/);
  const controller = await readFile(new URL('../src/controllers/receiving-followups.controller.js', import.meta.url), 'utf8');
  const pattern = new RegExp(controller.match(/!\/(\^\(pg:[^/]+\$)\/\.test/)[1]);
  for (const ok of ['pg:17', 'pg:17:sm:13', 'none']) assert.ok(pattern.test(ok), ok);
  for (const bad of ['pg:17:sm:', 'sm:13', 'pg:0', 'pg:17:sm:13:x']) assert.ok(!pattern.test(bad), bad);
  for (const file of ['../src/models/receiving-followups-store.js', '../src/services/receiving-push.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    const filters = source.match(/supplier_key = CONCAT\('pg:', skipped\.id\) OR [a-z_.]+supplier_key LIKE CONCAT\('pg:', skipped\.id, ':sm:%'\)\)/g) || [];
    assert.ok(filters.length >= 1, file);
    assert.equal(filters.length, (source.match(/CONCAT\('pg:', skipped\.id\)/g) || []).length, `${file}: every skipped-group filter covers split keys`);
  }
});
