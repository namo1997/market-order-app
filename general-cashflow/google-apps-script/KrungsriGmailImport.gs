/**
 * One-time setup
 * 1. Set API_URL and IMPORT_TOKEN below.
 * 2. Run createFiveMinuteTrigger once and approve Gmail + external-request access.
 * 3. Run importKrungsriReports once to test the connection.
 */
const CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/krungsri',
  IMPORT_TOKEN: 'PASTE_CASHFLOW_GMAIL_INBOX_TOKEN_HERE',
  DONE_LABEL: 'Cashflow/Imported Krungsri',
  SEARCH: 'from:Krungsri.BizMungMee@krungsri.com has:attachment -label:"Cashflow/Imported Krungsri"'
};

function importKrungsriReports() {
  const doneLabel = getOrCreateLabel_(CONFIG.DONE_LABEL);
  const threads = GmailApp.search(CONFIG.SEARCH, 0, 50);

  for (const thread of threads) {
    if (thread.getLabels().some((label) => label.getName() === CONFIG.DONE_LABEL)) continue;

    for (const message of thread.getMessages()) {
      if (message.getFrom().indexOf('Krungsri.BizMungMee@krungsri.com') === -1) continue;
      const zipFiles = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
        .filter((attachment) => /\.zip$/i.test(attachment.getName()));
      if (zipFiles.length === 0) continue;

      for (const zipFile of zipFiles) {
        const response = UrlFetchApp.fetch(CONFIG.API_URL, {
          method: 'post',
          headers: { Authorization: `Bearer ${CONFIG.IMPORT_TOKEN}` },
          payload: {
            file: zipFile.copyBlob().setName(zipFile.getName()),
            message_id: message.getId(),
            source_date: reportDate_(message.getSubject(), message.getDate()),
            sender_email: message.getFrom(),
            subject: message.getSubject()
          },
          muteHttpExceptions: true
        });
        const code = response.getResponseCode();
        if (code < 200 || code >= 300) {
          throw new Error(`นำเข้า ${zipFile.getName()} ไม่สำเร็จ (${code}): ${response.getContentText()}`);
        }
      }
    }
    // GmailMessage does not support getLabels()/addLabel(); labels belong to GmailThread.
    thread.addLabel(doneLabel);
  }
}

function createFiveMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importKrungsriReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importKrungsriReports').timeBased().everyMinutes(5).create();
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function reportDate_(subject, fallbackDate) {
  const matched = String(subject).match(/(20\d{2})(\d{2})(\d{2})/);
  if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  return Utilities.formatDate(fallbackDate, 'Asia/Bangkok', 'yyyy-MM-dd');
}
