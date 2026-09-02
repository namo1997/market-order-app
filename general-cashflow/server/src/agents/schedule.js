// ตัวตั้งเวลาสร้างสรุปตอนเช้า
//
// ทำไมไม่ใช้ Railway cron: cron ของ Railway รันเป็น process แยกซึ่งจะบูตแอปทั้งตัวใหม่
// งานนี้เบามาก (query ไม่กี่ครั้ง + เรียกโมเดล 1 ครั้ง) จึงคุ้มกว่าที่จะตั้งเวลาในตัวแอปเอง
//
// เวลาอ้างอิงเป็นเวลาไทยเสมอ ไม่ขึ้นกับ timezone ของ container
// ตั้งเวลาด้วย CASHFLOW_BRIEF_SCHEDULE_HHMM เช่น 07:00 ปล่อยว่างหรือ off = ไม่ตั้งเวลา

import { runMorningBrief } from './morningBrief.js';
import { loadMorningBrief, saveMorningBrief } from './morningBriefStore.js';
import { traceAgentRun } from './trace.js';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export const bangkokNow = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS);

export const bangkokDateString = (ms = Date.now()) => bangkokNow(ms).toISOString().slice(0, 10);

// สรุปตอนเช้าคือการทบทวนงานของ "เมื่อวาน" ตามเวลาไทย
export const briefTargetDate = (ms = Date.now()) =>
  bangkokNow(ms - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const parseScheduleTime = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'false' || raw === '0') return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};

// อีกกี่มิลลิวินาทีจะถึงเวลาที่ตั้งไว้ครั้งถัดไป (ตามเวลาไทย)
export const msUntilNextRun = ({ hour, minute }, ms = Date.now()) => {
  const now = bangkokNow(ms);
  const target = new Date(now);
  target.setUTCHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
};

export const scheduleHasPassedToday = ({ hour, minute }, ms = Date.now()) => {
  const now = bangkokNow(ms);
  const target = new Date(now);
  target.setUTCHours(hour, minute, 0, 0);
  return now.getTime() >= target.getTime();
};

export const generateAndStoreBrief = async ({ date = briefTargetDate(), generatedBy = 'schedule' } = {}) => {
  const result = await runMorningBrief({ date });
  await saveMorningBrief({ result, generatedBy });
  return result;
};

export const ensureScheduledMorningBrief = async ({
  schedule,
  nowMs = Date.now(),
  generatedBy = 'schedule',
  load = loadMorningBrief,
  generate = generateAndStoreBrief
} = {}) => {
  if (!schedule || !scheduleHasPassedToday(schedule, nowMs)) return { status: 'not_due' };
  const date = briefTargetDate(nowMs);
  const existing = await load({ date });
  if (existing) return { status: 'cached', date, result: existing };
  const result = await generate({ date, generatedBy });
  return { status: 'generated', date, result };
};

let timer = null;

export const startMorningBriefSchedule = () => {
  const schedule = parseScheduleTime(process.env.CASHFLOW_BRIEF_SCHEDULE_HHMM);
  if (!schedule) return null;

  const scheduleNext = () => {
    const delay = msUntilNextRun(schedule);
    timer = setTimeout(async () => {
      try {
        const outcome = await ensureScheduledMorningBrief({ schedule, generatedBy: 'schedule' });
        if (outcome.status === 'generated') {
          console.log(`[morning-brief] ${outcome.date} source=${outcome.result.source} findings=${outcome.result.finding_count}`);
        }
      } catch (error) {
        // ตั้งเวลาต้องไม่ตายเพราะรอบเดียวพลาด พรุ่งนี้ต้องยังทำงาน
        traceAgentRun({ agent: 'morning_brief', source: 'schedule_error', error: String(error?.message || error) });
        console.error('[morning-brief] failed:', error?.message || error);
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref?.();
    const hours = (delay / 3600000).toFixed(1);
    console.log(`[morning-brief] next run in ${hours}h (${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} เวลาไทย)`);
  };

  // Railway อาจพัก container เมื่อไม่มีผู้ใช้ หากตื่นหลังเวลาที่ตั้งไว้
  // ให้สร้างสรุปที่ขาดทันที โดยตรวจ cache ก่อนเพื่อไม่ให้ทำซ้ำ
  ensureScheduledMorningBrief({ schedule, generatedBy: 'schedule-catch-up' })
    .then((outcome) => {
      if (outcome.status === 'generated') {
        console.log(`[morning-brief] caught up ${outcome.date} source=${outcome.result.source} findings=${outcome.result.finding_count}`);
      }
    })
    .catch((error) => {
      traceAgentRun({ agent: 'morning_brief', source: 'schedule_catch_up_error', error: String(error?.message || error) });
      console.error('[morning-brief] catch-up failed:', error?.message || error);
    });
  scheduleNext();
  return () => clearTimeout(timer);
};
