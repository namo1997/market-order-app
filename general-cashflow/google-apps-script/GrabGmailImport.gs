/**
 * Candidate only: copy this file, GrabTriggerSchedule.gs AND monthly-daily-sheet-sync/src/GrabInboxRuntime.js
 * after release approval. Saving live Head changes the existing time trigger.
 * Credentials stay in Script Properties or the existing live CONFIG; never paste
 * a credential into this source. No install/create-trigger function is needed
 * when replacing an already scheduled importGrabReports implementation.
 */
const GRAB_CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/grab',
  TOKEN_PROPERTY: 'CASHFLOW_GMAIL_INBOX_TOKEN',
  DONE_LABEL: 'Cashflow/Imported Grab',
  SEARCH: 'from:no-reply@grab.com has:attachment'
};

function importGrabReports() {
  return runGrabInboxImport_(GRAB_CONFIG);
}

// Compatibility name: never restore the former five-minute Grab schedule.
function createGrabFiveMinuteTrigger() {
  return createGrabTwiceDailyTriggers();
}

function getOrCreateGrabLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
