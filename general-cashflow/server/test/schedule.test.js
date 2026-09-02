import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bangkokDateString,
  briefTargetDate,
  ensureScheduledMorningBrief,
  msUntilNextRun,
  parseScheduleTime,
  scheduleHasPassedToday
} from '../src/agents/schedule.js';

test('schedule time accepts HH:MM and rejects anything else', () => {
  assert.deepEqual(parseScheduleTime('07:00'), { hour: 7, minute: 0 });
  assert.deepEqual(parseScheduleTime('7:30'), { hour: 7, minute: 30 });
  assert.deepEqual(parseScheduleTime('23:59'), { hour: 23, minute: 59 });
  for (const bad of ['', '  ', 'off', 'OFF', '0', 'false', '24:00', '07:60', 'เช้า', '0700']) {
    assert.equal(parseScheduleTime(bad), null, `should reject: ${bad}`);
  }
});

// container ของ Railway เป็น UTC เวลาที่ตั้งไว้ต้องหมายถึงเวลาไทยเสมอ
test('the schedule fires at Thai local time, not container time', () => {
  // 2026-08-17T00:00:00Z = 07:00 เวลาไทยพอดี
  const sevenAmThai = Date.parse('2026-08-17T00:00:00Z');
  assert.equal(msUntilNextRun({ hour: 7, minute: 0 }, sevenAmThai + 1000), 24 * 3600000 - 1000);

  // 06:00 เวลาไทย ต้องเหลืออีก 1 ชั่วโมงถึง 07:00
  const sixAmThai = Date.parse('2026-08-16T23:00:00Z');
  assert.equal(msUntilNextRun({ hour: 7, minute: 0 }, sixAmThai), 3600000);
});

test('a time already past today rolls over to tomorrow', () => {
  const eightAmThai = Date.parse('2026-08-17T01:00:00Z');
  const delay = msUntilNextRun({ hour: 7, minute: 0 }, eightAmThai);
  assert.equal(delay, 23 * 3600000);
});

test('a sleeping service recognizes that the Thai schedule already passed', () => {
  const schedule = { hour: 7, minute: 0 };
  assert.equal(scheduleHasPassedToday(schedule, Date.parse('2026-08-16T23:59:00Z')), false);
  assert.equal(scheduleHasPassedToday(schedule, Date.parse('2026-08-17T00:04:00Z')), true);
});

test('catch-up creates only a missing brief after the scheduled time', async () => {
  const schedule = { hour: 7, minute: 0 };
  const nowMs = Date.parse('2026-08-17T00:04:00Z');
  const calls = [];
  const generated = await ensureScheduledMorningBrief({
    schedule,
    nowMs,
    generatedBy: 'test-catch-up',
    load: async ({ date }) => { calls.push(['load', date]); return null; },
    generate: async ({ date, generatedBy }) => {
      calls.push(['generate', date, generatedBy]);
      return { date, source: 'fallback', finding_count: 0 };
    }
  });

  assert.equal(generated.status, 'generated');
  assert.deepEqual(calls, [
    ['load', '2026-08-16'],
    ['generate', '2026-08-16', 'test-catch-up']
  ]);

  const cached = await ensureScheduledMorningBrief({
    schedule,
    nowMs,
    load: async () => ({ date: '2026-08-16' }),
    generate: async () => { throw new Error('must not generate twice'); }
  });
  assert.equal(cached.status, 'cached');
});

test('the brief targets yesterday in Thai time, including across UTC midnight', () => {
  // 07:00 ของวันที่ 17 เวลาไทย -> สรุปของวันที่ 16
  assert.equal(briefTargetDate(Date.parse('2026-08-17T00:00:00Z')), '2026-08-16');
  // 23:30 UTC ของวันที่ 16 = 06:30 เวลาไทยของวันที่ 17 -> ยังต้องเป็นวันที่ 16
  assert.equal(briefTargetDate(Date.parse('2026-08-16T23:30:00Z')), '2026-08-16');
  assert.equal(bangkokDateString(Date.parse('2026-08-16T23:30:00Z')), '2026-08-17');
});
