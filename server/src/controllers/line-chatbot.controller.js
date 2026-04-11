import crypto from 'crypto';
import * as branchModel from '../models/branch.model.js';
import * as adminModel from '../models/admin.model.js';
import * as supplierModel from '../models/supplier.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const LINE_OA_CHANNEL_SECRET = String(
  process.env.LINE_OA_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || ''
).trim();
const LINE_OA_CHANNEL_ACCESS_TOKEN = String(
  process.env.LINE_OA_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
).trim();

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_ENDPOINT =
  process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';

const CLICKHOUSE_SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const TH_TIME_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);

const MAX_LINE_TEXT = 4900;

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const escapeValue = (value) => String(value || '').replace(/'/g, "''");

const getTodayIso = () => {
  const now = new Date();
  const shifted = new Date(now.getTime() + TH_TIME_OFFSET * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

const toIsoDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
};

const truncateLineText = (text) => {
  const value = String(text || '').trim();
  if (value.length <= MAX_LINE_TEXT) return value || '-';
  return `${value.slice(0, MAX_LINE_TEXT - 16)}\n... (ตัดข้อความ)`;
};

const verifyLineSignature = ({ rawBody, signature }) => {
  if (!LINE_OA_CHANNEL_SECRET) return false;
  if (!rawBody || !signature) return false;

  const expected = crypto
    .createHmac('SHA256', LINE_OA_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const incomingBuffer = Buffer.from(String(signature));
  if (expectedBuffer.length !== incomingBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
};

const replyLineText = async ({ replyToken, text }) => {
  const token = String(LINE_OA_CHANNEL_ACCESS_TOKEN || '').trim();
  const safeReplyToken = String(replyToken || '').trim();
  if (!token || !safeReplyToken) return;

  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyToken: safeReplyToken,
      messages: [
        {
          type: 'text',
          text: truncateLineText(text)
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE reply failed: ${response.status} ${body}`);
  }
};

const getBranchMap = async () => {
  const branches = await branchModel.getAllBranches();
  const map = new Map();
  (branches || []).forEach((branch) => {
    const clickhouseId = String(branch?.clickhouse_branch_id || '').trim();
    if (clickhouseId) {
      map.set(clickhouseId, branch?.name || clickhouseId);
    }
  });
  return map;
};

const getSalesSnapshot = async ({ start, end, clickhouseBranchId = null }) => {
  const startIso = toIsoDate(start) || getTodayIso();
  const endIso = toIsoDate(end) || startIso;
  const branchIdText = String(clickhouseBranchId || '').trim();
  const branchFilter = branchIdText
    ? `AND d.branchid = '${escapeValue(branchIdText)}'`
    : '';

  const [dailyRows, branchMap] = await Promise.all([
    queryClickHouse(`
      SELECT
        toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET})) AS sale_date,
        d.branchid AS clickhouse_branch_id,
        count() AS bill_count,
        round(sum(d.totalamount), 2) AS total_revenue
      FROM doc d
      WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        ${branchFilter}
        AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
            BETWEEN toDate('${escapeValue(startIso)}') AND toDate('${escapeValue(endIso)}')
      GROUP BY sale_date, clickhouse_branch_id
      ORDER BY sale_date ASC, clickhouse_branch_id ASC
    `),
    getBranchMap()
  ]);

  const normalizedDaily = (dailyRows || []).map((row) => ({
    sale_date: row.sale_date,
    branch_id: String(row.clickhouse_branch_id || ''),
    branch_name:
      branchMap.get(String(row.clickhouse_branch_id || '')) ||
      String(row.clickhouse_branch_id || ''),
    bill_count: toSafeNumber(row.bill_count),
    total_revenue: toSafeNumber(row.total_revenue)
  }));

  const summary = normalizedDaily.reduce(
    (acc, row) => {
      acc.bill_count += row.bill_count;
      acc.total_revenue += row.total_revenue;
      return acc;
    },
    { bill_count: 0, total_revenue: 0 }
  );

  const byBranchMap = new Map();
  normalizedDaily.forEach((row) => {
    const key = row.branch_id || '-';
    if (!byBranchMap.has(key)) {
      byBranchMap.set(key, {
        branch_id: key,
        branch_name: row.branch_name,
        bill_count: 0,
        total_revenue: 0
      });
    }
    const current = byBranchMap.get(key);
    current.bill_count += row.bill_count;
    current.total_revenue += row.total_revenue;
  });

  const byBranch = Array.from(byBranchMap.values()).sort(
    (a, b) => b.total_revenue - a.total_revenue
  );

  return {
    start: startIso,
    end: endIso,
    summary,
    daily: normalizedDaily,
    by_branch: byBranch
  };
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const formatQty = (value) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });

const buildSalesDailyMessage = (snapshot) => {
  const lines = [
    `ยอดขาย ${snapshot.start} ถึง ${snapshot.end}`,
    `รวมบิล ${snapshot.summary.bill_count.toLocaleString('th-TH')} ใบ`,
    `ยอดรวม ฿${formatMoney(snapshot.summary.total_revenue)}`
  ];

  if (snapshot.by_branch.length > 0) {
    lines.push('');
    lines.push('แยกตามสาขา:');
    snapshot.by_branch.slice(0, 15).forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.branch_name} • ${row.bill_count.toLocaleString('th-TH')} ใบ • ฿${formatMoney(row.total_revenue)}`
      );
    });
  } else {
    lines.push('ไม่พบข้อมูลในช่วงที่เลือก');
  }

  return lines.join('\n');
};

const askOpenAIAboutSales = async ({ question, snapshot }) => {
  if (!OPENAI_API_KEY) {
    return 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY';
  }

  const systemPrompt = `
คุณเป็นผู้ช่วยสรุปยอดขายร้านอาหาร
- ตอบจากข้อมูล JSON ที่ให้เท่านั้น
- ถ้าไม่พบข้อมูล ให้ตอบว่า "ไม่พบข้อมูลในช่วงที่เลือก"
- ตอบภาษาไทย กระชับ ชัดเจน
`.trim();

  const userPrompt = `
คำถาม: ${String(question || '').trim()}
ข้อมูลยอดขาย: ${JSON.stringify(snapshot)}
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
    const body = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  return (
    payload?.choices?.[0]?.message?.content?.trim() ||
    'AI ไม่สามารถตอบได้ในตอนนี้'
  );
};

const parseKeyValueArgs = (tokens) => {
  const args = {};
  tokens.forEach((token) => {
    const index = token.indexOf('=');
    if (index <= 0) return;
    const key = token.slice(0, index).trim();
    const value = token.slice(index + 1).trim();
    if (!key) return;
    args[key] = value;
  });
  return args;
};

const toValidGroupId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const resolveProductGroupId = async (args) => {
  const directId = toValidGroupId(args.group_id || args.product_group_id || args.group);
  if (directId) {
    return { groupId: directId, groupName: null };
  }

  const groupNameKeyword = String(args.group_name || args.group_name_like || '').trim();
  if (!groupNameKeyword) {
    return { groupId: null, groupName: null };
  }

  const groups = await supplierModel.getAllSuppliers();
  const exact = groups.find(
    (group) => String(group?.name || '').trim().toLowerCase() === groupNameKeyword.toLowerCase()
  );
  if (exact) {
    return { groupId: Number(exact.id), groupName: String(exact.name || '') };
  }

  const matches = groups.filter((group) =>
    String(group?.name || '').toLowerCase().includes(groupNameKeyword.toLowerCase())
  );
  if (matches.length === 1) {
    return {
      groupId: Number(matches[0].id),
      groupName: String(matches[0].name || '')
    };
  }
  if (matches.length > 1) {
    const top = matches.slice(0, 5);
    const tips = top.map((group) => `${group.id}) ${group.name}`).join('\n');
    throw new Error(
      `พบหลายกลุ่มสินค้า กรุณาระบุ group_id ให้ชัดเจน\n${tips}`
    );
  }

  throw new Error(`ไม่พบกลุ่มสินค้าชื่อ "${groupNameKeyword}"`);
};

const getPurchaseWalkSnapshot = async ({ date, productGroupId = null }) => {
  const day = toIsoDate(date) || getTodayIso();

  const [summaryRows, reconcileRows] = await Promise.all([
    adminModel.getPurchaseReceivingSummaryReport({
      startDate: day,
      endDate: day,
      viewMode: 'branch',
      productGroupId
    }),
    adminModel.getPurchaseReceiveReconcileReport({
      startDate: day,
      endDate: day,
      productGroupId
    })
  ]);

  const totals = (summaryRows || []).reduce(
    (acc, row) => {
      acc.ordered += Number(row.ordered_quantity || 0);
      acc.purchased += Number(row.purchased_quantity || 0);
      acc.received += Number(row.received_quantity || 0);
      acc.pending += Number(row.pending_quantity || 0);
      acc.purchasedAmount += Number(row.purchased_amount || 0);
      acc.receivedAmount += Number(row.received_amount || 0);
      acc.incomplete += Number(row.incomplete_line_count || 0);
      return acc;
    },
    {
      ordered: 0,
      purchased: 0,
      received: 0,
      pending: 0,
      purchasedAmount: 0,
      receivedAmount: 0,
      incomplete: 0
    }
  );

  const topGroups = [...(summaryRows || [])]
    .sort((a, b) => Number(b.purchased_amount || 0) - Number(a.purchased_amount || 0))
    .slice(0, 8);

  const pendingItems = [...(reconcileRows || [])]
    .filter((row) => Number(row.pending_quantity || 0) > 0)
    .sort((a, b) => Number(b.pending_quantity || 0) - Number(a.pending_quantity || 0));

  return {
    date: day,
    totals,
    topGroups,
    pendingItems
  };
};

const buildPurchaseWalkSummaryMessage = ({ snapshot, groupLabel }) => {
  const { totals, topGroups, pendingItems, date } = snapshot;
  const lines = [
    `สรุปเดินซื้อ ${date}${groupLabel ? ` • ${groupLabel}` : ''}`,
    `สั่ง ${formatQty(totals.ordered)} | ซื้อ ${formatQty(totals.purchased)} | รับ ${formatQty(totals.received)} | ค้าง ${formatQty(totals.pending)}`,
    `มูลค่าซื้อ ฿${formatMoney(totals.purchasedAmount)} | มูลค่ารับ ฿${formatMoney(totals.receivedAmount)}`
  ];

  if (totals.incomplete > 0) {
    lines.push(`เตือน: ยังไม่ใส่เดินซื้อ/ราคา ${totals.incomplete.toLocaleString('th-TH')} รายการ`);
  }

  if (topGroups.length > 0) {
    lines.push('');
    lines.push('กลุ่มที่มูลค่าซื้อสูงสุด:');
    topGroups.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.product_group_name} • ${row.branch_name} • ซื้อ ฿${formatMoney(row.purchased_amount)} • ค้าง ${formatQty(row.pending_quantity)}`
      );
    });
  }

  if (pendingItems.length > 0) {
    lines.push('');
    lines.push('สินค้าค้างรับ (Top 10):');
    pendingItems.slice(0, 10).forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.product_name} ${formatQty(row.pending_quantity)} ${row.unit_abbr || ''}`
      );
    });
  }

  if (topGroups.length === 0) {
    lines.push('ไม่พบข้อมูลเดินซื้อในวันที่เลือก');
  }

  return lines.join('\n');
};

const buildPurchaseWalkPendingMessage = ({ snapshot, groupLabel }) => {
  const { date, pendingItems } = snapshot;
  const lines = [`รายการค้างรับ ${date}${groupLabel ? ` • ${groupLabel}` : ''}`];

  if (pendingItems.length === 0) {
    lines.push('ไม่พบสินค้าค้างรับ');
    return lines.join('\n');
  }

  pendingItems.slice(0, 30).forEach((row, index) => {
    lines.push(
      `${index + 1}) ${row.product_group_name} • ${row.product_name} • ค้าง ${formatQty(row.pending_quantity)} ${row.unit_abbr || ''}`
    );
  });

  return lines.join('\n');
};

const getHelpText = () => `
คำสั่งที่ใช้ได้:
1) ยอดขายวันนี้
2) /sales_daily start=YYYY-MM-DD end=YYYY-MM-DD branch_id=...
3) /ask_sales คำถาม start=YYYY-MM-DD end=YYYY-MM-DD branch_id=...
4) เดินซื้อวันนี้
5) /purchase_walk date=YYYY-MM-DD group_id=7
6) /purchase_walk_pending date=YYYY-MM-DD group_id=7
`.trim();

const executeTextCommand = async (text) => {
  const input = String(text || '').trim();
  if (!input) return getHelpText();

  if (input === 'ยอดขายวันนี้') {
    const snapshot = await getSalesSnapshot({});
    return buildSalesDailyMessage(snapshot);
  }

  if (input.startsWith('/sales_daily')) {
    const tokens = input
      .replace('/sales_daily', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const args = parseKeyValueArgs(tokens);
    const snapshot = await getSalesSnapshot({
      start: args.start,
      end: args.end,
      clickhouseBranchId: args.branch_id
    });
    return buildSalesDailyMessage(snapshot);
  }

  if (input.startsWith('/ask_sales')) {
    const tokens = input
      .replace('/ask_sales', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const kvTokens = tokens.filter((token) => token.includes('='));
    const questionTokens = tokens.filter((token) => !token.includes('='));
    const args = parseKeyValueArgs(kvTokens);
    const question = questionTokens.join(' ').trim();
    if (!question) {
      return 'กรุณาระบุคำถาม เช่น /ask_sales เมนูไหนขายดีสุดวันนี้';
    }

    const snapshot = await getSalesSnapshot({
      start: args.start,
      end: args.end,
      clickhouseBranchId: args.branch_id
    });
    const answer = await askOpenAIAboutSales({ question, snapshot });
    return `คำถาม: ${question}\n\n${answer}`;
  }

  if (input === 'เดินซื้อวันนี้') {
    const snapshot = await getPurchaseWalkSnapshot({});
    return buildPurchaseWalkSummaryMessage({ snapshot, groupLabel: null });
  }

  if (input === 'ค้างรับวันนี้') {
    const snapshot = await getPurchaseWalkSnapshot({});
    return buildPurchaseWalkPendingMessage({ snapshot, groupLabel: null });
  }

  if (input.startsWith('/purchase_walk_pending')) {
    const tokens = input
      .replace('/purchase_walk_pending', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const args = parseKeyValueArgs(tokens);
    const { groupId, groupName } = await resolveProductGroupId(args);
    const snapshot = await getPurchaseWalkSnapshot({
      date: args.date,
      productGroupId: groupId
    });
    return buildPurchaseWalkPendingMessage({
      snapshot,
      groupLabel: groupName || (groupId ? `กลุ่ม ${groupId}` : null)
    });
  }

  if (input.startsWith('/purchase_walk')) {
    const tokens = input
      .replace('/purchase_walk', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const args = parseKeyValueArgs(tokens);
    const { groupId, groupName } = await resolveProductGroupId(args);
    const snapshot = await getPurchaseWalkSnapshot({
      date: args.date,
      productGroupId: groupId
    });
    return buildPurchaseWalkSummaryMessage({
      snapshot,
      groupLabel: groupName || (groupId ? `กลุ่ม ${groupId}` : null)
    });
  }

  return getHelpText();
};

const processEvents = async (events) => {
  const safeEvents = Array.isArray(events) ? events : [];
  for (const event of safeEvents) {
    if (event?.type !== 'message') continue;
    if (event?.message?.type !== 'text') continue;
    const replyToken = String(event?.replyToken || '').trim();
    if (!replyToken) continue;

    try {
      const replyText = await executeTextCommand(event.message.text);
      await replyLineText({ replyToken, text: replyText });
    } catch (error) {
      await replyLineText({
        replyToken,
        text: `เกิดข้อผิดพลาด: ${error?.message || 'unknown error'}`
      }).catch(() => {});
    }
  }
};

export const handleWebhook = async (req, res, next) => {
  try {
    const rawBodyBuffer = req.body;
    const rawBody = Buffer.isBuffer(rawBodyBuffer)
      ? rawBodyBuffer.toString('utf8')
      : '';
    const signature = req.headers['x-line-signature'];

    const validSignature = verifyLineSignature({ rawBody, signature });
    if (!validSignature) {
      return res.status(401).json({
        success: false,
        message: 'Invalid LINE signature'
      });
    }

    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid LINE payload'
      });
    }

    res.status(200).json({ success: true });

    setImmediate(() => {
      processEvents(payload?.events || []).catch((error) => {
        console.error('[LINE CHATBOT] process events failed:', error?.message || error);
      });
    });
  } catch (error) {
    next(error);
  }
};
