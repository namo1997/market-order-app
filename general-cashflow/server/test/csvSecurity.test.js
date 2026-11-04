import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'csv-parse/sync';
import { parseStatementBuffer } from '../src/domain/statements.js';

test('reserved CSV column names cannot replace the parsed record prototype', () => {
  for (const columns of [true, (headers) => headers]) {
    const [row] = parse('__proto__,constructor,prototype,amount\nobject,object,object,123.45', {
      columns,
      cast: (value, context) => !context.header && value === 'object' ? { polluted: true } : value
    });
    assert.equal(Object.getPrototypeOf(row), Object.prototype);
    assert.equal(Object.hasOwn(row, '__proto__'), true);
    assert.deepEqual(row.__proto__, { polluted: true });
    assert.equal(row.polluted, undefined);
    assert.equal({}.polluted, undefined);
    assert.equal(row.amount, '123.45');
  }
});

test('statement imports retain ordinary dates and cents with reserved extra headers', async () => {
  const rows = await parseStatementBuffer({
    buffer: Buffer.from('date,description,reference,amount,__proto__,constructor,prototype\n2026-11-04,QR payment,fixture-ref,123.45,extra,extra,extra'),
    originalName: 'reserved-headers.csv', mimeType: 'text/csv'
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 123.45);
  assert.equal(rows[0].transactionDate, '2026-11-04');
  assert.equal(Object.getPrototypeOf(rows[0].rawPayload), Object.prototype);
  assert.equal({}.polluted, undefined);
});
