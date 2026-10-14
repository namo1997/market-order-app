const escapeClickHouseValue = (value) => String(value ?? '').replaceAll("'", "''");

export function buildHrmsSalesProductCatalogQuery({ shopId, branchId, from, to, timezoneOffset = 7 }) {
  const offset = Number(timezoneOffset);
  if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < -12 || offset > 14) {
    throw new Error('Invalid ClickHouse timezone offset');
  }

  return `
    SELECT
      barcode,
      argMax(product_name, latest_order_at) AS product_name,
      argMax(unit_code, latest_order_at) AS unit_code,
      argMax(unit_name, latest_order_at) AS unit_name
    FROM (
      SELECT
        trimBoth(o.barcode) AS barcode,
        argMax(trimBoth(o.names), o.lastupdatedatetime) AS product_name,
        argMax(trimBoth(o.unitcode), o.lastupdatedatetime) AS unit_code,
        argMax(trimBoth(o.unitname), o.lastupdatedatetime) AS unit_name,
        argMax(o.orderqty, o.lastupdatedatetime) AS order_qty,
        argMax(o.cancelqty, o.lastupdatedatetime) AS cancel_qty,
        max(o.orderdatetime) AS latest_order_at
      FROM dedetemp.ordertemplog AS o
      INNER JOIN dedebi.doc AS d FINAL
        ON d.shopid = o.shopid AND d.docno = o.docno
      WHERE o.shopid = '${escapeClickHouseValue(shopId)}'
        AND d.shopid = '${escapeClickHouseValue(shopId)}'
        AND o.branch = '${escapeClickHouseValue(branchId)}'
        AND d.branchid = '${escapeClickHouseValue(branchId)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND d.isdelete = 0
        AND o.isordersuccess = 1
        AND o.ispaysuccess = 1
        AND d.docdatetime >= parseDateTimeBestEffort('${escapeClickHouseValue(from)}')
        AND d.docdatetime < parseDateTimeBestEffort('${escapeClickHouseValue(to)}')
      GROUP BY o.shopid, o.docno, o.orderguid, barcode
    ) latest_lines
    WHERE order_qty - cancel_qty > 0
    -- Policy identity is barcode-only; collapse unit variants into one candidate.
    GROUP BY barcode
    ORDER BY product_name, barcode
    LIMIT 1000
  `;
}

export function normalizeHrmsSalesProductCatalog(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    barcode: String(row?.barcode || '').trim(),
    product_name: String(row?.product_name || '').trim(),
    unit_code: String(row?.unit_code || '').trim(),
    unit_name: String(row?.unit_name || '').trim(),
    latest_order_at: row?.latest_order_at || null
  })).filter((row) => (
    row.barcode
    && row.product_name
  ));
}
