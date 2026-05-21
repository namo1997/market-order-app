import crypto from 'crypto';
import * as branchModel from '../models/branch.model.js';
import * as adminModel from '../models/admin.model.js';
import * as supplierModel from '../models/supplier.model.js';
import { logChatbotQuery } from '../models/chatbot-query-log.model.js';
import { getChatbotMemory, upsertChatbotMemory } from '../models/chatbot-memory.model.js';
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
const TH_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.'
];

const MAX_LINE_TEXT = 4900;
const MAX_SALES_RANGE_DAYS = 31;
const CHAT_MEMORY_TTL_MS = 30 * 60 * 1000;
const RECONCILE_PICK_TTL_MS = 15 * 60 * 1000;
const pendingReconcileSelections = new Map();
const chatMemories = new Map();

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

const getWeekStartIso = (baseIso = getTodayIso()) => {
  const base = new Date(`${baseIso}T00:00:00Z`);
  const day = base.getUTCDay(); // 0=Sun
  const offsetToMonday = day === 0 ? 6 : day - 1;
  base.setUTCDate(base.getUTCDate() - offsetToMonday);
  return base.toISOString().slice(0, 10);
};

const getMonthStartIso = (baseIso = getTodayIso()) => {
  const [y, m] = baseIso.split('-');
  return `${y}-${m}-01`;
};

const toIsoDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
};

const extractIsoDateFromText = (value) => {
  const text = String(value || '');
  const matched = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return matched ? toIsoDate(matched[1]) : null;
};

const shiftIsoDate = (baseIso, days) => {
  const base = new Date(`${baseIso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
};

const diffDaysInclusive = (startIso, endIso) => {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diff + 1;
};

const parseDateFromToken = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;

  const iso = toIsoDate(text);
  if (iso) return iso;

  const ddmmyyyy = text.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    let year = ddmmyyyy[3] ? Number(ddmmyyyy[3]) : NaN;

    if (!Number.isFinite(year)) {
      const nowIso = getTodayIso();
      year = Number(nowIso.slice(0, 4));
    }
    if (year >= 2400) year -= 543; // พ.ศ. -> ค.ศ.
    if (year < 100) year += 2000;

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
      const y = String(year).padStart(4, '0');
      const m = String(month).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      return toIsoDate(`${y}-${m}-${d}`);
    }
  }

  const thisMonth = text.match(/^วันที่?\s*(\d{1,2})$/);
  if (thisMonth) {
    const day = Number(thisMonth[1]);
    if (day >= 1 && day <= 31) {
      const nowIso = getTodayIso();
      const year = nowIso.slice(0, 4);
      const month = nowIso.slice(5, 7);
      return toIsoDate(`${year}-${month}-${String(day).padStart(2, '0')}`);
    }
  }

  return null;
};

const parseHumanDateFromText = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const todayIso = getTodayIso();

  if (text.includes('วันนี้')) return todayIso;
  if (text.includes('เมื่อวาน')) return shiftIsoDate(todayIso, -1);
  if (text.includes('สองวันที่แล้ว') || text.includes('2วันที่แล้ว') || text.includes('2 วันที่แล้ว')) {
    return shiftIsoDate(todayIso, -2);
  }

  const daysAgo = text.match(/(\d+)\s*วันที่แล้ว/);
  if (daysAgo) {
    const offset = Number(daysAgo[1]);
    if (Number.isFinite(offset) && offset > 0 && offset <= 60) {
      return shiftIsoDate(todayIso, -offset);
    }
  }

  const fromIsoText = extractIsoDateFromText(text);
  if (fromIsoText) return fromIsoText;

  const fromDateLabel = text.match(/วันที่?\s*\d{1,2}(?:[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)?/);
  if (fromDateLabel) {
    return parseDateFromToken(fromDateLabel[0]);
  }

  return parseDateFromToken(text);
};

const formatHumanDateLabel = (isoDate) => {
  const iso = toIsoDate(isoDate);
  if (!iso) return String(isoDate || '-');

  const todayIso = getTodayIso();
  const target = new Date(`${iso}T00:00:00Z`);
  const today = new Date(`${todayIso}T00:00:00Z`);
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays === 2) return 'สองวันที่แล้ว';

  const [y, m, d] = iso.split('-').map((v) => Number(v));
  const [ty, tm] = todayIso.split('-').map((v) => Number(v));

  if (y === ty && m === tm) {
    return `วันที่ ${d} (เดือนนี้)`;
  }

  const monthLabel = TH_MONTHS_SHORT[m - 1] || `${m}`;
  const thaiYear = y + 543;
  return `${d} ${monthLabel} ${thaiYear}`;
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

const normalizeThaiSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[()\[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const resolveBranchFromText = async (text) => {
  const input = normalizeThaiSearchText(text);
  if (!input) return null;

  const branches = await branchModel.getAllBranches();
  const activeBranches = Array.isArray(branches) ? branches : [];
  const aliases = [
    { keywords: ['คันคลอง', 'คัน คลอง'], fallbackName: 'สาขาคันคลอง' },
    { keywords: ['สันกำแพง', 'สัน กำแพง'], fallbackName: 'สาขาสันกำแพง' }
  ];

  for (const branch of activeBranches) {
    const clickhouseId = String(branch?.clickhouse_branch_id || '').trim();
    if (!clickhouseId) continue;

    const branchName = normalizeThaiSearchText(branch?.name || '');
    if (branchName && input.includes(branchName)) {
      return {
        clickhouseBranchId: clickhouseId,
        branchName: branch?.name || clickhouseId
      };
    }
  }

  for (const alias of aliases) {
    if (!alias.keywords.some((keyword) => input.includes(keyword))) continue;
    const matched = activeBranches.find(
      (branch) => normalizeThaiSearchText(branch?.name || '').includes(normalizeThaiSearchText(alias.fallbackName))
    );
    if (matched?.clickhouse_branch_id) {
      return {
        clickhouseBranchId: String(matched.clickhouse_branch_id),
        branchName: matched.name
      };
    }
  }

  return null;
};

const getSalesSnapshot = async ({ start, end, clickhouseBranchId = null }) => {
  const startIso = toIsoDate(start) || getTodayIso();
  const endIso = toIsoDate(end) || startIso;
  if (startIso > endIso) {
    throw new Error('start ต้องไม่มากกว่า end');
  }
  const rangeDays = diffDaysInclusive(startIso, endIso);
  if (rangeDays > MAX_SALES_RANGE_DAYS) {
    throw new Error(`ช่วงวันที่ยาวเกินไป (สูงสุด ${MAX_SALES_RANGE_DAYS} วัน)`);
  }
  const branchIdText = String(clickhouseBranchId || '').trim();
  const branchFilter = branchIdText
    ? `AND d.branchid = '${escapeValue(branchIdText)}'`
    : '';

  const [dailyRows, topProductRows, branchMap] = await Promise.all([
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
    queryClickHouse(`
      SELECT
        dd.itemname AS product_name,
        round(sum(dd.qty), 3) AS qty,
        round(sum(dd.sumamount), 2) AS amount
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND d.isdelete = 0
        AND dd.transflag = 44
        ${branchFilter}
        AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
            BETWEEN toDate('${escapeValue(startIso)}') AND toDate('${escapeValue(endIso)}')
      GROUP BY dd.itemname
      ORDER BY amount DESC
      LIMIT 10
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
  const topProducts = (topProductRows || []).map((row) => ({
    product_name: String(row.product_name || '').trim() || '-',
    qty: toSafeNumber(row.qty),
    amount: toSafeNumber(row.amount)
  }));

  return {
    start: startIso,
    end: endIso,
    range_days: rangeDays,
    summary,
    aov: summary.bill_count > 0 ? summary.total_revenue / summary.bill_count : 0,
    daily: normalizedDaily,
    by_branch: byBranch,
    top_products: topProducts
  };
};

const extractProductKeywordFromSalesQuestion = (text) => {
  const input = String(text || '').trim();
  if (!input) return '';

  const beforeSale = input.match(/^(.+?)ขาย(?:ได้|ไป|กี่|เท่าไหร่|เท่าไร|วันนี้|เมื่อวาน|สัปดาห์นี้|เดือนนี้|$)/);
  const afterSale = input.match(/(?:ยอดขาย|ขาย)\s*(.+?)(?:ไปกี่|กี่|ได้เท่าไร|เท่าไร|เท่าไหร่|ได้กี่|สาขา|วันนี้|เมื่อวาน|สองวันที่แล้ว|เดือนนี้|$)/);
  const rawKeyword = beforeSale?.[1] || afterSale?.[1] || input;
  const cleaned = rawKeyword
    .replace(/ยอดขาย|ขาย|วันนี้|เมื่อวาน|สองวันที่แล้ว|เดือนนี้|สัปดาห์นี้/g, ' ')
    .replace(/สาขาคันคลอง|คันคลอง|สาขาสันกำแพง|สันกำแพง/g, ' ')
    .replace(/อะไร|เมนูไหน|สินค้าไหน|ช่วงเวลาไหน|สาขาไหน|ดีที่สุด|ขายดีสุด|ขายดี|อันดับ/g, ' ')
    .replace(/กี่ตัว|กี่ชิ้น|กี่รายการ|กี่จาน|เท่าไร|เท่าไหร่|ได้เท่าไร|ได้เท่าไหร่|ไป/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
};

const buildProductSearchCondition = (keyword) => {
  let words = normalizeThaiSearchText(keyword)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  // Thai product names often have no spaces and users may type words in a different order.
  // Example: "ไก่ย่างบ้าน" should match "ไก่บ้านย่าง".
  if (words.length <= 1) {
    const compact = words[0] || normalizeThaiSearchText(keyword);
    const knownTerms = [
      'ไก่',
      'บ้าน',
      'ย่าง',
      'ครึ่ง',
      'ทั้ง',
      'ข้าว',
      'เหนียว',
      'มะยง',
      'ขิด',
      'ขนม',
      'ถ้วย'
    ].filter((term) => compact.includes(term));
    if (knownTerms.length >= 2) {
      words = knownTerms;
    }
  }

  if (words.length === 0) return null;

  const andTerms = words
    .map((word) => `positionCaseInsensitive(dd.itemname, '${escapeValue(word)}') > 0`)
    .join(' AND ');
  const wholeTerm = `positionCaseInsensitive(dd.itemname, '${escapeValue(keyword)}') > 0`;
  return `(${wholeTerm} OR (${andTerms}))`;
};

const getProductSalesSnapshot = async ({ question }) => {
  const date = parseHumanDateFromText(question) || getTodayIso();
  const branch = await resolveBranchFromText(question);
  const productKeyword = extractProductKeywordFromSalesQuestion(question);
  const productCondition = buildProductSearchCondition(productKeyword);

  if (!productCondition) {
    return {
      date,
      branch,
      productKeyword,
      rows: []
    };
  }

  const branchFilter = branch?.clickhouseBranchId
    ? `AND d.branchid = '${escapeValue(branch.clickhouseBranchId)}'`
    : '';

  const rows = await queryClickHouse(`
    SELECT
      dd.barcode,
      dd.itemname,
      round(sum(dd.qty), 3) AS qty,
      round(sum(dd.sumamount), 2) AS amount,
      countDistinct(d.docno) AS bill_count
    FROM doc d
    JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
    WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND d.isdelete = 0
      AND dd.transflag = 44
      AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET})) = toDate('${escapeValue(date)}')
      ${branchFilter}
      AND ${productCondition}
    GROUP BY dd.barcode, dd.itemname
    ORDER BY qty DESC, amount DESC
    LIMIT 20
  `);

  return {
    date,
    branch,
    productKeyword,
    rows: rows || []
  };
};

const buildProductSalesMessage = (snapshot) => {
  const lines = [
    `ยอดขาย ${snapshot.productKeyword || 'สินค้า'} • ${formatHumanDateLabel(snapshot.date)}`,
    `สาขา: ${snapshot.branch?.branchName || 'ทุกสาขา'}`
  ];

  if (!snapshot.rows.length) {
    lines.push('ไม่พบยอดขายตามคำค้นนี้');
    return lines.join('\n');
  }

  let halfQty = 0;
  let wholeQty = 0;
  let hasHalfWholePattern = false;

  snapshot.rows.forEach((row, index) => {
    const name = String(row.itemname || '').trim();
    const qty = toSafeNumber(row.qty);
    const amount = toSafeNumber(row.amount);
    const billCount = toSafeNumber(row.bill_count);
    lines.push(
      `${index + 1}) ${name}: ${formatQty(qty)} รายการ • ฿${formatMoney(amount)} • ${billCount.toLocaleString('th-TH')} บิล`
    );

    if (name.includes('ครึ่งตัว')) {
      halfQty += qty;
      hasHalfWholePattern = true;
    }
    if (name.includes('ทั้งตัว')) {
      wholeQty += qty;
      hasHalfWholePattern = true;
    }
  });

  if (hasHalfWholePattern) {
    const equivalentWhole = wholeQty + halfQty / 2;
    lines.push('');
    lines.push(`รวมเทียบเป็นตัวเต็มประมาณ ${formatQty(equivalentWhole)} ตัว`);
  }

  return lines.join('\n');
};

const buildProductSalesToolMessage = (result) => {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const total = rows.reduce(
    (acc, row) => {
      acc.qty += toSafeNumber(row.qty);
      acc.amount += toSafeNumber(row.amount);
      acc.billCount += toSafeNumber(row.bill_count);
      return acc;
    },
    { qty: 0, amount: 0, billCount: 0 }
  );

  const lines = [
    `ยอดขาย ${result?.keyword || 'สินค้า'} (${result?.start || '-'} ถึง ${result?.end || '-'})`,
    `สาขา: ${result?.branch_name || 'ทุกสาขา'}`
  ];

  if (rows.length === 0) {
    lines.push('ไม่พบยอดขายตามคำค้นนี้');
    return lines.join('\n');
  }

  lines.push(`รวม ${formatQty(total.qty)} รายการ • ฿${formatMoney(total.amount)} • ${total.billCount.toLocaleString('th-TH')} บิล`);
  rows.slice(0, 10).forEach((row, index) => {
    lines.push(`${index + 1}) ${row.product_name}: ${formatQty(row.qty)} รายการ • ฿${formatMoney(row.amount)} • ${toSafeNumber(row.bill_count).toLocaleString('th-TH')} บิล`);
  });

  return lines.join('\n');
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
    `ยอดรวม ฿${formatMoney(snapshot.summary.total_revenue)}`,
    `ยอดเฉลี่ยต่อบิล (AOV) ฿${formatMoney(snapshot.aov)}`
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

const buildTopProductsMessage = (snapshot, { title = 'สินค้าขายดี' } = {}) => {
  const lines = [
    `${title} • ${formatHumanDateLabel(snapshot.start)}`,
    `สาขา: ${snapshot.by_branch.length === 1 ? snapshot.by_branch[0].branch_name : 'ทุกสาขา'}`
  ];

  const rows = Array.isArray(snapshot.top_products) ? snapshot.top_products.slice(0, 10) : [];
  if (rows.length === 0) {
    lines.push('ไม่พบข้อมูลในช่วงที่เลือก');
    return lines.join('\n');
  }

  rows.forEach((row, index) => {
    lines.push(
      `${index + 1}) ${row.product_name} • ${formatQty(row.qty)} • ฿${formatMoney(row.amount)}`
    );
  });

  return lines.join('\n');
};

const buildRankedProductsMessage = (result, { title = 'อันดับเมนู' } = {}) => {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const lines = [
    `${title} (${result?.start || '-'} ถึง ${result?.end || '-'})`,
    `สาขา: ${result?.branch_name || 'ทุกสาขา'}`
  ];

  if (rows.length === 0) {
    lines.push('ไม่พบข้อมูลในช่วงที่เลือก');
    return lines.join('\n');
  }

  rows.forEach((row, index) => {
    lines.push(
      `${index + 1}) ${row.product_name} • ${formatQty(row.qty)} • ฿${formatMoney(row.amount)}`
    );
  });

  return lines.join('\n');
};

const buildExecutiveSalesSummaryMessage = (snapshot, { label = 'สรุปยอดขาย' } = {}) => {
  const lines = [
    `${label} (${snapshot.start} ถึง ${snapshot.end})`,
    `ยอดขายรวม: ฿${formatMoney(snapshot.summary.total_revenue)}`,
    `จำนวนบิล: ${snapshot.summary.bill_count.toLocaleString('th-TH')} ใบ`,
    `AOV: ฿${formatMoney(snapshot.aov)}`
  ];

  if (snapshot.by_branch.length > 0) {
    const topBranch = snapshot.by_branch[0];
    lines.push(
      `สาขายอดสูงสุด: ${topBranch.branch_name} • ฿${formatMoney(topBranch.total_revenue)}`
    );
  }

  const topProducts = Array.isArray(snapshot.top_products) ? snapshot.top_products.slice(0, 3) : [];
  if (topProducts.length > 0) {
    lines.push('ขายดี Top 3:');
    topProducts.forEach((row, index) => {
      lines.push(`${index + 1}) ${row.product_name} • ${formatQty(row.qty)} • ฿${formatMoney(row.amount)}`);
    });
  }

  return lines.join('\n');
};

const resolveSalesRange = ({ period, start, end, text } = {}) => {
  const todayIso = getTodayIso();
  const input = String(text || '').trim();
  const normalizedPeriod = String(period || '').trim().toLowerCase();

  if (normalizedPeriod === 'today' || input.includes('วันนี้')) {
    return { start: todayIso, end: todayIso, label: 'วันนี้' };
  }
  if (normalizedPeriod === 'yesterday' || input.includes('เมื่อวาน')) {
    const yesterday = shiftIsoDate(todayIso, -1);
    return { start: yesterday, end: yesterday, label: 'เมื่อวาน' };
  }
  if (normalizedPeriod === 'week' || normalizedPeriod === 'this_week' || input.includes('สัปดาห์นี้')) {
    return { start: getWeekStartIso(todayIso), end: todayIso, label: 'สัปดาห์นี้' };
  }
  if (normalizedPeriod === 'month' || normalizedPeriod === 'this_month' || input.includes('เดือนนี้')) {
    return { start: getMonthStartIso(todayIso), end: todayIso, label: 'เดือนนี้' };
  }
  if (normalizedPeriod === 'last_7_days') {
    return { start: shiftIsoDate(todayIso, -6), end: todayIso, label: '7 วันล่าสุด' };
  }

  const startIso = toIsoDate(start) || parseHumanDateFromText(input) || todayIso;
  const endIso = toIsoDate(end) || startIso;
  if (startIso > endIso) {
    throw new Error('start ต้องไม่มากกว่า end');
  }
  const rangeDays = diffDaysInclusive(startIso, endIso);
  if (rangeDays > MAX_SALES_RANGE_DAYS) {
    throw new Error(`ช่วงวันที่ยาวเกินไป (สูงสุด ${MAX_SALES_RANGE_DAYS} วัน)`);
  }
  return { start: startIso, end: endIso, label: `${startIso} ถึง ${endIso}` };
};

const resolveSalesBranch = async ({ branch, branch_id: branchId, text } = {}) => {
  const directId = String(branchId || '').trim();
  if (directId) {
    return { clickhouseBranchId: directId, branchName: directId };
  }

  const branchText = String(branch || text || '').trim();
  const resolved = await resolveBranchFromText(branchText);
  if (resolved?.clickhouseBranchId) return resolved;

  return { clickhouseBranchId: null, branchName: 'ทุกสาขา' };
};

const salesBranchFilter = (clickhouseBranchId) =>
  clickhouseBranchId ? `AND d.branchid = '${escapeValue(clickhouseBranchId)}'` : '';

const buildSalesToolContext = async (args = {}, question = '') => {
  const range = resolveSalesRange({ ...args, text: question });
  const branch = await resolveSalesBranch({ ...args, text: question });
  return {
    ...range,
    ...branch,
    branchFilter: salesBranchFilter(branch.clickhouseBranchId)
  };
};

const getSalesOverviewTool = async (args = {}, question = '') => {
  const ctx = await buildSalesToolContext(args, question);
  const snapshot = await getSalesSnapshot({
    start: ctx.start,
    end: ctx.end,
    clickhouseBranchId: ctx.clickhouseBranchId
  });
  return {
    tool: 'sales_overview',
    branch_name: ctx.branchName,
    ...snapshot
  };
};

const getTopProductsTool = async (args = {}, question = '') => {
  const ctx = await buildSalesToolContext(args, question);
  const metric = String(args.metric || '').toLowerCase() === 'quantity' ? 'quantity' : 'revenue';
  const direction = String(args.direction || '').toLowerCase() === 'worst' ? 'worst' : 'best';
  const limit = Math.min(Math.max(Number(args.limit || 10), 1), 20);
  const orderBy = direction === 'worst'
    ? (metric === 'quantity' ? 'qty ASC, amount ASC' : 'amount ASC, qty ASC')
    : (metric === 'quantity' ? 'qty DESC, amount DESC' : 'amount DESC, qty DESC');

  const rows = await queryClickHouse(`
    SELECT
      dd.barcode,
      any(dd.itemname) AS product_name,
      round(sum(dd.qty), 3) AS qty,
      round(sum(dd.sumamount), 2) AS amount,
      countDistinct(d.docno) AS bill_count
    FROM doc d
    JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
    WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND d.isdelete = 0
      AND dd.transflag = 44
      ${ctx.branchFilter}
      AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
          BETWEEN toDate('${escapeValue(ctx.start)}') AND toDate('${escapeValue(ctx.end)}')
    GROUP BY dd.barcode
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);

  return {
    tool: 'top_products',
    start: ctx.start,
    end: ctx.end,
    branch_name: ctx.branchName,
    metric,
    direction,
    rows: (rows || []).map((row) => ({
      barcode: String(row.barcode || ''),
      product_name: String(row.product_name || '').trim() || '-',
      qty: toSafeNumber(row.qty),
      amount: toSafeNumber(row.amount),
      bill_count: toSafeNumber(row.bill_count)
    }))
  };
};

const getProductSalesTool = async (args = {}, question = '') => {
  const ctx = await buildSalesToolContext(args, question);
  const keyword = String(args.keyword || extractProductKeywordFromSalesQuestion(question) || '').trim();
  const condition = buildProductSearchCondition(keyword);
  if (!condition) {
    return {
      tool: 'product_sales',
      start: ctx.start,
      end: ctx.end,
      branch_name: ctx.branchName,
      keyword,
      rows: []
    };
  }

  const rows = await queryClickHouse(`
    SELECT
      dd.barcode,
      any(dd.itemname) AS product_name,
      round(sum(dd.qty), 3) AS qty,
      round(sum(dd.sumamount), 2) AS amount,
      countDistinct(d.docno) AS bill_count
    FROM doc d
    JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
    WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
      AND d.transflag = 44
      AND d.iscancel = 0
      AND d.isdelete = 0
      AND dd.transflag = 44
      ${ctx.branchFilter}
      AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
          BETWEEN toDate('${escapeValue(ctx.start)}') AND toDate('${escapeValue(ctx.end)}')
      AND ${condition}
    GROUP BY dd.barcode
    ORDER BY amount DESC, qty DESC
    LIMIT 20
  `);

  return {
    tool: 'product_sales',
    start: ctx.start,
    end: ctx.end,
    branch_name: ctx.branchName,
    keyword,
    rows: (rows || []).map((row) => ({
      barcode: String(row.barcode || ''),
      product_name: String(row.product_name || '').trim() || '-',
      qty: toSafeNumber(row.qty),
      amount: toSafeNumber(row.amount),
      bill_count: toSafeNumber(row.bill_count)
    }))
  };
};

const getSalesTimeBreakdownTool = async (args = {}, question = '') => {
  const ctx = await buildSalesToolContext(args, question);
  const grainInput = String(args.grain || '').toLowerCase();
  const grain = ['hourly', 'daily', 'weekday'].includes(grainInput) ? grainInput : 'daily';
  const dimensionExpr =
    grain === 'hourly'
      ? `toHour(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`
      : grain === 'weekday'
        ? `toDayOfWeek(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`
        : `toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`;

  const rows = await queryClickHouse(`
    SELECT
      sale_key,
      count() AS bill_count,
      round(sum(total_revenue), 2) AS total_revenue
    FROM (
      SELECT
        ${dimensionExpr} AS sale_key,
        d.docno,
        any(d.totalamount) AS total_revenue
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND d.isdelete = 0
        AND dd.transflag = 44
        ${ctx.branchFilter}
        AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
            BETWEEN toDate('${escapeValue(ctx.start)}') AND toDate('${escapeValue(ctx.end)}')
      GROUP BY sale_key, d.docno
    ) x
    GROUP BY sale_key
    ORDER BY sale_key
  `);

  return {
    tool: 'sales_time_breakdown',
    start: ctx.start,
    end: ctx.end,
    branch_name: ctx.branchName,
    grain,
    rows: (rows || []).map((row) => ({
      key: String(row.sale_key ?? ''),
      bill_count: toSafeNumber(row.bill_count),
      total_revenue: toSafeNumber(row.total_revenue)
    }))
  };
};

const getSalesCompareTool = async (args = {}, question = '') => {
  const ctx = await buildSalesToolContext(args, question);
  const currentDays = diffDaysInclusive(ctx.start, ctx.end);
  const compareEnd = toIsoDate(args.compare_end) || shiftIsoDate(ctx.start, -1);
  const compareStart = toIsoDate(args.compare_start) || shiftIsoDate(compareEnd, -(currentDays - 1));
  const [current, previous] = await Promise.all([
    getSalesSnapshot({
      start: ctx.start,
      end: ctx.end,
      clickhouseBranchId: ctx.clickhouseBranchId
    }),
    getSalesSnapshot({
      start: compareStart,
      end: compareEnd,
      clickhouseBranchId: ctx.clickhouseBranchId
    })
  ]);
  const revenueDiff = current.summary.total_revenue - previous.summary.total_revenue;
  const billDiff = current.summary.bill_count - previous.summary.bill_count;
  return {
    tool: 'sales_compare',
    branch_name: ctx.branchName,
    current,
    previous,
    diff: {
      total_revenue: revenueDiff,
      total_revenue_pct:
        previous.summary.total_revenue > 0
          ? (revenueDiff / previous.summary.total_revenue) * 100
          : null,
      bill_count: billDiff,
      bill_count_pct:
        previous.summary.bill_count > 0
          ? (billDiff / previous.summary.bill_count) * 100
          : null
    }
  };
};

const SALES_AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'sales_overview',
      description: 'สรุปยอดขายรวม จำนวนบิล AOV ยอดแยกสาขา รายวัน และสินค้าขายดีตามยอดเงิน',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days'] },
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
          branch: { type: 'string', description: 'ชื่อสาขา เช่น คันคลอง หรือ สันกำแพง' },
          branch_id: { type: 'string', description: 'ClickHouse branch id ถ้ารู้แน่ชัด' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'top_products',
      description: 'จัดอันดับสินค้าขายดีหรือขายไม่ดีตามยอดเงินหรือจำนวนชิ้น',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days'] },
          start: { type: 'string' },
          end: { type: 'string' },
          branch: { type: 'string' },
          branch_id: { type: 'string' },
          metric: { type: 'string', enum: ['revenue', 'quantity'] },
          direction: { type: 'string', enum: ['best', 'worst'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'product_sales',
      description: 'ค้นหายอดขายของสินค้า/เมนูตามคำค้น เช่น คอหมู ไก่บ้าน ตำไทย',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days'] },
          start: { type: 'string' },
          end: { type: 'string' },
          branch: { type: 'string' },
          branch_id: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sales_time_breakdown',
      description: 'ยอดขายแยกตามวัน ชั่วโมง หรือวันในสัปดาห์',
      parameters: {
        type: 'object',
        properties: {
          grain: { type: 'string', enum: ['daily', 'hourly', 'weekday'] },
          period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days'] },
          start: { type: 'string' },
          end: { type: 'string' },
          branch: { type: 'string' },
          branch_id: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sales_compare',
      description: 'เปรียบเทียบยอดขายช่วงปัจจุบันกับช่วงก่อนหน้า',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days'] },
          start: { type: 'string' },
          end: { type: 'string' },
          compare_start: { type: 'string' },
          compare_end: { type: 'string' },
          branch: { type: 'string' },
          branch_id: { type: 'string' }
        }
      }
    }
  }
];

const runSalesAiTool = async (name, args, question) => {
  if (name === 'sales_overview') return getSalesOverviewTool(args, question);
  if (name === 'top_products') return getTopProductsTool(args, question);
  if (name === 'product_sales') return getProductSalesTool(args, question);
  if (name === 'sales_time_breakdown') return getSalesTimeBreakdownTool(args, question);
  if (name === 'sales_compare') return getSalesCompareTool(args, question);
  return { error: `Unknown tool: ${name}` };
};

const askOpenAIAboutSales = async ({ question, snapshot = null, memory = null }) => {
  if (!OPENAI_API_KEY) {
    return 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY';
  }
  const effectiveQuestion = buildMemoryAwareQuestion(question, memory);

  const systemPrompt = `
คุณคือผู้ช่วยวิเคราะห์ยอดขายสำหรับผู้บริหารร้านอาหาร
กติกาบังคับ:
1) ตอบเฉพาะเรื่องยอดขายจาก ClickHouse tools เท่านั้น
2) ห้ามเดาตัวเลข ห้ามสร้างข้อมูลเอง ใช้เฉพาะผลจาก tools หรือ JSON ที่ระบบให้
3) นิยาม "ขายดีที่สุด" ถ้าไม่ระบุ ให้หมายถึงยอดเงินสูงสุด ถ้าถาม "จำนวน/ชิ้น" ให้ใช้จำนวน
4) ถ้าคำถามต้องใช้ข้อมูล ให้เรียก tools ก่อนตอบ
5) ช่วงวันที่เริ่มต้นคือวันนี้ตามเวลาไทย (${getTodayIso()}) ถ้าผู้ใช้ไม่ระบุ
6) ถ้ามีบริบทก่อนหน้า และคำถามเป็นคำถามต่อเนื่อง เช่น "แล้วเมื่อวานล่ะ" ให้ใช้สินค้า/สาขา/ช่วงจากบริบทนั้น
7) ถ้าคำถามต่อเนื่องระบุเฉพาะมิติใหม่ เช่น "แล้วสาขาคันคลองล่ะ" หรือ "แล้วเมื่อวานล่ะ" ให้คงมิติเดิมที่ไม่ได้เปลี่ยนไว้ เช่น สินค้าเดิม/ช่วงเดิม/สาขาเดิม
8) ตอบภาษาไทย กระชับ สำหรับผู้บริหารร้านอาหาร
รูปแบบคำตอบ:
- สรุป
- KPI หลัก
- รายการสำคัญ/อันดับ (ถ้ามี)
- ข้อสังเกตหรือข้อแนะนำไม่เกิน 3 ข้อ
`.trim();

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        `คำถาม: ${effectiveQuestion}`,
        memory ? `บริบทก่อนหน้า: ${JSON.stringify(memory)}` : '',
        memory ? 'ถ้าคำถามปัจจุบันไม่ได้เปลี่ยนสินค้า/สาขา/ช่วงเวลา ให้ใช้ค่าจากบริบทก่อนหน้าเป็นค่าเดิม' : '',
        snapshot ? `ข้อมูลตั้งต้น: ${JSON.stringify(snapshot)}` : ''
      ].filter(Boolean).join('\n')
    }
  ];

  const firstResponse = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: SALES_AI_TOOLS,
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: systemPrompt },
        messages[1]
      ]
    })
  });

  if (!firstResponse.ok) {
    const body = await firstResponse.text();
    throw new Error(`OpenAI request failed: ${firstResponse.status} ${body}`);
  }

  const firstPayload = await firstResponse.json();
  const firstMessage = firstPayload?.choices?.[0]?.message || {};
  const toolCalls = Array.isArray(firstMessage.tool_calls) ? firstMessage.tool_calls : [];
  if (toolCalls.length === 0) {
    return firstMessage?.content?.trim() || 'AI ไม่สามารถตอบได้ในตอนนี้';
  }

  messages.push(firstMessage);

  for (const toolCall of toolCalls.slice(0, 5)) {
    const name = toolCall?.function?.name;
    let args = {};
    try {
      args = JSON.parse(toolCall?.function?.arguments || '{}');
    } catch (error) {
      args = {};
    }
    const result = await runSalesAiTool(name, args, effectiveQuestion);
    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });
  }

  const finalResponse = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages
    })
  });

  if (!finalResponse.ok) {
    const body = await finalResponse.text();
    throw new Error(`OpenAI final request failed: ${finalResponse.status} ${body}`);
  }

  const finalPayload = await finalResponse.json();
  return finalPayload?.choices?.[0]?.message?.content?.trim() || 'AI ไม่สามารถตอบได้ในตอนนี้';
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
  const day = parseHumanDateFromText(date) || getTodayIso();

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

const getReconcileStatus = (row) => {
  const ordered = Number(row.ordered_quantity || 0);
  const purchased = Number(row.purchased_quantity || 0);
  const received = Number(row.received_quantity || 0);
  const pending = Number(row.pending_quantity || 0);

  if (ordered > 0 && purchased <= 0 && received <= 0) {
    return 'ยังไม่ซื้อ';
  }
  if (ordered > 0 && purchased > ordered) {
    return 'ซื้อเกินสั่ง';
  }
  if (ordered <= 0 && purchased > 0) {
    return 'ซื้อนอกใบสั่ง';
  }
  if (pending > 0) {
    return 'รับไม่ครบ';
  }
  if (pending < 0) {
    return 'รับเกิน';
  }
  if (purchased === received) {
    return 'ครบ';
  }
  return 'ผิดปกติ';
};

const getReconcileSnapshot = async ({ date, productGroupId = null }) => {
  const day = parseHumanDateFromText(date) || getTodayIso();
  const rows = await adminModel.getPurchaseReceiveReconcileReport({
    startDate: day,
    endDate: day,
    productGroupId
  });

  const enriched = (rows || []).map((row) => ({
    ...row,
    status_text: getReconcileStatus(row)
  }));

  const abnormalRows = enriched.filter((row) => row.status_text !== 'ครบ');
  const groupedCountsMap = new Map();
  abnormalRows.forEach((row) => {
    const key = Number(row.product_group_id || 0);
    if (!groupedCountsMap.has(key)) {
      groupedCountsMap.set(key, {
        product_group_id: key,
        product_group_name: row.product_group_name || 'ไม่ระบุกลุ่มสินค้า',
        abnormal_count: 0
      });
    }
    groupedCountsMap.get(key).abnormal_count += 1;
  });

  const groupedCounts = Array.from(groupedCountsMap.values()).sort(
    (a, b) => b.abnormal_count - a.abnormal_count
  );

  return {
    date: day,
    totalCount: enriched.length,
    abnormalCount: abnormalRows.length,
    groupedCounts,
    abnormalRows
  };
};

const buildPurchaseWalkSummaryMessage = ({ snapshot, groupLabel }) => {
  const { totals, topGroups, pendingItems, date } = snapshot;
  const lines = [
    `สรุปเดินซื้อ${groupLabel ? ` • ${groupLabel}` : ''}`,
    `ช่วงเวลา: ${formatHumanDateLabel(date)}`,
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
  const lines = [
    `รายการค้างรับ${groupLabel ? ` • ${groupLabel}` : ''}`,
    `ช่วงเวลา: ${formatHumanDateLabel(date)}`
  ];

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

const buildReconcileSummaryMessage = ({
  snapshot,
  groupLabel = null,
  forceAskGroup = false
}) => {
  const { date, abnormalCount, abnormalRows, groupedCounts } = snapshot;
  const lines = [
    `เช็คซื้อ-รับรวมกลุ่ม${groupLabel ? ` • ${groupLabel}` : ''}`,
    `ช่วงเวลา: ${formatHumanDateLabel(date)}`
  ];

  if (abnormalCount === 0) {
    lines.push('ไม่พบสถานะผิดปกติ');
    return lines.join('\n');
  }

  lines.push(`พบสถานะผิดปกติ ${abnormalCount.toLocaleString('th-TH')} รายการ`);

  if (forceAskGroup && !groupLabel) {
    lines.push('จำนวนเกิน 15 รายการ กรุณาเลือกกลุ่มสินค้าก่อน');
    lines.push('');
    lines.push('กลุ่มที่มีผิดปกติ:');
    groupedCounts.slice(0, 10).forEach((group, index) => {
      lines.push(
        `${index + 1}) ${group.product_group_name} (ID ${group.product_group_id}) • ${group.abnormal_count} รายการ`
      );
    });
    lines.push('');
    lines.push('พิมพ์เลขลำดับ (1..10) หรือพิมพ์ ID กลุ่มได้เลย');
    lines.push('หรือใช้: /reconcile group_id=<ID> date=วันนี้');
    return lines.join('\n');
  }

  abnormalRows.forEach((row, index) => {
    lines.push(
      `${index + 1}) ${row.product_group_name} • ${row.product_name} • สั่ง ${formatQty(row.ordered_quantity)} | ซื้อ ${formatQty(row.purchased_quantity)} | รับ ${formatQty(row.received_quantity)} | ค้าง ${formatQty(row.pending_quantity)} • ${row.status_text}`
    );
  });

  return lines.join('\n');
};

const makeLineSourceKey = (context = {}) => {
  const source = context.source || {};
  const sourceType = String(source.type || 'unknown').trim();
  const ownerId = String(source.userId || source.groupId || source.roomId || '').trim();
  if (!ownerId) return null;
  return `${sourceType}:${ownerId}`;
};

const getLogSource = (source = {}) => ({
  sourceType: String(source?.type || 'unknown').trim() || 'unknown',
  sourceId: String(source?.userId || source?.groupId || source?.roomId || '').trim() || null
});

const getChatMemory = (sourceKey) => {
  if (!sourceKey) return null;
  const memory = chatMemories.get(sourceKey);
  if (!memory) return null;
  if (Date.now() - Number(memory.updatedAt || 0) > CHAT_MEMORY_TTL_MS) {
    chatMemories.delete(sourceKey);
    return null;
  }
  return memory;
};

const loadChatMemory = async (sourceKey) => {
  if (!sourceKey) return null;
  const local = getChatMemory(sourceKey);
  if (local) return local;
  const persisted = await getChatbotMemory(sourceKey).catch((error) => {
    console.warn('[LINE CHATBOT] memory load failed:', error?.message || error);
    return null;
  });
  if (!persisted) return null;
  if (Date.now() - Number(persisted.updatedAt || 0) > CHAT_MEMORY_TTL_MS) {
    return null;
  }
  chatMemories.set(sourceKey, persisted);
  return persisted;
};

const detectPeriodFromText = (input) => {
  const text = String(input || '');
  if (text.includes('วันนี้')) return 'today';
  if (text.includes('เมื่อวาน')) return 'yesterday';
  if (text.includes('สัปดาห์นี้')) return 'this_week';
  if (text.includes('เดือนนี้')) return 'this_month';
  if (/7\s*วัน/.test(text)) return 'last_7_days';
  return null;
};

const isUsefulProductKeyword = (keyword) => {
  const value = String(keyword || '').trim();
  if (value.length < 2) return false;
  return !/^(ยอดขาย|ขาย|สรุป|วันนี้|เมื่อวาน|สัปดาห์นี้|เดือนนี้|อะไร|เมนูไหน|สินค้าไหน|สาขาไหน|ดีที่สุด|ขายดี)$/.test(value);
};

const extractMemoryPatchFromText = async (input) => {
  const patch = {};
  const period = detectPeriodFromText(input);
  if (period) patch.period = period;

  const branch = await resolveBranchFromText(input);
  if (branch?.clickhouseBranchId) {
    patch.branchName = branch.branchName;
    patch.clickhouseBranchId = branch.clickhouseBranchId;
  }

  if (String(input || '').includes('ขาย')) {
    const productKeyword = extractProductKeywordFromSalesQuestion(input);
    if (isUsefulProductKeyword(productKeyword)) {
      patch.productKeyword = productKeyword;
    }
  }

  patch.lastQuestion = String(input || '').trim();
  patch.updatedAt = Date.now();
  return patch;
};

const updateChatMemory = async (sourceKey, input) => {
  if (!sourceKey) return null;
  const current = (await loadChatMemory(sourceKey)) || {};
  const patch = await extractMemoryPatchFromText(input);
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null && value !== undefined && value !== '')),
    updatedAt: Date.now()
  };
  chatMemories.set(sourceKey, next);
  await upsertChatbotMemory(sourceKey, next).catch((error) => {
    console.warn('[LINE CHATBOT] memory persist failed:', error?.message || error);
  });
  return next;
};

const periodToThaiLabel = (period) => {
  if (period === 'today') return 'วันนี้';
  if (period === 'yesterday') return 'เมื่อวาน';
  if (period === 'this_week') return 'สัปดาห์นี้';
  if (period === 'this_month') return 'เดือนนี้';
  if (period === 'last_7_days') return '7 วันล่าสุด';
  return '';
};

const buildMemoryAwareQuestion = (question, memory) => {
  const input = String(question || '').trim();
  if (!memory) return input;

  const parts = [];
  const currentKeyword = input.includes('ขาย') ? extractProductKeywordFromSalesQuestion(input) : '';
  if (!isUsefulProductKeyword(currentKeyword) && memory.productKeyword) {
    parts.push(`สินค้า=${memory.productKeyword}`);
  }
  if (!detectPeriodFromText(input) && memory.period) {
    parts.push(`ช่วง=${periodToThaiLabel(memory.period)}`);
  }
  if (!/(คันคลอง|สันกำแพง|สาขา)/.test(input) && memory.branchName) {
    parts.push(`สาขา=${memory.branchName}`);
  }

  if (parts.length === 0) return input;
  return `${input}\nเติมบริบทต่อเนื่อง: ${parts.join(', ')}`;
};

const setPendingReconcileSelection = ({ sourceKey, date, groupedCounts }) => {
  if (!sourceKey) return;
  const list = Array.isArray(groupedCounts) ? groupedCounts.slice(0, 10) : [];
  pendingReconcileSelections.set(sourceKey, {
    date: toIsoDate(date) || getTodayIso(),
    groupedCounts: list,
    createdAt: Date.now()
  });
};

const resolvePendingReconcileSelection = ({ sourceKey, inputText }) => {
  if (!sourceKey) return null;
  const pending = pendingReconcileSelections.get(sourceKey);
  if (!pending) return null;
  if (Date.now() - Number(pending.createdAt || 0) > RECONCILE_PICK_TTL_MS) {
    pendingReconcileSelections.delete(sourceKey);
    return null;
  }

  const raw = String(inputText || '').trim();
  if (!/^\d+$/.test(raw)) return null;

  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;

  const options = Array.isArray(pending.groupedCounts) ? pending.groupedCounts : [];
  if (options.length === 0) return null;

  let picked = null;

  // พิมพ์เลข ID กลุ่มโดยตรง
  picked = options.find((option) => Number(option.product_group_id) === asNumber) || null;

  // หรือพิมพ์ลำดับ 1..N จากรายการที่บอทแสดง
  if (!picked && asNumber >= 1 && asNumber <= options.length) {
    picked = options[asNumber - 1];
  }

  if (!picked) {
    return {
      error: 'invalid_pick',
      message: `ไม่พบกลุ่มตามเลขที่พิมพ์ กรุณาพิมพ์เลข 1-${options.length} หรือ ID กลุ่มที่แสดง`
    };
  }

  pendingReconcileSelections.delete(sourceKey);
  return {
    date: pending.date,
    groupId: Number(picked.product_group_id),
    groupName: String(picked.product_group_name || '')
  };
};

const getHelpText = () => `
คำสั่งที่ใช้ได้:
1) ยอดขายวันนี้
2) /sales_daily start=YYYY-MM-DD end=YYYY-MM-DD branch_id=...
3) /ask_sales คำถาม start=YYYY-MM-DD end=YYYY-MM-DD branch_id=...
4) สรุปวันนี้ / สรุปสัปดาห์นี้ / สรุปเดือนนี้
`.trim();

const executeTextCommand = async (text, context = {}) => {
  const input = String(text || '').trim();
  if (!input) return getHelpText();
  const sourceKey = makeLineSourceKey(context);
  const memory = await loadChatMemory(sourceKey);
  const finish = async (reply) => {
    await updateChatMemory(sourceKey, input).catch((error) => {
      console.warn('[LINE CHATBOT] memory update failed:', error?.message || error);
    });
    return reply;
  };
  const shouldUseAiForDetail =
    /เทียบ|เปรียบ|ช่วง|เวลา|ชั่วโมง|แนวโน้ม|วิเคราะห์|ทำไม|สาขาไหน|วันไหน|รายสินค้า/.test(input);

  if (['สวัสดี', 'hello', 'hi'].includes(input.toLowerCase())) {
    return finish(`สวัสดีครับ\n${getHelpText()}`);
  }

  if (input === 'ยอดขายวันนี้') {
    const snapshot = await getSalesSnapshot({});
    return finish(buildSalesDailyMessage(snapshot));
  }

  if (input.includes('สรุปวันนี้')) {
    const todayIso = getTodayIso();
    const snapshot = await getSalesSnapshot({ start: todayIso, end: todayIso });
    return finish(buildExecutiveSalesSummaryMessage(snapshot, { label: 'สรุปวันนี้' }));
  }

  if (
    (input.includes('สรุปสัปดาห์นี้') || input === 'สัปดาห์นี้' || input.includes('สัปดาห์นี้ให้')) &&
    !shouldUseAiForDetail &&
    !/(ขายดี|ดีที่สุด|อะไร|เมนูไหน|สินค้าไหน)/.test(input)
  ) {
    const todayIso = getTodayIso();
    const weekStart = getWeekStartIso(todayIso);
    const snapshot = await getSalesSnapshot({ start: weekStart, end: todayIso });
    return finish(buildExecutiveSalesSummaryMessage(snapshot, { label: 'สรุปสัปดาห์นี้' }));
  }

  if (
    (input.includes('สรุปเดือนนี้') || input === 'เดือนนี้' || input.includes('เดือนนี้ให้')) &&
    !shouldUseAiForDetail &&
    !/(ขายดี|ดีที่สุด|อะไร|เมนูไหน|สินค้าไหน)/.test(input)
  ) {
    const todayIso = getTodayIso();
    const monthStart = getMonthStartIso(todayIso);
    const snapshot = await getSalesSnapshot({ start: monthStart, end: todayIso });
    return finish(buildExecutiveSalesSummaryMessage(snapshot, { label: 'สรุปเดือนนี้' }));
  }

  if (
    memory?.productKeyword &&
    /^(แล้ว|ละ|ล่ะ|ต่อ|อีก)|เมื่อวาน|วันนี้|สัปดาห์นี้|เดือนนี้|สาขา/.test(input) &&
    !/(ยอดขายรวม|สรุปทั้งหมด|ทุกอย่าง)/.test(input)
  ) {
    const result = await getProductSalesTool(
      {
        keyword: memory.productKeyword,
        period: detectPeriodFromText(input) || memory.period || 'today',
        branch: input
      },
      buildMemoryAwareQuestion(input, memory)
    );
    return finish(buildProductSalesToolMessage(result));
  }

  if (
    (input.includes('ขาย') || input.includes('ยอดขาย')) &&
    !input.startsWith('/ask_sales') &&
    !input.startsWith('/sales_daily')
  ) {
    const isWorstProductQuestion =
      /(ขายไม่ดี|ขายน้อย|ขายต่ำ|ยอดต่ำ|ท้าย|บ๊วย|ไม่ค่อยขาย)/.test(input);
    const isTopProductQuestion =
      /(อะไร|เมนูไหน|สินค้าไหน|อันดับ|top|ท็อป|\d+\s*อันดับ)/i.test(input) &&
      /(ขายดี|ดีที่สุด|ขายมาก|อันดับ|top|ท็อป)/i.test(input);

    const inferredBranch = await resolveBranchFromText(input);
    const inferredDate = parseHumanDateFromText(input) || getTodayIso();
    const inferredKeyword = extractProductKeywordFromSalesQuestion(input);
    const shouldUseAiForPeriodProduct = /สัปดาห์นี้|เดือนนี้|7\s*วัน|ตั้งแต่|ถึง/.test(input);

    if (shouldUseAiForDetail || (shouldUseAiForPeriodProduct && !isWorstProductQuestion)) {
      return finish(await askOpenAIAboutSales({ question: input, memory }));
    }

    if (isWorstProductQuestion) {
      const result = await getTopProductsTool(
        {
          period: detectPeriodFromText(input) || 'today',
          branch: input,
          metric: /จำนวน|ชิ้น/.test(input) ? 'quantity' : 'revenue',
          direction: 'worst',
          limit: 10
        },
        input
      );
      return finish(buildRankedProductsMessage(result, { title: 'เมนูขายไม่ดี' }));
    }

    if (isTopProductQuestion) {
      const snapshot = await getSalesSnapshot({
        start: inferredDate,
        end: inferredDate,
        clickhouseBranchId: inferredBranch?.clickhouseBranchId || null
      });
      return finish(buildTopProductsMessage(snapshot, { title: 'ยอดขายดีที่สุด' }));
    }

    // Natural-language sales query without product keyword:
    // e.g. "ยอดขายสาขาคันคลองวันนี้"
    if (!inferredKeyword) {
      const snapshot = await getSalesSnapshot({
        start: inferredDate,
        end: inferredDate,
        clickhouseBranchId: inferredBranch?.clickhouseBranchId || null
      });
      return finish(buildSalesDailyMessage(snapshot));
    }

    const snapshot = await getProductSalesSnapshot({ question: input });
    if (snapshot.productKeyword) {
      return finish(buildProductSalesMessage(snapshot));
    }
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
    return finish(buildSalesDailyMessage(snapshot));
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

    const answer = await askOpenAIAboutSales({
      question: [
        question,
        args.start ? `start=${args.start}` : '',
        args.end ? `end=${args.end}` : '',
        args.branch_id ? `branch_id=${args.branch_id}` : ''
      ].filter(Boolean).join(' '),
      memory
    });
    return finish(`คำถาม: ${question}\n\n${answer}`);
  }

  return finish(await askOpenAIAboutSales({ question: input, memory }));
};

const processEvents = async (events) => {
  const safeEvents = Array.isArray(events) ? events : [];
  for (const event of safeEvents) {
    if (event?.type !== 'message') continue;
    if (event?.message?.type !== 'text') continue;
    const replyToken = String(event?.replyToken || '').trim();
    if (!replyToken) continue;

    try {
      const replyText = await executeTextCommand(event.message.text, {
        source: event?.source || {}
      });
      const logSource = getLogSource(event?.source || {});
      await logChatbotQuery({
        channel: 'line',
        ...logSource,
        question: event.message.text,
        intent: 'line_text',
        answer: replyText,
        status: 'success'
      }).catch((error) => {
        console.warn('[LINE CHATBOT] log success failed:', error?.message || error);
      });
      await replyLineText({ replyToken, text: replyText });
    } catch (error) {
      const logSource = getLogSource(event?.source || {});
      await logChatbotQuery({
        channel: 'line',
        ...logSource,
        question: event?.message?.text || '',
        intent: 'line_text',
        answer: null,
        status: 'error',
        errorMessage: error?.message || 'unknown error'
      }).catch((logError) => {
        console.warn('[LINE CHATBOT] log error failed:', logError?.message || logError);
      });
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

export const testCommand = async (req, res, next) => {
  try {
    const enabled = String(process.env.LINE_BOT_TEST_ENABLED || 'true') === 'true';
    if (!enabled) {
      return res.status(404).json({
        success: false,
        message: 'LINE bot test endpoint is disabled'
      });
    }

    const text = String(req.body?.text || req.query?.text || '').trim();
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'text is required'
      });
    }

    const reply = await executeTextCommand(text, {
      source: {
        type: 'test',
        userId: 'local-test'
      }
    });
    await logChatbotQuery({
      channel: 'line-test',
      sourceType: 'test',
      sourceId: 'local-test',
      question: text,
      intent: 'test_command',
      answer: reply,
      status: 'success'
    }).catch((error) => {
      console.warn('[LINE CHATBOT] test log failed:', error?.message || error);
    });

    res.json({
      success: true,
      data: {
        input: text,
        reply
      }
    });
  } catch (error) {
    next(error);
  }
};
