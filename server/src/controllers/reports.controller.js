import * as branchModel from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';
import { createSalesQueryRunner, parseSalesReportFilters } from '../utils/sales-report-work.js';

const querySales = createSalesQueryRunner(queryClickHouse);

const SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';

// ClickHouse DateTime เก็บเป็นเวลาจริง (instant) ส่วนนาฬิกาที่แสดงขึ้นกับ timezone ของ server
// server POS ตั้งเป็น Asia/Bangkok อยู่แล้ว การ addHours(+7) จึงทำให้บิลหลัง 17:00 ไปตกวันถัดไป
// ต้องแปลงเป็นเวลาไทยตรง ๆ ด้วย toTimeZone เหมือน general-cashflow (ตรงกับแอป POS ทุกวัน)
const POS_TIME_ZONE = 'Asia/Bangkok';
const localTime = `toTimeZone(d.docdatetime, '${POS_TIME_ZONE}')`;
const saleDateExpr = `toDate(${localTime})`;
const saleHourExpr = `toHour(${localTime})`;
const saleWeekdayExpr = `toDayOfWeek(${localTime})`;
// บางบิลมีแค่ guidbranch หรือ branchid อย่างใดอย่างหนึ่ง ใช้ลำดับเดียวกับ cashflow
const branchExpr = "coalesce(nullIf(d.guidbranch, ''), nullIf(d.branchid, ''), '')";
const UNGROUPED_LABEL = 'ยังไม่จัดกลุ่ม';
const MENU_LIMIT = 2000;

const escapeValue = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "''");

const shiftDateByYears = (dateStr, years) => {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
};

// docdetail เป็น MergeTree: การ ingest ซ้ำทำให้บรรทัดขายเดิมซ้ำได้จริง (ส.ค. 2569 พบ 82 แถว)
// DISTINCT ตามบรรทัดบิลและค่าขายทุกตัว จึงไม่รวมสองบรรทัดที่สั่งเมนูเดียวกันเข้าด้วยกัน
export const salesDetailSource = (shopId) => `(SELECT DISTINCT
    shopid, docno, line_number, transflag, barcode, itemname, unitcode,
    qty, price, sumamount, discount, discountamount, ischoice, sumamountchoice
  FROM docdetail
  WHERE shopid = '${escapeValue(shopId)}'
    AND transflag = 44)`;

const productGroupSource = (shopId) => `(SELECT shopid, barcode, groupnames
  FROM productbarcode FINAL
  WHERE shopid = '${escapeValue(shopId)}')`;

export const buildSalesReportSql = ({
  shopId, start, end, prevStart, prevEnd, lastYearStart, lastYearEnd, clickhouseBranchId, search, limit
}) => {
  const shop = escapeValue(shopId);
  const branchFilter = clickhouseBranchId
    ? `AND ${branchExpr} = '${escapeValue(clickhouseBranchId)}'`
    : '';
  const searchFilter = search
    ? `AND (
          positionCaseInsensitive(dd.itemname, '${escapeValue(search)}') > 0
          OR positionCaseInsensitive(dd.barcode, '${escapeValue(search)}') > 0
        )`
    : '';
  const between = (from, to) => `${saleDateExpr} BETWEEN toDate('${escapeValue(from)}') AND toDate('${escapeValue(to)}')`;
  // ยอดระดับบิลใช้หัวบิลเท่านั้น (เหมือนแอป POS) ไม่ต้อง join รายการ จึงไม่ตกบิลที่ไม่มีรายการ
  const billWhere = (from, to) => `
        WHERE d.shopid = '${shop}'
          AND d.transflag = 44
          AND d.iscancel = 0
          AND ${between(from, to)}
          ${branchFilter}`;
  const menuFrom = `
      FROM doc AS d FINAL
      JOIN ${salesDetailSource(shopId)} dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      LEFT JOIN ${productGroupSource(shopId)} pb ON pb.shopid = dd.shopid AND pb.barcode = dd.barcode`;
  const menuWhere = (from, to) => `
      WHERE d.shopid = '${shop}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND ${between(from, to)}
        ${branchFilter}
        ${searchFilter}`;
  const groupNameExpr = `coalesce(nullIf(pb.groupnames, ''), '${UNGROUPED_LABEL}')`;
  const menuSql = (from, to, rowLimit) => `
      SELECT dd.barcode as barcode,
             any(dd.itemname) as menu_name,
             coalesce(nullIf(any(pb.groupnames), ''), '${UNGROUPED_LABEL}') as group_name,
             sum(dd.qty) as total_qty,
             sum(dd.sumamount) as total_revenue
      ${menuFrom}
      ${menuWhere(from, to)}
      GROUP BY dd.barcode
      ORDER BY total_revenue DESC, barcode ASC
      LIMIT ${rowLimit}`;
  const billTotals = (from, to) => `
      SELECT count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc AS d FINAL
      ${billWhere(from, to)}`;

  return {
    groupCheck: `
      SELECT count() as cnt
      FROM productbarcode
      WHERE shopid = '${shop}'
        AND length(groupnames) > 0`,
    pareto: menuSql(start, end, MENU_LIMIT),
    summary: `
      SELECT
        (SELECT count() FROM doc AS d FINAL ${billWhere(start, end)}) as bill_count,
        (SELECT sum(d.totalamount) FROM doc AS d FINAL ${billWhere(start, end)}) as total_revenue,
        (SELECT uniqExact(dd.barcode) ${menuFrom} ${menuWhere(start, end)}) as menu_count`,
    daily: `
      SELECT ${saleDateExpr} as sale_date,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc AS d FINAL
      ${billWhere(start, end)}
      GROUP BY sale_date
      ORDER BY sale_date`,
    branch: `
      SELECT ${branchExpr} as branch_id,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc AS d FINAL
      ${billWhere(start, end)}
      GROUP BY branch_id
      ORDER BY total_revenue DESC`,
    group: `
      SELECT ${groupNameExpr} as group_name,
             sum(dd.qty) as total_qty,
             sum(dd.sumamount) as total_revenue
      ${menuFrom}
      ${menuWhere(start, end)}
      GROUP BY group_name
      ORDER BY total_revenue DESC`,
    hourly: `
      SELECT ${saleHourExpr} as sale_hour,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc AS d FINAL
      ${billWhere(start, end)}
      GROUP BY sale_hour
      ORDER BY sale_hour`,
    billDist: `
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
        SELECT d.totalamount as total_amount
        FROM doc AS d FINAL
        ${billWhere(start, end)}
      ) x
      GROUP BY range_label, range_order
      ORDER BY range_order`,
    prevSummary: billTotals(prevStart, prevEnd),
    lastYearSummary: billTotals(lastYearStart, lastYearEnd),
    weekday: `
      SELECT ${saleWeekdayExpr} as day_num,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc AS d FINAL
      ${billWhere(start, end)}
      GROUP BY day_num
      ORDER BY day_num`,
    // ใช้ทั้งชุด (ไม่ตัดที่ limit หน้าจอ) เพื่อไม่ให้เมนูอันดับเกิน limit ถูกนับเป็นเมนูใหม่/หายไป
    prevItems: menuSql(prevStart, prevEnd, Math.max(limit, MENU_LIMIT))
  };
};

export const getSalesReport = async (req, res, next) => {
  try {
    const { start, end, startMs, endMs, branchId, search, limit } = parseSalesReportFilters(req.query);

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

    // คำนวณช่วงเวลาก่อนหน้า (same duration, shifted back)
    const dayDiff = Math.round((endMs - startMs) / 86400000) + 1;
    const prevEndDate = new Date(startMs - 86400000);
    const prevStartDate = new Date(prevEndDate.getTime() - (dayDiff - 1) * 86400000);
    const prevStart = prevStartDate.toISOString().split('T')[0];
    const prevEnd = prevEndDate.toISOString().split('T')[0];
    const lastYearStart = shiftDateByYears(start, -1);
    const lastYearEnd = shiftDateByYears(end, -1);

    const sql = buildSalesReportSql({
      shopId: SHOP_ID, start, end, prevStart, prevEnd, lastYearStart, lastYearEnd, clickhouseBranchId, search, limit
    });

    const [{ cnt: groupCountRaw } = { cnt: '0' }] = await querySales(sql.groupCheck, { groupMetadata: true });
    const hasGroups = Number(groupCountRaw || 0) > 0;

    const [paretoData, summaryRows, dailyData, branchData, groupData, hourlyData, billDistData, prevSummaryRows, lastYearSummaryRows, weekdayData, prevItemsData] = await Promise.all([
      querySales(sql.pareto),
      querySales(sql.summary),
      querySales(sql.daily),
      querySales(sql.branch),
      hasGroups ? querySales(sql.group) : Promise.resolve([]),
      querySales(sql.hourly),
      querySales(sql.billDist),
      querySales(sql.prevSummary),
      querySales(sql.lastYearSummary),
      querySales(sql.weekday),
      querySales(sql.prevItems)
    ]);
    const summary = summaryRows?.[0] || { bill_count: 0, total_revenue: 0, menu_count: 0 };
    const prevSummary = prevSummaryRows?.[0] || { bill_count: 0, total_revenue: 0 };
    const lastYearSummary = lastYearSummaryRows?.[0] || { bill_count: 0, total_revenue: 0 };
    res.json({
      success: true,
      data: {
        start,
        end,
        prev_start: prevStart,
        prev_end: prevEnd,
        last_year_start: lastYearStart,
        last_year_end: lastYearEnd,
        branch_id: branchId,
        time_zone: POS_TIME_ZONE,
        summary,
        prev_summary: prevSummary,
        last_year_summary: lastYearSummary,
        group_available: hasGroups,
        items: paretoData.slice(0, limit),
        pareto_items: paretoData,
        daily: dailyData,
        by_branch: branchData,
        by_group: groupData,
        by_hour: hourlyData,
        bill_dist: billDistData,
        by_weekday: weekdayData,
        prev_items: prevItemsData,
        prev_top_items: prevItemsData.slice(0, 20)
      }
    });
  } catch (error) {
    next(error);
  }
};
