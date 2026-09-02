// Agent #3 — สรุปงานค้างตอนเช้าให้ผู้ตรวจสอบ
//
// ขอบเขต: อ่านอย่างเดียว ไม่เขียน DB สักแถว ไม่เปลี่ยนสถานะเอกสาร ไม่จับคู่เงิน
// หน้าที่มันคือ "บอกว่าควรทำอะไรก่อน" ไม่ใช่ "ทำแทน"
//
// การแบ่งงานระหว่างโค้ดกับโมเดล:
// - โค้ดเป็นคนดึง facts และจัดลำดับความสำคัญ (rankFindings) — ส่วนนี้ deterministic
//   เพราะเกณฑ์ว่าอะไรด่วนกว่าอะไรเป็นกติกาธุรกิจ ไม่ควรให้โมเดลเปลี่ยนเองทุกวัน
// - โมเดลเป็นคนเรียบเรียงให้อ่านง่าย และเลือกได้ว่าจะเจาะดูเอกสารใบไหนเพิ่ม
//   ผ่าน tool get_receipt_detail
//
// ถ้าไม่ได้ตั้ง API key หรือเรียกโมเดลไม่สำเร็จ จะคืนข้อความ fallback ที่ยังใช้งานได้จริง
// สรุปตอนเช้าต้องมีทุกวัน ไม่ควรหายไปเพราะ OpenAI ล่ม

import { getPool } from '../db.js';
import { CASHIER_VARIANCE_CONFIRM_THRESHOLD, receiptStatusLabel } from '../domain/receipts.js';
import {
  condenseFindings,
  daysBetween,
  detectMissingFeeds,
  factsForPrompt,
  rankFindings,
  renderFallbackBrief
} from '../domain/morningBrief.js';
import { resolveAgentConfig, runStructuredAgent } from './openai.js';
import { traceAgentRun } from './trace.js';

const OPEN_STATUSES = ['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'];
const OPEN_SETTLEMENT_STATUSES = ['PENDING_EVIDENCE', 'READY_FOR_STATEMENT', 'EXCEPTION'];
// GRAB และบัตรเครดิตได้เงินเข้าช้ากว่าวันขาย ใช้กรอบเดียวกับ isWithinSettlementWindow
const SETTLEMENT_WINDOW_DAYS = 3;

export const morningBriefConfig = () =>
  resolveAgentConfig({
    prefix: 'CASHFLOW_BRIEF',
    defaultModel: 'gpt-5.6-luna',
    defaultEffort: 'medium',
    // งานนี้ output สั้น (ข้อความสรุป) แต่ยังต้องเผื่อ reasoning token
    defaultMaxOutputTokens: 8000
  });

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'sections', 'top_actions'],
  properties: {
    headline: {
      type: 'string',
      description: 'หนึ่งประโยคภาษาไทยบอกภาพรวมของวัน'
    },
    sections: {
      type: 'array',
      description: 'จัดกลุ่มตามความเร่งด่วน เรียงจากด่วนสุด',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'items'],
        properties: {
          heading: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    top_actions: {
      type: 'array',
      description: 'สิ่งที่ควรลงมือทำก่อน ไม่เกิน 3 ข้อ เขียนเป็นประโยคสั่งงานสั้นๆ',
      items: { type: 'string' }
    }
  }
};

const TOOLS = [
  {
    type: 'function',
    name: 'get_receipt_detail',
    description:
      'ดูรายละเอียดเอกสารรับเงินหนึ่งใบ แยกตามช่องทาง เพื่อเจาะดูว่าส่วนต่างมาจากช่องทางไหน ' +
      'ใช้เมื่อเห็นรายการที่ผิดปกติแล้วต้องการบอกผู้ตรวจสอบให้ชัดขึ้นว่าปัญหาอยู่ตรงไหน',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['receipt_id'],
      properties: {
        receipt_id: { type: 'integer', description: 'id ของ daily_receipts' }
      }
    }
  }
];

const INSTRUCTIONS = `คุณคือผู้ช่วยของผู้ตรวจสอบระบบรับเงินหน้าร้าน ร้านส้มตำ 2 สาขา (คันคลอง=KK, สันกำแพง=SK)
หน้าที่ของคุณคือสรุปงานค้างให้ผู้ตรวจสอบอ่านตอนเช้า แล้วบอกว่าควรทำอะไรก่อน

กติกาธุรกิจที่ต้องเข้าใจ:
- เอกสารรับเงินมี 1 ใบต่อสาขาต่อวัน สถานะไล่จาก ยังไม่ส่ง > รอตรวจ > ตรวจแล้ว > ปิดเอกสาร
- ยอดที่แคชเชียร์กรอกเทียบกับยอด POS บวกเงินทอนตอนเช้า ต่างเกิน ${CASHIER_VARIANCE_CONFIRM_THRESHOLD} บาทถือว่าต้องดู
- GRAB และบัตรเครดิตได้เงินเข้าบัญชีช้ากว่าวันขาย 1-3 วัน การที่เงินยังไม่เข้าในวันขายจึงเป็นเรื่องปกติ
  ให้เตือนเฉพาะเมื่อเลยกรอบ 3 วันไปแล้ว
- GRAB ของทั้งสองสาขาเข้าบัญชีกสิกร 030-8-66310-8 บัญชีเดียวกัน เงิน GRAB ของสันกำแพง
  ที่เข้าบัญชีคันคลองไม่ใช่ความผิดปกติ
- เงินโอนเข้าที่ยังไม่มีเจ้าของอาจเป็นเงินมัดจำลูกค้า ไม่ใช่ยอดขายเสมอไป ห้ามสรุปว่าเป็นยอดขาย
- ผลต่างมีสองจุดที่ห้ามเอามาหักล้างกัน: ต่างจากยอดก่อนหัก กับ เงินเข้าจริงต่างจากยอดสุทธิที่ควรได้

วิธีเขียน:
- ภาษาไทย พูดกับผู้ตรวจสอบตรงๆ เหมือนเพื่อนร่วมงานเล่าให้ฟัง ไม่ต้องเป็นทางการ
- ใส่ตัวเลขและวันที่ให้ครบ อย่าเขียนลอยๆ ว่า "มีส่วนต่าง"
- ห้ามเดาสาเหตุที่ข้อมูลไม่ได้บอก ถ้าไม่รู้ให้เขียนว่าต้องไปดูอะไรเพิ่ม
- ห้ามแนะนำให้ปิดเอกสารหรือยืนยันยอด การตัดสินใจนั้นเป็นของคน
- รายการที่ให้มาถูกจัดลำดับความสำคัญมาแล้ว ให้คงลำดับนั้นไว้ อย่าสลับเอง
- ถ้าไม่มีงานค้างเลย ให้บอกสั้นๆ ว่าไม่มี ไม่ต้องหาเรื่องมาเขียนเพิ่ม`;

// ---------------------------------------------------------------------------
// ดึง facts (อ่านอย่างเดียวทั้งหมด)
// ---------------------------------------------------------------------------

export const gatherMorningBriefFacts = async ({ date, pool = getPool() }) => {
  const [branches] = await pool.query(
    'SELECT code, name FROM branches WHERE is_active = TRUE ORDER BY code'
  );

  const [pendingRows] = await pool.query(
    `SELECT dr.id, dr.receipt_date, dr.status, b.code AS branch_code, b.name AS branch_name
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     WHERE dr.status IN (?) AND dr.receipt_date <= ?
     ORDER BY dr.receipt_date ASC, b.code ASC
     LIMIT 50`,
    [OPEN_STATUSES, date]
  );

  const [varianceRows] = await pool.query(
    `SELECT grouped.*
     FROM (
       SELECT dr.id, dr.receipt_date, b.code AS branch_code, b.name AS branch_name,
              dr.cashier_variance_acknowledged_at,
              ROUND(
                COALESCE(SUM(drl.cashier_amount), 0) + COALESCE(MAX(misc.misc_total), 0)
                - dr.gross_sales_expected - dr.morning_change_amount
              , 2) AS variance
       FROM daily_receipts dr
       JOIN branches b ON b.id = dr.branch_id
       LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
       LEFT JOIN (
         SELECT receipt_id, SUM(amount) AS misc_total
         FROM receipt_misc_items GROUP BY receipt_id
       ) misc ON misc.receipt_id = dr.id
       WHERE dr.receipt_date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ?
         AND dr.status <> 'DRAFT'
       GROUP BY dr.id, dr.receipt_date, b.code, b.name,
                dr.cashier_variance_acknowledged_at,
                dr.gross_sales_expected, dr.morning_change_amount
     ) grouped
     WHERE ABS(grouped.variance) >= ?
     ORDER BY ABS(grouped.variance) DESC
     LIMIT 20`,
    [date, date, CASHIER_VARIANCE_CONFIRM_THRESHOLD]
  );

  // เงื่อนไขตรงนี้สำคัญมาก และมาจากการดูข้อมูลจริง:
  //
  // - settlement_source = 'NONE' แปลว่ายังไม่มีหลักฐานอ้างอิง ตัวเลข settlement_variance_amount
  //   ตอนนั้นคือ 0 - ยอดแคชเชียร์ ซึ่งเป็นค่าตั้งต้นของทุกช่องทางที่ยังไม่ถูกตรวจ
  //   ไม่ใช่ส่วนต่างจริง จึงห้ามหยิบมาเตือนว่าเงินขาด
  // - GRAB/บัตรเครดิตได้เงินช้ากว่าวันขาย 1-3 วันเป็นปกติ การรอในกรอบนี้ไม่ใช่ปัญหา
  // - เงินสดไม่ได้ตรวจผ่าน settlement ธนาคาร ความถูกต้องของเงินสดถูกจับด้วย
  //   cashierVariances อยู่แล้ว เอามาซ้ำตรงนี้มีแต่ทำให้สรุปยาวขึ้นเปล่าๆ
  const [settlementRows] = await pool.query(
    `SELECT dr.id AS receipt_id, dr.receipt_date, b.code AS branch_code, b.name AS branch_name,
            pc.code AS channel_code, pc.label AS channel_label,
            rlr.settlement_status, rlr.settlement_source, rlr.exception_category, rlr.exception_note,
            rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount,
            DATEDIFF(?, dr.receipt_date) AS days_waiting
     FROM receipt_line_reconciliations rlr
     JOIN daily_receipt_lines drl ON drl.id = rlr.receipt_line_id
     JOIN daily_receipts dr ON dr.id = drl.receipt_id
     JOIN branches b ON b.id = dr.branch_id
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     WHERE dr.status <> 'CLOSED'
       AND drl.cashier_amount > 0
       AND pc.kind <> 'cash'
       AND dr.receipt_date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND ?
       AND (
         rlr.settlement_status = 'EXCEPTION'
         OR (
           rlr.settlement_source <> 'NONE'
           AND rlr.settlement_status IN (?)
           AND (ABS(rlr.cashier_reference_variance_amount) >= 0.01
                OR ABS(rlr.settlement_variance_amount) >= 0.01)
         )
         OR (
           rlr.settlement_source = 'NONE'
           AND rlr.settlement_status IN (?)
           AND DATEDIFF(?, dr.receipt_date) > ?
         )
       )
     ORDER BY dr.receipt_date ASC
     LIMIT 40`,
    [date, date, date, OPEN_SETTLEMENT_STATUSES, OPEN_SETTLEMENT_STATUSES, date, SETTLEMENT_WINDOW_DAYS]
  );

  const [[orphan]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount,
            MIN(transaction_date) AS oldest_date
     FROM bank_inbox_transactions
     WHERE receipt_line_id IS NULL
       AND auto_match_status = 'PENDING'
       AND transaction_date <= ?`,
    [date]
  );

  const [feedHistory] = await pool.query(
    `SELECT provider, source_date
     FROM bank_inbox_imports
     WHERE source_date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND ?`,
    [date, date]
  );

  const [failedFeeds] = await pool.query(
    `SELECT provider, original_name, error_message
     FROM bank_inbox_imports
     WHERE status = 'FAILED' AND source_date BETWEEN DATE_SUB(?, INTERVAL 3 DAY) AND ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [date, date]
  );

  return {
    date,
    branches: branches.map((row) => ({ code: row.code, name: row.name })),
    pendingReceipts: pendingRows.map((row) => ({
      receiptId: row.id,
      receiptDate: String(row.receipt_date).slice(0, 10),
      status: row.status,
      statusLabel: receiptStatusLabel(row.status),
      branchCode: row.branch_code,
      branchName: row.branch_name,
      daysOverdue: daysBetween(String(row.receipt_date).slice(0, 10), date)
    })),
    cashierVariances: varianceRows.map((row) => ({
      receiptId: row.id,
      receiptDate: String(row.receipt_date).slice(0, 10),
      branchCode: row.branch_code,
      branchName: row.branch_name,
      variance: Number(row.variance || 0),
      acknowledged: Boolean(row.cashier_variance_acknowledged_at)
    })),
    settlementIssues: settlementRows.map((row) => ({
      receiptId: row.receipt_id,
      receiptDate: String(row.receipt_date).slice(0, 10),
      branchCode: row.branch_code,
      branchName: row.branch_name,
      channelCode: row.channel_code,
      channelLabel: row.channel_label,
      settlementStatus: row.settlement_status,
      exceptionCategory: row.exception_category,
      exceptionNote: row.exception_note,
      // ไม่มีหลักฐาน = ตัวเลข variance ไม่มีความหมาย ตัวนี้บอก rankFindings ว่าพิมพ์จำนวนเงินได้ไหม
      hasEvidence: String(row.settlement_source || 'NONE') !== 'NONE',
      daysWaiting: Number(row.days_waiting || 0),
      cashierRefVariance: Number(row.cashier_reference_variance_amount || 0),
      settlementVariance: Number(row.settlement_variance_amount || 0)
    })),
    orphanTransactions: {
      count: Number(orphan?.count || 0),
      totalAmount: Number(orphan?.total_amount || 0),
      oldestDate: orphan?.oldest_date ? String(orphan.oldest_date).slice(0, 10) : null
    },
    bankFeeds: {
      missing: detectMissingFeeds({
        history: feedHistory.map((row) => ({
          provider: row.provider,
          source_date: String(row.source_date).slice(0, 10)
        })),
        targetDate: date
      }),
      failed: failedFeeds.map((row) => ({
        provider: row.provider,
        originalName: row.original_name,
        errorMessage: row.error_message
      }))
    }
  };
};

// tool ให้โมเดลเจาะดูเอกสารเพิ่ม — อ่านอย่างเดียว และคืนเฉพาะตัวเลขที่จำเป็น
const getReceiptDetail = async (pool, receiptId) => {
  const [rows] = await pool.query(
    `SELECT pc.code AS channel_code, pc.label AS channel_label,
            drl.expected_amount, drl.cashier_amount, drl.statement_amount, drl.variance_reason,
            rlr.settlement_status, rlr.settlement_source
     FROM daily_receipt_lines drl
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     WHERE drl.receipt_id = ?
     ORDER BY pc.sort_order ASC`,
    [Number(receiptId)]
  );
  const [misc] = await pool.query(
    'SELECT label, amount FROM receipt_misc_items WHERE receipt_id = ?',
    [Number(receiptId)]
  );
  if (rows.length === 0) return { error: 'ไม่พบเอกสารรับเงินนี้' };
  return {
    receipt_id: Number(receiptId),
    lines: rows.map((row) => ({
      channel: row.channel_label,
      expected: Number(row.expected_amount || 0),
      cashier: Number(row.cashier_amount || 0),
      statement: Number(row.statement_amount || 0),
      settlement_status: row.settlement_status,
      settlement_source: row.settlement_source,
      variance_reason: row.variance_reason
    })),
    misc_items: misc.map((row) => ({ label: row.label, amount: Number(row.amount || 0) }))
  };
};

// ---------------------------------------------------------------------------

export const runMorningBrief = async ({ date, pool = getPool(), config = morningBriefConfig() } = {}) => {
  const startedAt = Date.now();
  const facts = await gatherMorningBriefFacts({ date, pool });
  const allFindings = rankFindings(facts);
  // ยุบก่อนส่งให้โมเดลและก่อนเขียนข้อความ เพื่อให้ทั้งสองทางเห็นชุดเดียวกัน
  const findings = condenseFindings(allFindings);
  const fallbackText = renderFallbackBrief(facts, findings);

  const base = {
    date,
    finding_count: allFindings.length,
    shown_count: findings.length,
    findings,
    facts,
    generated_at: new Date().toISOString()
  };

  if (!config.enabled) {
    traceAgentRun({ agent: 'morning_brief', date, source: 'fallback', reason: 'no_api_key', findings: findings.length });
    return { ...base, source: 'fallback', text: fallbackText, brief: null };
  }

  try {
    const { result, usage, toolTrail, rounds } = await runStructuredAgent({
      config,
      instructions: INSTRUCTIONS,
      input: JSON.stringify(factsForPrompt(facts, findings), null, 2),
      schema: BRIEF_SCHEMA,
      schemaName: 'morning_brief',
      tools: TOOLS,
      maxToolRounds: 4,
      onToolCall: async (name, args) => {
        if (name === 'get_receipt_detail') return getReceiptDetail(pool, args.receipt_id);
        return { error: `unknown tool: ${name}` };
      }
    });

    const text = [
      result.headline,
      '',
      ...result.sections.flatMap((section) => [
        `${section.heading}:`,
        ...section.items.map((item) => `- ${item}`),
        ''
      ]),
      result.top_actions.length > 0 ? 'ทำก่อน:' : '',
      ...result.top_actions.map((action, index) => `${index + 1}. ${action}`)
    ].filter((line) => line !== undefined).join('\n').trim();

    traceAgentRun({
      agent: 'morning_brief',
      date,
      source: 'ai',
      model: config.model,
      effort: config.reasoningEffort,
      findings: findings.length,
      rounds,
      tools: toolTrail,
      usage,
      duration_ms: Date.now() - startedAt,
      summary: result.headline
    });

    return { ...base, source: 'ai', text, brief: result, usage, model: config.model };
  } catch (error) {
    // AI ล้มไม่ใช่เหตุให้ผู้ตรวจสอบไม่ได้สรุปตอนเช้า — ตกไปใช้ข้อความ deterministic
    traceAgentRun({
      agent: 'morning_brief',
      date,
      source: 'fallback',
      reason: 'ai_error',
      error: String(error?.message || error),
      findings: findings.length,
      duration_ms: Date.now() - startedAt
    });
    return { ...base, source: 'fallback', text: fallbackText, brief: null, error: String(error?.message || error) };
  }
};
