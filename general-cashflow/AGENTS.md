# นำเข้าอีเมลแบบ incremental — อนุมัติ 29 ตุลาคม 2026

- Production29Oct: server ff92dae/deployment c5a590bd-0f3c-4fcd-8094-0176406fe6f2, runtimeSHA e40b98f8dbdac6d1c0ea3bfee43e1549ca9ce9054fa7dc4b5fc9713ad8f5de2f /98files. Apps Script/runtimeใหม่ใช้จริง; inventory331+Grabใหม่1 รวม332acknowledged ไม่มี unresolved. อย่า replay45วันด้วย legacy thread readerอีก.
- หลักฐาน242BLOBตรงchecksumต้นฉบับครบ; Inboxเพิ่มสุทธิ91. Krungsri43รายงานศูนย์อยู่ PENDING_REVIEW ไม่ใช่รายการเงินขาด. CLOSED148snapshot/linesคงเดิม; POS drift62วันเดิมอัปเดตสองcache timestamps88วันตามปกติ พิสูจน์normalized row hashตรงทั้งหมด. Source/helperหลังreleaseบางcommitเป็นGAS/audit/docsเท่านั้น; server production-base ต้องตรงff92dae.

- พบ Krungsri SUMMARY-only ที่ระบุทุกช่องทางและ GRAND TOTAL เป็นศูนย์จริง. `parseBankReportZip` มี opt-in เฉพาะ `/api/inbox-imports/krungsri`: ตรวจชื่อ ZIP/วัน/merchant/header/ทุกยอดครบและเป็นศูนย์ก่อนรับ; เก็บ ZIP เดิมและ audit, ไม่สร้าง bank transaction/receipt match, สถานะ PENDING_REVIEW เสมอ. ข้อมูลหาย/ยอดบวก/ขัดแย้งยัง reject; ไม่เปิด fallback ให้ธนาคารอื่นและไม่แก้ schema/credentials.
- `retryCashflowKrungsriAfterParserFix` ใช้เฉพาะ backfill ที่อนุมัติแล้ว: ตรวจ health/runtime SHA ของ parser ที่แก้ตรงก่อนเร่ง retry เฉพาะ Krungsri HTTP400. เก็บ attempts/failure history/manual reason ไว้ ไม่ล้าง shared Gmail backoff และไม่เร่ง error อื่น.

- `inspectCashflowMailStatus` ใน `CashflowMailAudit.gs` อ่านเฉพาะ checkpoint/failure/proof metadata โดยไม่เรียก Gmail/Cashflow API. ตัวตรวจ `inspectCashflowKrungsriFailure` อ่าน ZIP ที่ fail เพียงหนึ่งข้อความเพื่อหาสาเหตุ ไม่ post/import/แก้ retry; เก็บผลส่วนตัวบน SSD. ใช้ audit ยืนยัน scan หมดและจับคู่ checksum/importId; ห้าม dump config/token ดิบ.

- ผู้ใช้อนุมัติแก้ live importer ลดการอ่านซ้ำและนำเข้าหลักฐานค้าง; ยังไม่อนุมัติ confirm/close/แก้ยอดหรือ Sheets. อ่าน `docs/mail-incremental-import.md` และคง target โครงการ Solao เดิม ไม่ใช้ monthly Sheet clasp target.
- `google-apps-script/CashflowMailRuntime.gs` ใช้ Gmail REST message IDs, durable per-source page/index/watermark, per-message/per-file acknowledgement และ shared quota backoff. ห้ามลบ legacy success/audit markers. ใช้ native inbox-import routes เดิม; ไม่มี schema/permission change.
- เริ่ม bootstrap ช่วงย้อนหลัง 45 วันเดิม แล้วใช้ overlap สองวัน. เก็บ failure ledger แยกและไม่อ้างครบเมื่อยังมี unresolved. รักษา CONFIG/credentials/helper และตาราง trigger เดิม; ก่อนเปลี่ยน handler ให้ probe Gmail API และตรวจ mailbox ตรง solao.acc@gmail.com.
- Tests อยู่ `google-apps-script/test/cashflowMailRuntime.test.mjs`; รันผ่าน SSD runner โดย snapshot เฉพาะ google-apps-script ไม่ต้องสำเนา dependencies ฝั่ง server. ล่าสุด18/18ผ่าน; bank target20/20/full server405pass/2native gates skipped. หลักฐาน private และ backup source อยู่ SSD ตาม docs/CHANGELOG.

# Grab twice daily schedule — prepared, 26 October 2026

- Latest owner approval replaces Grab five-minute scheduling with midnight/noon Asia/Bangkok. `GrabTriggerSchedule.gs` creates only importGrabReports atHour0/12 + nearMinute0 + everyDays1 + explicit timezone; Google may vary execution by approximately15minutes. Setup has no Gmail calls, creates replacements before removing only old Grab triggers, and checks all other trigger IDs unchanged. The standalone legacy createGrabFiveMinuteTrigger name delegates to the daily setup.
- Live project has independent handlers, so target only Grab. Its legacy createAllFiveMinuteTriggers will retain the other bank handlers at their existing cadence and delegate Grab to the new helper; never run the all-bank setup as this change. The separate combined monthly Sheet project/its shared trigger is outside this live release and stays unchanged.
- Local affected mock tests16/16 pass and combined source syntax/unrelated-code preservation checks pass. Configuration is not yet applied/read back. Today do not run another import after Gmail quota failure; real ingestion/dedup acceptance waits until27October Thai time. Do not assume quota resets at midnight.
- Plan/evidence: `/Volumes/SSD Files/SOLAO/cashflow/backups/grab-live-script-20261026/twice-daily-prepared.json`. Server remains verified3c105e05/30d779fa with unchanged runtime hash; these are Apps Script-only source changes.

# Grab server rollout — Production, Apps Script pending, 26 October 2026

- Server candidate `3c105e059bff787d141cd972808ff5cf33348528` deployed successfully as `30d779fa-0a04-4915-80db-41f14befb03a`. Public health ready; runtime source SHA256 `19a1a39d7f2239ccb1a56213652927b737ca1b22cb430be7a593de0758e016b9` /98 files matched. Canonical Git export (257 byte-verified files) kept `general-cashflow/` for the existing Railway rootDirectory; this was not a simulation copy. Cloud Node20 Alpine image build passed. Work/integration branches pushed and production-base advanced to the live commit.
- Existing live Apps Script source `รหัส.gs` backed up privately on SSD:297 lines/11185bytes, SHA256 `09009bf5392ac4ede50ba38b44c2fa7fc07641a2efdb5f20b47be738d8218537`; independent recopy matched. No live Head save or runtime-file creation yet: Mac locked. Preserve existing CONFIG/credentials and unrelated functions; local Grab-only combined syntax/global-collision/unrelated-code checks passed. Never push the monthly Sheet .clasp target to this importer.
- Five existing Head/time triggers observed; Grab execution starts demonstrate the existing five-minute cadence. No trigger saved/installed/deleted. Pre-release Grab execution failed with daily Gmail quota at getOrCreateLabel_; the same quota may prevent acceptance until recovery. Exact reset time unknown. Do not change credentials, triggers or dedup history to evade quota.
- Fresh SSD checks: Grab35/35, client57/57/build;28 saved PDF checksums/net matched. Native406/406 is retained evidence on the identical candidate, not a fresh production test. Exact MySQL version parity remains unproven. No successful new ingestion, live repeat/dedup, full45-day coverage or post-release financial invariance claimed.
- Continue without retrying the rejected blank-PIN/bulk financial read. Existing baseline at05:14UTC has148CLOSED rows,136stored closing snapshots; this is not proof after release. If required, the minimum comparison is one authorized existing CLOSED-list GET through a proper owner-authenticated session, using protected summaries and snapshot hashes; no148detail/attachment/BLOB reads. No financial mutation, manual replay, migration command or OAuth/credential change in this release.
- Evidence: `/Volumes/SSD Files/SOLAO/cashflow/reports/grab-release-20261026/release-result.json`; source backup metadata at `backups/grab-live-script-20261026/final-backup-verification.json`.

# Native Grab release gate — Local, 24 October 2026

- HTTP handler เป็น `server/src/grabInboxRoute.js`, shared bank-proof recalculation เป็น `server/src/receiptStatementAmount.js`; extraction คง logic/SQL เดิม byte-for-byte และ auth/upload wiring ยังอยู่ server.js.
- `server/test/grabInboxImport.mysql.test.js` รันเฉพาะ fixture port/root ที่มี identity manifest ตรง datadir/server UUID ของ instance NEW บน SSD. ห้ามชี้ไปฐานเดิมหรือ Production tunnel. ผู้ใช้อนุมัติ create/drop/migrate เฉพาะ disposable fixture ใหม่ของงานนี้แล้ว; ไม่ใช่สิทธิ์ migration Production.
- Node20.20.2 + nativeMySQL9.5 gate ผ่าน406/406 ไม่มี skip. KILL CONNECTION cleanup อาจ asynchronous: test poll จริงแบบจำกัด2s และต้องกู้ key เดิมได้โดยไม่มี duplicate/CLOSED changes; ผลวัด22ms. Docker/Alpine ยังไม่ผ่าน gate เพราะ Docker storage นอก SSD และ daemonปิด; ห้าม bypass/ย้าย/เปิดเอง. รายละเอียดเวอร์ชันและหลักฐานอยู่ docs/grab-import-reliability.md.

# Grab importer repair — Local candidate, 24 October 2026

- อ่าน `docs/grab-import-reliability.md` ก่อนแก้/ปล่อย pipeline นี้. `server/src/grabInboxImport.js` ใช้ checksum advisory lock + transaction บน connection เดียว; API เดิม `/api/inbox-imports/grab` ไม่เปลี่ยน permission/schema. New source_message_id เป็น attachment hash; Gmail ID จริงอยู่ใน raw_payload/audit. เก็บ legacy rows/dedup history และไม่รับ FAILED เป็น success.
- Shared Apps Script runtime คือ `google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js`; standalone/combined Grab entry เรียกตัวเดียวกัน. แก้ Head ของ live project เป็น Production switch ทุก 5 นาที; ต้องอนุมัติ release ก่อน ห้าม push `.clasp.json` ของ Sheet project ไปแทน live importerโดยเดา target.
- ไม่เรียก legacy `refreshGrabCashierExpectedAmounts()` ตอน startup: ฟังก์ชันเดิมเขียน historical/CLOSED evidence และ match states โดยไม่มี audit ใหม่. Replay/repair ย้อนหลังต้องแยกอนุมัติ. Server deploy ทำให้ trigger เดิมนำเข้าต่อได้ทันที จึงต้องอนุมัติ automatic ingestion พร้อม release หากยังมี trigger ทำงาน.
- คง gross/VAT/commission/marketing/promotion/income-adjustment/net และ branch mapping เดิม; missing/unknown ไม่ใช่ศูนย์. ห้ามนำ parser success ไปยืนยันเงินจริงหรือปิดรอบ. Card-fee mappings ไม่อยู่ในแพตช์นี้.
- Tests/fixtures/logs ใช้ SSD ตาม root policy; PDF ต้นฉบับไม่อยู่ Git. `CASHFLOW_GRAB_FIXTURE_DIR` เป็น path ของ test fixtures เท่านั้น ไม่ใช่ credential/Production env ใหม่. ผลและข้อจำกัดอยู่ CHANGELOG; ยังไม่มี deployment/live reimport/migration.

# General Cashflow source notes for the Business MCP task

## อนุมัติและปล่อยฐานค่าธรรมเนียม Grab — 13 ตุลาคม 2026

- เจ้าของอนุมัติ deploy ตัวแก้และบันทึก `before_adjustment` เฉพาะ Grab สันกำแพง 25 ก.ย. (line3045) ตามชีทเดิม โดยห้ามแก้ชีทต้นฉบับ. การอนุมัตินี้ supersedes Local-only ของส่วน Grab fee basis ด้านล่าง; ไม่ครอบคลุมการปิดรอบที่ยังขาดหลักฐานหรือรายจ่ายอื่น.
- Runtime code7de5f7b เริ่มปล่อย deployment3ceea76e-8057-4f04-9122-03b23e884e4c; source SHA2569477fc4382bec9b2ca047e2dfeb1e2163b345feb494f5619782682e2cc83ea35 /95files ตรง committed source และ empty preference คงยอดเดิม. แก้ build commit marker เก่าด้วย `CASHFLOW_BUILD_COMMIT` และตรวจ release identity สุดท้ายก่อนบันทึกฐาน.
- ก่อน migration มี fresh read-locked snapshot44tables/5193BLOBs; restoreNativeMySQL9.5 บนSSDตรวจทุก row/plain timestamp/BLOBhashผ่าน. อ้างอิงไฟล์ที่ไม่อยู่ในBLOBมี7pathsเดิมที่API404 (10references) เก็บข้อจำกัดจริง ไม่เรียกว่ากู้คืนแล้ว; ไม่มี filesystem-wide SSH archive เพราะไม่มีSSHkey. ทุก referenced path ที่มีข้อมูลจริงอยู่ใน snapshot BLOB.
- บันทึกฐานผ่าน native PUT/decision audit โดยอ่าน fingerprint/version สด; คงเงินจริง4969.82/nativefee/closing snapshot/HRMSและAugustSKเดิม. รายงานเต็มเดือนคาดเพิ่มexpense127.10/profitลด127.10; ห้ามสร้างmanual balancing expense. หลักฐานและสถานะสุดท้ายอยู่ `/Volumes/SSD Files/SOLAO/market-order-system/reports/grab-fee-release-20261013-1791864376848/`.

## Grab fee basis per receipt — Local, 13 October 2026

- Original SK August 17/18 formulas net their adjustments in commission; September 25 puts +127.10 in income and retains commission before adjustment. Do not hardcode receipt IDs, months, signs or new all-branch conventions. Existing defaults remain visible as unreviewed until a per-record choice is evidenced.
- Additive/idempotent `pnl_grab_fee_basis`: receipt_line_id PK, treatment enum net/before_adjustment, source_fingerprint, reference, reason, version, updated actor/time and deleted_at. No source amount, bank, receipt/closing snapshot or HRMS changes. No Production migration/release in this task.
- PUT/DELETE `/api/pnl/cashflow-fees/:receiptLineId/sheet-basis` retain report:pnl, human decision, transactional audit with integer line ID. Require expected_version; PUT also requires current source fingerprint and actual report provenance. Reset uses soft delete and increments version, including restore; stale report can still be reset. Audits and changes roll back together.
- Fingerprint canonical cents/line/date/branch inputs plus latest Grab import ID, transaction ID and archive checksum. Report ignores choices in settlement basis; sheet basis applies valid choices, stale choices use stored net and warn, missing source warns on every branch. Keep zero-net choices visible independently of counted expenses. External Sheet changes are not monitored: reference is audited human evidence.
- `GrabFeeBasis.jsx` is in Sources, uses only computed options, requires reason/reference and displays whole-month impact. `local_read_only` disables mutation. Protect concurrent edits with 409 rather than last-write-wins. Tests/builds/isolated native MySQL and browser fixtures run only on SSD snapshots.
- Evidence: `/Volumes/SSD Files/SOLAO/market-order-system/reports/september-closeout-20261012/`; latest projection confirms September profit 942,415.99 Local versus Production 942,543.09, and SK August fee total remains 58,865.83. Tests and final handoff recorded in CHANGELOG.

## อนุมัติ release การเงิน — 12 ตุลาคม 2026

- เจ้าของอนุมัติ Cashflow fee ตามชีท/ทิปนอกค่าใช้จ่าย/SSO ledger และ native บันทึก SSO 52,520 บาท (เงินเดือนก.ค., เดือนจ่ายส.ค., วันที่ตามชีท25ส.ค.). อนุมัตินี้ supersedes Local-only ของสามแพตช์; ห้ามเขียน Sheets/HRMS. Release เฉพาะ service general-cashflow ตาม root workflow, committed source + message/hash + push own/base หลังยืนยัน runtime.
- หลักฐานบิล #2791 รวม SSO อยู่ในยอด 133,179: ต้องไม่นับทั้งบิลเดิมพร้อม ledger. Native override ไม่นับ original และ manual TAX 80,659 + ledger SSO52,520 มี audit/เหตุผลเชื่อมกัน; ห้ามแก้ยอดบิล/สลิปต้นทางหรือบันทึกส่วนต่างลอย ๆ. Manual TAX ใช้ proration matched ตามกติกา manual เดิม; reconciliation ชีทใช้ทั้งเดือน.
- Production DB สด 9.7.2; consistent dump/restore native9.5บนSSDและ absent-BLOB historyต้องรายงานจริง ไม่เรียก Production8.4จาก note เก่า. หลักฐานก่อน/หลังและ backup อยู่รายงาน financial-release-20261012-1791778007970 บน SSD.

- `GET /integrations/dot/reconciliation` is a read-only integration route. `CASHFLOW_DOT_EXTRA_TOKENS_JSON` adds separately scoped token hashes without rotating the existing connector token; raw tokens stay in a secret store.
- The route reads only receipt-day and older residual candidates. It does not prove refund completeness or resolution status; null remains unknown.
- All tests/builds and generated output follow `/Users/surachart/.solao-tools/SSD_POLICY.md`; deploy only from committed canonical source after the user's approval under root `AGENTS.md`.

## Named Admin access

- Keep the Admin operator list in `client/src/App.jsx` and `server/src/domain/cashierAccess.js` aligned: สา (`admin_sa`), โม (`admin_mo`), จ๋า (`admin_ja`), เพ็ญ (`admin_pen`), จุ๋ม (`admin_jum`), dot (`admin_dot`).
- The five existing identities use the existing six-digit Admin PIN check. Owner-authorized `admin_dot` has `requiresPin: false` and logs in on selection through the same `/api/auth/admin-pin` route with an empty PIN. This identity grants full Admin access to anyone who selects it; do not extend the exception to other names. The server creates a distinct user on the first successful login and keeps disabled accounts disabled; adding a name does not require a schema migration.

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

## P&L fee comparison — Local, 2026-10-11

- GET report/items accept optional `fee_basis=settlement|sheet`; default settlement. Sheet basis: branch code KK uses valid Grab report component fees before income adjustments; SK retains net deductions as its Sheet does. This is an explicit reporting convention, not new cash expense or a Sheet mutation. Keep the excluded income adjustment visible in status/UI and use the same basis for prior-month comparison.
- Valid Grab payload requires finite components/income adjustment, matching cashier/gross/net/stored fee, and gross−components+adjustment=net. Batch allocations always win; missing/stale reports keep original amount with partial warning in KK sheet basis. Never add marketing again to gross component sum.
- SCB report-only fee derivation requires BANK_SETTLEMENT, one matched Statement, confirmed status and exact agreement of expected net, matched amount, line Statement amount and transaction sum. Keep gross>=net>0; no inference for manual/unmatched/batch/other channels. Expose before/after amounts; preserve native receipt reconciliation/closing data.
- Loader uses correlated subqueries for latest Grab report and Statement aggregate to avoid multiplying receipt lines. Raw payload never enters report response. Fee warning/adjustment/correction details follow branch filter.
- Original financial patch was based on runtime381a59c; integrated with verified runtime8e0b394 (cash-first mobile page) before handoff; Local350 server pass/1 existing skip, client57/build pass. No schema/env/new mutation. Production fee and native SCB stale record remain unchanged until separately authorized release/action; do not claim Local projections as deployed values. Evidence folder is recorded in CHANGELOG.

## P&L เงินทิปเป็นเงินผ่าน — Local, 2026-10-11

- คำยืนยันล่าสุดของเจ้าของ “ทิปเราไม่นับเป็นค่าใช้จ่ายครับ” ยกเลิกกติกาเดิมที่บวก FINALIZED tips เป็น expense. คงการตรวจ pools/allocations รวมผู้รับชั่วคราวไว้; adapter แยก hrmsPassThrough (excluded, category null, PASS_THROUGH_NOT_EXPENSE) จาก hrmsExpenses. ห้ามแก้ locked net pay หรือประวัติจ่ายทิปใน HRMS.
- Report รับ hrmsPassThrough แยกและกรองสาขา คืน hrms_pass_through / hrms_pass_through_total. เงินผ่านไม่เข้ารายจ่าย/HRMS total/หมวด STAFF/กำไรทั้งเดือนหรือ matched; UI แสดงเป็นข้อมูลประกอบที่ไม่หักกำไร. ไม่มี schema/env/new endpoint หรือ automatic LINE matching.
- LINE ที่เป็นทิปต้องใช้ native audited exclusion หลังตรวจเอกสาร/ข้อความ ไม่หักทุกบิลที่ยอดเท่ากับ pool อัตโนมัติ. บิล #1133 สันกำแพง 8,674 ได้แยกใน Production ตามคำสั่งนี้ แต่แพตช์ HRMS ยัง Local; ต้องบอกสถานะแยกกัน.
- Tests บน SSD: server351 ผ่าน/skip1 เดิม, client57/build ผ่าน. แพตช์ fee ก่อนหน้ายังไม่ได้ deploy เช่นกัน; อนุมัติปล่อยใหม่ต้องระบุทั้งสองขอบเขต. รายงานพนักงานและหลักฐานอยู่ใน CHANGELOG.

## P&L ประกันสังคมนำส่งจริงและบันทึก reconciliation — Local, 2026-10-11

- `pnl/socialSecurity.js` และตาราง additive/idempotent `pnl_social_security_payments`: id BIGINT, month_start DATE UNIQUE, payroll_month DATE, payment_date DATE, amount DECIMAL(14,2) positive, note required, created/updated/deleted actor/time. หนึ่งยอดรวมบริษัทต่อเดือนจ่าย; soft-delete/upsertคืนรายการเดิม ไม่ลบประวัติ. ไม่แตะตาราง HRMS.
- GET/PUT/DELETE `/api/pnl/social-security-payment` อยู่ภายใต้ admin report:pnl และ decision guard ของ router เดิม. PUTรับ month/payroll_month/YYYY-MM, payment_date/YYYY-MM-DD อยู่เดือนจ่ายและไม่ใช่อนาคต, amount string positive cents, note1–500; payroll_monthไม่หลังเดือนจ่าย. SELECT FOR UPDATE + mutation + audit `pnl.sso.create/update/delete` อยู่ transactionเดียวกัน, entityIdเป็น integer; auditล้มเหลวต้องrollback.
- ไม่มีแถว active → ใช้ HRMS SSOเดิม. มีแถว active → ตัดเฉพาะ HRMS_SOCIAL_SECURITY_EMPLOYEE/EMPLOYER ของเดือนรายงาน แล้วเพิ่ม CASHFLOW_SOCIAL_SECURITY_PAYMENT เป็น STAFF/CENTRAL ใน fullและmatchedเต็มยอด. คงเงินเดือนสุทธิ/เงินเบิก/ทิปเงินผ่านเดิม. Branchviewไม่ปันยอดบริษัทเข้าสาขาและต้องแก้จากทุกสาขา; reportคืน social_security_payment/expenses/total และ replaced_hrms_amountให้ตรวจ.
- `SocialSecurityPayment.jsx` อยู่ในแหล่งข้อมูล P&L: แสดงเดือนเงินเดือน/วันที่/หลักฐาน/ยอดที่ใช้แทน, บันทึกหรือกลับฐาน HRMSผ่าน APIปกติ. Preview local_read_onlyปิดปุ่ม และ previewserverปฏิเสธทุก mutationโดยอิสระ. UIไม่สั่งโอนเงินหรือเปลี่ยน HRMS; แสดงSSOเดิมเป็นข้อมูลประกอบเมื่อใช้ยอดนำส่งจริง.
- คำยืนยันเจ้าของ: Part Time4,375แยกนอก HRMS; SSO52,520ของเงินเดือนก.ค. วันที่25ส.ค.มาจากชีทA30 (ยังไม่ยืนยันธนาคาร). PartTimeบันทึกnativeid3/audit25909แล้ว; SSOยังเป็นLocalproposal ไม่สร้างProductionแถวก่อนอนุมัติrelease. การแยกทิป/advance LINEต้องมีต้นฉบับและ audited overrideรายรายการ ไม่ตัดด้วยยอดเท่ากันอย่างเดียว.
- บันทึกทุกการไม่นับ/เปลี่ยนหมวด/เพิ่มรายจ่ายพร้อมเหตุผล source key/ยอดก่อน–หลัง/audit/สถานะLocalหรือProductionใน CHANGELOGและ SSD adjustment-ledger.csv; ไม่เปลี่ยนชีท ไม่เพิ่มยอดชดเชยส่วนต่าง. Handoff sourceอยู่ docs/employee-reconciliation-2026-08.md.
- Final SSD suite355server/1skipเดิม,57client/buildผ่าน; migration/API/auditจริงผ่าน native MySQL9.5บนSSD/loopback. Production8.4ไม่ได้ใช้ในการทดสอบนี้. รวมruntimemobile8e0b394ผ่านmerge05e1f07แล้ว; ก่อนreleaseต้องrefreshidentity/รวมฐานที่ปล่อยล่าสุดและได้รับอนุมัติใหม่สำหรับfee+tips+SSO. ไม่มี push/deployในงานนี้.

- Phone review is `MobileCashReview.jsx` (view `mobile-review`, opened by receipt id from the day page). It reuses existing audited APIs only; never send an empty `variance_reason` that would erase a saved reason. Desktop keeps Dashboard/ReconciliationMatrix.

## Reconciliation continuation — 12 Oct 2026

- Latest owner instruction pauses deploy/push/migration. Native actions described in CHANGELOG are saved in Production; fee/tips/SSO code and SSO52,520ledger/TAX80,659 split remain Local. Do not deploy automatically just because backup restore passed.
- Use `final-native-private.json` and `kk-audit/after-native-category-bridge-final-native-private.json` under the financial-release SSD evidence folder. Actual profit904868.84 differs from pending Local975097.84; corrected Sheet/tip basis935565.855261682. Prior checkpoints do not include all latest closures/manual/period moves.
- Preserve native recurringid1,manualids4–11, and overrides2048/720/2931/3643/2533. Existing financialfields bystablekey were checked unchanged. Do not add duplicate utility/supplier manual amounts; periodmoves keep paidSeptember dates.
- Do not forcecloseKK9/30 orSK6: source767 lacksdate/total;2237isemployeeGYSremittance and cannot honestly pass purchase/service receipt checks;645isconfirmedpair withAIfailed andmissingfile. Current AIretry can change confirmedamount/category and invalidatepair. Need original evidence or a narrow audited correction before closing.
- Cashflow Sheets are read-only. Expenseleafcells4679were recorded with named descriptions/cellnotes; generic residuals and unidentified credits remain pending. Market transferamounts1924/2117/2159 already agree with Sheet; do not replace them with purchase totals.
- The restored backup predates nativeactions; refresh a consistent baseline before future release. Preserve original failed backup attempts and seven pre-existing unavailablefiles as evidence, not recovered claims.
