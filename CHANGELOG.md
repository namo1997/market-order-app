# CHANGELOG — ระบบรับสินค้า (branch receiving/integration-20261020)

## 2026-10-20 — รวมงานรับสินค้า + เชื่อมบัญชีเจ้าหนี้ + สต๊อก + ออกแบบ UI (สถานะ: Local / Staging บางส่วน)

ผู้ทำ: Codex gpt-6.1-sol (A1, B, C, D, UI-1..UI-5), Sonnet subagents (แก้/รวม), Claude ตรวจ/รวม/ทดสอบ
ผลทดสอบล่าสุด (int-r4, 2 รอบบน SSD): server 642/642 · client 797/797 · pilot 51/51 · vite build ทั้งสองผ่าน · APK `reports/receiving-int-r4/receiving-debug.apk`

### งานที่รวมใน branch นี้
- **ฐาน receiving/apk 0e9cda5** (งาน 20 ต.ค. ก่อนหน้า): คิวรวมร้านไม่บังคับรับ, หน้าร้านค้าและชื่อย่อ (1 แถว/ร้าน, รหัสเจ้าหนี้ตามสาขา, ลิงก์ไปหน้าซัพเดิม), เตือนจำนวนผิดปกติ, หมายเหตุต่อบรรทัด, void ข้ามวันโดยบัญชี 7 วัน, ใบวางบิล/ใบสรุปรอบ (statement), ส่วนลดบรรทัดติดลบ, จับคู่ด้วยรหัสสินค้าในบิล, แผ่นเซ็นเต็มจอ, รับของค้าง (รับก่อนหน้า/ยังขาด), 11ข (ยืนยันรับไม่เขียน actual_price), 10ข (ซ่อนเมนูรับสินค้าเดิม + สวิตช์ LEGACY_RECEIVING_WRITES_ENABLED), Dockerfile Node 22
- **A1** `fa6d38c` endpoint ส่งออกใบรับของให้บัญชีเจ้าหนี้ `GET /api/receiving-export/ap/v1/documents` (env `RECEIVING_EXPORT_TOKEN`, ไม่ตั้ง = 503) + `receiving_supplier_branch_codes.branch_id` + index — สัญญา `reports/integration-2026-10-20/CONTRACT-receiving-ap-export-v1.md`
- **B** `78283c1` สต๊อก: ล็อกยอดคงคลังร่วม, คืนของลดสต๊อกแบบระบุจำนวนหน่วยฐาน (ตาราง `receiving_issue_stock_returns`), กันลดซ้ำตอน void, ลิงก์ที่มาใบรับใน StockMovements/StockCheck
- **C** `5509367` + `b6426c4` เพิ่มสินค้าให้ร้าน/นำเข้า CSV พร้อม preview + ชื่อย่อ/รหัสในบิล ใน transaction + audit; pilot seed แม่ริม SYNTHETIC; แก้ DDL pilot ที่ MODIFY คอลัมน์ FK บน MySQL จริง
- **UI-1** `7e96f09` คิว: แยกว่าง/ผิดพลาด, CTA ตามร้าน, ฟอร์มนับ/IME
- **UI-2** `4b5d303` เทียบบิล/สรุป/เซ็น/สำเร็จ: ป้าย blocker, ledger ที่ทราบ/ไม่ทราบ, ลำดับขั้น 4 ช่อง (นับ·ตรวจ·สรุป·เซ็น), AI provenance
- **UI-3** `cd2f0f6` โทเคนดีไซน์ร่วม + หน้าแอดมินรับของ/ร้านค้า + เลือกสาขาจริงให้รหัสเจ้าหนี้
- **UI-4** `6dfc11f` ลำดับชั้นหน้าติดตามปัญหา
- รวม/แก้หลังรวม: `10d0e5a`, `0627ea1`, `62c2266`, `01434cf` (เทสต์ class shell ตามพฤติกรรม), `d8315ef`

### งานคู่ใน general-cashflow (branch แยก ยังไม่รวม)
- **A2** `cashflow/ap-receiving-import` `a1ebcc8` นำเข้าใบรับของเป็นหลักฐานซื้อใน AP ledger (ไม่สร้างยอดจ่าย), กันซ้ำกับ LBC, env `MARKET_RECEIVING_EXPORT_URL`/`MARKET_RECEIVING_EXPORT_TOKEN` — server 398 · client 81
- **UI-5** `cashflow/ap-ui-redesign` `f626b02` หน้า AP ledger/ใบรับของตามโทเคนร่วม — server 398 · client 83

### Deploy / สถานะ
- Staging `solao-receiving-staging`: deployment `1216ff56` (commit 4631bd0 ของ receiving/apk) SUCCESS 2026-10-20 17:35 — **deploy ครั้งนั้นไม่ได้ใส่ `-m` และยังไม่ได้ตรวจ hash runtime** (ผิดข้อ 7 AGENTS.md — รอบหน้าทำครบ)
- Production: **ยังไม่ deploy / ยังไม่ migrate / ยังไม่ push** — รอเจ้าของอนุมัติ; ต้องประกอบ branch รวมจาก production-base ก่อนปล่อย
- Schema ใหม่ (additive) ที่ต้องมีก่อนปล่อย: ดู `reports/receiving-overnight-2026-10-18/RELEASE-PLAN.md` + ตาราง `receiving_issue_stock_returns`, คอลัมน์ `receiving_supplier_branch_codes.branch_id`, index `idx_receiving_documents_export`, `uq_receiving_supplier_branch`

### ค้าง
- ตรวจภาพหน้าจอ 375/1440 สว่าง/มืด ของ UI ใหม่ และทดสอบบนมือถือจริงกับ build int-r4
- รหัสเจ้าหนี้ตามสาขาที่บันทึกก่อนมี branch_id ต้องผูกสาขาใหม่ในหน้าร้านค้า
- MODIFY COLUMN เก่าใน supplier.model.js:87, purchase-order.model.js:37 (นอกเส้นทางงานนี้)
- โทรศัพท์ทดสอบต่อ Wi-Fi ที่ไม่มีอินเทอร์เน็ต — ใช้ proxy ผ่าน USB (127.0.0.1:8842 → staging) ชั่วคราว
