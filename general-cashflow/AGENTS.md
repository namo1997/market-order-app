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
