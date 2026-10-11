# General Cashflow source notes for the Business MCP task

- `GET /integrations/dot/reconciliation` is a read-only integration route. `CASHFLOW_DOT_EXTRA_TOKENS_JSON` adds separately scoped token hashes without rotating the existing connector token; raw tokens stay in a secret store.
- The route reads only receipt-day and older residual candidates. It does not prove refund completeness or resolution status; null remains unknown.
- All tests/builds and generated output follow `/Users/surachart/.solao-tools/SSD_POLICY.md`; deploy only from committed canonical source after the user's approval under root `AGENTS.md`.

## Named Admin access

- Keep the Admin operator list in `client/src/App.jsx` and `server/src/domain/cashierAccess.js` aligned: สา (`admin_sa`), โม (`admin_mo`), จ๋า (`admin_ja`), เพ็ญ (`admin_pen`), จุ๋ม (`admin_jum`).
- All five identities use the existing six-digit Admin PIN check. The server creates a distinct user on the first successful login and keeps disabled accounts disabled; adding a name does not require a schema migration.

## P&L v0 (Local, fix1 for Claude verification)

- อ่าน `docs/pnl-v0.md` สำหรับ schema 7 ตาราง, routes `/api/pnl`, env `PNL_LINE_BILL_BASE_URL`, `PNL_LINE_BILL_EXPORT_TOKEN`, `PNL_LINE_GROUP_BRANCH_MAP` และคำสั่ง full tests บน SSD.
- `report:pnl` ให้ admin เท่านั้น; keep existing decision audit flow + logAudit ทุก mutation. ใหม่อยู่ `server/src/pnl/` และ `client/src/ProfitLoss.jsx`.
- List fingerprint ใช้ skip พร้อม profile timestamp; snapshot_fingerprint แยก. Duplicate keys ใช้แถวแรกครั้งเดียวและนับ; overrides/rules/manual เป็นข้อมูลคนกรอก ห้ามลบตอน sync.
- ไม่บวก reimbursements/incoming; เก็บ counts ต่อ round; manual DELETE เป็น soft delete. Missing export v2 → FAILED. ไม่มี cron/AI/VAT split/ส่วนกลาง allocation.
- Test ไม่สร้าง MySQL บน Mac. เทสต์เดิมใช้ frozen contract assets ที่ track ใน `server/test/fixtures/management-accounting-contract/`; รัน full suite ผ่าน SSD runner โดยไม่ต้อง prepare และไม่อ่านโมดูลที่พักแล้ว.
- สถานะ Local เท่านั้น; Claude เป็นผู้ตรวจและดำเนิน release หลังผู้ใช้อนุมัติ ห้าม push/deploy ในงาน B.

- Audit entityId เป็น integer/null เท่านั้น; override ใช้ expense item id พร้อม stable_key ใน payload, rule-from-override อ่าน id หลัง upsert. Unexpected route errors log ข้อความปลอดข้อมูลลับและตอบ PNL_REQUEST_FAILED.
- Report คงยอดทั้งเดือน และเพิ่ม totals_matched/branch_columns[].matched/category_rows[].matched. Default UI เป็น matched; LINE/POS ใช้ matched dates ต่อสาขา, manual ปัด cents ตาม matched days/วันเดือน, ส่วนกลางใช้ intersection ทุกสาขา; ไม่รวม LINE ไม่ระบุสาขา.
- pnl_category_rules.created_by NULL คือระบบ; seed 14 rules เฉพาะเมื่อยังไม่มีตารางก่อน CREATE. Migrate ซ้ำ/ผู้ใช้ลบกฎต้องไม่เติมกลับ. Categories TRANSPORT/ADMIN ใช้ INSERT IGNORE.
- MySQL DATETIME sync strings เป็น UTC; client เติม Z ก่อนแสดง dateStyle medium/timeStyle short ใน Asia/Bangkok เหมือน Cashflow.

## P&L v0 fix2 — G1 เดือนรับรู้ (Local)

- `pnl_item_overrides.period_month` เป็น DATE วันที่ 1 หรือ NULL. Guard information_schema.COLUMNS ก่อน ALTER ADD รองรับฐานเดิม; ห้ามสร้าง MySQL บน Mac ให้ Claude ตรวจ MySQL 8 จริง.
- Override period_month รับ YYYY-MM/null; จำกัด 0–3 เดือนย้อนหลังจาก business_date, เดือนเดียวกันบันทึก NULL; omitted ต้องคงค่าเดิม. ห้ามย้ายจาก suggestion อัตโนมัติ.
- loadReportData โหลด LINE ตามช่วงวันที่ OR period override เดือนปลายทาง, overrides ครบ และ rounds นอกช่วงเฉพาะ closed ที่มีรายการย้ายเข้า. buildReport กรองเดือนรับรู้ก่อนคำนวณ; count คืนเงิน/เงินเข้ายังคงเดือนของรอบเดิม.
- moved_in/moved_out `{items,count,amount,counted_amount}`: amount ยอดเต็มรวมรายการ excluded, counted_amount เฉพาะนับ. แต่ละ item period_month เป็น YYYY-MM/null และ suggested_period_month เป็นคำแนะนำ. API ตัด raw_json และเติม source_url ให้ทั้งรายการปกติ/ย้ายเข้า/ย้ายออก.
- โหมด matched: ย้ายเข้าเฉลี่ย cents ตาม matched days ของสาขา / วันเดือนปลายทาง, ตัดไม่ระบุสาขา; LINE ที่ไม่ย้ายยังใช้วันจ่ายตรง matched dates. ทั้งเดือนนับเต็มเพียงเดือนรับรู้. ย้ายกลับส่ง null; category/excluded mutation ต้องรักษา period เดิม.
- Full SSD tests/build fix2 ผ่าน server 306 + skip 1, client 48; handoff `cashflow-pnl-v0-fix2-handoff.md` บน SSD reports/pnl-v0. Local เท่านั้น ห้าม push/deploy.

## P&L POS ส่วนเสริม — Local, 2026-10-10

- ผู้ใช้เลือกเสริม POS เฉพาะวันไม่มีใบรับเงิน ไม่ refresh/create daily_receipts และไม่แทนใบรับเงิน OPEN/ยอดศูนย์. `server/src/pnl/revenue.js` อ่าน fetchExpectedSalesRange (FINAL/cancelled filtering/Bangkok ตามเดิม) เฉพาะสาขาที่ขาดวันก่อนวันนี้; timeout 20s ผ่าน optional AbortSignal ใน clickhouse.js.
- Report เพิ่ม `revenue_pos_without_receipt`, `pos_revenue_status`, totals/branch matched `receipt_revenue`, `pos_without_receipt_revenue`, `pos_without_receipt_days`. รายรับรวมใช้ cents และ POS fallback ไม่มีการเขียน cache/schema/env ใหม่.
- completeness คง revenue_days/revenue_missing เป็นใบรับเงิน CLOSED; เพิ่ม revenue_available_days/revenue_unavailable/pos_without_receipt_dates. matched ใช้ CLOSED receipt หรือ POS ส่วนเสริม + LINE closed; ไม่อ้างว่าปิดใบรับเงินแล้ว. เมื่อ receipt มีขึ้นครั้งถัดไป ยอด receipt ชนะและ POS supplement หายไป.
- POS fail/invalid amount → PNL_POS_UNAVAILABLE ใน metadata ไม่ส่ง error upstream/token และไม่เติมศูนย์; ไม่มี branch mapping แสดง unmapped_branch_ids. ไม่มี POS row ไม่อนุมานยอดศูนย์. UI แยกยอดและวันที่ พร้อมคำเตือนเชื่อมต่อและรายการใบรับเงินที่ยังไม่ปิด.
- Full SSD tests: server 311 pass/1 skip เดิม, client48/build ผ่าน. ใช้ fixtures สมมติ/HTTP read-only; ไม่อ่านหรือเขียน Production. รายงาน: /Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/pos-fallback-20261010-handoff.md. Claude ตรวจ/release หลังผู้ใช้อนุมัติ; ไม่มี push/deploy ในงานนี้.

## HRMS paid basis — Local, 2026-10-10

- Owner explicitly confirms HRMS is paid: locked net payroll + approved advance principal only; no gross/repayment/interest addback. Read `docs/pnl-v0.md` for date basis, special branch buckets and limitations.
- GET-only optional server adapter in pnl/hrms.js; no HRMS writes/auth extraction. Config PNL_HRMS_BASE_URL/PNL_HRMS_READ_TOKEN/PNL_HRMS_BRANCH_MAP; owner provides ADMIN bearer, never frontend token. Return aggregates only; errors/missing configuration remain visible.
- Keep HRMS amounts full in matched mode with warning; do not silently prorate paid cash amounts. Payroll month is a reporting convention, not verified transfer date. Existing HRMS source remains untouched; Local only pending authenticated integration and release.
- Native fee reader uses CLOSED noncash receipt lines, batch allocated fees and gross-to-net aggregate once (Grab marketing already inside). Keep missing fees unknown and visible. receipt_misc_items are not automatically cash expenses.

## HRMS Production release authorization — 2026-10-10

- Owner explicitly authorized Codex to configure HRMS, reconcile real paid figures and duplicates, and release Production. This supersedes earlier Local-only/Claude release gates for this scope. Release from isolated integration based on current deployed 4c0f1d9; preserve cashier receipt issues.
- Add FINALIZED tip allocations (including temporary recipients) once; TIP_SEPARATE is payroll INFO, outside net. Check pool totals, allocation IDs and branch references. Draft tips are excluded. Cashflow health publishes source_sha256 over actual server/client source for release verification.
- Connect using normal owner ADMIN login credential on server only (90-day JWT, renew before expiry), never mint/forge JWT or extract browser credentials. HRMS source unchanged. All Production reads and audited P&L overrides retain evidence only on verified SSD.

- Production verified: deployment194febf6, sourceaf749b6, runtime source SHA2563fea6080… / 82 files. Native startup repairs update non-P&L metadata; full DB hashes differ, compare original P&L business fields/fees and retain audit. Locked HRMS/approved advances unchanged; current draft attendance can change during normal usage. Connection token expires 2027-01-08; refresh through normal owner login and skip-deploy secret update before scoped release.

## P&L รายจ่ายประจำยอดคงที่ — Local, 2026-10-10

- `pnl_recurring_expenses` และ `pnl_recurring_skips` เป็น additive/idempotent MySQL 8 DDL ใน pnl/schema.js. ห้ามลบ expense row; series_id ของเวอร์ชันแรก = id ตัวเอง. ไม่มี cron/หลักฐาน/การลงจ่ายเงินจริงใหม่.
- `pnl/recurring.js` ลงทะเบียน GET /recurring?month, GET /recurring/series/:seriesId, POST /recurring, PUT /recurring/:id, POST /recurring/:id/stop, PUT/DELETE /recurring/:id/skips/:month ภายใน router report:pnl admin และ decision guard เดิม. ทุก mutation audit integer entityId ใน transaction เดียวกัน.
- สร้าง start_month รับ YYYY-MM ภายใน ±12 เดือนจากเดือนปัจจุบันเวลาไทย. STAFF → 422 STAFF_FROM_HRMS. PUT ต้องส่ง effective_month และข้อมูลรายการครบ; เดือนต้องอยู่ในช่วง version. E=start แก้เดิม; E>start ปิด version เดิม E−1 และสร้างใหม่พร้อม end เดิม; ย้าย skips ตั้งแต่ E ไป version ใหม่ใน transaction/audit เดียวกัน.
- stop รับ last_month เป็นเดือนสุดท้ายที่นับ (inclusive). ไม่ให้ขยาย version ที่ปิดแล้วเพื่อป้องกันทับ version หลัง. UI "หยุดตั้งแต่เดือน" ส่งเดือนก่อนหน้าเป็น last_month. Skip ต้องอยู่ในช่วง version และมีเหตุผล; ยกเลิก skip มี audit. History รวม versions/skips; รายการที่หยุดแล้วหาได้จากเดือนที่เคย active.
- Report recurring={items,total,skipped,duplicate_warnings} แยก manual_expenses. ใช้ bucket/COGS/proration cents เหมือน manual; ส่วนกลางใช้ intersection matched dates. Warning LINE เฉพาะรายการ counted เดือนรับรู้/หมวด/สาขาเดียวกัน ±5% จากยอด recurring พร้อม source_url; ไม่หักยอดเอง. ไม่แก้ HRMS/POS/fees.
- UI RecurringExpenses.jsx อยู่เหนือ manual พร้อมฟอร์ม/เหตุผล/ประวัติ; loading ไม่แสดง totals. Browser fixture 768px อยู่ SSD, ไม่ต่อ Production.
- Full SSD server 327 pass/1 skip เดิม, client48/build ผ่าน. Handoff `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/recurring-expenses-handoff.md`. Claude ตรวจ MySQL 8.4 tmpfs ต่อ; ห้าม push/deploy ในงานนี้.


## P&L month advice + TAX — Local A/B, 2026-10-11

- `pnl_credit_suppliers` and `pnl_seed_versions` added; normalize patterns with domain.normalize. Version seeds `credit-suppliers-v1`/`tax-rules-v1` commit with flag, never restore user-deleted rows. Categories ensure pnl_group default OPERATING, TAX group TAX/sort90; rules priority50 keep explicit category overrides.
- `/api/pnl/credit-suppliers` GET/POST/DELETE/:id and POST `/items/period-month/bulk` remain admin report:pnl + human decision + transactional audit. Bulk accepts 1–200 unique stable keys; same validation/saveOverride audit (expense item integer id), preserve category/excluded/note, rollback all on any failure.
- Report advice includes suggested_period_reason; explicit month wins, then credit 1–10 / utilities 1–15; no suggestion on excluded/period override. UI requires human click, bulk default all checked. Read docs/pnl-v0.md for two-argument suggestPeriodMonth compatibility.
- `opex` excludes TAX. Full/matched/company/branch totals include operating_profit/tax/net_profit_after_tax; net_profit aliases after-tax. Category sum = cogs+opex+tax (cents). No change to matched proration, revenue/fees or HRMS imports.
- This branch implements A/B only: do not edit pnl/hrms.js or implement C; C belongs to cashflow/pnl-hrms-sso. Integration conflict candidates: report.js, ProfitLoss.jsx, CHANGELOG/AGENTS/docs. Re-run all checks after merging; no push/deploy from this task. Handoff on verified SSD reports/pnl-v0/month-tax-handoff.md; MySQL 8.4 integration remains Claude's check.
## P&L ประกันสังคมจาก HRMS — Local, 2026-10-11

- LOCKED payroll เพิ่ม STAFF ส่วนพนักงาน social_security และนายจ้างจำนวนเท่ากันต่อสาขา/เดือนรอบ; matched นับเต็มเหมือน HRMS เดิม. หาก field หาย/null แม้หนึ่งรายการ ไม่นับทั้งสองส่วนและ status missing/totals null; 0 ที่ระบุจริงถือว่าครบ.
- UI เตือนข้อมูลไม่ครบและ overlap LINE/manual ประกันสังคม|สปส โดยไม่ตัดยอดเอง. HRMS source อ่านอย่างเดียว; ไม่มี schema change/push/deploy. Handoff บน SSD reports/pnl-v0/hrms-sso-handoff.md.

## Admin mobile — Local, 2026-10-11

- `MobileAdmin.jsx` / `mobileAdmin.css` แสดง admin-only shell <=760px; desktop/cashier navigation remains separate. Entry is mobile-home; existing `?view=overview` link remains supported.
- Mobile overview uses the existing GET `/api/reports/receipts-overview` with sale/daily basis, page_size 12, and current month ending at Bangkok today. Never create/refresh POS receipts from the new home or card list.
- Retain null amounts, server pagination/summary semantics, overlapping attention/pending counts, abort stale requests, and unsaved-review-note guards. Card actions link to existing audited workflows; no new API/schema/env.
- Phone receipt review follows LINE Bill's queue/evidence/action layout: select one payment channel, inspect its image or document, then use the bottom action to save/confirm that channel through the existing API. Hidden channel rows remain mounted so switching channels preserves draft amounts. Empty channels are available through an explicit toggle.
- A cashier document preview is reference evidence, never proof of a bank match; only the existing evidence_attachment_id links a confirmed source. Authenticated image previews revoke object URLs and ignore obsolete requests. Calendar and branch/date selection keep the existing receipt filters and do not create missing receipts.
- Issues and import/audit history are progressively disclosed on phones; desktop workflows retain their existing controls.
- User approval is still required for deployment. Local preview fixtures and screenshots belong on verified SSD only.

- Local snapshot preview may supply optional `preview_snapshot` metadata (`date`, `captured_at`, `read_only`, `attachments_copied`). Mobile UI shows the fixed day and disables edits/missing evidence; the local snapshot server independently rejects mutations. This is a presentation hint, not an authorization mechanism for Production.

## Mobile admin Production release — 2026-10-11

- User explicitly authorized upload after Local review. Runtime release `381a59c` / Railway `5858d57d-1319-4d59-b4dd-9cfa8516cb8a` verified SUCCESS, health commit/hash/file count match committed source.
- Mobile Admin has Home/Receive only; calendar and branch/date selection retained. Evidence first, one channel at a time; backend runtime and schema unchanged. Full SSD server344/client57/build passed (server1 existing skip). Protected11 financial tables/schema and 1 Oct summary identical before/after.
- Browser verification is read-only on Production; persistence and channel drafts were tested on separate Local QA DB. Import/print variants were not exhaustively exercised. Release evidence in CHANGELOG.

## Phone receipt review redesign — 2026-10-11

- Phone admin receipt page: day card selector, channel checklist rows (`.ma-channel-row`) with one expanded work card, and sticky `.ma-day-actions` for day workflow/messages. Keep phone-only behaviour behind `mobileReceipt`/`phoneDetail`; desktop matrix and workflow stay unchanged.
- Never reference `mobileReceipt` outside `ReconciliationMatrix` (print sheets have no viewport state). Phone confirm stays disabled while the actual amount is empty/zero; correction requires a reason.
- Sticky actions need `overflow-x:clip` (not hidden) on the phone shell, and flex children must not keep a z-index above the bar.
- Phone admin has a single destination `mobile-receipts` (no home, no bottom nav): month + day strip from GET `/api/daily-receipts`, branch cash cards from the overview CASH line. Phone review opens on CASH and lists other channels as plain rows. Keep reads side-effect free.
