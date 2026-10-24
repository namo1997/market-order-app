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
- Transaction/idempotency helper: `server/src/grabInboxImport.js`; route integration: `server/src/server.js`
- Standalone entry: `google-apps-script/GrabGmailImport.gs`
- Shared Apps Script runtime: `google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js`
- Combined entry: `google-apps-script/monthly-daily-sheet-sync/src/InboxImports.js` (Grab function only)
- Tests: `server/test/grab.test.js`, `grabPdfFixture.test.js`, `grabInboxImport.test.js`, `grabAppsScript.test.js`

Private original PDF fixtures stay on SSD and are SHA-256 pinned in the fixture test. Set `CASHFLOW_GRAB_FIXTURE_DIR` to the originals directory to run those two tests; absent fixtures are explicitly skipped, never silently reported as PDF coverage. Text-layout, malformed PDF/table/date, legacy duplicate, same-message multiple attachments, repeated runs, concurrency/rollback, bounded retry, Retry-After, response validation, durable failure recovery, budget replay, pagination and both Apps Script entry points are covered. Apps Script services and DB connections are mocked. The existing native-MySQL release-schema test remains skipped; no real DB integration or live Gmail fetch/import was run as a test.

Run tests through the SSD runner as required by root AGENTS.md. Final full suite: **391 tests, 390 passed, 0 failed, 1 existing native-MySQL skip**, exit 0. Evidence and exact commands are retained under the SSD report path below. The local runtime was Node.js 23.11.0 on macOS; the repository Dockerfile uses Node 20 Alpine. A production-like Node 20/container build and real Apps Script execution were not run in this task and remain rollout gates. This server-only patch does not change client source or require a client rebuild.

## Release sequence — requires one explicit approval

1. Review this candidate diff and local commit; refresh Production build identity and preserve a protected backup before any release. The repository baseline archive is available below. A complete credential-bearing export of live Apps Script Head was **not** copied into this repository; preserve its source securely before editing, without placing secret values in chat/logs.
2. Deploy only the committed General Cashflow server using the repository's canonical release workflow. Confirm terminal deployment, `/health` commit/hash and targeted parser/idempotency behavior. Do not push the auto-deploy branch or deploy from an SSD simulation copy before approval.
3. The existing live Grab trigger can start importing the backlog as soon as the repaired **server** is live, even before changing Apps Script. Release approval must therefore explicitly include automatic ingestion within the existing/new 45-day lookback; a server-only approval does not isolate it from live imports. If approval excludes automatic ingestion, do not deploy against an active trigger; pausing/resuming it requires separate authorization. Only after server verification, replace the existing live Grab configuration/function with `GrabGmailImport.gs` and add the shared `GrabInboxRuntime.js` as a separate script file. Review existing helper/global names to avoid duplicate declarations. Keep the other live importer functions and existing trigger schedules unchanged. Do not run trigger installation helpers. Saving Head is the production switch and needs the same explicit release approval.
4. Observe the existing trigger executions, failed-label ledger and missing-report coverage. The new trigger can resume previously failing reports within its lookback, including missing attachments of legacy multi-PDF emails; approval must cover that automatic ingestion. Manual reimports/backfills and financial confirmation/closure remain separately authorized actions. Do not clear success markers or pretend parser success proves a bank receipt.
5. For rollback, restore the former Apps Script implementation first if reverting the server to message-level dedup. Retain all imported evidence/history and financial audits. No deletion or historical balance adjustment is a rollback mechanism.

## Native MySQL gate and remaining validation

The full suite skips `real MySQL release-schema reconciliation fixture` because `CASHFLOW_DOT_FIXTURE_PORT` is unset. Native MySQL binaries are installed locally (including MySQL 9.5). A meaningful follow-up can run without Production access: initialize a **new disposable datadir on the verified SSD**, start `mysqld --no-defaults` bound only to a private loopback port/socket, scrub credentials/config, then set that fixture port inside an SSD simulation. Never use an existing database, application config, saved connection or a Production tunnel: the opt-in fixture calls `DROP DATABASE IF EXISTS cashflow_dot_fixture` and `migrateDatabase()`. That schema/bootstrap test was not executed in this task's no-migration/no-cleanup scope. It validates the release-schema reconciliation loader; it does not itself exercise the entire Grab import HTTP transaction. The new advisory-lock/rollback tests currently use mocked connections, so native Grab SQL/concurrency remains an explicit release-validation gap.

Review preserved accounting invariants: original amounts/components and merchant IDs; original PDF/checksum evidence; untouched legacy dedup rows; unchanged bank-money provenance/payout dates; CLOSED receipts excluded from incoming auto-link; no historical Grab reparse on server boot; audit and financial writes share a transaction. Parser success or imported status never grants approval to confirm money or close a day. Before any separately authorized closure, compare all missing branch-days and original checksums against the imported rows, component/net amounts and existing bank statement evidence; keep unknown/unmapped sources pending.

Permissions are separable: (a) release committed server source + save the specified live Head, explicitly including expected automatic Grab ingestion; (b) manual or expanded historical replay/backfill if not included in (a); (c) financial confirmations/closures or balance adjustments. Only candidate preparation/testing is authorized now. No new schema/migration is required by this patch, no trigger installation is required, and no permission/security changes are part of rollout.

## Exact full-suite command

Run from any directory; the SSD runner creates a fresh simulation and captures output. The dependency copy reads the existing local install, and writes only into that SSD simulation. All credentials are scrubbed by the runner. The original fixture directory is private and stays outside Git.

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

Additional read-only checks: `git diff --check`, `node --check server/src/server.js`, `node --check server/src/domain/grab.js`, `node --check server/src/grabInboxImport.js`, and `node --check google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js`, from the service source directory. No client source changed; client tests/build were not rerun.

## Evidence

- Report directory: `/Volumes/SSD Files/SOLAO/cashflow/reports/grab-import-repair-20261024/`
- Baseline source archive: `/Volumes/SSD Files/SOLAO/cashflow/backups/grab-import-baseline-cf3cefbc-20261024.tar`; SHA-256 `3883919b2905bb644d08d79735424897debbb3785b476f419ad8c2958e80818d`
- Baseline reproduction: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-08-26-666Z-f023adfc/reports/command.log`
- Focused tests: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-24-22-544Z-d57eaaa7/reports/command.log` (32 passed at that checkpoint)
- Final full suite: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-46-29-634Z-458acac3/reports/command.log` (391 total, 390 passed, 0 failed, 1 native-MySQL skip; latest source including the disabled historical startup call)
- Initial full suite: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-24T12-27-50-563Z-f2faf054/reports/command.log` (388 passed, 1 existing native-MySQL skip)

Official references: [Gmail date filtering and Unix seconds](https://developers.google.com/workspace/gmail/api/guides/filtering), [Apps Script LockService](https://developers.google.com/apps-script/reference/lock).
