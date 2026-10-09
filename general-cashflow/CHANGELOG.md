# ประวัติ General Cashflow

## 10 ตุลาคม 2026 — กำไรขาดทุนเบื้องต้น v0 (B1–B7)

- สถานะ Local เท่านั้นใน `cashflow/pnl-v0`; เพิ่ม schema/cache sync/report/API Admin และหน้ากำไรขาดทุนภาษาไทย ไม่ push/deploy/ต่อ Production.
- ยึด export v2 งาน A: list fingerprint แยก snapshot fingerprint, dedupe บิลครั้งเดียว, counts คืนเงิน/เงินเข้าไม่นับยอด, รองรับ payments_without_bill; override/rules/manual ไม่ถูกลบโดย sync.
- การคำนวณใช้ integer cents, แยกไม่ระบุสาขา/ส่วนกลาง และความครบถึงเมื่อวานเวลาไทย; mutation มี audit และคง decision reason flow เดิม.
- ผล full SSD suite: server 294 ผ่าน / 1 skip เดิม (opt-in DB), client 45 ผ่าน, Vite build ผ่าน. Pure functions + fake query/fetch ไม่สร้าง MySQL. Browser fixture 768px ไม่มี horizontal scroll ทั้งหน้า, negative แดง, category rule payload และ copy previous month ไม่บันทึกอัตโนมัติผ่านการสังเกต.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-09T19-11-28-110Z-924f1d0e/reports/command.log`; รายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-handoff.md`.
- ข้อจำกัด: worktree ฐานไม่มี frozen accounting test dependencies; copy 20 ไฟล์แบบ read-only ลง SSD snapshot พร้อม hashes ก่อน full test ไม่แก้ต้นฉบับ. Schema ยังไม่ทดสอบกับ MySQL จริง; รอ Claude ตรวจ integration และ preview snapshot จริงก่อน release.

## 9 ตุลาคม 2026 — เพิ่มผู้ใช้งาน Admin เพ็ญและจุ๋ม

- เพิ่ม เพ็ญ (`admin_pen`) และ จุ๋ม (`admin_jum`) ในตัวเลือก Admin และ allowlist ฝั่ง server โดยใช้การตรวจ PIN 6 หลักเดิม; บัญชีแยกถูกสร้างเมื่อเข้าสู่ระบบสำเร็จครั้งแรก ไม่ต้องเปลี่ยน schema.
- สถานะ: Production ตามอนุมัติผู้ใช้; deployment `55b6cf9a-3863-4bfd-8b1a-85bbbbc17ba8` SUCCESS จาก source commit `dc8f956` ผ่าน branch รวม `cashflow/integration-20261009-admin-pen-jum`.
- ผลทดสอบบน SSD: auth/domain 4/4, client 44/44 และ Vite build ผ่าน; browser แสดงรายชื่อครบห้าคน เลือกทั้งสองชื่อเปิดช่อง PIN ได้ และเปลี่ยนชื่อแล้วล้าง PIN เดิม.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-09T08-08-38-333Z-bfc4cc46/reports/command.log`; รายงาน `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.md`; ภาพ `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.jpg`.
- ตรวจ Production: `/health` ready, หน้าเลือกผู้ใช้งานมีครบห้าชื่อ, เพ็ญ/จุ๋มเข้าได้ด้วย PIN เดิมและ `/auth/me` คืนตัวตน Admin แยกกัน; PIN ผิด/ไม่กรอกถูกปฏิเสธ 401. หลักฐาน `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-production-20261009.json` และภาพชื่อเดียวกัน `.jpg`.
- ตรวจฐานก่อน release: deployment เดิม `630c9563` ยังเป็นตัวออนไลน์ล่าสุด ตรง release `066d515` ที่มีรายงาน runtime hash ยืนยันไว้; diff executable source มีเพียงสองรายการรายชื่อ. Upload จาก canonical worktree โดย service root เป็น `general-cashflow`, ไม่ใช้ SSD simulation deploy; Railway staged changes 11 รายการของงานอื่นคงเดิม.
- ข้อจำกัด: `/health` รายงาน commit `unknown` สำหรับ CLI upload จึงอ้าง source commit, deployment id/message, image digest และผลตรวจพฤติกรรมจริง; ไม่ได้อ้างว่าอ่าน runtime hash ใหม่หรือเทียบข้อมูลรับจ่ายทั้งหมด.

## 7 ตุลาคม 2026 — token อ่านแยกสำหรับ Business MCP

- เพิ่ม `CASHFLOW_DOT_EXTRA_TOKENS_JSON` ให้ endpoint reconciliation ตรวจ token hash และสิทธิ์สาขา/วันหมดอายุแยกกัน โดยไม่เปลี่ยน token เดิมและยังอ่านอย่างเดียว.
- สถานะ: Local ยังไม่ deploy Production.
- ผลทดสอบ: `dotReconciliation.test.js` ผ่านบน SSD 22/22 รวม token ใหม่/เดิม, สิทธิ์สาขา, GET-only และข้อมูลที่ไม่รู้ต้องคง null.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-07T14-37-44-802Z-941486ea/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: ตั้ง token ใหม่ใน secret store, ผูก Gateway, ตรวจ live ครบ และขออนุมัติ deploy.
