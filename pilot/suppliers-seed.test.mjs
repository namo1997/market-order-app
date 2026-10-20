import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import * as ocr from '../server/src/services/receiving-ocr.service.js';
import { matchOcrLinesToCatalog } from '../server/src/services/receiving-ocr-matcher.js';
import { seed } from './seed.mjs';
import { pilotOptions } from './codex-ocr.mjs';
import { SUPPLIERS_2026_10 } from './seed-suppliers.mjs';
const ocrCode = ocr.normalizeItemCode;

const server = fileURLToPath(new URL('../server', import.meta.url));
const noop = async () => {};

const splitValues = text => {
  const tokens = []; let current = '', quoted = false;
  for (const char of text) {
    if (char === "'") quoted = !quoted;
    if (char === ',' && !quoted) { tokens.push(current.trim()); current = ''; } else current += char;
  }
  return [...tokens, current.trim()];
};
// Records every INSERT as a row; no database of any kind is touched.
async function runSeed(profile = 'suppliers-2026-10', date = '2026-10-20') {
  const rows = {}, statements = []; let orderId = 100;
  const pool = { async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim(); statements.push({ sql: text, params });
    const insert = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \((.*)\)$/.exec(text);
    if (insert) {
      const columns = insert[2].split(',').map(column => column.trim());
      // Inline literals (status, ids, true) are read from the SQL text; '?' consumes the next parameter.
      let next = 0;
      const values = splitValues(insert[3]).map(token => token === '?' ? params[next++]
        : /^'.*'$/.test(token) ? token.slice(1, -1) : token === 'true' ? true : token === 'false' ? false : token === 'NULL' ? null : Number(token));
      (rows[insert[1]] ||= []).push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
      return [{ insertId: insert[1] === 'orders' ? ++orderId : 7 }];
    }
    return [{ insertId: 7 }];
  } };
  const source = { ocr, order: { ensureOrderReceivingColumns: noop }, inventory: { ensureInventoryTables: noop }, schema: { ensureReceivingDocumentsTables: noop } };
  const result = await seed(server, pool, source, { profile, date });
  return { result, rows, statements };
}

test('flag: --seed=suppliers-2026-10 is accepted, unknown profiles and duplicates still rejected, other profiles unchanged', () => {
  assert.deepEqual(pilotOptions(['--seed=suppliers-2026-10']), { port: 0, ocr: 'mock', seed: 'suppliers-2026-10' });
  assert.deepEqual(pilotOptions(['--port=8841', '--ocr=codex', '--seed=suppliers-2026-10']), { port: 8841, ocr: 'codex', seed: 'suppliers-2026-10' });
  for (const seedName of ['default', 'jae-waew', 'ice-vic', 'all']) assert.equal(pilotOptions([`--seed=${seedName}`]).seed, seedName);
  for (const args of [['--seed=suppliers-2026'], ['--seed=suppliers-2026-10', '--seed=default'], ['--seed=SUPPLIERS-2026-10']]) assert.throws(() => pilotOptions(args));
});

test('suppliers-2026-10 contains the seven registry suppliers with SYNTHETIC identifiers and registry ordering modes under both keys', async () => {
  const { result, rows } = await runSeed();
  assert.equal(result.label, 'SYNTHETIC'); assert.equal(result.profile, 'suppliers-2026-10');
  const registry = await readFile('/Volumes/SSD Files/SOLAO/market-order-system/reports/supplier-setup/SUPPLIERS.md', 'utf8').catch(() => null);
  const names = ['เจ๊แววไก่สด ตลาดเมืองใหม่', 'ร้านน้ำแข็ง vic', 'ร้านต้นพยอมพานิช', 'บริษัท สุพรค้าหมูเจริญ จำกัด', 'ร้านแพปลาภูเก็ต', 'บริษัท เบทาโกรเกษตรอุตสาหกรรม จำกัด', 'บริษัท เอเซียเกษตรรุ่งวิไล จำกัด'];
  assert.deepEqual(rows.supplier_masters.map(row => row.name), names); assert.deepEqual(rows.product_groups.map(row => row.name), names);
  if (registry) for (const name of names) assert.ok(registry.includes(name.replace(/ \(.*/, '')), `registry mentions ${name}`);
  assert.ok(rows.supplier_masters.every(row => row.code.startsWith('SYN-'))); assert.ok(rows.product_groups.every(row => row.code.startsWith('SYN-')));
  assert.equal(new Set(rows.supplier_masters.map(row => row.code)).size, 7);
  assert.equal(result.supplierMasters, 7); assert.equal(result.supplierProductGroups, 7);
  const profiles = rows.receiving_supplier_profiles;
  assert.equal(profiles.length, 14);
  assert.deepEqual(profiles.filter(row => row.supplier_key.startsWith('sm:')).map(row => [row.supplier_key, row.ordering_mode]),
    [['sm:1', 'system'], ['sm:2', 'walk_in_phone'], ['sm:3', 'mixed'], ['sm:4', 'mixed'], ['sm:5', 'mixed'], ['sm:6', 'system'], ['sm:7', 'mixed']]);
  assert.deepEqual(profiles.filter(row => row.supplier_key.startsWith('pg:')).map(row => row.ordering_mode), ['system', 'walk_in_phone', 'mixed', 'mixed', 'mixed', 'system', 'mixed']);
  for (const row of profiles) { assert.ok(row.branches_note && row.bill_format_note); assert.ok(['system', 'walk_in_phone', 'mixed', null].includes(row.ordering_mode)); }
});

test('suppliers-2026-10 products carry registry units and prices, belong to their supplier, and reference seeded units', async () => {
  const { rows, result } = await runSeed();
  const byName = new Map(rows.products.map(row => [row.name, row]));
  const price = { 'ขา B': '60.00', 'ปีกบน': '76.00', 'ปีกกลาง': '135.00', 'อกไก่': '80.00', 'น้ำแข็งหลอดใหญ่': '35.00', 'น้ำแข็งบด (ใช้ครัว)': '35.00',
    'น้ำแข็งสำหรับกาแฟ': '35.00', 'น้ำแข็งบด (ใช้ผลิต)': '35.00', 'ไข่ไก่เบอร์ 1': '138.00', 'โฟม 502': '145.00', 'ตับหมู': '100.00', 'สันคอ': '150.00',
    'กะพงไซด์ (ปลากระพงขาว)': '145.00', 'เนื้อปูอก (เล็ก)': '800.00', 'เนื้อปูก้อน (กลาง)': '1750.00', 'ปูม้า #2 (6–8 ตัว/โล)': '325.00', 'หมึกอาร์เจนฯ': '200.00',
    'สันคอหมูสเต็ก 5KG': '150.00', 'สันคอหมู B-2 1KG': '150.00', 'ปีกกลาง MW 1กก': '130.00', 'FR CK ไก่บ้านอีสานล้วง ตัดคอ ตัดขา': '94.00',
    'ถั่วคั่ว ตราช้าง': '86.00', 'แป้งทอดกรอบ ครัววังทิพย์': '400.00', 'ถุงพลาสติกร้อน 5x8': '77.00', 'ถุงพลาสติกร้อน 7x11': '79.00' };
  for (const [name, expected] of Object.entries(price)) assert.equal(byName.get(name)?.default_price, expected, name);
  const unitIds = new Set([1, ...rows.units.map(row => row.id)]);
  assert.deepEqual([...unitIds].sort(), [1, 2, 3, 4, 5, 6]);
  assert.ok(rows.products.every(row => unitIds.has(row.unit_id)));
  const unitName = id => ({ 1: 'กก.', 2: 'ถุง', 3: 'แผง', 4: 'แถว', 5: 'กล่อง', 6: 'ห่อ' })[id];
  assert.equal(unitName(byName.get('ไข่ไก่เบอร์ 1').unit_id), 'แผง'); assert.equal(unitName(byName.get('โฟม 502').unit_id), 'แถว');
  assert.equal(unitName(byName.get('น้ำแข็งหลอดใหญ่').unit_id), 'ถุง'); assert.equal(unitName(byName.get('แป้งทอดกรอบ ครัววังทิพย์').unit_id), 'กล่อง');
  assert.equal(new Set(rows.products.map(row => row.id)).size, rows.products.length); assert.equal(new Set(rows.products.map(row => row.code)).size, rows.products.length);
  assert.equal(rows.products.length, result.products);
  // Every product is linked once to its supplier's group and master, and ids line up.
  assert.equal(rows.product_group_links.length, rows.products.length); assert.equal(rows.product_supplier_master_links.length, rows.products.length);
  for (const product of rows.products) assert.equal(product.product_group_id, rows.product_group_links.find(link => link.product_id === product.id).product_group_id);
  // Unknown registry prices stay NULL instead of inventing numbers.
  assert.equal(byName.get('แป้งสาลี ว่าว').default_price, null);
});

test('suppliers-2026-10 aliases are exactly the owner-confirmed ones, unique per key, under pg: and sm: keys', async () => {
  const { rows, result } = await runSeed();
  const productName = new Map(rows.products.map(row => [row.id, row.name]));
  const view = key => rows.supplier_product_aliases.filter(row => row.supplier_key === key).map(row => [row.bill_text, productName.get(row.product_id)]);
  assert.deepEqual(view('pg:1'), [['ทB', 'ขา B'], ['ทร', 'ขา B'], ['ป.บน', 'ปีกบน'], ['ป.กลาง', 'ปีกกลาง'], ['ปีกกลาง (ญ.)', 'ปีกกลาง'], ['ต.ไก่', 'อกไก่']]);
  assert.deepEqual(view('pg:2'), [['หลอดใหญ่', 'น้ำแข็งหลอดใหญ่'], ['โม่ครัว', 'น้ำแข็งบด (ใช้ครัว)'], ['กาแฟ', 'น้ำแข็งสำหรับกาแฟ'], ['โม่โรงงาน', 'น้ำแข็งบด (ใช้ผลิต)']]);
  assert.deepEqual(view('pg:3'), [['ไข่เบอร์ 1', 'ไข่ไก่เบอร์ 1'], ['ไข่ไก่ NO1', 'ไข่ไก่เบอร์ 1'], ['6 × 14', 'ถุงหิ้ว 6×14'], ['8 × 16', 'ถุงหิ้ว 8×16']]);
  assert.deepEqual(view('pg:4'), [['บดB', 'หมูบดเกรด B']]);
  for (const key of ['pg:5', 'pg:6', 'pg:7', 'sm:5', 'sm:6', 'sm:7']) assert.deepEqual(view(key), [], `${key} prints full names, no alias`);
  for (let id = 1; id <= 4; id++) assert.deepEqual(view(`sm:${id}`), view(`pg:${id}`));
  assert.equal(rows.supplier_product_aliases.length, 30); assert.equal(result.aliases, 30);
  const seen = new Set();
  for (const row of rows.supplier_product_aliases) {
    const unique = [row.supplier_key, row.normalized_bill_text, row.normalized_unit_text].join('|');
    assert.ok(!seen.has(unique), `duplicate alias ${unique}`); seen.add(unique);
    assert.equal(row.normalized_bill_text, ocr.normalizeMatchText(row.bill_text)); assert.ok(row.confirm_count === undefined || row.confirm_count >= 1);
    assert.equal(row.supplier_key.startsWith('sm:') ? row.supplier_master_id : row.product_group_id, Number(row.supplier_key.slice(3)));
  }
});

test('suppliers-2026-10 orders exist only for suppliers that order through the system and use their own products', async () => {
  const { rows, result } = await runSeed();
  const group = new Map(rows.products.map(row => [row.id, row.product_group_id]));
  assert.equal(rows.orders.length, 5); assert.equal(result.orders, 5); assert.equal(result.orderItems, rows.order_items.length);
  assert.ok(rows.orders.every(order => order.order_date === '2026-10-20' && order.order_number.startsWith('SYNTHETIC-')));
  assert.equal(new Set(rows.orders.map(order => order.order_number)).size, 5);
  const supplierOfOrder = new Map();
  rows.order_items.forEach(item => {
    const supplier = group.get(item.product_id);
    assert.ok(!supplierOfOrder.has(item.order_id) || supplierOfOrder.get(item.order_id) === supplier, 'one order never mixes suppliers');
    supplierOfOrder.set(item.order_id, supplier);
  });
  assert.deepEqual([...new Set(supplierOfOrder.values())].sort(), [1, 3, 4, 5, 6], 'walk-in (2) and unknown (7) suppliers have no system order');
  for (const order of rows.orders) {
    const items = rows.order_items.filter(item => item.order_id === 101 + rows.orders.indexOf(order));
    const cents = items.reduce((sum, item) => sum + Math.round(Number(item.quantity) * 100) * Math.round(Number(item.requested_price) * 100), 0);
    assert.equal(order.total_amount, (cents / 10000).toFixed(2));
    assert.ok(items.length > 0);
  }
  assert.equal(rows.orders.find(order => order.order_number.includes('-S1-')).total_amount, '3510.00', 'matches the existing jae-waew profile total');
  assert.deepEqual([...new Set(rows.orders.map(order => order.user_id))].sort(), [1, 2], 'one order for the second branch demonstrates multi-branch');
});

test('suppliers-2026-10 aliases drive the real OCR matcher: confirmed abbreviations resolve per supplier key, other suppliers do not leak', async () => {
  const { rows } = await runSeed();
  const productById = new Map(rows.products.map(row => [row.id, row]));
  const aliases = rows.supplier_product_aliases.map(row => ({ ...row, product_name: productById.get(row.product_id).name }));
  const products = rows.products.map(row => ({ id: row.id, name: row.name, unit_id: row.unit_id }));
  const units = [{ id: 1, name: 'กิโลกรัม', abbreviation: 'กก.' }, { id: 2, name: 'ถุง', abbreviation: 'ถุง' }];
  const match = (supplierKey, bill_text, unit_text = 'กก.') => matchOcrLinesToCatalog({ ocrLines: [{ bill_text, unit_text, quantity_billed: 2, unit_price: 10, amount: 20, confidence: 0.9 }],
    aliases, products, units, supplierKey })[0];
  for (const key of ['pg:1', 'sm:1']) {
    assert.deepEqual([match(key, 'ทB').product_name, match(key, 'ทร').product_name, match(key, 'ต.ไก่').product_name, match(key, 'ป.บน').product_name,
      match(key, 'ป.กลาง').product_name, match(key, 'ปีกกลาง (ญ.)').product_name], ['ขา B', 'ขา B', 'อกไก่', 'ปีกบน', 'ปีกกลาง', 'ปีกกลาง']);
  }
  assert.equal(match('pg:1', 'ทB').match.source, 'alias');
  assert.equal(match('pg:2', 'โม่ครัว', 'ถุง').product_name, 'น้ำแข็งบด (ใช้ครัว)');
  assert.equal(match('pg:3', '6 × 14', 'ใบ').product_name, 'ถุงหิ้ว 6×14');
  assert.equal(match('pg:3', 'ไข่ไก่ NO1', 'แผง').product_name, 'ไข่ไก่เบอร์ 1');
  assert.equal(match('pg:4', 'บดB').product_name, 'หมูบดเกรด B');
  assert.notEqual(match('pg:2', 'ทB').match?.source, 'alias', 'ice shop key must not use chicken abbreviations');
  assert.notEqual(match('pg:5', 'บดB').match?.source, 'alias');
  assert.notEqual(match('none', 'ทB').match?.source, 'alias');
});

test('suppliers-2026-10 never contains bank, tax-id or phone data and is deterministic across two runs; other profiles keep working', async () => {
  const first = await runSeed(), second = await runSeed();
  assert.deepEqual(first.statements, second.statements); assert.deepEqual(first.result, second.result);
  const values = first.statements.flatMap(entry => entry.params).filter(value => typeof value === 'string');
  for (const value of values) {
    assert.ok(!/\d{9,}/.test(value) && !/\b\d{3}-\d-\d{5}-\d\b/.test(value) && !/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/.test(value), `account/tax/phone-like number in ${value}`);
    assert.ok(!/ธนาคาร|บัญชีเลขที่|เลขประจำตัวผู้เสียภาษี|โทร\s*\d|tel|promptpay|@/i.test(value), value);
  }
  for (const supplier of SUPPLIERS_2026_10) assert.ok(!/\d{9,}/.test(JSON.stringify(supplier)));
  const other = await runSeed('suppliers-2026-10', '2026-10-21');
  assert.ok(other.rows.orders.every(order => order.order_date === '2026-10-21'));
  for (const profile of ['default', 'jae-waew', 'ice-vic', 'all']) assert.equal((await runSeed(profile)).result.label, 'SYNTHETIC');
  assert.equal((await runSeed('jae-waew')).result.aliases, 6); assert.equal((await runSeed('ice-vic')).result.aliases, 4);
  await assert.rejects(runSeed('suppliers-2026'), /Invalid pilot seed profile/);
});

test('suppliers-2026-10 follows the owner registry: correct branch spelling, mixed ordering for the dry-goods supplier, same-branch note and synthetic per-branch AP codes', async () => {
  const { rows, result, statements } = await runSeed();
  const everything = JSON.stringify(statements.map(entry => entry.params));
  assert.ok(!everything.includes('บ้านแจ้ง'), 'typo "บ้านแจ้ง" must not appear');
  assert.ok(!JSON.stringify(SUPPLIERS_2026_10).includes('บ้านแจ้ง'));
  const asia = rows.receiving_supplier_profiles.filter(row => row.supplier_key === 'sm:7' || row.supplier_key === 'pg:7');
  assert.deepEqual(asia.map(row => row.ordering_mode), ['mixed', 'mixed'], 'เอเซียเกษตรรุ่งวิไล is mixed, not unspecified');
  assert.ok(rows.receiving_supplier_profiles.every(row => row.ordering_mode !== undefined));
  // Suppliers that mention both names carry the owner's note that they are the same branch.
  for (const key of ['sm:5', 'pg:5', 'sm:7', 'pg:7']) {
    const note = rows.receiving_supplier_profiles.find(row => row.supplier_key === key).branches_note;
    assert.match(note, /บ้านแจ้ = สันกำแพง \(ต้นเปา\) เป็นสาขาเดียวกัน/, key); assert.ok(note.length <= 500);
  }
  assert.match(rows.receiving_supplier_profiles.find(row => row.supplier_key === 'sm:5').branches_note, /บ้านแจ้ \(/);
  // Per-branch AP codes: only for the two shops the registry names, under the master key, synthetic, no long numbers.
  const codes = rows.receiving_supplier_branch_codes;
  assert.deepEqual(codes.map(row => [row.supplier_key, row.supplier_code]), [['sm:4', 'SYN-AP-049'], ['sm:7', 'SYN-AP-003'], ['sm:7', 'SYN-AP-053']]);
  assert.equal(result.branchCodes, 3);
  assert.ok(codes.every(row => row.supplier_code.startsWith('SYN-AP-') && row.is_active === 1 && !/\d{9,}/.test(`${row.supplier_code}${row.branch_note}`)));
  assert.equal(new Set(codes.map(row => `${row.supplier_key}|${row.supplier_code}`)).size, codes.length);
});

test('suppliers-2026-10 carries one SYNTHETIC item_code alias that wins over misread text, per supplier key only', async () => {
  const { rows, result } = await runSeed();
  const withCode = rows.supplier_product_aliases.filter(row => row.item_code);
  assert.deepEqual(withCode.map(row => [row.supplier_key, row.bill_text, row.item_code]), [['pg:3', 'ไข่เบอร์ 1', 'SYN-5002'], ['sm:3', 'ไข่เบอร์ 1', 'SYN-5002']]);
  assert.equal(result.aliases, 30, 'the example reuses an existing alias row; the alias count is unchanged');
  for (const row of withCode) assert.equal(ocrCode(row.item_code), row.item_code, 'seeded code passes the server validation');
  const productById = new Map(rows.products.map(row => [row.id, row]));
  const aliases = rows.supplier_product_aliases.map(row => ({ ...row, product_name: productById.get(row.product_id).name }));
  const products = rows.products.map(row => ({ id: row.id, name: row.name, unit_id: row.unit_id }));
  const match = (supplierKey, extra) => matchOcrLinesToCatalog({ ocrLines: [{ bill_text: 'โฟมเบอร์ 1', unit_text: 'แผง', quantity_billed: 15, unit_price: 139, amount: 2085, confidence: 0.9, ...extra }],
    aliases, products, units: [], supplierKey })[0];
  for (const key of ['pg:3', 'sm:3']) {
    const byCode = match(key, { item_code: 'SYN-5002' });
    assert.equal(byCode.product_name, 'ไข่ไก่เบอร์ 1'); assert.equal(byCode.match.source, 'alias'); assert.equal(byCode.bill_text, 'โฟมเบอร์ 1');
    assert.notEqual(match(key, {}).match?.source, 'alias', 'without the code the misread text finds nothing');
  }
  assert.notEqual(match('pg:1', { item_code: 'SYN-5002' }).match?.source, 'alias', 'another supplier does not see the code');
});
