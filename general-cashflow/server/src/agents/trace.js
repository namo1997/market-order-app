// บันทึกร่องรอยการทำงานของ agent ทีละครั้ง (JSONL วันละไฟล์)
//
// ทำไมต้องมี: เวลา agent เสนอผิด ต้องย้อนดูได้ว่าตอนนั้นเห็น facts อะไร
// เรียก tool อะไรไปบ้าง และตอบอะไรกลับมา ถ้าไม่เก็บไว้จะสืบไม่ได้เลย
//
// ยืมแนวจาก line-bill-capture/src/ai-trace.js: append อย่างเดียว ไม่ค้าง event loop
// และถ้าเขียนไม่ได้ก็เงียบ — งานหลักต้องไม่พังเพราะเขียน log ไม่ได้
//
// ปิดได้ด้วย CASHFLOW_AGENT_TRACE_ENABLED=0

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const enabled = () => String(process.env.CASHFLOW_AGENT_TRACE_ENABLED ?? '1').trim() !== '0';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const bangkokDate = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

export const traceDir = () =>
  process.env.CASHFLOW_AGENT_TRACE_DIR || path.resolve(__dirname, '..', '..', 'agent-trace');

export const tracePath = (ms = Date.now()) => path.join(traceDir(), `${bangkokDate(ms)}.jsonl`);

// ตัดข้อความยาวก่อนเก็บ ไม่ให้ไฟล์บวมและไม่ให้ prompt ทั้งก้อนไหลลง log
const clip = (value, max = 400) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const traceAgentRun = (entry = {}) => {
  if (!enabled()) return;
  try {
    const now = Date.now();
    const line = JSON.stringify({
      ts: new Date(now).toISOString(),
      ...entry,
      error: entry.error ? clip(entry.error) : undefined,
      summary: entry.summary ? clip(entry.summary) : undefined
    });
    fs.mkdirSync(traceDir(), { recursive: true });
    fs.appendFileSync(tracePath(now), `${line}\n`);
  } catch {
    // เขียน trace ไม่ได้ ไม่ใช่เหตุให้ agent ล้ม
  }
};
