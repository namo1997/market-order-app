# Sales sync regression checks

Run the unit/controller checks on Node.js 22.3+ (module mocks are experimental):

```sh
cd server
npm ci
npm run test:sync
```

The optional MySQL integration check uses only a disposable local database named
`sales_sync_test`. It refuses other database names and non-loopback hosts.

```sh
docker run --detach --name market-sync-regression-mysql \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=sales_sync_test \
  -p 127.0.0.1:33077:3306 mysql:8.0
# Wait for mysqladmin ping to succeed, then:
SALES_SYNC_TEST_MYSQL=1 DB_HOST=127.0.0.1 DB_PORT=33077 \
  DB_USER=root DB_PASSWORD= DB_NAME=sales_sync_test npm run test:sync
docker rm --force market-sync-regression-mysql
```

# Persistence behavior

`sales_sync_retry_status` retains the status envelope, but `last_result.data`
contains numeric totals and `*_count` fields instead of unbounded arrays.
`run_id` references `sales_sync_runs`. Its bounded `summary_json` is the durable
completion marker; `result_json` is the complete response stored in LONGTEXT.
A NULL `result_json` means archival failed, not that the sync failed.

The new table is created before the first cron attempt and cached thereafter.
For rollout, run `npm run migrate:sales-sync-storage` once with the target
database configuration before starting the new version. This creates the journal
and upgrades legacy columns smaller than TEXT without narrowing larger columns.
For a stock-changing run, the completion marker is inserted in the same InnoDB
transaction as stock deductions, before COMMIT. Successful runs with no stock
changes also record completion before returning. A unique target date prevents
two cron runs from committing stock changes for the same day. HTTP/manual sync
keeps its existing behavior and does not use this daily cron guard.

Archive and display-status writes happen after completion. Their failures are
logged separately and never mark the sync pending. A restarted process checks
the journal before executing a stale pending retry. If the journal is unreadable,
the attempt stops rather than assuming no completion exists. Actual sync failures
retain the existing retry/final-window states. A completion-marker write failure
rolls back the inventory transaction, so that case remains a real sync failure.

Existing historical status entries are not rewritten or inferred to have
succeeded during rollout. The existing inventory-reference deduplication remains.
Schema changes to `system_settings` are no longer attempted on every read/write;
the short status continues to fit the existing TEXT column.

The table contains detailed operational data and is not exposed through a new
public API. Operators can retrieve `summary_json`, `result_json`, and
`completed_at` by `run_id` through their authorized database tooling.
