# General Cashflow

Standalone phase-1 app for daily front-of-house receipt reconciliation.

## Scope

- Separate from the market-order app.
- Uses its own MySQL database: `general_cashflow_db`.
- Reads ClickHouse POS sales only. It does not write back to ClickHouse or the market-order database.
- Supports the first workflow only: daily receipt intake by branch.

## Roles

- `cashier`: create daily receipts from ClickHouse, enter submitted amounts, attach cashier summaries.
- `auditor`: import statement files, enter verified amounts, record variance reasons, send back corrections.
- `recorder`: close checked receipts and view reconciliation reports.
- `admin`: all permissions plus branch/channel settings.

## Run Locally

```bash
cd general-cashflow/server
cp .env.example .env
npm install
npm run migrate
npm run dev
```

```bash
cd general-cashflow/client
npm install
npm run dev
```

Frontend default: `http://localhost:5178`

API default: `http://localhost:8100`

Demo users are seeded when `CASHFLOW_SEED_DEMO_USERS=true`:

- `admin` / value of `CASHFLOW_ADMIN_PASSWORD`
- Cashier uses the `เข้าใช้งานแคชเชียร์` button and does not need a password in phase 1.
- `auditor` / `auditor123`
- `recorder` / `recorder123`

## Deploy to Railway

This app deploys as **one standalone Railway service**, separate from the market-order app's
service — same pattern as the root app (Dockerfile builds the client, Express serves the built
static files plus its API from a single process).

1. **Create a new Railway service** in your project:
   - Source: this repo.
   - Root directory: `general-cashflow` (so Railway's build context is this folder and it picks
     up `general-cashflow/Dockerfile` automatically — no Nixpacks/Procfile needed).
2. **Add a MySQL database** to the Railway project (its own plugin/instance — do not reuse the
   market-order app's database) and note its connection details.
3. **Set these environment variables** on the new service (values come from your local
   `general-cashflow/server/.env` — do not commit real secrets to git):
   - `CASHFLOW_DB_HOST`, `CASHFLOW_DB_PORT`, `CASHFLOW_DB_USER`, `CASHFLOW_DB_PASSWORD`,
     `CASHFLOW_DB_NAME` — point at the MySQL added in step 2.
   - `CASHFLOW_JWT_SECRET` — set a real random secret in production (don't rely on the local
     dev default).
   - `CASHFLOW_ADMIN_PASSWORD`, `CASHFLOW_ADMIN_USERNAME` — admin login for this deployment.
   - `CASHFLOW_SEED_DEMO_USERS` — set to `false` in production once real users are set up.
   - `CASHFLOW_CLICKHOUSE_HOST`, `CASHFLOW_CLICKHOUSE_PORT`, `CASHFLOW_CLICKHOUSE_USER`,
     `CASHFLOW_CLICKHOUSE_PASSWORD`, `CASHFLOW_CLICKHOUSE_DATABASE`, `CASHFLOW_CLICKHOUSE_SHOP_ID`,
     `CASHFLOW_CLICKHOUSE_TZ_OFFSET` — same read-only POS credentials used locally.
   - `CASHFLOW_CORS_ORIGIN` — optional once deployed as one combined service (client and API
     share the same origin), but set it to the Railway-assigned domain
     (e.g. `https://general-cashflow-production.up.railway.app`) if another origin will ever
     call this API directly.
   - Do **not** set `PORT` — Railway injects it automatically and the server already binds to
     `process.env.PORT` (falls back to `CASHFLOW_PORT`/8100 only when `PORT` is absent, i.e.
     local dev).
4. **Attach a Railway volume** mounted at `/app/server/uploads` if you want cashier attachments
   and statement-import files to survive redeploys — the container filesystem is otherwise
   ephemeral. Without a volume, uploaded files are lost on every deploy/restart (existing
   database rows referencing them would then 404).
5. Deploy. Railway builds `general-cashflow/Dockerfile`, which runs `npm run migrate`'s table
   creation automatically on boot (`migrateDatabase()` runs at server startup, same as local dev)
   — no separate migration step needed.

## ClickHouse Rules

Expected sales use:

- `doc.totalamount` for gross sales.
- `doc.paycashamount` for expected cash.
- `docpayment.description + docpayment.amount` for non-cash channels.
- Filters: `shopid`, `doc.transflag = 44`, `doc.iscancel = 0`, Thai business date via `toDate(addHours(docdatetime, 7))`.

Default channel mappings:

- `เคพลัสช็อป` -> `QR_KPLUS`
- `GRAB` -> `GRAB`
- `CREDITCARD` -> `CREDIT_CARD`
- `SML - พร้อมเพย์` -> `PROMPTPAY`
