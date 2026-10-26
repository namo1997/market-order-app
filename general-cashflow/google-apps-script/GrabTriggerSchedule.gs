/** Explicit setup only. This function does not call Gmail or run an import. */
function createGrabTwiceDailyTriggers() {
  const handler = 'importGrabReports';
  const timezone = 'Asia/Bangkok';
  const hours = [0, 12];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('GRAB_SCHEDULE_BUSY');
  try {
    const before = ScriptApp.getProjectTriggers();
    const previous = before.filter((trigger) => trigger.getHandlerFunction() === handler);
    const otherIds = before.filter((trigger) => trigger.getHandlerFunction() !== handler)
      .map((trigger) => trigger.getUniqueId()).sort();
    const created = [];
    try {
      // Create both replacements before removing the old Grab schedule.
      hours.forEach((hour) => {
        created.push(ScriptApp.newTrigger(handler).timeBased().atHour(hour)
          .nearMinute(0).everyDays(1).inTimezone(timezone).create());
      });
      previous.forEach((trigger) => ScriptApp.deleteTrigger(trigger));
    } catch {
      // Remove only replacements created by this invocation. Read back before retry.
      created.forEach((trigger) => {
        try { ScriptApp.deleteTrigger(trigger); } catch { /* inspect actual triggers */ }
      });
      throw new Error('GRAB_SCHEDULE_SETUP_FAILED_READ_TRIGGERS_BEFORE_RETRY');
    }
    const after = ScriptApp.getProjectTriggers();
    const currentGrab = after.filter((trigger) => trigger.getHandlerFunction() === handler);
    const currentOtherIds = after.filter((trigger) => trigger.getHandlerFunction() !== handler)
      .map((trigger) => trigger.getUniqueId()).sort();
    if (currentGrab.length !== 2 || JSON.stringify(otherIds) !== JSON.stringify(currentOtherIds)) {
      throw new Error('GRAB_SCHEDULE_READBACK_MISMATCH');
    }
    const summary = {
      handler, timezone, hours, nearMinute: 0, approximateMinuteTolerance: 15,
      createdTriggerIds: created.map((trigger) => trigger.getUniqueId()),
      removedTriggerIds: previous.map((trigger) => trigger.getUniqueId()),
      grabTriggerCount: currentGrab.length, otherTriggersUnchanged: true
    };
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
}
