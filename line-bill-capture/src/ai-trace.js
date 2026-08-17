// บันทึกร่องรอยการอ่านรูปของ AI ทีละครั้ง (JSONL วันละไฟล์)
//
// ทำไมต้องมี: เวลา AI ตัดสินผิด เดิมสืบย้อนไม่ได้เลยว่าตอนนั้นเห็นอะไรและตอบอะไร
// เก็บไว้แล้วตอบคำถามได้ว่า "ทำไมบิลใบนี้ถึงอ่านยอดไม่ออก" หรือ "รูปนี้ล้มเหลวเพราะอะไร"
//
// ตั้งใจให้เบาและไม่ล้ม: append อย่างเดียว ไม่ค้าง event loop และถ้าเขียนไม่ได้ก็เงียบ
// การอ่านรูปต้องไม่พังเพราะเขียน log ไม่ได้
//
// ปิดได้ด้วย AI_TRACE_ENABLED=0

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './db.js';

const enabled = () => String(process.env.AI_TRACE_ENABLED ?? '1').trim() !== '0';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const bangkokDate = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

export const traceDir = () => path.join(getDataDir(), 'ai-trace');
export const tracePath = (ms = Date.now()) => path.join(traceDir(), `${bangkokDate(ms)}.jsonl`);

// ตัดข้อความยาวก่อนเก็บ ไม่ให้ไฟล์บวมและไม่ให้ raw OCR ทั้งหน้าไหลลง log
const clip = (value, max = 200) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const traceAiRun = (entry = {}) => {
  if (!enabled()) return;
  try {
    const now = Date.now();
    const line = JSON.stringify({ ts: new Date(now).toISOString(), ...entry });
    fs.mkdirSync(traceDir(), { recursive: true });
    fs.appendFileSync(tracePath(now), `${line}\n`);
  } catch {
    // เขียน trace ไม่ได้ ไม่ใช่เหตุให้การอ่านรูปล้ม
  }
};

export const traceAnalysis = ({ item, config, analysis, durationMs, contextCounts }) => {
  const usage = analysis?._usage || {};
  traceAiRun({
    event: 'analysis',
    item_id: Number(item?.id) || null,
    source_id: item?.source_id || null,
    provider: config?.provider || null,
    model: config?.model || null,
    duration_ms: Math.round(Number(durationMs) || 0),
    tokens: {
      input: Number(usage.input_tokens || 0),
      cached: Number(usage.cached_input_tokens || 0),
      output: Number(usage.output_tokens || 0),
      total: Number(usage.total_tokens || 0)
    },
    context: {
      nearby_text: Number(contextCounts?.nearbyText || 0),
      conversation: Number(contextCounts?.conversation || 0),
      learning_examples: Number(contextCounts?.learningExamples || 0)
    },
    decision: {
      category: analysis?.category ?? null,
      document_class: analysis?.document_class ?? null,
      bill_total_value: analysis?.bill_total_value ?? null,
      slip_amount_value: analysis?.slip_amount_value ?? null,
      announced_amount: analysis?.announced_amount ?? null,
      amount_conflict: Boolean(analysis?.amount_conflict),
      payment_role: analysis?.payment_role ?? null,
      confidence: analysis?.confidence ?? null,
      vendor_name: clip(analysis?.vendor_name, 80) || null,
      summary: clip(analysis?.summary, 160) || null
    }
  });
};

export const traceFailure = ({ item, config, error, failure, durationMs }) => {
  traceAiRun({
    event: 'failure',
    item_id: Number(item?.id) || null,
    source_id: item?.source_id || null,
    provider: config?.provider || null,
    model: config?.model || null,
    duration_ms: Math.round(Number(durationMs) || 0),
    attempt: Number(item?.ai_attempt_count || 0) + 1,
    error_kind: failure?.errorKind || null,
    retryable: Boolean(failure?.nextRetryAt),
    message: clip(error?.message, 240)
  });
};
