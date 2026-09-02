const GENERAL_CASHFLOW_INBOX = Object.freeze({
  API_BASE_URL: 'https://general-cashflow-production.up.railway.app',
  TOKEN_PROPERTY: 'CASHFLOW_GMAIL_INBOX_TOKEN',
  IMPORT_LOOKBACK_DAYS: 90,
  DONE_LABELS: Object.freeze({
    krungsri: 'Cashflow/Imported Krungsri',
    grab: 'Cashflow/Imported Grab',
    kplus: 'Cashflow/Imported KSHOP',
    scb: 'Cashflow/Imported SCB',
    krungthai: 'Cashflow/Imported Krungthai'
  })
});

/** Runs every inbox connector. One failed bank does not block the other sources. */
function importAllGeneralCashflowInboxReports() {
  const jobs = [
    ['Krungsri', importKrungsriReports],
    ['Grab', importGrabReports],
    ['K SHOP', importKplusShopReports],
    ['SCB Business Anywhere', importScbBusinessAnywhereReports],
    ['Krungthai Business', importKrungthaiBusinessReports]
  ];
  const errors = [];

  jobs.forEach(([name, job]) => {
    try {
      job();
    } catch (error) {
      errors.push(`${name}: ${error.message || error}`);
    }
  });

  if (errors.length) {
    appendGeneralCashflowLog_('INBOX_ERROR', errors.join(' | '));
    throw new Error(errors.join('\n'));
  }
  appendGeneralCashflowLog_('INBOX_SUCCESS', 'ตรวจอีเมลครบทุกแหล่งแล้ว');
}

function installGeneralCashflowInboxTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'importAllGeneralCashflowInboxReports')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importAllGeneralCashflowInboxReports').timeBased().everyMinutes(5).create();
  appendGeneralCashflowLog_('SETUP', 'ติดตั้งการนำเข้า Gmail ทุก 5 นาทีแล้ว');
}

function testGeneralCashflowServerConnection() {
  const response = UrlFetchApp.fetch(`${GENERAL_CASHFLOW_INBOX.API_BASE_URL}/health`, {
    method: 'get',
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`General Cashflow ตอบกลับ ${response.getResponseCode()}: ${response.getContentText()}`);
  }
  return response.getContentText();
}

function importKrungsriReports() {
  importAttachmentReports_({
    source: 'krungsri',
    endpoint: '/api/inbox-imports/krungsri',
    search: `from:Krungsri.BizMungMee@krungsri.com has:attachment newer_than:${GENERAL_CASHFLOW_INBOX.IMPORT_LOOKBACK_DAYS}d`,
    sender: /Krungsri\.BizMungMee@krungsri\.com/i,
    file: /\.zip$/i,
    sourceDate: (message) => reportDateFromSubject_(message.getSubject(), message.getDate())
  });
}

function importGrabReports() {
  importAttachmentReports_({
    source: 'grab',
    endpoint: '/api/inbox-imports/grab',
    search: `from:no-reply@grab.com has:attachment newer_than:${GENERAL_CASHFLOW_INBOX.IMPORT_LOOKBACK_DAYS}d`,
    sender: /no-reply@grab\.com/i,
    file: /\.pdf$/i
  });
}

function importScbBusinessAnywhereReports() {
  importAttachmentReports_({
    source: 'scb',
    endpoint: '/api/inbox-imports/scb-business-anywhere',
    search: `from:contact_business@email.scb.co.th has:attachment filename:zip newer_than:${GENERAL_CASHFLOW_INBOX.IMPORT_LOOKBACK_DAYS}d`,
    sender: /contact_business@email\.scb\.co\.th/i,
    file: /^HISTSTMT.*\.zip$/i
  });
}

function importKrungthaiBusinessReports() {
  importAttachmentReports_({
    source: 'krungthai',
    endpoint: '/api/inbox-imports/krungthai-business',
    search: `from:noreply@krungthai.com has:attachment filename:zip newer_than:${GENERAL_CASHFLOW_INBOX.IMPORT_LOOKBACK_DAYS}d`,
    sender: /noreply@krungthai\.com/i,
    file: /\.zip$/i
  });
}

function importKplusShopReports() {
  const source = 'kplus';
  const threads = GmailApp.search(
    `from:KPLUSSHOP@kasikornbank.com newer_than:${GENERAL_CASHFLOW_INBOX.IMPORT_LOOKBACK_DAYS}d`,
    0,
    100
  );

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      if (!/KPLUSSHOP@kasikornbank\.com/i.test(message.getFrom())) return;
      const importKey = inboxImportKey_(source, message.getId(), 'email-body');
      if (PropertiesService.getScriptProperties().getProperty(importKey)) return;

      const body = message.getPlainBody();
      const merchantMatch = body.match(/รหัสร้านค้า\s*:\s*(KB\d+)/i);
      const amountMatch = body.match(/ยอดเงินจำนวน\s*\(บาท\)\s*:\s*([\d,]+(?:\.\d{1,2})?)/i);
      if (!merchantMatch || !amountMatch) return;

      const saleDate = new Date(message.getDate().getTime() - 24 * 60 * 60 * 1000);
      postInboxJson_('/api/inbox-imports/kplus-shop', {
        message_id: message.getId(),
        source_date: Utilities.formatDate(saleDate, 'Asia/Bangkok', 'yyyy-MM-dd'),
        sender_email: message.getFrom(),
        subject: message.getSubject(),
        body,
        merchant_id: merchantMatch[1],
        amount: amountMatch[1]
      });
      markInboxImported_(importKey);
    });
    thread.addLabel(getOrCreateInboxLabel_(GENERAL_CASHFLOW_INBOX.DONE_LABELS[source]));
  });
}

function importAttachmentReports_(config) {
  const properties = PropertiesService.getScriptProperties();
  const threads = GmailApp.search(config.search, 0, 100);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      if (!config.sender.test(message.getFrom())) return;
      const files = message
        .getAttachments({ includeInlineImages: false, includeAttachments: true })
        .filter((attachment) => config.file.test(attachment.getName()));

      files.forEach((file) => {
        const importKey = inboxImportKey_(config.source, message.getId(), file.getName());
        if (properties.getProperty(importKey)) return;
        postInboxFile_(config.endpoint, file, message, config.sourceDate);
        markInboxImported_(importKey);
      });
    });
    thread.addLabel(getOrCreateInboxLabel_(GENERAL_CASHFLOW_INBOX.DONE_LABELS[config.source]));
  });
}

function postInboxFile_(endpoint, file, message, sourceDateResolver) {
  const payload = {
    file: file.copyBlob().setName(file.getName()),
    message_id: message.getId(),
    sender_email: message.getFrom(),
    subject: message.getSubject()
  };
  if (sourceDateResolver) payload.source_date = sourceDateResolver(message);

  const response = UrlFetchApp.fetch(`${GENERAL_CASHFLOW_INBOX.API_BASE_URL}${endpoint}`, {
    method: 'post',
    headers: inboxAuthorizationHeader_(),
    payload,
    muteHttpExceptions: true
  });
  assertInboxResponse_(response, file.getName());
}

function postInboxJson_(endpoint, payload) {
  const response = UrlFetchApp.fetch(`${GENERAL_CASHFLOW_INBOX.API_BASE_URL}${endpoint}`, {
    method: 'post',
    contentType: 'application/json',
    headers: inboxAuthorizationHeader_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  assertInboxResponse_(response, endpoint);
}

function inboxAuthorizationHeader_() {
  const token = PropertiesService.getScriptProperties().getProperty(GENERAL_CASHFLOW_INBOX.TOKEN_PROPERTY);
  if (!token) {
    throw new Error(`ยังไม่ได้ตั้ง Script Property: ${GENERAL_CASHFLOW_INBOX.TOKEN_PROPERTY}`);
  }
  return { Authorization: `Bearer ${token}` };
}

function assertInboxResponse_(response, itemName) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`นำเข้า ${itemName} ไม่สำเร็จ (${code}): ${response.getContentText()}`);
  }
}

function inboxImportKey_(source, messageId, itemName) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${source}:${messageId}:${itemName}`,
    Utilities.Charset.UTF_8
  );
  const hash = digest.map((byte) => (`0${(byte + 256).toString(16)}`).slice(-2)).join('');
  return `cashflow:inbox:${source}:${hash}`;
}

function markInboxImported_(key) {
  PropertiesService.getScriptProperties().setProperty(key, new Date().toISOString());
}

function getOrCreateInboxLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function reportDateFromSubject_(subject, fallbackDate) {
  const matched = String(subject).match(/(20\d{2})(\d{2})(\d{2})/);
  if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  return Utilities.formatDate(fallbackDate, 'Asia/Bangkok', 'yyyy-MM-dd');
}

// Compatibility wrappers for trigger names used by the previous separate scripts.
function createFiveMinuteTrigger() { installGeneralCashflowInboxTrigger(); }
function createGrabFiveMinuteTrigger() { installGeneralCashflowInboxTrigger(); }
function createKplusShopFiveMinuteTrigger() { installGeneralCashflowInboxTrigger(); }
function createScbBusinessAnywhereFiveMinuteTrigger() { installGeneralCashflowInboxTrigger(); }
function createKrungthaiBusinessFiveMinuteTrigger() { installGeneralCashflowInboxTrigger(); }
