import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// AR-P4-A is deliberately a fixture-only suite.  It does not import an
// adapter, database client, HTTP handler, or source token.  The rows below are
// source-like evidence grouped in one scenario so the accounting relationships
// remain explicit (and cannot be reconstructed by guessing from totals).
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, '../../../management-accounting/docs/contracts/general-cashflow/fixtures/accounting/phase-4');
const fixtureFiles = fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort();
const fixtures = fixtureFiles.map((name) => ({ name, fixture: JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) }));

const SCOPE = Object.freeze({ from: '2026-08-01', to: '2026-08-31', branch: 'SK', timezone: 'Asia/Bangkok' });
const MONEY_FIELDS = new Set([
  'gross_amount_incl_vat', 'expected_gross_amount', 'expected_fee_amount', 'expected_net_amount',
  'gross_amount', 'fee_amount', 'net_amount', 'actual_money_amount', 'allocated_net_amount',
  'allocated_fee_amount', 'amount', 'allocation_fee_amount',
]);
const FORBIDDEN_KEYS = /^(?:account_number|full_account_number|token|access_token|refresh_token|holder_name|customer_name|person_name|phone|email|address|raw_statement_payload|attachment_contents)$/i;
const ADJUSTMENT_TYPES = new Set(['REFUND', 'CHARGEBACK', 'REVERSAL']);

function cents(value) {
  assert.equal(typeof value, 'string', `money must be a decimal string: ${value}`);
  assert.match(value, /^\d+\.\d{2}$/, `money must have exactly two decimal places: ${value}`);
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function money(value) {
  return (BigInt(value) / 100n).toString() + '.' + (BigInt(value) % 100n).toString().padStart(2, '0');
}

function rows(fixture, entityType) {
  return fixture.data.filter((row) => row.entity_type === entityType);
}

function assertNoForbiddenData(value, location = 'fixture') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenData(item, `${location}[${index}]`));
  if (!value || typeof value !== 'object') {
    assert.doesNotMatch(String(value), /(?:bearer\s+|sk_live_|secret|password)/i, `${location} contains secret-like data`);
    assert.doesNotMatch(String(value), /\b\d{10,19}\b/, `${location} contains an unmasked account-like number`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(FORBIDDEN_KEYS.test(key), false, `${location}.${key} is forbidden by privacy contract`);
    assertNoForbiddenData(nested, `${location}.${key}`);
  }
}

function assertDateInPilot(value, location) {
  assert.match(value, /^2026-08-(?:0[1-9]|[12]\d|3[01])$/, `${location} must be an August 2026 date`);
}

function sourceTotals(fixture) {
  const total = (entityType, field) => rows(fixture, entityType).reduce((sum, row) => sum + (row[field] == null ? 0n : cents(row[field])), 0n);
  return {
    sales_gross: total('pos_daily_sale', 'gross_amount_incl_vat'),
    expectation_gross: total('receipt_expectation', 'expected_gross_amount'),
    settlement_gross: total('cash_settlement', 'gross_amount'),
    settlement_net: total('cash_settlement', 'net_amount'),
    allocation_net: total('allocation', 'amount'),
    requested_allocation_net: total('allocation', 'amount'),
    adjustment_amount: total('receivable_adjustment', 'amount'),
    allocation_fee: total('allocation', 'allocation_fee_amount'),
  };
}

function expectedTotals(fixture) {
  return Object.fromEntries(Object.entries(fixture.expected.source_totals || {}).map(([key, value]) => [key, cents(value)]));
}

test('AR-P4-A has exactly six deterministic sanitized accounting scenarios', () => {
  assert.deepEqual(fixtureFiles, [
    'adjustments-refund-chargeback-reversal.json',
    'cent-rounding.json',
    'gross-fee-net.json',
    'many-settlements-one-expectation.json',
    'one-batch-many-business-days.json',
    'over-allocation-rejected.json',
  ]);
  assert.equal(new Set(fixtures.map(({ fixture }) => fixture.fixture_id)).size, fixtures.length);
  for (const { name, fixture } of fixtures) {
    assert.equal(fixture.schema_version, 'ar-p4-accounting-1.0', name);
    assert.equal(fixture.source, 'GENERAL_CASHFLOW', name);
    assert.equal(fixture.source_type, 'accounting_scenario', name);
    assert.deepEqual(fixture.scope, SCOPE, name);
    assert.ok(Array.isArray(fixture.data) && fixture.data.length > 0, name);
    assert.ok(fixture.expected && typeof fixture.expected === 'object', name);
    assert.ok(['VALID', 'EXCEPTION'].includes(fixture.expected.status), name);
    assertNoForbiddenData(fixture, name);
  }
});

test('all scenario rows stay in SK/August business scope and use exact cents', () => {
  for (const { name, fixture } of fixtures) {
    for (const [index, row] of fixture.data.entries()) {
      assert.ok(['pos_daily_sale', 'receipt_expectation', 'cash_settlement', 'allocation', 'receivable_adjustment'].includes(row.entity_type), `${name}[${index}] entity`);
      if (row.entity_type !== 'allocation') {
        assert.equal(row.branch_code, 'SK', `${name}[${index}] branch`);
        assertDateInPilot(row.business_date, `${name}[${index}].business_date`);
      } else if (row.business_date != null) {
        assert.equal(row.branch_code, 'SK', `${name}[${index}] allocation branch`);
        assertDateInPilot(row.business_date, `${name}[${index}].business_date`);
      }
      if (row.settlement_date != null) assert.match(row.settlement_date, /^2026-\d{2}-\d{2}$/, `${name}[${index}].settlement_date`);
      assert.equal(typeof row.source_id, 'string', `${name}[${index}] source_id`);
      for (const [key, value] of Object.entries(row)) if (MONEY_FIELDS.has(key)) cents(value);
    }
    for (const [key, value] of Object.entries(fixture.expected)) {
      if (['recognized_sales', 'expected_net_receipts', 'allocated_net', 'actual_cash_in', 'receivable_in_transit', 'recognized_fees'].includes(key)) cents(value);
    }
    for (const value of Object.values(fixture.expected.source_totals || {})) cents(value);
  }
});

test('source totals are derived exactly from explicit rows, never balancing rows', () => {
  for (const { name, fixture } of fixtures) {
    const actual = sourceTotals(fixture);
    const declared = expectedTotals(fixture);
    for (const [key, value] of Object.entries(declared)) assert.equal(actual[key], value, `${name} source_totals.${key}`);
    if (fixture.expected.status === 'VALID') {
      assert.equal(actual.allocation_net <= actual.settlement_net, true, `${name} allocation <= settlement net`);
      assert.equal(fixture.expected.recognized_sales, money(actual.sales_gross), `${name} recognized sales must come from explicit POS rows`);
      assert.equal(fixture.expected.expected_net_receipts, money(rows(fixture, 'receipt_expectation').reduce((sum, row) => sum + cents(row.expected_net_amount), 0n)), `${name} expected net`);
      assert.equal(fixture.expected.allocated_net, money(actual.allocation_net), `${name} allocated net`);
      assert.equal(fixture.expected.actual_cash_in, money(rows(fixture, 'cash_settlement').reduce((sum, row) => sum + cents(row.actual_money_amount), 0n)), `${name} actual cash-in`);
      assert.equal(fixture.expected.recognized_fees, money(rows(fixture, 'receipt_expectation').reduce((sum, row) => sum + cents(row.expected_fee_amount), 0n)), `${name} recognized fee`);
      assert.equal(fixture.expected.receivable_in_transit, money(rows(fixture, 'receipt_expectation').reduce((sum, row) => sum + cents(row.expected_net_amount), 0n) - actual.allocation_net), `${name} transit`);
    } else {
      for (const key of ['recognized_sales', 'expected_net_receipts', 'allocated_net', 'actual_cash_in', 'receivable_in_transit', 'recognized_fees']) assert.equal(fixture.expected[key], '0.00', `${name} exception ${key}`);
    }
    assert.equal(fixture.data.some((row) => row.entity_type === 'balancing' || row.is_balancing === true), false, `${name} must not invent a balancing row`);
  }
});

test('every settled source row satisfies gross-fee-net and explicit allocation caps in integer cents', () => {
  for (const { name, fixture } of fixtures) {
    const settlements = rows(fixture, 'cash_settlement');
    for (const settlement of settlements) {
      assert.equal(cents(settlement.gross_amount) - cents(settlement.fee_amount), cents(settlement.net_amount), `${name} ${settlement.source_id} gross-fee-net`);
      const linked = rows(fixture, 'allocation').filter((row) => row.settlement_source_id === settlement.source_settlement_id);
      const allocated = linked.reduce((sum, row) => sum + cents(row.amount), 0n);
      if (fixture.expected.status === 'VALID') assert.equal(allocated <= cents(settlement.net_amount), true, `${name} settlement allocation cap`);
    }
    const expectations = rows(fixture, 'receipt_expectation');
    for (const expectation of expectations) {
      const linked = rows(fixture, 'allocation').filter((row) => row.expectation_source_id === expectation.source_receipt_line_id);
      const allocated = linked.reduce((sum, row) => sum + cents(row.amount), 0n);
      if (fixture.expected.status === 'VALID') assert.equal(allocated <= cents(expectation.expected_net_amount), true, `${name} expectation allocation cap`);
    }
  }
});

test('source totals remain traceable by business day, branch, channel, and batch', () => {
  const dimensions = ['business_date', 'branch_code', 'channel_code', 'source_batch_id'];
  const amountFields = {
    pos_daily_sale: 'gross_amount_incl_vat',
    receipt_expectation: 'expected_gross_amount',
    cash_settlement: 'gross_amount',
    allocation: 'amount',
    receivable_adjustment: 'amount',
  };
  for (const { name, fixture } of fixtures) {
    for (const dimension of dimensions) {
      const candidates = fixture.data.filter((row) => row[dimension] != null);
      if (!candidates.length) continue;
      for (const [entityType, field] of Object.entries(amountFields)) {
        const entityRows = candidates.filter((row) => row.entity_type === entityType && row[field] != null);
        if (!entityRows.length) continue;
        const byDimension = new Map();
        for (const row of entityRows) byDimension.set(row[dimension], (byDimension.get(row[dimension]) || 0n) + cents(row[field]));
        const groupedTotal = [...byDimension.values()].reduce((sum, value) => sum + value, 0n);
        const overallTotal = entityRows.reduce((sum, row) => sum + cents(row[field]), 0n);
        assert.equal(groupedTotal, overallTotal, `${name} ${entityType}.${field} grouped by ${dimension}`);
      }
    }
    assert.ok([...new Set(fixture.data.filter((row) => row.entity_type !== 'allocation' && row.branch_code).map((row) => row.branch_code))].every((branch) => branch === 'SK'), `${name} branch grouping`);
  }
});

test('gross-fee-net scenario preserves 100000 revenue and 98000 cash-in', () => {
  const fixture = fixtures.find(({ name }) => name === 'gross-fee-net.json').fixture;
  assert.equal(fixture.expected.recognized_sales, '100000.00');
  assert.equal(fixture.expected.expected_net_receipts, '98000.00');
  assert.equal(fixture.expected.actual_cash_in, '98000.00');
  assert.equal(fixture.expected.recognized_fees, '2000.00');
  assert.equal(fixture.expected.receivable_in_transit, '0.00');
  assert.equal(rows(fixture, 'pos_daily_sale')[0].business_date, '2026-08-10');
  assert.equal(rows(fixture, 'cash_settlement')[0].settlement_date, '2026-08-11');
});

test('one batch fans out to many August business days and many settlements converge on one expectation', () => {
  const batch = fixtures.find(({ name }) => name === 'one-batch-many-business-days.json').fixture;
  const batchRows = rows(batch, 'cash_settlement');
  assert.equal(batchRows.length, batch.expected.batch_count);
  assert.deepEqual([...new Set(batch.data.filter((row) => row.entity_type === 'allocation').map((row) => row.business_date))].sort(), batch.expected.batch_business_dates);
  assert.equal(batchRows[0].settlement_date, batch.expected.settlement_date);
  assert.equal(batchRows[0].settlement_date.slice(0, 7), '2026-09');

  const many = fixtures.find(({ name }) => name === 'many-settlements-one-expectation.json').fixture;
  const expectationIds = new Set(rows(many, 'cash_settlement').map((row) => row.source_receipt_line_id));
  assert.equal(rows(many, 'cash_settlement').length, many.expected.settlement_count);
  assert.equal(expectationIds.size, 1);
  for (const checkpoint of many.expected.checkpoint_totals) {
    const settled = rows(many, 'cash_settlement').filter((row) => row.settlement_date <= checkpoint.as_of_settlement_date);
    const allocated = settled.reduce((sum, row) => sum + cents(row.allocated_net_amount), 0n);
    assert.equal(money(allocated), checkpoint.allocated_net, checkpoint.as_of_settlement_date);
    assert.equal(money(cents('98000.00') - allocated), checkpoint.receivable_in_transit, checkpoint.as_of_settlement_date);
  }
});

test('cent-rounding scenario sums every explicit cent without floating-point arithmetic', () => {
  const fixture = fixtures.find(({ name }) => name === 'cent-rounding.json').fixture;
  const allocations = rows(fixture, 'allocation');
  assert.deepEqual(allocations.map((row) => Number(cents(row.amount))).sort((a, b) => b - a), fixture.expected.allocation_cents.sort((a, b) => b - a));
  assert.deepEqual(allocations.map((row) => Number(cents(row.allocation_fee_amount))).sort((a, b) => b - a), fixture.expected.allocation_fee_cents.sort((a, b) => b - a));
  assert.equal(allocations.reduce((sum, row) => sum + cents(row.amount), 0n), cents('98.00'));
  assert.equal(allocations.reduce((sum, row) => sum + cents(row.allocation_fee_amount), 0n), cents('2.00'));
});

test('refund, chargeback and reversal are append-only adjustment rows with D-11/D-12 unmapped', () => {
  const fixture = fixtures.find(({ name }) => name === 'adjustments-refund-chargeback-reversal.json').fixture;
  const adjustments = rows(fixture, 'receivable_adjustment');
  assert.equal(adjustments.length, fixture.expected.adjustment_count);
  assert.deepEqual(adjustments.map((row) => row.adjustment_type), fixture.expected.adjustment_types);
  assert.ok(adjustments.every((row) => ADJUSTMENT_TYPES.has(row.adjustment_type)));
  assert.ok(adjustments.every((row) => row.applies_to_source_id));
  assert.equal(fixture.expected.adjustments_are_append_only, true);
  assert.equal(fixture.expected.original_sales_and_settlement_unchanged, true);
  for (const key of ['thai_coa_code', 'vat_amount', 'wht_amount', 'tax_treatment']) assert.equal(fixture.expected[key], null, key);
  assert.equal(fixture.expected.approval_status, 'REVIEW_REQUIRED');
});

test('over-allocation declares a stable 422 exception and produces no balancing or financial fact', () => {
  const fixture = fixtures.find(({ name }) => name === 'over-allocation-rejected.json').fixture;
  assert.equal(fixture.expected.status, 'EXCEPTION');
  assert.deepEqual(fixture.expected.error, {
    code: 'ALLOCATION_EXCEEDS_SOURCE',
    status: 422,
    message: 'Explicit allocation exceeds settlement net or remaining expectation',
  });
  const requested = rows(fixture, 'allocation').reduce((sum, row) => sum + cents(row.amount), 0n);
  assert.equal(requested, cents(fixture.expected.source_totals.requested_allocation_net));
  assert.equal(requested > cents(rows(fixture, 'cash_settlement')[0].net_amount), true);
  assert.equal(fixture.expected.no_financial_facts_created, true);
  assert.equal(fixture.expected.no_balancing_row_created, true);
});
