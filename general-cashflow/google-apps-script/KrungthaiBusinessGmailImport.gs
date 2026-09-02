/**
 * Forwards Krungthai Business historical-statement ZIP files to General Cashflow.
 * Set IMPORT_TOKEN to the same CASHFLOW_GMAIL_INBOX_TOKEN configured in Railway.
 */
const KRUNGTHAI_CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/krungthai-business',
  IMPORT_TOKEN: 'PASTE_CASHFLOW_GMAIL_INBOX_TOKEN_HERE',
  DONE_LABEL: 'Cashflow/Imported Krungthai',
  SEARCH: 'from:noreply@krungthai.com has:attachment filename:zip newer_than:45d'
};

function importKrungthaiBusinessReports() {
  const doneLabel = getOrCreateKrungthaiLabel_(KRUNGTHAI_CONFIG.DONE_LABEL);
  const properties = PropertiesService.getScriptProperties();
  const threads = GmailApp.search(KRUNGTHAI_CONFIG.SEARCH, 0, 50);

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!/noreply@krungthai\.com/i.test(message.getFrom())) continue;
      const importKey = `cashflow:krungthai:${message.getId()}`;
      if (properties.getProperty(importKey)) continue;

      const files = message
        .getAttachments({ includeInlineImages: false, includeAttachments: true })
        .filter((attachment) => /\.zip$/i.test(attachment.getName()));
      if (files.length === 0) continue;

      for (const file of files) {
        const response = UrlFetchApp.fetch(KRUNGTHAI_CONFIG.API_URL, {
          method: 'post',
          headers: { Authorization: `Bearer ${KRUNGTHAI_CONFIG.IMPORT_TOKEN}` },
          payload: {
            file: file.copyBlob().setName(file.getName()),
            message_id: message.getId(),
            source_date: Utilities.formatDate(message.getDate(), 'Asia/Bangkok', 'yyyy-MM-dd'),
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
      properties.setProperty(importKey, new Date().toISOString());
    }
    thread.addLabel(doneLabel);
  }
}

function createKrungthaiBusinessFiveMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importKrungthaiBusinessReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importKrungthaiBusinessReports').timeBased().everyMinutes(5).create();
}

function getOrCreateKrungthaiLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
