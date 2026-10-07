# CHANGELOG — market-order-app

บันทึกประวัติการแก้ไข (ภาษาไทย) ตามกติกาใน `AGENTS.md`

## 2026-10-07 — แก้บั๊กระบบคลัง INV-01..INV-07 (Local, ยังไม่ deploy)

- **สถานะ:** Local — branch `inventory/stock-bugfix-2026-10-07` ฐาน commit `265abf4` ยังไม่ push/ไม่ deploy
- **สิ่งที่ทำ**
  - INV-01/02: รายการ stock_check เป็นยอดสัมบูรณ์ใน reflow (`server/src/utils/stock-ledger.js`, `recalculateLedgerBalances`); sync ขายตามสูตร, แปรรูป, ลบยอดขาย reflow ledger ใน transaction เดียวกัน
  - INV-03: ล็อกแถว `inventory_balance` (`lockBalanceRow`) ใน `createTransaction`, แปรรูป, apply, reflow
  - INV-04/06: แก้ `is_applied`/`has_newer_applied` และ `system_quantity` ในรายงาน variance
  - INV-05: กรองวันที่ไทยเป็นช่วง UTC (dashboard, ประวัติแปรรูป, ลบยอดขาย, gate ของ apply, usage report, realtime balance, effective date ของ movement/stock card)
  - INV-07: `init-balance` ตั้งยอดสัมบูรณ์ (`setInitialBalance`); ล้างเช็คสต็อกที่ apply แล้วตอบ 409
  - เอกสาร: `docs/modules/inventory.md` (บั๊กที่รู้แล้ว + บั๊กที่พบเพิ่ม INV-08..10), `docs/modules/modules.json`
- **ผลทดสอบ (รันผ่านตัวรัน SSD):** `node --test server/tests/*.test.mjs` 14 ผ่าน/0 ล้มเหลว ทั้ง TZ=UTC และ TZ=Asia/Bangkok; import controllers/models ที่แก้ได้ทั้ง 5 ไฟล์; `vite build` ของ client สำเร็จ; SQL ยังไม่ได้ทดสอบกับ MySQL จริง
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/inventory-stock-bugfix-2026-10-07.md`
- **ค้างอยู่ก่อน deploy**
  - SQL ที่แก้ยังไม่เคยรันกับ MySQL จริง ต้อง smoke test บน DB สำเนาใน SSD (variance report, sync ขาย, ลบยอดขาย, แปรรูป)
  - ตรวจ INV-10 (stock_check เก่าที่ `balance_after` อาจไม่ใช่ยอดนับ) เทียบกับ `stock_checks.stock_quantity` ก่อน deploy
  - INV-08, INV-09 ยังไม่แก้
  - ยังไม่ได้แก้ `AGENTS.md` (ไม่มี route/ตาราง/enum ใหม่) ค่าความหมายของ `init-balance` เปลี่ยนเป็นสัมบูรณ์ ต้องแจ้งผู้ใช้หน้าจอที่เรียก
