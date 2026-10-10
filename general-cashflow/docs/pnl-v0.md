# กำไรขาดทุนเบื้องต้น v0

ฐาน P&L fix1/fix2 ปล่อย Production แล้วตาม handoff 10 ต.ค. 2026 (source 61a032e); การเสริม POS ท้ายเอกสารเป็น Local ใน branch `codex/cashflow-pnl-pos-fallback` ยังไม่ push/deploy. หัวข้อประวัติ fix1/fix2 ด้านล่างบันทึกสถานะ ณ เวลาส่งตรวจเดิม.

## ขอบเขตและการเชื่อมต่อ

- P&L อยู่ใน General Cashflow; `management-accounting` คง freeze
- Admin เท่านั้นใช้ `report:pnl`; routes ทุกเส้นตรวจ login + permission ก่อน decision guard เดิมและ handler
- รายรับใช้ `daily_receipts.gross_sales_expected` ทุกสถานะ รวม VAT ไม่แทนด้วย close snapshot; `monthly_sales_closes.revision_number` เป็นป้ายเท่านั้น
- `PNL_LINE_BILL_BASE_URL`, `PNL_LINE_BILL_EXPORT_TOKEN`, `PNL_LINE_GROUP_BRANCH_MAP` เป็น optional config; ไม่มี URL/token ยังดู report ได้ แต่ sync ตอบ `PNL_NOT_CONFIGURED`
- ใช้ `Authorization: Bearer` ตรงกับ worktree งาน A commit `77d0c2d`; ไม่มี token ใน client/log/error
- Source seed `server/src/db.js` ระบุ `KK` = สาขาคันคลอง, `SK` = สาขาสันกำแพง; ไม่ hardcode LINE mapping และไม่ได้ต่อ Production DB

## ตารางและ API

DDL ใหม่ `server/src/pnl/schema.js` เรียกจาก migrateDatabase: `pnl_categories`, `pnl_expense_rounds`, `pnl_expense_items`, `pnl_category_rules`, `pnl_item_overrides`, `pnl_manual_expenses`, `pnl_sync_runs`.
เงินเป็น DECIMAL(14,2); คำนวณด้วย integer cents แปลงจาก money helper เดิมก่อนรวม.

ใต้ `/api/pnl`: GET report/items/categories, POST sync, PUT items/:stableKey/override, GET/POST rules + DELETE rules/:id, GET/POST manual-expenses + PUT/DELETE manual-expenses/:id.
ทุก mutation ลง logAudit ด้วย integer/null entityId (override ใช้ pnl_expense_items.id พร้อม stable_key ใน payload; rule จาก override อ่านกลับหลัง upsert); CRUD + override/rule อยู่ transaction เดียวกับ audit. DELETE manual เป็น soft delete.
เฉพาะ pnlError ที่ระบบกำหนดมี public code/status; error ภายในตอบ 500 PNL_REQUEST_FAILED และ console.error ข้อความคงที่ไม่ใส่ SQL/token/payload. Permission rejection ยังคง 403.
Decision reason flow เดิมคงอยู่เมื่อ config เปิด; client ใช้ request helper เดิม.

## Sync และการคำนวณ

- GET_LOCK บน connection ที่ใช้งานจนจบ run; lock ไม่ได้ → 409; pagination ทุกหน้า, timeout 20 วินาทีต่อ request, ไม่ตาม redirect
- skip เทียบ **list** fingerprint + profile_max_updated_at + branch mapping; snapshot_fingerprint เป็นข้อมูลประกอบ
- closed replace ใน transaction ต่อ round; open ลบ cache items แต่ override/rules/manual ไม่ถูกลบ
- ไม่มี pnl_fields_version/stable_key → FAILED `LBC_EXPORT_V2_REQUIRED`; round ที่สำเร็จก่อนหน้าใน run ยังอยู่และ report แสดงผล run FAILED
- stable_key ซ้ำใน snapshot ใช้แถวแรกและ bill amount ครั้งเดียว นับ duplicate_keys; ย้ายข้าม round → ใหม่ชนะ นับ moved_keys พร้อมซ่อม totals ของ round เก่า
- reimbursements/incoming ไม่บวกยอด เก็บจำนวนใน round เพื่อแสดงข้อความ; payments_without_bill รองรับชนิดแยก
- raw_json เก็บเฉพาะ P&L facts; ไม่เก็บ legacy account/recipient metadata; free text ปกปิดชุดเลขยาว
- override การนับและหมวดชนะ automatic; rule เรียง priority/id; unknown/draft นับพร้อมป้าย; ยังไม่จัดหมวดเป็น opex
- ส่วนกลางจาก manual แยกจาก LINE ไม่ระบุสาขา; ไม่มี allocation ส่วนกลางใน v0
- ความครบใช้ถึงเมื่อวานเวลาไทย และนับ closed date ไม่ซ้ำ; ถ้าวันเดียวมี open round ที่ map สาขาเดียวกัน ถือวันยังไม่ครบ
- ไม่มีข้อมูล round ของกลุ่มที่ไม่เคยส่งมา: ระบบรู้เฉพาะวันที่ขาดต่อสาขา ไม่อนุมานว่าทุกกลุ่ม LINE ครบ

## โหมดข้อมูลครบและกฎตั้งต้น (fix1)

- `completeness[].matched_dates/matched_days`: วันก่อนวันนี้เวลาไทยที่มีรายรับ CLOSED และ LINE ปิดครบทุก observed round ของสาขานั้น. วันที่มี open round แม้มี closed round วันเดียวกันไม่ผ่าน.
- `totals_matched`, `branch_columns[].matched`, `category_rows[].matched.amount/branches` คิด POS CLOSED/LINE เฉพาะ matched dates ของแต่ละสาขา. ผลรวม columns รวมส่วนกลางเท่ากับบริษัทด้วย integer cents.
- manual รายเดือนต่อรายการ: `round(amount_cents × matched_days / days_in_month)`; ส่วนกลางใช้วันที่ทุกสาขาครบพร้อมกัน (intersection). `matched_days/matched_dates` ระดับบริษัทและ CENTRAL คือ intersection; ยอดบริษัทเป็นผลรวมยอด matched ของแต่ละสาขาซึ่งอาจมีจำนวนวันต่างกัน ไม่ใช่จำกัดทุกยอดเหลือ intersection.
- `matched_unassigned_excluded_total` แสดงยอด LINE ไม่ระบุสาขาที่ปกติจะถูกนับแต่ตัดออกใน matched mode; UNASSIGNED column matched เป็นศูนย์.
- UI ค่าเริ่มต้น “เฉพาะวันที่ข้อมูลครบ”; การ์ด/ตารางใช้ matched พร้อมจำนวนวันและข้อความ manual เฉลี่ยตามวัน. เมื่อสลับ “ทั้งเดือน” ใช้ยอดเดิม; คำเตือนสีส้มใช้ `expense_missing_revenue_days` (จำนวนวันที่มี CLOSED revenue แต่ขาด LINE อย่างน้อยหนึ่งสาขา นับวันไม่ซ้ำ). กล่องรอจัดหมวด/รายการ/manual/drill-down ยังเป็นข้อมูลทั้งเดือน.
- “ดึงล่าสุด” แปลง DATETIME UTC ที่ไม่มี offset ให้เป็น ISO UTC ก่อนใช้ Cashflow-style Thai medium date / short time ใน Asia/Bangkok.
- Categories เพิ่ม TRANSPORT (65) และ ADMIN (75) ด้วย INSERT IGNORE. `created_by INT NULL` พร้อม ALTER MODIFY ที่รันซ้ำได้; NULL แสดง “ระบบ”.
- ตรวจ information_schema.TABLES ก่อน CREATE: ถ้า rules table ยังไม่มีจึง seed supplier 13 กฎ (priority 100) + purpose ตลาด (200), normalize ด้วย helper เดียวกับ CRUD/classify. ตารางมีแล้วแม้ว่าง/กฎถูกลบจะไม่ seed เติมกลับ. ฐานรอบก่อนที่มีตารางแล้วต้องไม่รับกฎตั้งต้นอัตโนมัติ ตามข้อ F5.

## การทดสอบ

ใช้ SSD runner เท่านั้น ไม่สร้าง MySQL ใหม่. pnl.test.js ใช้ stateful fake query/fetch; pnlRoutes.test.js ใช้ HTTP loopback + JWT/permission จริง + fake query/audit; client pure helper test.

เทสต์เดิมใช้ consumer และ fixtures 20 ไฟล์ที่ track ใน `server/test/fixtures/management-accounting-contract/` พร้อม README/provenance; เนื้อหา byte-identical กับ manifest ของรอบก่อน ไม่มีขั้น prepare หรือ dependency ต่อ checkout อื่น.

```sh
node /Users/surachart/.solao-tools/ssd-workspace.mjs run --project market-order-system --source /Users/surachart/solao-worktrees/cashflow-pnl-v0 -- sh -c 'cd general-cashflow/server && npm ci && npm test && cd ../client && npm ci && npm test && npm run build'
```

หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-handoff.md`.
หลักฐาน fix1: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix1-handoff.md`.
ค้าง: Claude ตรวจ fix1 กับ MySQL 8.4 จริง/LINE preview/POS จริงอีกครั้ง แล้วดำเนิน release ตามอนุมัติผู้ใช้; งานนี้ไม่สร้าง MySQL บน Mac.

## G1 ย้ายเดือนรับรู้รายจ่าย LINE (fix2, Local)

ตัวอย่าง “สรุปยอดชำระ supplier ประจำเดือน สิงหาคม 2569” วันที่จ่าย 5 ก.ย. 2569 จำนวน 467,281.73 บาท: ระบบแนะนำ ส.ค. 2569 ผู้ใช้ต้องกดย้ายเอง. งานนี้เพิ่มความสามารถ ไม่มีการบันทึก override ของบิลจริง.

### Schema/API

- `pnl_item_overrides.period_month DATE NULL`: วันที่ 1 ของเดือนรับรู้; NULL ใช้เดือน business_date. DDL ฐานใหม่มีคอลัมน์; ฐานเดิมตรวจ information_schema.COLUMNS ก่อน ALTER ADD แบบ idempotent ตามรูปแบบ ensureColumn ใน db.js.
- `PUT /api/pnl/items/:stableKey/override` รับ `period_month: 'YYYY-MM' | null`. ไม่ส่งฟิลด์ให้คงค่าเดิม. ห้ามเดือนหลัง business_date และย้อนหลังไม่เกิน 3 เดือนตามเดือนปฏิทิน (รองรับข้ามปี); ผิดตอบ 422 INVALID_PERIOD_MONTH. เดือนเดียวกับวันจ่าย normalize เป็น NULL.
- Mutation/audit อยู่ transaction เดียวกัน ใช้ integer expense item ID พร้อม stable_key และ period_month ใน before/after payload. ย้ายเดือนรักษาหมวด/excluded/note; จัดหมวด/ไม่นับรักษา period_month.

### Report และยอด

- LINE อยู่เดือน M เมื่อ period_month=M หรือ NULL และ business_date อยู่ M. loadReportData อ่านช่วงวันที่ OR override วันที่ 1 ของเดือน M พร้อม overrides ของทั้งสองกลุ่ม; rounds นอกเดือนต้อง closed และมีรายการย้ายเข้า. รายการย้ายออกคงอยู่ใน movement box แต่ไม่รวม totals/items ของเดือนต้นทาง.
- `items[].period_month` และ movement items แสดง YYYY-MM/null; `suggested_period_month` เป็น YYYY-MM/null. API ตัด raw_json และเติม source_url ให้ทั้งสามกลุ่ม.
- `moved_in`, `moved_out`: `{items,count,amount,counted_amount}`. amount รวมยอดเต็มของรายการที่ย้ายทั้งหมด (รวม excluded); counted_amount รวมเฉพาะ !excluded. moved_out.items[].period_month บอกเดือนปลายทาง; business_date คงวันจ่ายจริง.
- ทั้งเดือนนับยอดเต็มเฉพาะเดือนปลายทาง. matched mode เฉลี่ย moved_in ต่อรายการ `round(amount_cents × branch_matched_days / days_in_destination_month)`; ไม่ระบุสาขาตัดออก. LINE เดิมไม่ย้ายยังนับตาม business_date ตรง matched dates. ยอดครบสาขารวมตรงยอดบริษัทและ category ด้วย cents. การย้ายไม่ทำให้วัน LINE/POS ครบเพิ่ม และไม่ย้าย reimbursement/incoming counts ของ round.
- UI ทั้งรอจัดหมวด/drill-down/กล่องย้ายเข้าออกมี input month พร้อม min/max, ปุ่มย้ายเดือนและปุ่มเด่น suggestion ที่ต้องกดเอง. กล่องปลายทางแสดงวันที่จ่ายจริง/ย้ายกลับ; ทั้งหมวดและไม่นับทำได้เหมือนเดิม. เดือนใช้ชื่อไทย + พ.ศ. ย้ายกลับส่ง null.

### คำแนะนำและทดสอบ

`suggestPeriodMonth(description,businessDate)` pure function ตรวจคำว่า ประจำเดือน/เดือน ตามด้วยชื่อเดือนไทยเต็มหรือย่อ และปี พ.ศ. 4 หลักที่อาจมีหรือไม่มี (รองรับ พ.ศ. ก่อนตัวเลขด้วย). ไม่มีปีเลือกปีใกล้ที่สุดที่เดือนไม่อยู่หลังวันจ่าย. คืนค่าเฉพาะเดือนก่อนหน้าที่ย้อนไม่เกิน 3 เดือน; เดือนเดียวกัน/อนาคต/เกินช่วง/ไม่พบเดือน คืน null. ไม่แก้ข้อมูลโดยอัตโนมัติ.

`server/test/pnlPeriod.test.js`: ตัวอย่าง 4 กรณีบังคับ + ปี พ.ศ./ข้ามปี/เกิน 3 เดือน, validation, migration ซ้ำ, closed-only query, matched cents/unassigned/excluded/branch filter/ย้ายกลับ และ invariant ผลรวมสองเดือนคงเดิม ต้นทางลดเท่าปลายทางเพิ่ม. pnlRoutes.test.js ตรวจ 422/rollback/no audit เมื่อ invalid, normalization, คงหมวด/excluded/period และ integer audit. client tests ตรวจช่วงเดือนข้ามปีและชื่อไทย/พ.ศ.

ผล full command ตามหัวข้อการทดสอบ: server 306 ผ่าน / skip 1 เดิม (opt-in DB), client 48 ผ่าน, Vite build ผ่าน. Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-07-17-615Z-e4225fe8/reports/command.log`. npm ci รายงาน dependency vulnerabilities และ Vite มี chunk-size warning; ไม่แก้ dependencies นอก scope G1. ยังไม่ได้รัน MySQL จริงหรือ browser interaction ใน fix2; Claude ตรวจ schema/query กับ MySQL 8 และ UI/integration ต่อ. ไม่ push/deploy.

หลักฐาน fix2: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix2-handoff.md`.

## รายรับ POS ที่ยังไม่มีใบรับเงิน (Local, 10 ต.ค. 2026)

ผู้ใช้เลือกให้เสริม POS เฉพาะวันไม่มี daily_receipts. ทุกสถานะ/ยอดศูนย์ของใบรับเงินที่มีอยู่ชนะ POS เสมอ. ไม่สร้างใบรับเงิน ไม่เปลี่ยนสถานะ/closing และไม่บันทึก cache ใหม่. ดึงแบบ read-only จาก fetchExpectedSalesRange เดิมสำหรับสาขาที่ขาดวัน จนถึงเมื่อวานเวลาไทย (ไม่ดึงวันปัจจุบัน/อนาคตมาเสริม); ไม่มี POS row คือไม่ทราบ ไม่ใช่ยอดศูนย์.

`revenue_pos_without_receipt[]` มี branch_id, receipt_date, gross_sales_expected, bill_count, source=POS_WITHOUT_RECEIPT. `pos_revenue_status` เป็น available/not_needed/unavailable + unmapped_branch_ids; unavailable เพิ่ม code=PNL_POS_UNAVAILABLE. รายรับตามใบรับเงิน + POS ส่วนเสริม = revenue ทั้งโหมดเต็มเดือนและ matched และสาขารวมตรงบริษัทด้วย cents. totals เพิ่ม receipt_revenue/pos_without_receipt_revenue/pos_without_receipt_days (จำนวนคู่วัน-สาขา).

วันที่ข้อมูลครบสำหรับคำนวณ matched ยอมรับ POS ส่วนเสริมที่มีข้อมูลจริงคู่กับ LINE ปิดแล้ว; ความครบการปิดใบรับเงินคงแยกชัด: revenue_days/revenue_missing ใช้ receipt CLOSED เดิม ขณะที่ revenue_available_days/revenue_unavailable/pos_without_receipt_dates อธิบายแหล่งรายรับ. UI แสดงแหล่งรายรับที่นำมาคำนวณตามโหมด พร้อมตารางรายรับทั้งเดือนและสถานะ POS ส่วนเสริมที่ยังไม่มีใบรับเงิน. ใบรับเงินที่สร้างภายหลังจะมาแทน fallback ในการโหลดรอบหน้า.

ClickHouse error/timeout 20s/invalid amount → ยังคงแสดงยอดใบรับเงินพร้อมคำเตือนรายรับและกำไรยังไม่ครบ ไม่เปิดเผย response upstream หรือ credential. สาขาไม่มี mapping แสดงคำเตือนแยก. Report GET ไม่มี financial mutation/audit write; guard admin ก่อน DB/POS เดิมไม่เปลี่ยน.

Full SSD runner log: /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-47-47-919Z-d2b64d42/reports/command.log; server311 pass/skip1, client48/build. หลักฐาน/ข้อจำกัดเพิ่มเติมในรายงาน pos-fallback-20261010-handoff.md บน SSD reports/pnl-v0. ไม่มี Production test/deploy ในงานนี้.

## HRMS payments — owner-confirmed basis (2026-10-10)

เจ้าของยืนยันว่า HRMS ถือว่าจ่ายครบแล้ว จึงใช้ **เงินเดือนสุทธิของรอบ LOCKED + เงินต้นเบิกกลางเดือนที่ APPROVED + ทิปจ่ายแยกของรอบ FINALIZED** เป็นยอดเงินจ่ายพนักงาน แทน gross wages. ไม่บวกยอดหักคืน/ดอกเบี้ย/repayment ซ้ำ. หน้าสรุป advance อ่านเฉพาะ APPROVED อยู่แล้ว; ไม่อ่านคำขอ SUBMITTED/REJECTED/CANCELLED. ไม่แก้สถานะหรือข้อมูล HRMS.

- `server/src/pnl/hrms.js` ใช้ GET `/api/payroll/runs/YYYY-MM` และ GET `/api/advance-requests/summary?payment_month=YYYY-MM` รวม GET `/api/tips/runs?payout_month=YYYY-MM`. ต้องใช้ ADMIN bearer ที่ได้จาก login ปกติของเจ้าของ ผ่าน `PNL_HRMS_READ_TOKEN` ฝั่ง server; ไม่ปลอม JWT ไม่ extract browser session และไม่เปิดเผยต่อ client. Token หมดอายุ/ต้นทางล้มเหลวแสดง incomplete; ไม่แทน unknown ด้วย confirmed zero. ไม่ใช้ accounting export POST เพราะมี artifact/audit write.
- `PNL_HRMS_BASE_URL` ต้อง HTTPS (ยกเว้น loopback test). `PNL_HRMS_BRANCH_MAP` map ชื่อสาขา payroll snapshot/advance summary ไป Cashflow code `KK`,`SK` หรือ bucket `PRODUCTION`,`CENTRAL`. ไม่กระจายส่วนกลาง/ผลิตเข้าสาขาร้านอัตโนมัติ. ไม่ map → UNASSIGNED พร้อม warning. Payroll ใช้ branch ที่ snapshot; advance summary ใช้สาขาปัจจุบันจาก HRMS จึงมีข้อจำกัดเมื่อย้ายสาขาย้อนหลัง.
- คืนเฉพาะ aggregate ต่อสาขา/แหล่ง ไม่ส่งชื่อพนักงาน เลขบัญชี รายละเอียดหัก หรือ attendance. ตรวจ net รวมตรงกับ run.total_net และเงินต้นรวมตรง summary.totals.principal; duplicate/malformed/restricted advance scope → unavailable ทั้งแหล่ง.
- เงินเดือนลงเดือนของ payroll run เพราะไม่มีวันที่โอนเงินเดือนทั้งรอบ. เก็บ period_start/end และ `date_basis=PAYROLL_MONTH`; ห้ามเรียกวัน lock/period_end ว่าวันโอนจริง. เงินเบิกลงเดือนรับเงินวันที่ 15 และแสดง date_basis=SCHEDULED_ADVANCE_DATE; เดือนอนาคตไม่ดึงเป็นยอดจ่ายแล้ว.
- `payment_basis=OWNER_CONFIRMED_PAID` หมายถึงคำยืนยันเจ้าของ ไม่ใช่ธนาคารยืนยัน. รอบ legacy LOCKED ใช้ได้ตามคำยืนยันนี้โดยไม่สร้าง hash ย้อนหลัง. รอบที่ยังไม่ LOCKED ไม่นับเงินเดือนและแสดง warning.
- HRMS นับเต็มเดือนทั้งโหมด month และ matched ไม่เฉลี่ยยอดจ่ายจริงตามจำนวนวัน; UI เตือน matched และให้เปลี่ยน month เพื่อเทียบรายรับทั้งเดือน. ทำให้ matched net profit เปรียบเทียบกับเดือนเต็มไม่ได้.
- รายการ post-payment corrections ยังไม่ดึงอัตโนมัติ (ตรวจ ส.ค.–ต.ค. พบ 0 รายการ). ทิป FINALIZED นับทุก allocation รวมคนชั่วคราว และตรวจยอดตรงทุก pool; TIP_SEPARATE เป็น INFO ไม่รวม net payroll จึงบวกครั้งเดียว. ต้องตรวจบิล LINE/รายการ STAFF กรอกเองก่อนใช้ยอดเพื่อป้องกันการบันทึกจ่ายพนักงานซ้ำข้ามแหล่ง. นี่เป็นมุมเงินออกตามที่เจ้าของเลือก ไม่ใช่ค่าแรงตามบัญชีคงค้าง.
- Release ได้รับอนุมัติจากเจ้าของ 10/10/2026. ตรวจยอดจริง ส.ค. 1,084,636 (net 1,035,262 + advance 27,000 + tips 22,374), ก.ย. 990,457 (net 958,457 + advance 32,000; tips DRAFT ไม่นับ); ต.ค. payroll/tips DRAFT และไม่มี APPROVED advance จึง 0. API credential ปกติมีอายุ 90 วัน ต้องต่ออายุก่อนหมดอายุ; แสดง incomplete เมื่อเชื่อมไม่ได้.

### Native Cashflow fees

Report reads CLOSED receipt lines and reconciliations in the same transaction as the receipt report. CASH lines are excluded. For a settlement batch use `settlement_batch_allocated_fee_amount`, never repeat aggregate batch fee on every day. Otherwise use stored `fee_amount`. Category MARKETING includes platform fees and marketing already inside gross-to-net deduction once; do not separately add Grab marketing to that total. Missing/null/invalid allocation is unknown, warning `partial`, not confirmed zero. Month totals include full fee; matched totals retain only branch/date matched rows. No receipt writes, recalculation or upstream refresh.

Receipt miscellaneous presets (เช็คอิน, แลกแต้ม, สมาชิก, รถตู้, เครดิต …) are signed reconciliation adjustments without expense type, not a reliable cash expense ledger. Do not auto-import them as expenses. Explicit expense bills/payment-without-bill remain in the LINE source and explicit manual expenses remain available. Cross-source wage/fee duplication requires operator review; no historical rows are silently deleted/reclassified.

### Production reconciliation 2026-10-10

ตรวจครบ 75/81 payroll items และ APPROVED advances 15/16 รายการ ส.ค./ก.ย.; IDs และ employee/date/amount keys ไม่ซ้ำ. LINE stable keys 378 ไม่ซ้ำ, manual 0. ตัด P&L #2283 จำนวน 330,000 ด้วย audited override เนื่องจากเป็นโอนระหว่างบัญชีบริษัทเพื่อเติมบัญชี payroll (ข้อความต้นทางและคู่สลิป #2287); คงต้นฉบับ LINE. #1299 ค่าแรงทดลองงาน 2,520 ไม่อยู่ใน payroll และ #1374 ค่าแรงเงินสด 360 เจ้าของยืนยันนอก HRMS จึงนับเพิ่มเป็น STAFF พร้อม audit note. คำเตือน STAFF ใช้ตรวจความเสี่ยง ไม่ใช่ยืนยันว่าซ้ำ. เงินเดือนอยู่เดือนรอบตามข้อตกลง ไม่ถือว่าได้ตรวจ bank statement ทุกบัญชี.

ค่าธรรมเนียม receipt CLOSED ส.ค. 124,167.37 และ ก.ย. 61,634.84 ไม่มี allocation ที่หาย. `/health.build.source_sha256` hash source server/src + client/src จริงขณะเริ่มโปรเซส ใช้เทียบ release worktree; CASHFLOW_BUILD_COMMIT เป็น build argument สำหรับ CLI release ที่ไม่มี Git metadata. ไม่มี HRMS source/schema changes.
