/** Read-only audit of local checkpoints and server acknowledgements. No Gmail/API calls. */
function inspectCashflowMailStatus() {
  const all = PropertiesService.getScriptProperties().getProperties();
  const rows = Object.keys(CFMAIL_V3_.SOURCES).map(function (source) {
    const prefix = 'cashflow:mail:v3:';
    const state = cfMailJson_(all[prefix + 'state:' + source]) || {};
    const failurePrefix = prefix + 'failure:' + source + ':';
    const failures = Object.keys(all).filter(function (key) { return key.indexOf(failurePrefix) === 0; })
      .map(function (key) { return cfMailJson_(all[key]); })
      .filter(function (row) { return row && row.state === 'FAILED'; });
    const proofs = Object.keys(all).filter(function (key) { return key.indexOf(prefix + 'file:' + source + ':') === 0; })
      .map(function (key) {
        const value = cfMailJson_(all[key]) || {};
        return { source: source, checksum: value.checksum || null, importId: value.importId || null };
      });
    for (let i = 0; i < proofs.length; i += 3) console.log(JSON.stringify({ evidenceProofs: proofs.slice(i, i + 3) }));
    return { source: source,
      acknowledgedMessages: Object.keys(all).filter(function (key) { return key.indexOf(prefix + 'done:' + source + ':') === 0; }).length,
      acknowledgedFiles: proofs.length, scanPending: !!state.scan,
      scanWindow: state.scan ? { after: state.scan.after, before: state.scan.before, pageIndex: state.scan.page?.index || 0 } : null,
      watermark: state.watermark || null,
      unresolved: failures.map(function (row) { return { messageId: row.messageId, code: row.code, attempts: row.attempts, retryAt: row.nextAttemptAt }; }),
      last: cfMailJson_(all[prefix + 'last:' + source]) };
  });
  const result = { mailStatus: rows, pauseUntil: Number(all['cashflow:mail:v3:pause-until'] || 0),
    propertyCount: Object.keys(all).length,
    propertyBytes: Object.keys(all).reduce(function (sum, key) { return sum + Utilities.newBlob(key + all[key]).getBytes().length; }, 0) };
  // Small log entries remain complete in the editor's accessible text.
  rows.forEach(function (row) {
    for (let i = 0; i < row.unresolved.length; i += 2) console.log(JSON.stringify({ source: row.source, mailFailures: row.unresolved.slice(i, i + 2) }));
    console.log(JSON.stringify({ mailStatus: Object.assign({}, row, { unresolved: undefined, unresolvedCount: row.unresolved.length }) }));
  });
  console.log(JSON.stringify({ mailStorage: { propertyCount: result.propertyCount, propertyBytes: result.propertyBytes, pauseUntil: result.pauseUntil } }));
  return result;
}

/** Inspect one failed ZIP without importing it or modifying retry checkpoints. */
function inspectCashflowKrungsriFailure() {
  const all = PropertiesService.getScriptProperties().getProperties();
  const key = Object.keys(all).find(function (key) {
    return key.indexOf('cashflow:mail:v3:failure:krungsri:') === 0 && cfMailJson_(all[key])?.state === 'FAILED';
  });
  if (!key) return console.log(JSON.stringify({ krungsriInspection: 'NO_UNRESOLVED' }));
  const profile = cfMailGmail_('profile');
  if (String(profile.emailAddress).toLowerCase() !== 'solao.acc@gmail.com') throw Error('MAIL_ACCOUNT_MISMATCH');
  const failure = cfMailJson_(all[key]);
  const message = cfMailGmail_('messages/' + encodeURIComponent(failure.messageId) + '?format=full');
  const parts = [];
  (function walk(part) { if (!part) return; parts.push(part); (part.parts || []).forEach(walk); })(message.payload);
  parts.filter(function (part) { return String(part.filename || '').toLowerCase().endsWith('.zip'); }).forEach(function (part) {
    const data = part.body.data || cfMailGmail_('messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(part.body.attachmentId)).data;
    const bytes = Utilities.base64DecodeWebSafe(data);
    console.log(JSON.stringify({ krungsriInspection: { messageId: message.id, filename: part.filename, bytes: bytes.length, checksum: cfMailHash_(bytes) } }));
    const files = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', part.filename));
    files.forEach(function (file) {
      console.log(JSON.stringify({ krungsriZipEntry: { filename: file.getName(), bytes: file.getBytes().length } }));
      if (file.getName().toLowerCase().endsWith('.csv')) file.getDataAsString('UTF-8').split(String.fromCharCode(10)).map(function (line) { return line.trim(); }).filter(Boolean).slice(0, 12)
        .forEach(function (line, index) { console.log(JSON.stringify({ krungsriCsvLine: { line: index + 1, text: line.slice(0, 320) } })); });
    });
  });
}
