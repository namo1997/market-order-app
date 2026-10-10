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
