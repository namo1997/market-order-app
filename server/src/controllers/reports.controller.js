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
             sum(d.totalamount) as total_revenue
      FROM doc d
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
    `;

    const dailySql = `
      SELECT ${docDateExpr} as sale_date,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc d
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
      GROUP BY sale_date
      ORDER BY sale_date
    `;

    const branchSql = `
      SELECT d.branchid as branch_id,
             count() as bill_count,
             sum(d.totalamount) as total_revenue
      FROM doc d
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND ${docDateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
      GROUP BY branchid
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
        AND d.iscancel = 0
        AND ${dateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
        ${searchFilter}
        AND length(pb.groupnames) > 0
      GROUP BY pb.groupnames
      ORDER BY total_revenue DESC
    `;

    const [menuData, summaryRows, dailyData, branchData, groupData] = await Promise.all([
      queryClickHouse(menuSql),
      queryClickHouse(summarySql),
      queryClickHouse(dailySql),
      queryClickHouse(branchSql),
      hasGroups ? queryClickHouse(groupSql) : Promise.resolve([])
    ]);
    const summary = summaryRows?.[0] || { bill_count: 0, total_revenue: 0 };
    res.json({
      success: true,
      data: {
        start,
        end,
        branch_id: branchId,
        summary,
        group_available: hasGroups,
        items: menuData,
        daily: dailyData,
        by_branch: branchData,
        by_group: groupData
      }
    });
  } catch (error) {
    next(error);
  }
};
