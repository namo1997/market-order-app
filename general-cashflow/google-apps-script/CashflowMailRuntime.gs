/** Incremental, message-level mail intake. Existing tokens and trigger schedules stay in place. */
const CFMAIL_V3_ = Object.freeze({
  VERSION: 3, LOOKBACK_DAYS: 45, OVERLAP_SECONDS: 172800,
  PAGE_SIZE: 100, MAX_MESSAGES: 40, RUN_MS: 180000, POLL_MS: 900000,
  BASE: 'https://general-cashflow-production.up.railway.app',
  SOURCES: {
    grab: { sender: 'no-reply@grab.com', query: 'has:attachment', file: /\.pdf$/i, endpoint: 'grab' },
    kplus: { sender: 'KPLUSSHOP@kasikornbank.com', query: '', endpoint: 'kplus-shop' },
    scb: { sender: 'contact_business@email.scb.co.th', query: 'has:attachment filename:zip', file: /^HISTSTMT.*\.zip$/i, endpoint: 'scb-business-anywhere' },
    krungsri: { sender: 'Krungsri.BizMungMee@krungsri.com', query: 'has:attachment', file: /\.zip$/i, endpoint: 'krungsri' },
    krungthai: { sender: 'noreply@krungthai.com', query: 'has:attachment filename:zip', file: /\.zip$/i, endpoint: 'krungthai-business' }
  }
});

function probeCashflowMailApi() {
  const profile = cfMailGmail_('profile');
  if (String(profile.emailAddress).toLowerCase() !== 'solao.acc@gmail.com') throw Error('MAIL_ACCOUNT_MISMATCH');
  console.log(JSON.stringify({ mailApi: 'READY', account: profile.emailAddress, version: CFMAIL_V3_.VERSION }));
  return { mailApi: 'READY', account: profile.emailAddress };
}

function cashflowMailRun_(source, options) {
  const cfg = CFMAIL_V3_.SOURCES[source];
  if (!cfg) throw Error('MAIL_SOURCE_UNKNOWN');
  const opts = options || {}, now = Date.now(), props = PropertiesService.getScriptProperties();
  const pause = Number(props.getProperty('cashflow:mail:v3:pause-until') || 0);
  if (pause > now) return { source: source, skipped: 'MAIL_QUOTA_BACKOFF', retryAt: pause };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { source: source, skipped: 'LOCK_BUSY' };
  const stateKey = 'cashflow:mail:v3:state:' + source;
  const failurePrefix = 'cashflow:mail:v3:failure:' + source + ':';
  const summary = { source: source, imported: 0, duplicate: 0, skipped: 0, failed: 0, messagesRead: 0, listCalls: 0 };
  try {
    const token = cfMailToken_(source, props);
    let state = cfMailJson_(props.getProperty(stateKey)) || {};
    const all = props.getProperties();
    const retries = Object.keys(all).filter(function (key) {
      const row = key.indexOf(failurePrefix) === 0 && cfMailJson_(all[key]);
      return row && row.state === 'FAILED' && Number(row.nextAttemptAt) <= now;
    }).map(function (key) { return cfMailJson_(all[key]).messageId; });
    if (!opts.force && !state.scan && state.nextPollAt > now && !retries.length) return { source: source, skipped: 'NOT_DUE' };
    const profile = cfMailGmail_('profile');
    if (String(profile.emailAddress).toLowerCase() !== 'solao.acc@gmail.com') throw cfMailError_('MAIL_ACCOUNT_MISMATCH');
    const budget = function () { return summary.messagesRead < (opts.maxMessages || CFMAIL_V3_.MAX_MESSAGES) && Date.now() - now < (opts.runMs || CFMAIL_V3_.RUN_MS); };
    const processOne = function (id) {
      const doneKey = 'cashflow:mail:v3:done:' + source + ':' + id;
      if (props.getProperty(doneKey)) { summary.skipped++; return; }
      const failedKey = failurePrefix + id;
      const previous = cfMailJson_(props.getProperty(failedKey));
      if (previous && previous.state === 'FAILED' && previous.nextAttemptAt > Date.now()) { summary.skipped++; return; }
      summary.messagesRead++;
      try {
        const message = cfMailGmail_('messages/' + encodeURIComponent(id) + '?format=full');
        cfMailProcess_(source, cfg, message, token, props, summary);
        props.setProperty(doneKey, new Date().toISOString());
        if (previous) props.setProperty(failedKey, JSON.stringify(Object.assign({}, previous, { state: 'RESOLVED', resolvedAt: Date.now() })));
      } catch (error) {
        if (error.mailFatal) throw error;
        const attempts = (previous && previous.attempts || 0) + 1;
        props.setProperty(failedKey, JSON.stringify({ messageId: id, state: 'FAILED', code: error.safeCode || 'MAIL_PROCESS_ERROR',
          attempts: attempts, lastFailedAt: Date.now(), nextAttemptAt: Date.now() + Math.min(21600000, 900000 * Math.pow(2, Math.min(attempts - 1, 5))) }));
        summary.failed++;
      }
    };
    for (let i = 0; i < retries.length && budget(); i++) processOne(retries[i]);
    if (!state.scan) {
      const before = Math.floor(now / 1000);
      const after = state.watermark ? Math.max(0, state.watermark - CFMAIL_V3_.OVERLAP_SECONDS) : before - CFMAIL_V3_.LOOKBACK_DAYS * 86400;
      state.scan = { after: after, before: before, pageToken: null, page: null };
      props.setProperty(stateKey, JSON.stringify(state));
    }
    while (budget() && state.scan) {
      const scan = state.scan;
      if (!scan.page) {
        const q = 'from:' + cfg.sender + ' ' + cfg.query + ' after:' + (scan.after - 1) + ' before:' + scan.before;
        const response = cfMailGmail_('messages?maxResults=' + CFMAIL_V3_.PAGE_SIZE + '&q=' + encodeURIComponent(q)
          + (scan.pageToken ? '&pageToken=' + encodeURIComponent(scan.pageToken) : ''));
        summary.listCalls++;
        scan.page = { ids: (response.messages || []).map(function (row) { return row.id; }), index: 0, next: response.nextPageToken || null };
        props.setProperty(stateKey, JSON.stringify(state));
      }
      while (scan.page.index < scan.page.ids.length && budget()) {
        processOne(scan.page.ids[scan.page.index]);
        scan.page.index++;
        props.setProperty(stateKey, JSON.stringify(state));
      }
      if (scan.page.index < scan.page.ids.length) break;
      if (scan.page.next) { scan.pageToken = scan.page.next; scan.page = null; }
      else { state.watermark = scan.before; state.scan = null; state.nextPollAt = Date.now() + CFMAIL_V3_.POLL_MS; }
      props.setProperty(stateKey, JSON.stringify(state));
    }
    const pending = props.getProperties();
    summary.unresolved = Object.keys(pending).filter(function (key) { return key.indexOf(failurePrefix) === 0 && cfMailJson_(pending[key])?.state === 'FAILED'; }).length;
    summary.scanComplete = !state.scan;
    summary.finishedAt = Date.now();
    props.setProperty('cashflow:mail:v3:last:' + source, JSON.stringify(summary));
    console.log(JSON.stringify(summary));
    return summary;
  } finally { lock.releaseLock(); }
}

function cfMailProcess_(source, cfg, message, token, props, summary) {
  const headers = message.payload?.headers || [];
  const header = function (name) { return String(headers.find(function (h) { return h.name.toLowerCase() === name; })?.value || ''); };
  const from = header('from'), address = (from.match(/<([^>]+)>/) || [null, from])[1].trim().toLowerCase();
  if (address !== cfg.sender.toLowerCase()) throw cfMailError_('MAIL_SENDER_MISMATCH');
  const date = new Date(Number(message.internalDate));
  if (!Number.isFinite(date.getTime())) throw cfMailError_('MAIL_DATE_INVALID');
  const common = { message_id: message.id, sender_email: from, subject: header('subject') };
  const parts = [];
  (function walk(part) { if (!part) return; parts.push(part); (part.parts || []).forEach(walk); })(message.payload);
  if (source === 'kplus') {
    const bodyParts = parts.filter(function (p) { return p.mimeType === 'text/plain' && p.body?.data; });
    if (!bodyParts.length) throw cfMailError_('KSHOP_PLAIN_BODY_MISSING');
    const body = bodyParts.map(function (p) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(p.body.data)).getDataAsString('UTF-8'); }).join('\n');
    const merchant = body.match(/รหัสร้านค้า\s*:\s*(KB\d+)/i), amount = body.match(/ยอดเงินจำนวน\s*\(บาท\)\s*:\s*([\d,]+\.\d{2})/i);
    if (!merchant || !amount) throw cfMailError_('KSHOP_FIELDS_MISSING');
    const result = cfMailPost_(cfg.endpoint, token, Object.assign({}, common, { source_date: Utilities.formatDate(new Date(date.getTime() - 86400000), 'Asia/Bangkok', 'yyyy-MM-dd'), body: body, merchant_id: merchant[1], amount: amount[1] }), true);
    summary[result.duplicate ? 'duplicate' : 'imported']++;
    return;
  }
  const files = parts.filter(function (p) { return p.filename && cfg.file.test(p.filename) && (p.body?.attachmentId || p.body?.data); });
  if (!files.length) throw cfMailError_('MAIL_EXPECTED_ATTACHMENT_MISSING');
  files.forEach(function (part) {
    const fileKey = 'cashflow:mail:v3:file:' + source + ':' + cfMailHash_(message.id + ':' + part.partId + ':' + part.filename);
    if (props.getProperty(fileKey)) { summary.skipped++; return; }
    const data = part.body.data || cfMailGmail_('messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(part.body.attachmentId)).data;
    if (!data) throw cfMailError_('MAIL_ATTACHMENT_EMPTY');
    const bytes = Utilities.base64DecodeWebSafe(data), checksum = cfMailHash_(bytes);
    if (part.body.size && bytes.length !== Number(part.body.size)) throw cfMailError_('MAIL_ATTACHMENT_SIZE_MISMATCH');
    const blob = Utilities.newBlob(bytes, part.mimeType || 'application/octet-stream', part.filename);
    const payload = Object.assign({}, common, { file: blob });
    // Grab already has attachment/checksum idempotency. Bank legacy IDs stay identical for single-file messages.
    if (source !== 'grab' && files.length > 1) payload.message_id = message.id + ':' + checksum;
    if (source === 'krungthai') payload.source_date = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
    if (source === 'krungsri') { const m = common.subject.match(/(20\d{2})(\d{2})(\d{2})/); payload.source_date = m ? m[1] + '-' + m[2] + '-' + m[3] : Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd'); }
    const result = cfMailPost_(cfg.endpoint, token, payload, false);
    props.setProperty(fileKey, JSON.stringify({ checksum: checksum, importedAt: Date.now(), importId: result.data?.id || null }));
    summary[result.duplicate ? 'duplicate' : 'imported']++;
  });
}

function cfMailGmail_(route) {
  const response = UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + route, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  const code = response.getResponseCode(), data = cfMailJson_(response.getContentText());
  if (code >= 200 && code < 300 && data && !data.error) return data;
  const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || 'UNKNOWN');
  const pause = /dailyLimit|quotaExceeded/i.test(reason) ? 21600000 : [429, 500, 502, 503, 504].indexOf(code) >= 0 || /rateLimit/i.test(reason) ? 900000 : 0;
  if (pause) PropertiesService.getScriptProperties().setProperty('cashflow:mail:v3:pause-until', String(Date.now() + pause));
  const err = cfMailError_('GMAIL_API_' + code + '_' + reason.replace(/[^A-Za-z0-9_]/g, '').slice(0,60));
  err.mailFatal = code !== 404 || route.indexOf('messages/') !== 0;
  throw err;
}

function cfMailPost_(endpoint, token, payload, json) {
  const options = { method: 'post', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    payload: json ? JSON.stringify(payload) : payload };
  if (json) options.contentType = 'application/json';
  let code;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = UrlFetchApp.fetch(CFMAIL_V3_.BASE + '/api/inbox-imports/' + endpoint, options); }
    catch (_) { if (attempt < 2) { Utilities.sleep(500 * Math.pow(2, attempt)); continue; } throw cfMailError_('IMPORT_NETWORK_ERROR'); }
    code = response.getResponseCode();
    const data = cfMailJson_(response.getContentText());
    if (code >= 200 && code < 300 && data?.success === true && data.data?.status !== 'FAILED') return data;
    if ([408, 425, 429, 500, 502, 503, 504].indexOf(code) < 0 || attempt === 2) break;
    const headers = response.getAllHeaders?.() || {};
    const retry = headers['Retry-After'] || headers['retry-after'];
    const delay = retry ? (/^\d+$/.test(String(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
    if (!Number.isFinite(delay) || delay > 2000) break;
    Utilities.sleep(Math.max(delay, 500 * Math.pow(2, attempt)));
  }
  throw cfMailError_('IMPORT_HTTP_' + code);
}

function cfMailToken_(source, props) {
  const token = props.getProperty('CASHFLOW_GMAIL_INBOX_TOKEN') || (source === 'krungthai' && typeof KRUNGTHAI_CONFIG !== 'undefined' && KRUNGTHAI_CONFIG.IMPORT_TOKEN)
    || (typeof CONFIG !== 'undefined' && CONFIG.IMPORT_TOKEN);
  if (!token) throw cfMailError_('IMPORT_TOKEN_MISSING');
  return token;
}
function cfMailError_(code) { const error = new Error(code); error.safeCode = code; return error; }
function cfMailJson_(value) { try { return JSON.parse(value); } catch (_) { return null; } }
function cfMailHash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }

/** Bounded manual continuation. Existing per-source triggers resume the same checkpoints. */
function continueCashflowMailBackfill() {
  const started = Date.now(), results = [];
  for (const source of Object.keys(CFMAIL_V3_.SOURCES)) {
    if (Date.now() - started > 240000) break;
    results.push(cashflowMailRun_(source, { force: true, maxMessages: 40, runMs: Math.min(60000, 240000 - (Date.now() - started)) }));
  }
  console.log(JSON.stringify({ backfill: results }));
  return results;
}
