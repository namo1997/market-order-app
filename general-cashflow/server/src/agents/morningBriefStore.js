// เก็บและอ่านผลสรุปตอนเช้าที่ agent สร้างไว้
//
// ทำไมต้องเก็บ: การสร้างสรุปหนึ่งครั้งใช้เวลา 8-11 วินาที ถ้าให้หน้าจอสร้างใหม่ทุกครั้ง
// ที่มีคนเปิดดู จะช้าและเสียค่า token ซ้ำโดยเปล่าประโยชน์ cron สร้างรอบเดียวตอนเช้า
// แล้วทุกคนอ่านของเดิม
//
// ขอบเขตการเขียน: agent เขียนได้เฉพาะตาราง morning_briefs เท่านั้น
// ไม่แตะ daily_receipts, daily_receipt_lines, receipt_line_reconciliations หรือยอดเงินใดๆ

import { getPool } from '../db.js';

export const saveMorningBrief = async ({ result, generatedBy = 'schedule', pool = getPool() }) => {
  await pool.query(
    `INSERT INTO morning_briefs
       (brief_date, source, model, finding_count, shown_count, brief_text, payload, error_message, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = VALUES(source), model = VALUES(model),
       finding_count = VALUES(finding_count), shown_count = VALUES(shown_count),
       brief_text = VALUES(brief_text), payload = VALUES(payload),
       error_message = VALUES(error_message), generated_by = VALUES(generated_by)`,
    [
      result.date,
      result.source,
      result.model || null,
      Number(result.finding_count || 0),
      Number(result.shown_count || 0),
      result.text || '',
      JSON.stringify({ findings: result.findings || [], brief: result.brief || null, usage: result.usage || null }),
      result.error || null,
      generatedBy
    ]
  );
};

export const loadMorningBrief = async ({ date, pool = getPool() }) => {
  const [rows] = await pool.query(
    `SELECT brief_date, source, model, finding_count, shown_count, brief_text, payload,
            error_message, generated_by, updated_at
     FROM morning_briefs WHERE brief_date = ?`,
    [date]
  );
  const row = rows[0];
  if (!row) return null;

  // mysql2 คืน JSON column มาเป็น object อยู่แล้วในเวอร์ชันนี้ แต่กันไว้เผื่อได้ string
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {});
  return {
    date: String(row.brief_date).slice(0, 10),
    source: row.source,
    model: row.model,
    finding_count: row.finding_count,
    shown_count: row.shown_count,
    text: row.brief_text,
    findings: payload.findings || [],
    brief: payload.brief || null,
    usage: payload.usage || null,
    error: row.error_message || undefined,
    generated_by: row.generated_by,
    cached: true,
    generated_at: row.updated_at
  };
};

export const listMorningBriefs = async ({ limit = 30, pool = getPool() }) => {
  const [rows] = await pool.query(
    `SELECT brief_date, source, model, finding_count, shown_count, generated_by, updated_at
     FROM morning_briefs ORDER BY brief_date DESC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((row) => ({ ...row, brief_date: String(row.brief_date).slice(0, 10) }));
};
