import { config } from './config.js';
import { roundMoney } from './domain/money.js';

const escapeValue = (value) => String(value ?? '').replace(/'/g, "''");

export const queryClickHouse = async (sql) => {
  const { host, user, password, database, port, secure } = config.clickhouse;
  if (!host || !user || !password) {
    const error = new Error('Missing ClickHouse connection configuration');
    error.statusCode = 503;
    throw error;
  }
  const protocol = secure ? 'https' : 'http';
  const url = `${protocol}://${host}:${port}/?database=${encodeURIComponent(database)}`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const trimmedSql = String(sql || '').trim();
  const finalSql = /\bformat\s+\w+/i.test(trimmedSql) ? trimmedSql : `${trimmedSql}\nFORMAT JSON`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain'
    },
    body: finalSql
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`ClickHouse query failed: ${response.status} ${text}`);
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  return payload?.data || [];
};

export const fetchExpectedSales = async ({ receiptDate, clickhouseBranchId }) => {
  const shopId = escapeValue(config.clickhouse.shopId);
  const branchId = escapeValue(clickhouseBranchId);
  const date = escapeValue(receiptDate);
  const offset = Number(config.clickhouse.tzOffset || 7);
  const branchExpr = "coalesce(nullIf(d.guidbranch, ''), nullIf(d.branchid, ''), '')";

  const [summary = {}] = await queryClickHouse(`
    WITH payment_by_doc AS (
      SELECT shopid, docno, toFloat64(sum(amount)) AS non_cash_amount
      FROM docpayment FINAL
      WHERE shopid = '${shopId}'
      GROUP BY shopid, docno
    )
    SELECT
      count() AS bill_count,
      toFloat64(sum(d.totalamount)) AS gross_sales,
      toFloat64(sum(d.paycashamount)) AS cash_sales,
      toFloat64(sum(coalesce(p.non_cash_amount, 0))) AS non_cash_sales
    FROM doc AS d FINAL
    LEFT JOIN payment_by_doc p ON p.shopid = d.shopid AND p.docno = d.docno
    WHERE d.shopid = '${shopId}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND ${branchExpr} = '${branchId}'
      AND toDate(addHours(d.docdatetime, ${offset})) = toDate('${date}')
  `);

  const paymentRows = await queryClickHouse(`
    SELECT
      nullIf(trimBoth(dp.description), '') AS clickhouse_description,
      count() AS payment_rows,
      countDistinct(dp.docno) AS bill_count,
      toFloat64(sum(dp.amount)) AS amount
    FROM docpayment AS dp FINAL
    INNER JOIN doc AS d FINAL ON d.shopid = dp.shopid AND d.docno = dp.docno
    WHERE dp.shopid = '${shopId}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND coalesce(nullIf(dp.guidbranch, ''), nullIf(dp.branchid, ''), '') = '${branchId}'
      AND toDate(addHours(d.docdatetime, ${offset})) = toDate('${date}')
    GROUP BY clickhouse_description
    ORDER BY amount DESC
  `);

  return {
    billCount: Number(summary.bill_count || 0),
    grossSales: roundMoney(summary.gross_sales),
    cashSales: roundMoney(summary.cash_sales),
    nonCashSales: roundMoney(summary.non_cash_sales),
    paymentRows: paymentRows.map((row) => ({
      description: row.clickhouse_description || '',
      amount: roundMoney(row.amount),
      paymentRows: Number(row.payment_rows || 0),
      billCount: Number(row.bill_count || 0)
    }))
  };
};

export const fetchExpectedSalesRange = async ({ from, to, branches }) => {
  const shopId = escapeValue(config.clickhouse.shopId);
  const fromDate = escapeValue(from);
  const toDate = escapeValue(to);
  const offset = Number(config.clickhouse.tzOffset || 7);
  const normalizedBranches = (Array.isArray(branches) ? branches : [])
    .map((branch) => ({
      code: String(branch.code || '').trim(),
      clickhouseBranchId: String(branch.clickhouse_branch_id || branch.clickhouseBranchId || '').trim()
    }))
    .filter((branch) => branch.code && branch.clickhouseBranchId);
  if (normalizedBranches.length === 0) return [];

  const codeByClickHouseId = new Map(
    normalizedBranches.map((branch) => [branch.clickhouseBranchId, branch.code])
  );
  const branchIds = normalizedBranches
    .map((branch) => `'${escapeValue(branch.clickhouseBranchId)}'`)
    .join(', ');
  const branchExpr = "coalesce(nullIf(d.guidbranch, ''), nullIf(d.branchid, ''), '')";
  const rows = await queryClickHouse(`
    SELECT
      toString(toDate(addHours(d.docdatetime, ${offset}))) AS business_date,
      ${branchExpr} AS clickhouse_branch_id,
      count() AS bill_count,
      toFloat64(sum(d.totalamount)) AS gross_sales
    FROM doc AS d FINAL
    WHERE d.shopid = '${shopId}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND ${branchExpr} IN (${branchIds})
      AND toDate(addHours(d.docdatetime, ${offset})) BETWEEN toDate('${fromDate}') AND toDate('${toDate}')
    GROUP BY business_date, clickhouse_branch_id
    ORDER BY business_date ASC, clickhouse_branch_id ASC
  `);

  return rows.map((row) => ({
    businessDate: row.business_date,
    branchCode: codeByClickHouseId.get(String(row.clickhouse_branch_id || '')) || '',
    billCount: Number(row.bill_count || 0),
    grossSalesExpected: roundMoney(row.gross_sales)
  })).filter((row) => row.branchCode);
};

export const fetchOpenCartOrders = async ({ receiptDate }) => {
  const shopId = escapeValue(config.clickhouse.shopId);
  const date = escapeValue(receiptDate);
  const offset = Number(config.clickhouse.tzOffset || 7);

  const rows = await queryClickHouse(`
    SELECT
      c.cartnumber AS cart_number,
      any(c.usercode) AS user_code,
      max(c.createdatetime) AS opened_at,
      toFloat64(max(c.totalamount)) AS amount,
      countIf(cd.name != '') AS item_count,
      arrayStringConcat(arraySlice(groupArrayIf(cd.name, cd.name != ''), 1, 3), ', ') AS sample_items
    FROM cartorder c
    LEFT JOIN cartorderdetail cd
      ON cd.shopid = c.shopid
     AND cd.cartnumber = c.cartnumber
    WHERE c.shopid = '${shopId}'
      AND toDate(addHours(c.createdatetime, ${offset})) = toDate('${date}')
    GROUP BY c.cartnumber
    ORDER BY opened_at DESC
    LIMIT 50
  `);

  const openTables = rows.map((row) => ({
    cartNumber: row.cart_number || '',
    userCode: row.user_code || '',
    openedAt: row.opened_at || null,
    amount: roundMoney(row.amount),
    itemCount: Number(row.item_count || 0),
    sampleItems: row.sample_items || ''
  }));

  return {
    available: true,
    branchFilterSupported: false,
    openTableCount: openTables.length,
    openTableAmount: roundMoney(openTables.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    openTables
  };
};
