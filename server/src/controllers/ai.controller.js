import * as branchModel from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_ENDPOINT =
  process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const CLICKHOUSE_SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const TH_TIME_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);
const AI_BRANCH_SALES_TOKEN = String(process.env.AI_BRANCH_SALES_TOKEN || '').trim();

const buildSalesReportContext = (report) => {
  const items = Array.isArray(report?.items) ? report.items : [];
  const byBranch = Array.isArray(report?.by_branch) ? report.by_branch : [];
  const byGroup = Array.isArray(report?.by_group) ? report.by_group : [];
  const daily = Array.isArray(report?.daily) ? report.daily : [];

  const normalizedItems = items.map((item) => ({
    menu_name: item.menu_name || '',
    barcode: item.barcode || '',
    total_qty: Number(item.total_qty || 0),
    total_revenue: Number(item.total_revenue || 0),
    group_name: item.group_name || ''
  }));

  return {
    start: report?.start || '',
    end: report?.end || '',
    branch_id: report?.branch_id ?? null,
    summary: report?.summary || {},
    daily,
    by_branch: byBranch,
    by_group: byGroup,
    items: normalizedItems
  };
};

export const chatSalesReport = async (req, res, next) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(400).json({
        success: false,
        message: 'Missing OpenAI API key'
      });
    }

    const question = String(req.body?.question || '').trim();
    const report = req.body?.report || null;

    if (!question) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    if (!report) {
      return res.status(400).json({
        success: false,
        message: 'Report data is required'
      });
    }

    const reportContext = buildSalesReportContext(report);
    let branchNames = {};
    try {
      const branches = await branchModel.getAllBranches();
      branchNames = (branches || []).reduce((acc, branch) => {
        if (branch.clickhouse_branch_id) {
          acc[branch.clickhouse_branch_id] = branch.name;
        }
        return acc;
      }, {});
    } catch (error) {
      branchNames = {};
    }

    reportContext.branch_names = branchNames;
    const systemPrompt = `
คุณเป็นผู้ช่วยวิเคราะห์รายงานยอดขาย
- ใช้ข้อมูลใน JSON ที่ได้รับเท่านั้น ห้ามเดาเพิ่ม
- ถ้าไม่มีข้อมูลที่ตอบได้ ให้บอกว่า "ไม่พบข้อมูลในรายงาน"
- ห้ามแสดงรหัสสาขา ให้ใช้ชื่อสาขาจาก branch_names เท่านั้น
- ตอบเป็นภาษาไทย กระชับ เข้าใจง่าย
`.trim();

    const userPrompt = `
คำถาม: ${question}
ข้อมูลรายงาน (JSON): ${JSON.stringify(reportContext)}
`.trim();

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    let answer = payload?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(500).json({
        success: false,
        message: 'AI response is empty'
      });
    }

    Object.entries(branchNames).forEach(([id, name]) => {
      if (!id || !name) return;
      answer = answer.split(id).join(name);
    });

    res.json({
      success: true,
      data: {
        answer
      }
    });
  } catch (error) {
    next(error);
  }
};

const escapeValue = (value) => String(value || '').replace(/'/g, "''");

const toIsoDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
};

const getTodayIso = () => {
  const now = new Date();
  const shifted = new Date(now.getTime() + TH_TIME_OFFSET * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

export const getBranchDailySales = async (req, res, next) => {
  try {
    if (!AI_BRANCH_SALES_TOKEN) {
      return res.status(503).json({
        success: false,
        message: 'AI_BRANCH_SALES_TOKEN is not configured'
      });
    }

    const token = String(req.query?.token || req.headers['x-api-key'] || '').trim();
    if (!token || token !== AI_BRANCH_SALES_TOKEN) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    const todayIso = getTodayIso();
    const start = toIsoDate(req.query?.start) || todayIso;
    const end = toIsoDate(req.query?.end) || todayIso;

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'start must be <= end'
      });
    }

    const rows = await queryClickHouse(`
      SELECT
        toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET})) AS sale_date,
        d.branchid AS clickhouse_branch_id,
        count() AS bill_count,
        round(sum(d.totalamount), 2) AS total_revenue
      FROM doc d
      WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
            BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
      GROUP BY sale_date, clickhouse_branch_id
      ORDER BY sale_date ASC, clickhouse_branch_id ASC
    `);

    const branches = await branchModel.getAllBranches();
    const branchMap = new Map(
      (branches || [])
        .filter((branch) => String(branch.clickhouse_branch_id || '').trim())
        .map((branch) => [String(branch.clickhouse_branch_id), branch.name])
    );

    const normalizedRows = rows.map((row) => ({
      sale_date: row.sale_date,
      branch_id: row.clickhouse_branch_id,
      branch_name: branchMap.get(String(row.clickhouse_branch_id)) || String(row.clickhouse_branch_id || ''),
      bill_count: Number(row.bill_count || 0),
      total_revenue: Number(row.total_revenue || 0)
    }));

    res.json({
      success: true,
      data: {
        start,
        end,
        generated_at: new Date().toISOString(),
        rows: normalizedRows
      }
    });
  } catch (error) {
    next(error);
  }
};
