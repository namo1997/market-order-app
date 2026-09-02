/** Forwards only current SCB historical-statement ZIP files to General Cashflow. */
const SCB_BIZ_CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/scb-business-anywhere',
  IMPORT_TOKEN: GRAB_CONFIG.IMPORT_TOKEN,
  DONE_LABEL: 'Cashflow/Imported SCB',
  SEARCH: 'from:contact_business@email.scb.co.th has:attachment filename:zip newer_than:45d -label:"Cashflow/Imported SCB"'
};

function importScbBusinessAnywhereReports() {
  const doneLabel = getOrCreateScbLabel_(SCB_BIZ_CONFIG.DONE_LABEL);
  const threads = GmailApp.search(SCB_BIZ_CONFIG.SEARCH, 0, 50);
  for (const thread of threads) {
    if (thread.getLabels().some((label) => label.getName() === SCB_BIZ_CONFIG.DONE_LABEL)) continue;
    for (const message of thread.getMessages()) {
      const files = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
        .filter((attachment) => /^HISTSTMT.*\.zip$/i.test(attachment.getName()));
      for (const file of files) {
        const response = UrlFetchApp.fetch(SCB_BIZ_CONFIG.API_URL, {
          method: 'post',
          headers: { Authorization: `Bearer ${SCB_BIZ_CONFIG.IMPORT_TOKEN}` },
          payload: {
            file: file.copyBlob().setName(file.getName()),
            message_id: message.getId(),
            sender_email: message.getFrom(),
            subject: message.getSubject()
          },
          muteHttpExceptions: true
        });
        const code = response.getResponseCode();
        if (code < 200 || code >= 300) {
          throw new Error(`นำเข้า ${file.getName()} ไม่สำเร็จ (${code}): ${response.getContentText()}`);
        }
      }
    }
    thread.addLabel(doneLabel);
  }
}

function createScbBusinessAnywhereFiveMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importScbBusinessAnywhereReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importScbBusinessAnywhereReports').timeBased().everyMinutes(5).create();
}

function getOrCreateScbLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
