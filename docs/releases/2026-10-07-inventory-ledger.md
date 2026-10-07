# ชุดแก้คลัง INV-01..07 และตั้งยอดจากการนับล่าสุด วันที่ 7 ตุลาคม 2026

Production SUCCESS: `80d2e500-494a-47be-b84f-d15304bde15e` (`market-order-app` / `production`) จุด rollback คือ `bbf8d57f-4079-441b-971f-0d302fabcff3`

## สิ่งที่เปลี่ยน

- โค้ดจาก branch `inventory/stock-bugfix-2026-10-07` (INV-01..07 + แก้ deadlock `lockBalanceRow`) ดู `docs/modules/inventory.md`
- ไฟล์ใน release: `server/src/controllers/inventory.controller.js`, `server/src/controllers/recipe.controller.js`, `server/src/models/inventory.model.js`, `server/src/models/stock-check.model.js`, `server/src/utils/stock-ledger.js` (ใหม่), `server/src/utils/bangkok-date.js` (ใหม่ใน release), `server/tests/stock-ledger.test.mjs` (ใหม่), `server/scripts/reflow-stock-ledger-absolute.mjs` (ใหม่) ไม่มี schema/migration
- `POST /api/inventory/init-balance` รับ `quantity` เป็นยอดเป้าหมาย (ไม่ใช่ส่วนเพิ่ม)

## วิธีจัด release

- ฐานคือ `releases/2026-10-06-app-launcher-icon/release/` (deployment `bbf8d57f`) ไฟล์ทั้ง 4 ที่แก้ hash ตรงกับ commit ฐาน `265abf4` จึงวางไฟล์จาก branch ทับได้ตรง ๆ ไม่รวมงานค้างอื่น
- Tests 61/61 และ client build ผ่านบนสำเนาแยกใน SSD

## ข้อมูล Production ที่แก้ (ผู้ใช้อนุมัติ: ระบบคลังยังไม่มีผู้ใช้จริง)

1. สำรอง DB ก่อนแก้ `data-fix/pre-reflow-railway.sql.gz` (sha256 `ecdd5657…cfec91`) restore บน SSD แล้ว จำนวนแถวคลังตรงกับ Production
2. `reflow-stock-ledger-absolute.mjs --apply` เปลี่ยน 32 คู่ (รอบแรกเน็ตหลุดหลัง commit 2 คู่ รอบสองอีก 30) ยอดเปลี่ยน 20 คู่ ส่วนใหญ่แก้การตัดซ้ำจาก INV-01
3. `apply-latest-stock-checks.mjs --apply` ปรับยอดจากการนับล่าสุดที่ยังไม่เคย apply 237 รายการ 12 กลุ่ม (วัน, แผนก) ไม่มีข้าม
4. ตรวจซ้ำ: การนับค้าง 0, reflow dry-run 0 คู่, `/health/db` 200

## สิ่งที่ยังเหลือ

- 526 คู่ยอดติดลบ คือสินค้าที่ไม่เคยถูกนับแต่ถูกตัดตามสูตรขาย จะถูกต้องเมื่อเริ่มนับและกดปรับยอด
- INV-08, INV-09 ยังไม่แก้; ยังไม่มี branch `market/production-base` (ต้องขออนุมัติก่อนสร้าง)

## หลักฐาน (SSD)

`/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-07-inventory-ledger/` มี `base/`, `release/`, `*-manifest.sha256`, `tests.log`, `build.log`, `deploy.log`, `data-fix/` (backup, รายงาน dry-run/apply)
