/** Forwards K SHOP daily settlement emails to General Cashflow. */
const KPLUS_SHOP_CONFIG = {
  API_URL: 'https://general-cashflow-production.up.railway.app/api/inbox-imports/kplus-shop',
  IMPORT_TOKEN: 'PASTE_CASHFLOW_GMAIL_INBOX_TOKEN_HERE',
  DONE_LABEL: 'Cashflow/Imported KSHOP',
  SEARCH: 'from:KPLUSSHOP@kasikornbank.com newer_than:45d'
};

function importKplusShopReports() {
  const doneLabel = getOrCreateKplusLabel_(KPLUS_SHOP_CONFIG.DONE_LABEL);
  const properties = PropertiesService.getScriptProperties();
  const threads = GmailApp.search(KPLUS_SHOP_CONFIG.SEARCH, 0, 50);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!/KPLUSSHOP@kasikornbank\.com/i.test(message.getFrom())) continue;
      const importKey = `cashflow:kplus:${message.getId()}`;
      if (properties.getProperty(importKey)) continue;
      const body = message.getPlainBody();
      const merchantId = body.match(/รหัสร้านค้า\s*:\s*(KB\d+)/i)?.[1];
      const amount = body.match(/ยอดเงินจำนวน\s*\(บาท\)\s*:\s*([\d,]+\.\d{2})/i)?.[1];
      if (!merchantId || !amount) continue;
      const saleDate = new Date(message.getDate().getTime() - 24 * 60 * 60 * 1000);
      const response = UrlFetchApp.fetch(KPLUS_SHOP_CONFIG.API_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${KPLUS_SHOP_CONFIG.IMPORT_TOKEN}` },
        payload: JSON.stringify({
          message_id: message.getId(),
          source_date: Utilities.formatDate(saleDate, 'Asia/Bangkok', 'yyyy-MM-dd'),
          sender_email: message.getFrom(),
          subject: message.getSubject(),
          body,
          merchant_id: merchantId,
          amount
        }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) throw new Error(`นำเข้า K SHOP ไม่สำเร็จ (${code}): ${response.getContentText()}`);
      // Track the individual message. A Gmail label applies to the whole thread,
      // which can contain later daily settlements with the same subject.
      properties.setProperty(importKey, new Date().toISOString());
    }
    thread.addLabel(doneLabel);
  }
}

function createKplusShopFiveMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importKplusShopReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importKplusShopReports').timeBased().everyMinutes(5).create();
}

function getOrCreateKplusLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
