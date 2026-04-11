import nacl from 'tweetnacl';
import * as branchModel from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const DISCORD_PUBLIC_KEY = String(process.env.DISCORD_PUBLIC_KEY || '').trim();
const DISCORD_APPLICATION_ID = String(process.env.DISCORD_APPLICATION_ID || '').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_ENDPOINT =
  process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const CLICKHOUSE_SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const TH_TIME_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);

const MAX_DISCORD_CONTENT = 1900;

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

const getOptionValue = (interaction, name) => {
  const options = Array.isArray(interaction?.data?.options)
    ? interaction.data.options
    : [];
  const found = options.find((option) => option?.name === name);
  return found?.value ?? null;
};

const truncateDiscordContent = (text) => {
  const value = String(text || '').trim();
  if (value.length <= MAX_DISCORD_CONTENT) return value;
  return `${value.slice(0, MAX_DISCORD_CONTENT - 20)}\n... (ตัดข้อความ)`;
};

const verifyDiscordSignature = ({ timestamp, signature, rawBody }) => {
  if (!DISCORD_PUBLIC_KEY) return false;
  if (!timestamp || !signature || !rawBody) return false;

  try {
    const message = Buffer.from(`${timestamp}${rawBody}`);
    const sig = Buffer.from(String(signature), 'hex');
    const key = Buffer.from(DISCORD_PUBLIC_KEY, 'hex');
    return nacl.sign.detached.verify(message, sig, key);
  } catch (error) {
    return false;
  }
};

const sendDiscordFollowup = async ({ applicationId, interactionToken, content }) => {
  const appId = String(applicationId || DISCORD_APPLICATION_ID || '').trim();
  const token = String(interactionToken || '').trim();
  if (!appId || !token) return;

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: truncateDiscordContent(content),
        flags: 64 // ephemeral
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord followup failed: ${response.status} ${body}`);
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

  const [dailyRows, itemRows, branchMap] = await Promise.all([
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
        m.name_1 AS menu_name,
        m.barcode AS barcode,
        round(sum(s.qty), 2) AS total_qty,
        round(sum(s.totalamount), 2) AS total_revenue
      FROM doci s
      JOIN doc d
        ON d.shopid = s.shopid
       AND d.guidfixed = s.docguidfixed
       AND d.docdate = s.docdate
      LEFT JOIN icitem m ON m.barcode = s.itembarcode
      WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        ${branchFilter}
        AND toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))
            BETWEEN toDate('${escapeValue(startIso)}') AND toDate('${escapeValue(endIso)}')
      GROUP BY menu_name, barcode
      ORDER BY total_revenue DESC
      LIMIT 30
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

  const normalizedItems = (itemRows || []).map((row) => ({
    menu_name: row.menu_name || '',
    barcode: row.barcode || '',
    total_qty: toSafeNumber(row.total_qty),
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
    by_branch: byBranch,
    items: normalizedItems
  };
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const buildSalesDailyMessage = (snapshot) => {
  const lines = [
    `ยอดขายรายวัน ${snapshot.start} ถึง ${snapshot.end}`,
    `รวมบิล: ${snapshot.summary.bill_count.toLocaleString('th-TH')} ใบ`,
    `ยอดขายรวม: ฿${formatMoney(snapshot.summary.total_revenue)}`
  ];

  if (snapshot.by_branch.length > 0) {
    lines.push('');
    lines.push('แยกตามสาขา:');
    snapshot.by_branch.slice(0, 20).forEach((row, index) => {
      lines.push(
        `${index + 1}. ${row.branch_name} • บิล ${row.bill_count.toLocaleString(
          'th-TH'
        )} • ฿${formatMoney(row.total_revenue)}`
      );
    });
  } else {
    lines.push('');
    lines.push('ไม่พบข้อมูลยอดขายในช่วงวันที่ที่เลือก');
  }

  return lines.join('\n');
};

const askOpenAIAboutSales = async ({ question, snapshot }) => {
  if (!OPENAI_API_KEY) {
    return 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY';
  }

  const systemPrompt = `
คุณเป็นผู้ช่วยวิเคราะห์ยอดขายร้านอาหาร
- ตอบจากข้อมูล JSON ที่ให้เท่านั้น
- ถ้าไม่พบ ให้ตอบว่า "ไม่พบข้อมูลในช่วงที่เลือก"
- ตอบภาษาไทยแบบกระชับ อ่านง่าย
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

const processCommand = async (interaction) => {
  const commandName = String(interaction?.data?.name || '').trim();

  if (commandName === 'sales_daily') {
    const start = getOptionValue(interaction, 'start');
    const end = getOptionValue(interaction, 'end');
    const clickhouseBranchId = getOptionValue(interaction, 'branch_id');
    const snapshot = await getSalesSnapshot({ start, end, clickhouseBranchId });
    return buildSalesDailyMessage(snapshot);
  }

  if (commandName === 'ask_sales') {
    const question = String(getOptionValue(interaction, 'question') || '').trim();
    if (!question) {
      return 'กรุณาระบุคำถามใน option `question`';
    }
    const start = getOptionValue(interaction, 'start');
    const end = getOptionValue(interaction, 'end');
    const clickhouseBranchId = getOptionValue(interaction, 'branch_id');
    const snapshot = await getSalesSnapshot({ start, end, clickhouseBranchId });
    const answer = await askOpenAIAboutSales({ question, snapshot });
    return `คำถาม: ${question}\n\n${answer}`;
  }

  return `ยังไม่รองรับคำสั่ง \`${commandName}\``;
};

const processDeferredInteraction = async (interaction) => {
  try {
    const content = await processCommand(interaction);
    await sendDiscordFollowup({
      applicationId: interaction?.application_id || DISCORD_APPLICATION_ID,
      interactionToken: interaction?.token,
      content
    });
  } catch (error) {
    await sendDiscordFollowup({
      applicationId: interaction?.application_id || DISCORD_APPLICATION_ID,
      interactionToken: interaction?.token,
      content: `เกิดข้อผิดพลาด: ${error?.message || 'unknown error'}`
    }).catch(() => {});
  }
};

export const handleInteraction = async (req, res, next) => {
  try {
    const rawBodyBuffer = req.body;
    const rawBody = Buffer.isBuffer(rawBodyBuffer)
      ? rawBodyBuffer.toString('utf8')
      : '';

    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const validSignature = verifyDiscordSignature({
      timestamp,
      signature,
      rawBody
    });

    if (!validSignature) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Discord signature'
      });
    }

    let interaction = null;
    try {
      interaction = JSON.parse(rawBody);
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid interaction payload'
      });
    }

    // Discord PING
    if (interaction?.type === 1) {
      return res.json({ type: 1 });
    }

    // Application Command
    if (interaction?.type === 2) {
      res.json({
        type: 5,
        data: { flags: 64 }
      });

      setImmediate(() => {
        processDeferredInteraction(interaction).catch(() => {});
      });
      return;
    }

    return res.json({
      type: 4,
      data: {
        content: 'ไม่รองรับ interaction ประเภทนี้',
        flags: 64
      }
    });
  } catch (error) {
    next(error);
  }
};

