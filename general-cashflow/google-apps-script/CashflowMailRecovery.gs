/** Authorized retry of the diagnosed HTTP 400s, gated on the verified parser release. */
function retryCashflowKrungsriAfterParserFix() {
  const expected = 'e40b98f8dbdac6d1c0ea3bfee43e1549ca9ce9054fa7dc4b5fc9713ad8f5de2f';
  const response = UrlFetchApp.fetch(CFMAIL_V3_.BASE + '/health', { muteHttpExceptions: true });
  const health = cfMailJson_(response.getContentText());
  if (response.getResponseCode() !== 200 || health?.ready !== true || health.build?.source_sha256 !== expected)
    throw Error('KRUNGSRI_PARSER_RELEASE_NOT_READY');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { source: 'krungsri', skipped: 'LOCK_BUSY' };
  let rescheduled = 0;
  try {
    const props = PropertiesService.getScriptProperties(), all = props.getProperties();
    Object.keys(all).filter(function (key) { return key.indexOf('cashflow:mail:v3:failure:krungsri:') === 0; })
      .forEach(function (key) {
        const row = cfMailJson_(all[key]);
        if (row?.state !== 'FAILED' || row.code !== 'IMPORT_HTTP_400') return;
        props.setProperty(key, JSON.stringify(Object.assign({}, row, { nextAttemptAt: Date.now(),
          manualRetryAt: Date.now(), manualRetryReason: 'APPROVED_BACKFILL_AFTER_VERIFIED_ZERO_SUMMARY_FIX' })));
        rescheduled++;
      });
  } finally { lock.releaseLock(); }
  console.log(JSON.stringify({ krungsriRecovery: { rescheduled: rescheduled, verifiedParser: expected } }));
  return cashflowMailRun_('krungsri', { force: true });
}
