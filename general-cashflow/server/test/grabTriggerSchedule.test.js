import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const schedule = fs.readFileSync(new URL('../../google-apps-script/GrabTriggerSchedule.gs', import.meta.url), 'utf8');
const standalone = fs.readFileSync(new URL('../../google-apps-script/GrabGmailImport.gs', import.meta.url), 'utf8');
const fixture = ({ failCreate = 0, busy = false } = {}) => {
  const make = (id, handler, settings = {}) => ({ id, handler, settings,
    getUniqueId: () => id, getHandlerFunction: () => handler });
  let triggers = [make('grab-old', 'importGrabReports'), make('bank-a', 'importKrungsriReports'),
    make('bank-b', 'importScbBusinessAnywhereReports'), make('bank-c', 'importKplusShopReports'),
    make('bank-d', 'importKrungthaiBusinessReports')];
  const deleted = [], created = [], logs = [];
  let calls = 0, releases = 0;
  const context = vm.createContext({
    console: { log: (line) => logs.push(JSON.parse(line)) },
    GmailApp: new Proxy({}, { get() { throw new Error('Setup must not use Gmail quota'); } }),
    LockService: { getScriptLock: () => ({ tryLock: () => !busy, releaseLock: () => releases++ }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (trigger) => { deleted.push(trigger.id); triggers = triggers.filter((t) => t.id !== trigger.id); },
      newTrigger: (handler) => {
        const settings = {};
        const builder = {
          timeBased() { return this; }, atHour(hour) { settings.hour = hour; return this; },
          nearMinute(minute) { settings.minute = minute; return this; },
          everyDays(days) { settings.days = days; return this; },
          inTimezone(zone) { settings.timezone = zone; return this; },
          everyMinutes() { throw new Error('Must not restore five-minute Grab imports'); },
          create() {
            if (++calls === failCreate) throw new Error('Injected setup failure');
            const trigger = make('new-' + calls, handler, settings);
            created.push(trigger); triggers.push(trigger); return trigger;
          }
        };
        return builder;
      }
    }
  });
  vm.runInContext(schedule, context);
  return { context, deleted, created, logs, triggers: () => triggers, releases: () => releases };
};

test('Grab replacement uses midnight/noon Bangkok only and preserves four unrelated trigger IDs', () => {
  const f = fixture(); const result = f.context.createGrabTwiceDailyTriggers();
  assert.deepEqual(f.created.map((t) => t.settings), [
    { hour: 0, minute: 0, days: 1, timezone: 'Asia/Bangkok' },
    { hour: 12, minute: 0, days: 1, timezone: 'Asia/Bangkok' }
  ]);
  assert.deepEqual(f.deleted, ['grab-old']);
  assert.deepEqual(f.triggers().filter((t) => t.handler !== 'importGrabReports').map((t) => t.id),
    ['bank-a', 'bank-b', 'bank-c', 'bank-d']);
  assert.equal(f.triggers().length, 6); assert.equal(result.grabTriggerCount, 2);
  assert.equal(result.approximateMinuteTolerance, 15); assert.equal(f.releases(), 1);
});

test('repeating the setup leaves exactly two Grab triggers and never touches another handler', () => {
  const f = fixture(); f.context.createGrabTwiceDailyTriggers(); f.context.createGrabTwiceDailyTriggers();
  assert.equal(f.triggers().filter((t) => t.handler === 'importGrabReports').length, 2);
  assert.ok(f.deleted.every((id) => id === 'grab-old' || id.startsWith('new-')));
  assert.equal(f.triggers().filter((t) => t.handler !== 'importGrabReports').length, 4);
});

test('failure while creating replacements keeps the original schedule and removes its partial replacement', () => {
  const f = fixture({ failCreate: 2 });
  assert.throws(() => f.context.createGrabTwiceDailyTriggers(), /SETUP_FAILED_READ_TRIGGERS/);
  assert.ok(f.triggers().some((t) => t.id === 'grab-old'));
  assert.equal(f.triggers().length, 5); assert.deepEqual(f.deleted, ['new-1']);
  assert.equal(f.releases(), 1);
});

test('busy setup changes nothing and the compatibility name delegates to the daily schedule', () => {
  const f = fixture({ busy: true });
  assert.throws(() => f.context.createGrabTwiceDailyTriggers(), /GRAB_SCHEDULE_BUSY/);
  assert.equal(f.created.length, 0); assert.equal(f.deleted.length, 0);
  const g = fixture(); vm.runInContext(standalone, g.context);
  g.context.createGrabFiveMinuteTrigger();
  assert.deepEqual(g.created.map((t) => t.settings.hour), [0, 12]);
});
