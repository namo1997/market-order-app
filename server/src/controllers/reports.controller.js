import * as branchModel from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const TH_TIME_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);

const escapeValue = (value) => String(value || '').replace(/'/g, "''");

export const getSalesReport = async (req, res, next) => {
  try {
    const start = req.query.start || new Date().toISOString().split('T')[0];
    const end = req.query.end || start;
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Number(req.query.limit || 200), 1000);

    let clickhouseBranchId = null;
    if (branchId) {
      const branch = await branchModel.getBranchById(branchId);
      if (!branch?.clickhouse_branch_id) {
        return res.status(400).json({
          success: false,
          message: 'Branch is missing ClickHouse branch id'
        });
      }
      clickhouseBranchId = branch.clickhouse_branch_id;
    }

    const branchFilter = clickhouseBranchId
      ? `AND d.branchid = '${escapeValue(clickhouseBranchId)}'`
      : '';
    const searchFilter = search
      ? `AND (
          positionCaseInsensitive(dd.itemname, '${escapeValue(search)}') > 0
          OR positionCaseInsensitive(dd.barcode, '${escapeValue(search)}') > 0
        )`
      : '';
    const dateExpr = `toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`;
    const docDateExpr = `toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`;

    const groupCheckSql = `
      SELECT count() as cnt
      FROM productbarcode
      WHERE shopid = '${SHOP_ID}'
        AND length(groupnames) > 0
    `;

    const [{ cnt: groupCountRaw } = { cnt: '0' }] = await queryClickHouse(groupCheckSql);
    const hasGroups = Number(groupCountRaw || 0) > 0;

    const menuSql = `
      SELECT dd.barcode as barcode,
             any(dd.itemname) as menu_name,
             any(pb.groupnames) as group_name,
             sum(dd.qty) as total_qty,
             sum(dd.sumamount) as total_revenue
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      LEFT JOIN productbarcode pb ON pb.shopid = dd.shopid AND pb.barcode = dd.barcode
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND dd.transflag = 44
        AND d.iscancel = 0
        AND ${dateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
        ${searchFilter}
      GROUP BY dd.barcode
      ORDER BY total_revenue DESC
      LIMIT ${limit}
    `;

    const summarySql = `
      SELECT count() as bill_count,
             sum(total_revenue) as total_revenue
      FROM (
        SELECT d.docno,
               any(d.totalamount) as total_revenue
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY d.docno
      ) x
    `;

    const dailySql = `
      SELECT sale_date,
             count() as bill_count,
             sum(total_revenue) as total_revenue
      FROM (
        SELECT ${docDateExpr} as sale_date,
               d.docno,
               any(d.totalamount) as total_revenue
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY sale_date, d.docno
      ) x
      GROUP BY sale_date
      ORDER BY sale_date
    `;

    const branchSql = `
      SELECT branch_id,
             count() as bill_count,
             sum(total_revenue) as total_revenue
      FROM (
        SELECT d.branchid as branch_id,
               d.docno,
               any(d.totalamount) as total_revenue
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY branch_id, d.docno
      ) x
      GROUP BY branch_id
      ORDER BY total_revenue DESC
    `;

    const groupSql = `
      SELECT pb.groupnames as group_name,
             sum(dd.qty) as total_qty,
             sum(dd.sumamount) as total_revenue
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      LEFT JOIN productbarcode pb ON pb.shopid = dd.shopid AND pb.barcode = dd.barcode
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND dd.transflag = 44
        AND d.iscancel = 0
        AND ${dateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
        ${searchFilter}
        AND length(pb.groupnames) > 0
      GROUP BY pb.groupnames
      ORDER BY total_revenue DESC
    `;

    const hourlySql = `
      SELECT sale_hour,
             count() as bill_count,
             sum(total_revenue) as total_revenue
      FROM (
        SELECT toHour(addHours(d.docdatetime, ${TH_TIME_OFFSET})) as sale_hour,
               d.docno,
               any(d.totalamount) as total_revenue
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY sale_hour, d.docno
      ) x
      GROUP BY sale_hour
      ORDER BY sale_hour
    `;

    const billDistSql = `
      SELECT
        multiIf(total_amount < 100, 'ต่ำกว่า 100',
                total_amount < 200, '100-199',
                total_amount < 300, '200-299',
                total_amount < 500, '300-499',
                total_amount < 1000, '500-999',
                '1000+') as range_label,
        multiIf(total_amount < 100, 1,
                total_amount < 200, 2,
                total_amount < 300, 3,
                total_amount < 500, 4,
                total_amount < 1000, 5,
                6) as range_order,
        count() as bill_count,
        sum(total_amount) as total_revenue
      FROM (
        SELECT d.docno,
               any(d.totalamount) as total_amount
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY d.docno
      ) x
      GROUP BY range_label, range_order
      ORDER BY range_order
    `;

    // คำนวณช่วงเวลาก่อนหน้า (same duration, shifted back)
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    const dayDiff = Math.round((endMs - startMs) / 86400000) + 1;
    const prevEndDate = new Date(startMs - 86400000);
    const prevStartDate = new Date(prevEndDate.getTime() - (dayDiff - 1) * 86400000);
    const prevStart = prevStartDate.toISOString().split('T')[0];
    const prevEnd = prevEndDate.toISOString().split('T')[0];

    const prevSummarySql = `
      SELECT count() as bill_count,
             sum(total_revenue) as total_revenue
      FROM (
        SELECT d.docno,
               any(d.totalamount) as total_revenue
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(prevStart)}') AND toDate('${escapeValue(prevEnd)}')
          ${branchFilter}
        GROUP BY d.docno
      ) x
    `;

    const weekdaySql = `
      SELECT day_num,
             count() as bill_count,
             sum(bill_amount) as total_revenue
      FROM (
        SELECT toDayOfWeek(addHours(d.docdatetime, ${TH_TIME_OFFSET})) as day_num,
               d.docno,
               any(d.totalamount) as bill_amount
        FROM doc d
        JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
        WHERE d.shopid = '${SHOP_ID}'
          AND d.transflag = 44
          AND dd.transflag = 44
          AND d.iscancel = 0
          AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
          ${branchFilter}
        GROUP BY toDayOfWeek(addHours(d.docdatetime, ${TH_TIME_OFFSET})), d.docno
      ) x
      GROUP BY day_num
      ORDER BY day_num
    `;

    // เมนูที่ไม่ได้ขายใน period นี้ แต่เคยขายในช่วงก่อนหน้า (เพื่อ new vs returning)
    const prevTopItemsSql = `
      SELECT dd.barcode as barcode,
             any(dd.itemname) as menu_name,
             sum(dd.sumamount) as total_revenue
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND dd.transflag = 44
        AND d.iscancel = 0
        AND ${dateExpr} BETWEEN toDate('${escapeValue(prevStart)}') AND toDate('${escapeValue(prevEnd)}')
        ${branchFilter}
      GROUP BY dd.barcode
      ORDER BY total_revenue DESC
      LIMIT 20
    `;

    const [menuData, summaryRows, dailyData, branchData, groupData, hourlyData, billDistData, prevSummaryRows, weekdayData, prevTopItemsData] = await Promise.all([
      queryClickHouse(menuSql),
      queryClickHouse(summarySql),
      queryClickHouse(dailySql),
      queryClickHouse(branchSql),
      hasGroups ? queryClickHouse(groupSql) : Promise.resolve([]),
      queryClickHouse(hourlySql),
      queryClickHouse(billDistSql),
      queryClickHouse(prevSummarySql),
      queryClickHouse(weekdaySql),
      queryClickHouse(prevTopItemsSql)
    ]);
    const summary = summaryRows?.[0] || { bill_count: 0, total_revenue: 0 };
    const prevSummary = prevSummaryRows?.[0] || { bill_count: 0, total_revenue: 0 };
    res.json({
      success: true,
      data: {
        start,
        end,
        prev_start: prevStart,
        prev_end: prevEnd,
        branch_id: branchId,
        summary,
        prev_summary: prevSummary,
        group_available: hasGroups,
        items: menuData,
        daily: dailyData,
        by_branch: branchData,
        by_group: groupData,
        by_hour: hourlyData,
        bill_dist: billDistData,
        by_weekday: weekdayData,
        prev_top_items: prevTopItemsData
      }
    });
  } catch (error) {
    next(error);
  }
};
