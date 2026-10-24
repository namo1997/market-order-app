# Grab Gmail import repair — local candidate, 24 October 2026

## Verified cause and boundaries

Production `/health` reported commit `cf3cefbca3f44f6e7565fcf233c2199a6326d687` on 24 October 2026. The isolated branch starts from that exact `cashflow/production-base` revision. Original PDFs from `solao.acc@gmail.com` reproduce HTTP 422 with the baseline parser: pdf-parse emits `V A T`, while the summary search requires `VAT`. The KK 23 October and SK 13 October original PDFs now pass; first-page renders were visually compared with all asserted summary amounts. This does not independently prove the format of every missing branch-day report.

The inspected live Apps Script project is **ดึงข้อมูลรับเงินเข้า**, ID `1Mxaj5LfLEQoFRbyDuj0lPSRE2ms3RNQVZaImeXlEesXcMTS3wreqhG4i`. Its `importGrabReports` Head trigger runs every five minutes. The monthly Sheet project in `.clasp.json` is a separate deployment target; never blindly push it to repair the inspected live project.

No Production source, triggers, OAuth/security settings, financial rows, reconciliation confirmation, close status, migration, or historical balance was changed during this work. Card acquirer imports and fee/VAT/net-payout mappings are outside this patch.

## Candidate behavior

- Normalize only spaced VAT for parsing; retain the original extracted text. Recognized summary tables must have complete, valid monetary columns and a component/net reconciliation within two satang. Reject unreadable/malformed/truncated tables with 422 instead of substituting headline totals and zero fees. Preserve existing gross/VAT/service/promotion/commission/marketing/delivery/income-adjustment/net fields and merchant mapping. Unknown merchants remain unmapped. Invalid dates and unreadable PDFs fail validation; parser workers are released in `finally`.
- API deduplication uses the existing provider/checksum unique key, including all legacy rows. New `source_message_id` is an attachment-scoped `grab:<SHA256(messageId:checksum)>` that fits the existing column. The original Gmail message ID is retained in transaction `raw_payload.source_message_id` and the audit payload. No schema change, dedup deletion, or rewrite of old rows. A stored FAILED row returns 409, never a successful duplicate.
- The same DB connection holds an advisory checksum lock, checks duplicates, begins/commits/rolls back the existing financial transaction, and releases the lock. A connection with uncertain lock release is destroyed. The existing receipt selection adds `FOR UPDATE` to serialize receipt/closing changes. The legacy startup call that reparsed all archived Grab reports (including CLOSED receipts) and rewrote values/match states is disabled; deployment must not become a historical repair. Incoming-import accounting SQL, amount formulas and closing restrictions otherwise remain in place. No new settlement/payment-date inference.
- Apps Script uses `LockService` and per-message/checksum success markers. A failed PDF does not prevent other attachments/messages from importing. Existing single-PDF message markers are honored and preserved. Old multi-PDF message markers are preserved but every checksum is checked against the API, because the old API may have skipped later attachments.
- Only explicit HTTP 2xx JSON `success:true` is acknowledged. Transient network/408/425/429/5xx errors receive at most two immediate retries, bounded waits (maximum ten seconds), jitter and Retry-After handling. A long Retry-After defers the attachment without blocking others. Non-transient failures wait one hour; exhausted transient failures wait at least fifteen minutes. Validation failures are never marked imported.
- Default standalone bounds: 45-day lookback, 25 threads/page, 100 threads/run, 100 new attachment attempts/run and a four-minute budget. Both scan dates freeze across runs; changing labels does not change the query. A partial page is replayed safely. The combined Sheet connector retains its existing 90-day lookback. Completed/failed labels reflect processed threads; the query never excludes either label. New arrivals enter the next full scan.
- Durable Script Properties: `cashflow:grab:scan:v2`, `cashflow:grab:last-run:v2`, attachment success keys and per-attachment failure records (message ID, filename, checksum, HTTP status, attempt/retry times). Failure records become RESOLVED after success. No response body, token, email body or raw exception string is stored. `Cashflow/Failed Grab` exposes unresolved threads; the execution throws a count-only incomplete summary after processing the batch. Existing dedup history is never cleared.

A persisted success marker also repairs an interrupted failure-ledger RESOLVED update without reposting the PDF.

The runtime reads `CASHFLOW_GMAIL_INBOX_TOKEN` from existing Script Properties first, with compatibility for the existing live `CONFIG.IMPORT_TOKEN`; it does not embed or print credentials. No new permission scope is required by this source. Production Script Property storage/quota has not been inspected; preserve history if capacity needs separate treatment.

## Files and tests

- Parser: `server/src/domain/grab.js`
- Transaction/idempotency helper: `server/src/grabInboxImport.js`; actual HTTP handler: `server/src/grabInboxRoute.js`; shared statement recalculation: `server/src/receiptStatementAmount.js`; authenticated route wiring remains in `server/src/server.js`
- Standalone entry: `google-apps-script/GrabGmailImport.gs`
- Shared Apps Script runtime: `google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js`
- Combined entry: `google-apps-script/monthly-daily-sheet-sync/src/InboxImports.js` (Grab function only)
- Tests: `server/test/grab.test.js`, `grabPdfFixture.test.js`, `grabInboxImport.test.js`, `grabAppsScript.test.js`, `grabInboxImport.mysql.test.js`

Private original PDF fixtures stay on SSD and are SHA-256 pinned in the fixture test. Set `CASHFLOW_GRAB_FIXTURE_DIR` to the originals directory to run those two tests; absent fixtures are explicitly skipped, never silently reported as PDF coverage. Text-layout, malformed PDF/table/date, legacy duplicate, same-message multiple attachments, repeated runs, concurrency/rollback, bounded retry, Retry-After, response validation, durable failure recovery, budget replay, pagination and both Apps Script entry points are covered. Apps Script services remain mocked. DB mocks are supplemented by the native MySQL HTTP integration gate below, which runs the actual handler/parser/statement recalculation/SQL/audit on a newly created disposable instance. No live Gmail fetch/import was run as a test.

Run tests through the SSD runner as required by root AGENTS.md. Initial candidate 1ca07923 passed 390 tests with one native-MySQL skip on Node23.11.0. **Final gate: Node20.20.2 + native MySQL9.5.0, 406 tests passed, 0 failed, 0 skipped**, exit0. The native gate includes the previously skipped release-schema fixture and ten actual Grab HTTP/transaction subtests. Handler, financial payload and shared statement recalculation were extracted for testability and verified byte-for-byte against 1ca07923; no accounting SQL/amount semantics changed in the extraction. The repository Dockerfile uses Node20 Alpine; macOS Node20 coverage is not Alpine/container coverage. This server-only patch does not change client source; client tests/build were not rerun.

## Release sequence — requires one explicit approval

1. Review this candidate diff and local commit; refresh Production build identity and preserve a protected backup before any release. The repository baseline archive is available below. A complete credential-bearing export of live Apps Script Head was **not** copied into this repository; preserve its source securely before editing, without placing secret values in chat/logs.
2. Deploy only the committed General Cashflow server using the repository's canonical release workflow. Confirm terminal deployment, `/health` commit/hash and targeted parser/idempotency behavior. Do not push the auto-deploy branch or deploy from an SSD simulation copy before approval.
3. The existing live Grab trigger can start importing the backlog as soon as the repaired **server** is live, even before changing Apps Script. Release approval must therefore explicitly include automatic ingestion within the existing/new 45-day lookback; a server-only approval does not isolate it from live imports. If approval excludes automatic ingestion, do not deploy against an active trigger; pausing/resuming it requires separate authorization. Only after server verification, replace the existing live Grab configuration/function with `GrabGmailImport.gs` and add the shared `GrabInboxRuntime.js` as a separate script file. Review existing helper/global names to avoid duplicate declarations. Keep the other live importer functions and existing trigger schedules unchanged. Do not run trigger installation helpers. Saving Head is the production switch and needs the same explicit release approval.
4. Observe the existing trigger executions, failed-label ledger and missing-report coverage. The new trigger can resume previously failing reports within its lookback, including missing attachments of legacy multi-PDF emails; approval must cover that automatic ingestion. Manual reimports/backfills and financial confirmation/closure remain separately authorized actions. Do not clear success markers or pretend parser success proves a bank receipt.
5. For rollback, restore the former Apps Script implementation first if reverting the server to message-level dedup. Retain all imported evidence/history and financial audits. No deletion or historical balance adjustment is a rollback mechanism.

## Native MySQL gate and remaining validation

The user authorized disposable fixture create/drop/migrate operations only within a NEW isolated SSD instance. The gate controller creates a random datadir under `/Volumes/SSD Files/SOLAO/cashflow/tmp/grab-gate-<id>`, starts MySQL with `--no-defaults`, binds only 127.0.0.1 on a free port, then verifies datadir/port/server UUID and that only system databases exist before passing fixture ports to tests. It uses no saved credentials/app .env or Production tunnel. The native Grab test rechecks the identity manifest and rejects an existing fixture schema before calling migration. Both test schemas are task-created disposable data, not Production migrations. The process was stopped after the run; no daemon/service was installed and no existing DB was contacted.

Final instance: `/Volumes/SSD Files/SOLAO/cashflow/tmp/grab-gate-e8b2fb2d`, MySQL9.5.0, loopback port52557, server UUID42c94486-cfac-11f1-a6bb-193eece3aebc. It exited after testing. The recorded Production reference is MySQL9.7.2; this gate did not reconnect to Production to refresh that version and does not establish exact-version parity.

Native tests passed: malformed PDF leaves all rows unchanged; exact original PDF/cents/blob/hash/audit; duplicate/forward no-write and two attachments from the same Gmail ID; concurrent requests commit once; injected audit failure rolls back all handler writes; real advisory lock contention returns503 without writes; original bank proof/settlement date are preserved and a Grab pseudo-statement is excluded; CLOSED snapshots/financial rows stay immutable; legacy/FAILED rows stay unchanged; killed connection rollback, eventual lock release and same-key recovery/no duplicate.

The first Node20/native attempt recorded 404 passes and 2 failures (one leaf assertion plus its parent) because it assumed lock release was synchronous with `KILL CONNECTION`. Diagnostics from the final test show the killed thread absent at0ms while its lock holder was still visible, then holderNULL at22ms. The test uses server-side polling with a hard2-second bound (below the application's5-second GET_LOCK wait), never manually releases the killed connection's lock, and asserts rollback, successful recovery on the identical key, exactly one committed row after retry, no duplicate and unchanged CLOSED data. No lock implementation change was needed for this asynchronous cleanup observation. Initial failure evidence is retained.

Docker/Alpine build is **blocked and was not run**: `check-docker --project cashflow` reported the Docker disk image outside approved SSD storage; Docker also reported no running daemon. Do not bypass the policy or move/start Docker in this task. Node20.20.2 macOS arm64 was downloaded only from nodejs.org to SSD and verified against official SHA-256 `466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6`; it did not replace the installed runtime. Real Apps Script execution and Production acceptance remain post-approval steps.

Review preserved accounting invariants: original amounts/components and merchant IDs; original PDF/checksum evidence; untouched legacy dedup rows; unchanged bank-money provenance/payout dates; CLOSED receipts excluded from incoming auto-link; no historical Grab reparse on server boot; audit and financial writes share a transaction. Parser success or imported status never grants approval to confirm money or close a day. Before any separately authorized closure, compare all missing branch-days and original checksums against the imported rows, component/net amounts and existing bank statement evidence; keep unknown/unmapped sources pending.

Permissions are separable: (a) release committed server source + save the specified live Head, explicitly including expected automatic Grab ingestion; (b) manual or expanded historical replay/backfill if not included in (a); (c) financial confirmations/closures or balance adjustments. Only candidate preparation/testing is authorized now. No new schema/migration is required by this patch, no trigger installation is required, and no permission/security changes are part of rollout.

## Exact test commands

Final native/Node20 gate controller (each invocation creates a NEW guarded SSD MySQL instance, prepares an SSD source snapshot and stops its own child):

```sh
node '/Volumes/SSD Files/SOLAO/cashflow/reports/grab-import-repair-20261024/run-native-node20-gates.mjs'
```

The controller invokes `/Volumes/SSD Files/SOLAO/cashflow/cache/node20-release-gate/node-v20.20.2-darwin-arm64/bin/node --test` from the SSD snapshot's `server` directory. It sets `CASHFLOW_GRAB_FIXTURE_PORT`, `CASHFLOW_GRAB_FIXTURE_ROOT`, and `CASHFLOW_DOT_FIXTURE_PORT` only after identity checks; also `CASHFLOW_GRAB_FIXTURE_DIR` and `CASHFLOW_DECISION_REASON_REQUIRED=0`. Never set fixture ports against an existing service. Exact controller source and result manifests are retained with the SSD report.

Earlier Node23 mock/default full suite, runnable from any directory; the SSD runner creates a fresh simulation and captures output. The dependency copy reads the existing local install, and writes only into that SSD simulation. All credentials are scrubbed by the runner. The original fixture directory is private and stays outside Git.

```sh
node /Users/surachart/.solao-tools/ssd-workspace.mjs run --project cashflow --source '/Users/surachart/Documents/Codex/2026-10-24/task-2/cashflow-grab-import/general-cashflow' -- node --input-type=module -e '
import path from "node:path";
import {spawnSync} from "node:child_process";
import {copyDependencies} from "/Users/surachart/.solao-tools/ssd-workspace.mjs";
await copyDependencies("/Users/surachart/ระบบสั่งของตลาดสด/general-cashflow/server/node_modules",path.join(process.cwd(),"server/node_modules"),process.env,path.dirname(process.cwd()));
process.env.CASHFLOW_GRAB_FIXTURE_DIR="/Volumes/SSD Files/SOLAO/cashflow/reports/grab-import-repair-20261024/originals";
process.env.CASHFLOW_DECISION_REASON_REQUIRED="0";
const result=spawnSync(process.execPath,["--test"],{cwd:path.join(process.cwd(),"server"),env:process.env,stdio:"inherit"});
process.exitCode=result.status ?? 1;
'
```

Additional read-only checks (including Node20 syntax checks for the extracted modules): `git diff --check`, `node --check server/src/server.js`, `node --check server/src/domain/grab.js`, `node --check server/src/grabInboxImport.js`, `node --check server/src/grabInboxRoute.js`, `node --check server/src/receiptStatementAmount.js`, and `node --check google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js`, from the service source directory. No client source changed; client tests/build were not rerun.

## Evidence

- **Final Node20/native full suite:** `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T13-10-09-808Z-b9b47adf/reports/node20-native-full.log` (406/406 pass, no skips)
- Final identity/shutdown: `/Volumes/SSD Files/SOLAO/cashflow/tmp/grab-gate-e8b2fb2d/gate-result.json`
- Disconnect timing/release: `/Volumes/SSD Files/SOLAO/cashflow/tmp/grab-gate-e8b2fb2d/disconnect-lock-observation.json`
- Preserved initial native failure: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T13-05-56-183Z-8ac0a755/reports/node20-native-full.log`

- Report directory: `/Volumes/SSD Files/SOLAO/cashflow/reports/grab-import-repair-20261024/`
- Baseline source archive: `/Volumes/SSD Files/SOLAO/cashflow/backups/grab-import-baseline-cf3cefbc-20261024.tar`; SHA-256 `3883919b2905bb644d08d79735424897debbb3785b476f419ad8c2958e80818d`
- Baseline reproduction: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-08-26-666Z-f023adfc/reports/command.log`
- Focused tests: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-24-22-544Z-d57eaaa7/reports/command.log` (32 passed at that checkpoint)
- Earlier Node23 full suite: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-46-29-634Z-458acac3/reports/command.log` (391 total, 390 passed, 0 failed, 1 native-MySQL skip; latest source including the disabled historical startup call)
- Initial full suite: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-27-50-563Z-f2faf054/reports/command.log` (388 passed, 1 existing native-MySQL skip)

Official references: [Node20 distribution checksums](https://nodejs.org/dist/v20.20.2/SHASUMS256.txt), [Gmail date filtering and Unix seconds](https://developers.google.com/workspace/gmail/api/guides/filtering), [Apps Script LockService](https://developers.google.com/apps-script/reference/lock).
