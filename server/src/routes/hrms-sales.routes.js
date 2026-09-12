import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const router = express.Router();

const getLinkSecret = () => String(process.env.SALES_DEVICE_LINK_SECRET || '').trim();
const CLICKHOUSE_SHOP_ID = String(
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy'
).trim();
const CLICKHOUSE_TZ_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);
const escapeClickHouseValue = (value) => String(value || '').replaceAll("'", "''");

function authorizeHrmsRequest(req, res, requiredScope, message) {
  const linkSecret = getLinkSecret();
  if (!linkSecret) {
    res.status(503).json({ success: false, message: 'ระบบเชื่อมข้อมูลยอดขายยังไม่ถูกตั้งค่า' });
    return false;
  }

  const bearerToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  let payload;
  try {
    payload = jwt.verify(bearerToken, linkSecret, {
      issuer: 'hrms',
      audience: 'market-order-sales-device'
    });
  } catch {
    res.status(401).json({ success: false, message });
    return false;
  }

  if (payload?.scope !== requiredScope) {
    res.status(403).json({ success: false, message: 'สิทธิ์อ่านข้อมูลยอดขายพนักงานไม่ถูกต้อง' });
    return false;
  }
  return true;
}

async function getClickHouseBranch(branchName) {
  const [rows] = await pool.execute(
    `SELECT name, clickhouse_branch_id
     FROM branches
     WHERE is_active = true AND name = ?
     LIMIT 1`,
    [branchName]
  );
  return rows[0] || null;
}

router.get('/clickhouse-employees', async (req, res, next) => {
  try {
    if (!authorizeHrmsRequest(req, res, 'sales_employee_directory', 'ไม่มีสิทธิ์อ่านรายชื่อพนักงานขาย')) return;

    const branchName = String(req.query?.branch_name || '').trim();
    if (!branchName) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุสาขา' });
    }

    const branch = await getClickHouseBranch(branchName);
    const clickhouseBranchId = String(branch?.clickhouse_branch_id || '').trim();
    if (!clickhouseBranchId) {
      return res.status(404).json({ success: false, message: `ไม่พบรหัส ClickHouse ของ ${branchName}` });
    }

    const rows = await queryClickHouse(`
      SELECT
        trimBoth(orderemployeecode) AS employee_code,
        argMax(trimBoth(orderemployeedetail), orderdatetime) AS employee_name,
        max(orderdatetime) AS latest_order_at,
        countDistinct(docno) AS bill_count
      FROM dedetemp.ordertemplog
      WHERE shopid = '${escapeClickHouseValue(CLICKHOUSE_SHOP_ID)}'
        AND branch = '${escapeClickHouseValue(clickhouseBranchId)}'
        AND isordersuccess = 1
        AND ispaysuccess = 1
        AND orderqty - cancelqty > 0
        AND trimBoth(orderemployeecode) != ''
        AND trimBoth(orderemployeedetail) != ''
      GROUP BY employee_code
      ORDER BY employee_name, employee_code
    `);

    res.set('Cache-Control', 'private, max-age=60');
    return res.json({
      success: true,
      data: rows.map((row) => ({
        employee_code: String(row.employee_code || '').trim(),
        employee_name: String(row.employee_name || '').trim(),
        latest_order_at: row.latest_order_at || null,
        bill_count: Number(row.bill_count || 0)
      })),
      branch: { name: branchName, clickhouse_branch_id: clickhouseBranchId }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/employee-sales', async (req, res, next) => {
  try {
    if (!authorizeHrmsRequest(req, res, 'sales_employee_sync', 'ไม่มีสิทธิ์อ่านข้อมูลยอดขายพนักงาน')) return;

    const branchName = String(req.body?.branch_name || '').trim();
    const employeeCodes = [...new Set(
      (Array.isArray(req.body?.employee_codes) ? req.body.employee_codes : [])
        .map((code) => String(code || '').trim())
        .filter(Boolean)
    )].slice(0, 100);
    const from = String(req.body?.from || '').trim();
    const to = String(req.body?.to || '').trim();
    if (!branchName || employeeCodes.length === 0 || !from || !to) {
      return res.status(400).json({ success: false, message: 'ข้อมูลสาขา รหัสพนักงาน หรือช่วงเวลาไม่ครบ' });
    }
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      return res.status(400).json({ success: false, message: 'ช่วงเวลาที่ต้องการดึงข้อมูลไม่ถูกต้อง' });
    }

    const branch = await getClickHouseBranch(branchName);
    const clickhouseBranchId = String(branch?.clickhouse_branch_id || '').trim();
    if (!clickhouseBranchId) {
      return res.status(404).json({ success: false, message: `ไม่พบรหัส ClickHouse ของ ${branchName}` });
    }

    const employeeCodeSql = employeeCodes
      .map((code) => `'${escapeClickHouseValue(code)}'`)
      .join(', ');
    const rows = await queryClickHouse(`
      SELECT
        trimBoth(orderemployeecode) AS employee_code,
        argMax(trimBoth(orderemployeedetail), orderdatetime) AS employee_name,
        formatDateTime(toStartOfHour(addHours(orderdatetime, ${CLICKHOUSE_TZ_OFFSET})), '%Y-%m-%d %H:00:00') AS sale_hour,
        trimBoth(barcode) AS barcode,
        argMax(trimBoth(names), orderdatetime) AS product_name,
        trimBoth(unitcode) AS unit_code,
        argMax(trimBoth(unitname), orderdatetime) AS unit_name,
        sum(orderqty - cancelqty) AS net_qty,
        sum((orderqty - cancelqty) * price) AS net_sales_amount,
        countDistinct(docno) AS bill_count,
        count() AS line_count,
        max(addHours(orderdatetime, ${CLICKHOUSE_TZ_OFFSET})) AS latest_order_at
      FROM dedetemp.ordertemplog
      WHERE shopid = '${escapeClickHouseValue(CLICKHOUSE_SHOP_ID)}'
        AND branch = '${escapeClickHouseValue(clickhouseBranchId)}'
        AND trimBoth(orderemployeecode) IN (${employeeCodeSql})
        AND orderdatetime >= parseDateTimeBestEffort('${escapeClickHouseValue(from)}')
        AND orderdatetime < parseDateTimeBestEffort('${escapeClickHouseValue(to)}')
        AND isordersuccess = 1
        AND ispaysuccess = 1
        AND orderqty - cancelqty != 0
      GROUP BY employee_code, sale_hour, barcode, unit_code
      HAVING net_qty != 0
      ORDER BY sale_hour, employee_code, product_name
    `);

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: rows.map((row) => ({
        employee_code: String(row.employee_code || '').trim(),
        employee_name: String(row.employee_name || '').trim(),
        sale_hour: row.sale_hour,
        barcode: String(row.barcode || '').trim(),
        product_name: String(row.product_name || '').trim(),
        unit_code: String(row.unit_code || '').trim(),
        unit_name: String(row.unit_name || '').trim(),
        net_qty: Number(row.net_qty || 0),
        net_sales_amount: Number(row.net_sales_amount || 0),
        bill_count: Number(row.bill_count || 0),
        line_count: Number(row.line_count || 0),
        latest_order_at: row.latest_order_at || null
      })),
      branch: { name: branchName, clickhouse_branch_id: clickhouseBranchId },
      range: { from, to }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
