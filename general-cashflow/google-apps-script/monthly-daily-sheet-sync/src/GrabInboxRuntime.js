/** Shared by the standalone and combined Grab connector. No trigger changes here. */
function runGrabInboxImport_(options) {
  const config = Object.assign({
    LOOKBACK_DAYS: 45, PAGE_SIZE: 25, MAX_THREADS: 100, MAX_ATTACHMENTS: 100,
    RUN_BUDGET_MS: 240000, MAX_RETRIES: 2, MAX_SLEEP_MS: 10000,
    TOKEN_PROPERTY: 'CASHFLOW_GMAIL_INBOX_TOKEN',
    DONE_LABEL: 'Cashflow/Imported Grab', FAILURE_LABEL: 'Cashflow/Failed Grab'
  }, options);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: 'LOCK_BUSY' };
  const properties = PropertiesService.getScriptProperties();
  const started = Date.now();
  const summary = { imported: 0, skipped: 0, failed: 0, pending: 0, threads: 0, attachments: 0 };
  const cursorKey = 'cashflow:grab:scan:v2';
  const runKey = 'cashflow:grab:last-run:v2';
  try {
    // Existing CONFIG compatibility avoids requiring a credential/security change
    // for the live project. Never serialize this value or response bodies.
    const token = properties.getProperty(config.TOKEN_PROPERTY)
      || (typeof CONFIG !== 'undefined' && CONFIG.IMPORT_TOKEN);
    if (!token) throw new Error('GRAB_IMPORT_TOKEN_MISSING');
    let cursor = grabReadJson_(properties.getProperty(cursorKey));
    if (!cursor || cursor.lookbackDays !== config.LOOKBACK_DAYS
        || cursor.query !== config.SEARCH || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0
        || !Number.isSafeInteger(cursor.before) || !Number.isSafeInteger(cursor.after)
        || cursor.before > Math.floor(started / 1000) || cursor.after >= cursor.before) {
      const before = Math.floor(started / 1000);
      cursor = { before, after: before - config.LOOKBACK_DAYS * 86400, offset: 0,
        lookbackDays: config.LOOKBACK_DAYS, query: config.SEARCH };
    }
    // Freeze both ends across pages/runs. Labels never alter this query.
    const search = `${config.SEARCH} after:${cursor.after - 1} before:${cursor.before}`;
    let stop = false;
    while (!stop && summary.threads < config.MAX_THREADS && Date.now() - started < config.RUN_BUDGET_MS) {
      const pageSize = Math.min(config.PAGE_SIZE, config.MAX_THREADS - summary.threads);
      const threads = GmailApp.search(search, cursor.offset, pageSize);
      if (!threads.length) { cursor = null; break; }
      for (const thread of threads) {
        if (Date.now() - started >= config.RUN_BUDGET_MS || summary.attachments >= config.MAX_ATTACHMENTS) {
          stop = true; break;
        }
        summary.threads++;
        let complete = true;
        let hasReports = false;
        let outsideWindow = false;
        try {
          for (const message of thread.getMessages()) {
            if (!/(^|<)no-reply@grab\.com>?$/i.test(message.getFrom().trim())) continue;
            const messageTime = message.getDate().getTime();
            if (messageTime < cursor.after * 1000 || messageTime >= cursor.before * 1000) {
              outsideWindow = true; continue;
            }
            const files = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
              .filter((file) => /\.pdf$/i.test(file.getName()));
            if (!files.length) continue;
            hasReports = true;
            let messageComplete = true;
            // The old API deduplicated the whole message. Multi-file messages
            // must therefore be checked per checksum, even with a legacy marker.
            const legacyDone = files.length === 1 && properties.getProperty(`cashflow:grab:${message.getId()}`);
            for (const file of files) {
              if (Date.now() - started >= config.RUN_BUDGET_MS) {
                stop = true; complete = false; messageComplete = false; break;
              }
              const blob = file.copyBlob().setName(file.getName());
              const checksum = grabHash_(blob.getBytes());
              const key = `cashflow:grab:file:v2:${grabHash_(message.getId() + ':' + checksum)}`;
              const failureKey = key.replace(':file:', ':failure:');
              const previousFailure = grabReadJson_(properties.getProperty(failureKey));
              if (properties.getProperty(key) || legacyDone) {
                // A prior run may have saved success before a quota/network
                // error prevented updating the failure ledger. Repair only
                // from an existing success marker, without posting again.
                if (previousFailure && previousFailure.state === 'FAILED') {
                  properties.setProperty(failureKey, JSON.stringify(Object.assign({}, previousFailure,
                    { state: 'RESOLVED', resolvedAt: Date.now() })));
                }
                summary.skipped++; continue;
              }
              if (previousFailure && previousFailure.state === 'FAILED' && previousFailure.nextAttemptAt > Date.now()) {
                summary.pending++; complete = false; messageComplete = false; continue;
              }
              if (summary.attachments >= config.MAX_ATTACHMENTS) {
                stop = true; complete = false; messageComplete = false; break;
              }
              summary.attachments++;
              const result = grabPostWithRetry_(config, token, blob, message, started);
              if (result.ok) {
                properties.setProperty(key, new Date().toISOString());
                if (previousFailure) properties.setProperty(failureKey, JSON.stringify(Object.assign({}, previousFailure,
                  { state: 'RESOLVED', resolvedAt: Date.now() })));
                summary.imported++;
              } else {
                const now = Date.now();
                properties.setProperty(failureKey, JSON.stringify({ state: 'FAILED', messageId: message.getId(),
                  fileName: file.getName().slice(0, 255), checksum, httpStatus: result.status,
                  code: result.code, firstFailedAt: previousFailure ? previousFailure.firstFailedAt : now,
                  lastFailedAt: now, attempts: (previousFailure ? previousFailure.attempts : 0) + result.attempts,
                  nextAttemptAt: now + Math.max(result.retryAfterMs || 0, result.transient ? 900000 : 3600000) }));
                summary.failed++; complete = false; messageComplete = false;
              }
            }
            const legacyKey = `cashflow:grab:${message.getId()}`;
            if (messageComplete && files.length && !properties.getProperty(legacyKey)) {
              properties.setProperty(legacyKey, new Date().toISOString());
            }
            if (stop) break;
          }
        } catch {
          // Gmail/quota failures are visible, but do not expose mail bodies or
          // exception strings, which can contain response data/credentials.
          summary.failed++; complete = false;
        }
        if (hasReports && complete && !outsideWindow) {
          thread.addLabel(grabLabel_(config.DONE_LABEL));
          const failedLabel = GmailApp.getUserLabelByName(config.FAILURE_LABEL);
          if (failedLabel) thread.removeLabel(failedLabel);
        } else if (!complete) {
          thread.addLabel(grabLabel_(config.FAILURE_LABEL));
          const doneLabel = GmailApp.getUserLabelByName(config.DONE_LABEL);
          if (doneLabel) thread.removeLabel(doneLabel);
        }
        if (stop) break;
      }
      // On a partial page, replay it next time. Successful attachment markers
      // make replay safe; advancing a half-processed page would lose reports.
      if (stop) break;
      cursor.offset += threads.length;
      properties.setProperty(cursorKey, JSON.stringify(cursor));
      if (threads.length < pageSize) { cursor = null; break; }
    }
    if (cursor) properties.setProperty(cursorKey, JSON.stringify(cursor));
    else properties.deleteProperty(cursorKey);
    properties.setProperty(runKey, JSON.stringify(Object.assign({}, summary, { finishedAt: Date.now(), scanComplete: !cursor })));
    if (summary.failed || summary.pending) throw new Error(`GRAB_IMPORT_INCOMPLETE failed=${summary.failed} pending=${summary.pending} imported=${summary.imported}`);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function grabPostWithRetry_(config, token, blob, message, started) {
  let result = { ok: false, status: null, code: 'DEFERRED', transient: true, attempts: 0 };
  for (let attempt = 0; attempt <= config.MAX_RETRIES; attempt++) {
    if (Date.now() - started >= config.RUN_BUDGET_MS) return result;
    try {
      const response = UrlFetchApp.fetch(config.API_URL, {
        method: 'post', headers: { Authorization: `Bearer ${token}` },
        payload: { file: blob, message_id: message.getId(), sender_email: message.getFrom(), subject: message.getSubject() },
        muteHttpExceptions: true
      });
      const status = response.getResponseCode();
      const body = grabReadJson_(response.getContentText());
      if (status >= 200 && status < 300 && body && body.success === true && body.data?.status !== 'FAILED') return { ok: true };
      const transient = [408, 425, 429, 500, 502, 503, 504].indexOf(status) >= 0 || (status >= 200 && status < 300);
      const headers = response.getAllHeaders();
      const retryHeader = headers['Retry-After'] || headers['retry-after'];
      const retryAfterMs = retryHeader ? Math.max(0, /^\d+$/.test(String(retryHeader))
        ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
      result = { ok: false, status, code: status >= 200 && status < 300 ? 'INVALID_RESPONSE' : `HTTP_${status}`,
        transient, retryAfterMs: Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, 86400000) : 0, attempts: attempt + 1 };
    } catch {
      result = { ok: false, status: null, code: 'NETWORK_ERROR', transient: true, attempts: attempt + 1 };
    }
    if (!result.transient || attempt === config.MAX_RETRIES || result.retryAfterMs > config.MAX_SLEEP_MS) return result;
    const delay = Math.max(result.retryAfterMs || 0, Math.min(config.MAX_SLEEP_MS, 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250)));
    if (Date.now() + delay - started >= config.RUN_BUDGET_MS) return result;
    Utilities.sleep(delay);
  }
  return result;
}

function grabReadJson_(value) {
  try { return JSON.parse(value); } catch { return null; }
}
function grabHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}
function grabLabel_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
