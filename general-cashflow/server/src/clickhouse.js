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
      FROM docpayment
      WHERE shopid = '${shopId}'
      GROUP BY shopid, docno
    )
    SELECT
      count() AS bill_count,
      toFloat64(sum(d.totalamount)) AS gross_sales,
      toFloat64(sum(d.paycashamount)) AS cash_sales,
      toFloat64(sum(coalesce(p.non_cash_amount, 0))) AS non_cash_sales
    FROM doc d
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
    FROM docpayment dp
    INNER JOIN doc d ON d.shopid = dp.shopid AND d.docno = dp.docno
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
