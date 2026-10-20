import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHrmsSalesProductCatalogQuery,
  normalizeHrmsSalesProductCatalog
} from '../src/utils/hrms-sales-product-catalog.js';

test('ClickHouse catalog query is branch and period scoped and excludes cancelled bills and quantities', () => {
  const sql = buildHrmsSalesProductCatalogQuery({
    shopId: "shop'1",
    branchId: 'BR03',
    from: '2026-08-25T17:00:00.000Z',
    to: '2026-09-25T17:00:00.000Z'
  });

  assert.match(sql, /FROM dedetemp\.ordertemplog AS o/);
  assert.match(sql, /INNER JOIN dedebi\.doc AS d FINAL/);
  assert.match(sql, /d\.transflag = 44/);
  assert.match(sql, /d\.iscancel = 0/);
  assert.match(sql, /d\.isdelete = 0/);
  assert.match(sql, /o\.isordersuccess = 1/);
  assert.match(sql, /o\.ispaysuccess = 1/);
  assert.match(sql, /argMax\(o\.orderqty, o\.lastupdatedatetime\)/);
  assert.match(sql, /argMax\(o\.cancelqty, o\.lastupdatedatetime\)/);
  assert.match(sql, /WHERE order_qty - cancel_qty > 0/);
  assert.match(sql, /GROUP BY barcode/);
  assert.match(sql, /GROUP BY o\.shopid, o\.docno, o\.orderguid, barcode/);
  assert.match(sql, /o\.branch = 'BR03'/);
  assert.match(sql, /d\.branchid = 'BR03'/);
  assert.match(sql, /shop''1/);
  assert.match(sql, /LIMIT 1000/);
});

test('catalog normalization returns only product identity fields and drops malformed rows', () => {
  const rows = normalizeHrmsSalesProductCatalog([
    { barcode: 'PARTIAL', product_name: 'เหลือหลังยกเลิกบางส่วน', unit_code: 'EA', unit_name: 'ชิ้น' },
    { barcode: '', product_name: 'ไม่มีบาร์โค้ด' },
    { barcode: 'NO-NAME', product_name: '' }
  ]);

  assert.deepEqual(rows.map((row) => row.barcode), ['PARTIAL']);
  assert.equal(rows[0].unit_code, 'EA');
});
