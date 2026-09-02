/**
 * Forwards each daily GrabFood PDF to General Cashflow.
 * Set IMPORT_TOKEN to the same CASHFLOW_GMAIL_INBOX_TOKEN used by the Krungsri script,
 * then run createGrabFiveMinuteTrigger once.
 */
const GRAB_CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/grab',
  IMPORT_TOKEN: 'PASTE_CASHFLOW_GMAIL_INBOX_TOKEN_HERE',
  DONE_LABEL: 'Cashflow/Imported Grab',
  SEARCH: 'from:no-reply@grab.com has:attachment newer_than:45d'
};

function importGrabReports() {
  const doneLabel = getOrCreateGrabLabel_(GRAB_CONFIG.DONE_LABEL);
  const properties = PropertiesService.getScriptProperties();
  const threads = GmailApp.search(GRAB_CONFIG.SEARCH, 0, 50);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!/no-reply@grab\.com/i.test(message.getFrom())) continue;
      const importKey = `cashflow:grab:${message.getId()}`;
      if (properties.getProperty(importKey)) continue;
      const reports = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
        .filter((attachment) => /\.pdf$/i.test(attachment.getName()));
      for (const report of reports) {
        const response = UrlFetchApp.fetch(GRAB_CONFIG.API_URL, {
          method: 'post',
          headers: { Authorization: `Bearer ${GRAB_CONFIG.IMPORT_TOKEN}` },
          payload: {
            file: report.copyBlob().setName(report.getName()),
            message_id: message.getId(),
            sender_email: message.getFrom(),
            subject: message.getSubject()
          },
          muteHttpExceptions: true
        });
        const code = response.getResponseCode();
        if (code < 200 || code >= 300) {
          throw new Error(`นำเข้า ${report.getName()} ไม่สำเร็จ (${code}): ${response.getContentText()}`);
        }
      }
      properties.setProperty(importKey, new Date().toISOString());
    }
    thread.addLabel(doneLabel);
  }
}

function createGrabFiveMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importGrabReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importGrabReports').timeBased().everyMinutes(5).create();
}

function getOrCreateGrabLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
