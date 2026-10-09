# กำไรขาดทุนเบื้องต้น v0

สถานะ 10 ตุลาคม 2026: Local ใน branch `cashflow/pnl-v0` สำหรับ Claude ตรวจ ไม่มี push/deploy/Production DB

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
ทุก mutation ลง logAudit; CRUD + override/rule อยู่ transaction เดียวกับ audit. DELETE manual เป็น soft delete.
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

## การทดสอบ

ใช้ SSD runner เท่านั้น ไม่สร้าง MySQL ใหม่. pnl.test.js ใช้ stateful fake query/fetch; pnlRoutes.test.js ใช้ HTTP loopback + JWT/permission จริง + fake query/audit; client pure helper test.

เทสต์เดิมใช้ consumer และ fixtures 20 ไฟล์ที่ track ใน `server/test/fixtures/management-accounting-contract/` พร้อม README/provenance; เนื้อหา byte-identical กับ manifest ของรอบก่อน ไม่มีขั้น prepare หรือ dependency ต่อ checkout อื่น.

```sh
node /Users/surachart/.solao-tools/ssd-workspace.mjs run --project market-order-system --source /Users/surachart/solao-worktrees/cashflow-pnl-v0 -- sh -c 'cd general-cashflow/server && npm ci && npm test && cd ../client && npm ci && npm test && npm run build'
```

หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-handoff.md`.
ค้าง: Claude ตรวจ integration/MySQL migration และ preview snapshot จริง แล้วขออนุมัติ release เอง.
