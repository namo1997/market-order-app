# Private cloud Cashflow reconciliation

Approved scope: KK and SK, previous completed Asia/Bangkok day, and historical quantified residual candidates strictly above absolute 100 THB. Financial writes/status changes are prohibited. One MCP tool: `cashflow_read_reconciliation({day?, cursor?})`.

Connection: dot → owner-private Sites-managed plugin/OAuth → owner-restricted Worker → `GET /integrations/dot/reconciliation` on the existing General Cashflow Railway service. No Mac runtime or separate Railway service is needed. Source authentication is independent of app login; no PIN, password, browser cookie or existing export/admin token is reused.

The API is disabled unless all are set: `CASHFLOW_DOT_TOKEN_SHA256` (SHA-256 hex of a dedicated 32-byte random base64url token), `CASHFLOW_DOT_BRANCHES=KK,SK`, and future `CASHFLOW_DOT_EXPIRES_AT` (ISO timestamp; approved initial lifetime 30 days). Owner generates/enters the raw token outside chat into Sites runtime secret `CASHFLOW_DOT_UPSTREAM_TOKEN`. Store only its digest in Railway. Sites `CASHFLOW_DOT_OWNER_ID` must match the owner's authenticated site-scoped ID from private `/connection-identity`.

Owner secure entry: ChatGPT Sites → connector Site → More actions → Settings → runtime variables/secrets. Railway → exact General Cashflow production service → Variables. Never commit or paste tokens into chat, instructions, client JSON or command arguments. After owner entry, deploy the approved saved Site version and apply the service variable change. Native plugin Connect/OAuth consent must be completed by the owner. Verify the actual dot cloud tool read and an unattended read with Mac off before claiming connection or setting the daily schedule.

Read-only transactions, bound SELECTs, constant-time token hash checks, expiry, fixed branch scope, one in-flight call and 60 calls/minute enforce API access. It rejects browser Origin and mutations. Amount/evidence queries stay inside approved branches; cross-branch settlement-batch membership metadata only marks that batch unproven and never loads outside-branch amounts. Output excludes employee names, free text, account numbers, raw bank/card credentials, PAN and CVV. It includes aggregate channel amounts, source receipt/line IDs and settlement dates.

Follow `pagination.next_cursor` until null, including empty pages, and pin returned `day` on subsequent calls. Dates use Bangkok; money comparisons use integer satang. Unavailable values stay null. Structured refunds/resolution history are absent, POS is a stored snapshot, and some original blanks have already become schema-default zero. Historical candidates are not a complete verified unresolved ledger. No source refresh, repair, migration, AI call or financial write occurs in the endpoint. Separate pages do not share one frozen snapshot.

Revoke using the digest/expiry, remove the Site upstream secret and disconnect the private plugin. Stop any daily schedule separately. No login credential must change. Stay within current plan limits; paid changes require separate confirmation.

Tests: `node --test test/dotReconciliation.test.js`. Opt-in disposable schema test: `CASHFLOW_DOT_FIXTURE_PORT=<local-test-port> node --test test/dotReconciliation.db.test.js`; this forces a loopback synthetic fixture database and rejects a local `.env`. Never point it at production. Local tests do not validate Sites boundary authentication or actual dot delivery.

Setup guidance: https://learn.chatgpt.com/docs/sites and https://docs.railway.com/variables.
