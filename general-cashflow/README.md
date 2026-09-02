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

### Safe local snapshot preview

The preview uses a dedicated Docker MySQL database on loopback and never points the
application at production:

```bash
cd general-cashflow/server
npm run preview
```

Open `http://127.0.0.1:5178`. Shadow/OpenAI calls are disabled unless
`CASHFLOW_PREVIEW_AI_ENABLED=1` is set explicitly. To replace the local database with a
read-only 60-day source snapshot, set `CASHFLOW_PREVIEW_SOURCE_URL` to a read-only MySQL URL,
start the preview database, then run `npm run preview:sync`. The sync command refuses any
non-loopback destination.

Every browser mutation creates a frozen pre-decision snapshot, asks the human for a reason,
and links the result to Shadow AI. Shadow never changes receipt/reconciliation data and its
failure does not block the human workflow. Cancelling the reason prompt invalidates the
unused decision context, and secrets/account identifiers are removed from the copy sent to
Shadow while the complete local audit record is retained. The action contract is in
[`docs/DECISION_ACTION_REGISTRY.md`](./docs/DECISION_ACTION_REGISTRY.md); use
`npm run shadow:eval` in `server/` to report agreement by action.

### Local daily-close demo (no API/database)

Start only the frontend and open:

`http://localhost:5178/?local-demo=1`

This sandbox uses the August 5 sample data and bundled evidence files. Closing the day changes only React state in the browser and enables the sample PDF download; it does not call the API or update the database.

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
   - `CASHFLOW_GOOGLE_CLIENT_ID`, `CASHFLOW_GOOGLE_ALLOWED_EMAILS` — optional Google Sign-In.
     Separate multiple allowed emails with commas. Google login uses the existing user named by
     `CASHFLOW_GOOGLE_APP_USERNAME` (defaults to the admin username) and never creates or links a
     Google identity row in the cashflow database.
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

Keep `deploy.sleepApplication` set to `false` in `railway.json` for production.
This service handles cashier submissions, email imports, and the morning scheduler,
so it must stay running between requests. Startup migrations and evidence checks
can take about 50 seconds; enabling Serverless can make the first request after
idle time fail with a 502. Keep the `/health` readiness check enabled when deploying.
Always-on operation continues to consume Railway resources while idle.

## Krungsri Biz Mung-Mee Gmail Import

The system can receive the daily Krungsri ZIP report directly from Gmail without a manual download.
It stores parsed transactions in a separate pending-review inbox, so incoming customer deposits and
cross-day settlements never change a cashier receipt automatically.

1. Set `CASHFLOW_GMAIL_INBOX_TOKEN` in Railway to a long random value.
2. Create a Google Apps Script while signed in to `solao.acc@gmail.com`, then paste
   [`google-apps-script/KrungsriGmailImport.gs`](./google-apps-script/KrungsriGmailImport.gs).
3. Put the Railway token in `CONFIG.IMPORT_TOKEN`.
4. Run `createFiveMinuteTrigger` once, approve the requested Gmail and external-request permissions,
   then run `importKrungsriReports` once as the connection test.

The endpoint is `POST /api/inbox-imports/krungsri`. It accepts only ZIP files and a bearer token,
deduplicates by Gmail message ID and file checksum, supports CSV/XLSX/XLS/PDF inside the archive,
and limits the archive to 20 files and 50 MB after extraction. Auditors can inspect queued imports at
`GET /api/inbox-imports` and their parsed rows at `GET /api/inbox-imports/:id/transactions`.

## Krungthai Business Gmail Import

Krungthai Business historical-statement ZIP files can be forwarded from Gmail to
`POST /api/inbox-imports/krungthai-business` using
[`google-apps-script/KrungthaiBusinessGmailImport.gs`](./google-apps-script/KrungthaiBusinessGmailImport.gs).
Each file is deduplicated by Gmail message ID and ZIP checksum, then stored as `PENDING_REVIEW`.
Generic incoming transfers are deliberately not auto-classified as KTC because customer deposits
and KTC settlements can share an account. Set `CASHFLOW_KRUNGTHAI_ZIP_PASSWORD` in Railway only
when the ZIP is password-protected.

## ClickHouse Rules

Expected sales use:

- `doc.totalamount` for gross sales.
- `doc.paycashamount` for expected cash.
- `docpayment.description + docpayment.amount` for non-cash channels.
- Filters: `shopid`, `doc.transflag = 44`, `doc.iscancel = 0`, Thai business date via `toDate(addHours(docdatetime, 7))`.

### Safe monthly backfill

The admin-only backfill creates missing receipts as `DRAFT` and refreshes expected values only for
`DRAFT` or `NEEDS_CORRECTION`. It never refreshes submitted, checked, or closed receipts and supports
an idempotent dry run:

```bash
npm --prefix server run backfill:clickhouse -- \
  --from 2026-07-01 --to 2026-07-31 --branches KK,SK --dry-run
```

The Google Sheets monthly feed uses the same read-only ClickHouse sales definition while taking the
workflow status from `daily_receipts`. Grab exports prefer a complete linked settlement report and
fall back to the submitted cashier sales amount only when the report is missing or incomplete:

```text
GET /api/google-sheets/monthly-daily.csv?month=2026-07
Authorization: Bearer <CASHFLOW_SHEETS_EXPORT_TOKEN>
```

QR กรุงศรี is exported as `qr_krungsri_amount` using the same priority rule: a matched bank
report amount wins, otherwise a submitted cashier amount is used.

`scb_credit_amount` fills the Kanklong `รูด เครดิต SCB` gross column from the submitted cashier
amount while no card closing report is available. Bank Statement evidence remains authoritative for
the separate net settlement column and does not get overwritten by this fallback.

Grab columns are `grab_sales_amount`, `grab_fee_20_amount`,
`grab_ads_promotion_amount`, `grab_bank_amount`, and `grab_source`. For a complete Grab report:

- sales = report cashier amount after merchant-funded promotion
- fee 20% = commission/tax + additional commission
- ads/promotion = marketing fee + merchant-funded delivery discount
- bank = report net amount, including settlement adjustments

An incomplete positive-sales report with a zero net amount is not treated as final. In that case the
feed exports only the submitted cashier sales amount and leaves the other three Grab amounts blank.

`cashier_misc_total` is the audit total of every free-form item added by the cashier for that receipt.
The feed also splits those items into the six sheet columns: cash-paid food/van/staff residuals,
บ้านพี่จุ๋ม, บ้านพี่เพ็ญ, บ้านคุณย่า, เครดิตพี่จุ๋ม/พี่เพ็ญ, and สมาชิก. The member column accepts only
labels containing สมาชิก, แลกแต้ม, or รีวิว. Every unmatched label goes to the cash-paid residual
column and remains visible in the cell note. An empty draft is exported blank so existing manual
sheet data is preserved; a submitted or closed receipt with no misc items is exported as zero.

The bound Apps Script project is managed with `clasp` in
[`google-apps-script/monthly-daily-sheet-sync`](./google-apps-script/monthly-daily-sheet-sync/README.md).

Default channel mappings:

- `เคพลัสช็อป` -> `QR_KPLUS`
- `GRAB` -> `GRAB`

### Grab branch mapping

Grab reports are assigned by the Grab store ID, while the sales total is the primary
reference amount. The settlement net amount is kept separately for matching the bank
transfer after Grab fees and adjustments.

| Grab store | Branch | Primary amount |
| --- | --- | --- |
| `ส้มตำ Hello solao (ฮัลโหล โซลาว) - ถนนรอบเมืองเชียงใหม่` | คันคลอง | Gross sales from the Grab report |
| `โซลาวบ้านเจ๊ - ต้นเปา (Hello Solao)` | สันกำแพง | Gross sales from the Grab report |

Both stores receive Grab transfers to Kasikorn account `030-8-66310-8`.
For `grab_bank_amount`, a matched statement transaction from this account is the
highest-priority actual amount for both branches. Until that statement is available,
the Grab report net amount is used. Grab sales, fees, and promotions continue to come
from the Grab report, with submitted cashier sales used only when the report is absent.

K SHOP daily emails are also routed by merchant ID: `KB000001590548` and
`KB000001995795` to คันคลอง; `KB000001927650` and `KB000002044790` to
สันกำแพง, all under `QR กสิกร`.

Full-month KBank PDFs can be imported idempotently as closed QR evidence. The route validates the
branch account, keeps existing matching K SHOP rows, adds only missing merchant transactions, and
records a closed zero for statement dates without Thai QR Payment:

```text
POST /api/inbox-imports/kbank-monthly
Authorization: Bearer <CASHFLOW_GMAIL_INBOX_TOKEN>
multipart/form-data: file, branch_code=KK|SK, month=YYYY-MM, dry_run=true|false
```

The San Kamphaeng statement can also be imported separately for Kasikorn card settlements. This
route accepts account `176-3-14786-6`, keeps only rows described as full payment / instalment /
reward-point sales, records closed zero days, and links the actual net deposit to
`CREDIT_CARD_KBANK` without mixing it with Thai QR:

```text
POST /api/inbox-imports/kbank-monthly-card
Authorization: Bearer <CASHFLOW_GMAIL_INBOX_TOKEN>
multipart/form-data: file, branch_code=SK, month=YYYY-MM, dry_run=true|false
```

The same Kanklong statement is imported separately for Grab so QR and Grab evidence never share a
receipt line. It validates account `030-8-66310-8`, maps the following-day X3812 deposits to both
stores using exact Grab-report nets, and uses the early/late settlement order only after at least
three exact-report days prove that order. Rows that still cannot be proven remain unlinked:

```text
POST /api/inbox-imports/kbank-monthly-grab
Authorization: Bearer <CASHFLOW_GMAIL_INBOX_TOKEN>
multipart/form-data: file, month=YYYY-MM, dry_run=true|false
```
- `CREDITCARD` -> `CREDIT_CARD`

Credit-card channels are branch-specific:

- `KK` (คันคลอง): `CREDIT_CARD_SCB`, `CREDIT_CARD_KTC`
- `SK` (สันกำแพง): `CREDIT_CARD_KBANK` only. Monthly statement imports use the actual Kasikorn
  card settlement while preserving the cashier-submitted gross amount separately.
- `SML - พร้อมเพย์` -> `PROMPTPAY`
