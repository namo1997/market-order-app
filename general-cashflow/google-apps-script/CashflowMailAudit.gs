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
    for (let i = 0; i < proofs.length; i += 15) console.log(JSON.stringify({ evidenceProofs: proofs.slice(i, i + 15) }));
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
  // One row per source keeps the audit readable within Apps Script's per-entry log limit.
  rows.forEach(function (row) { console.log(JSON.stringify({ mailStatus: row })); });
  console.log(JSON.stringify({ mailStorage: { propertyCount: result.propertyCount, propertyBytes: result.propertyBytes, pauseUntil: result.pauseUntil } }));
  return result;
}
