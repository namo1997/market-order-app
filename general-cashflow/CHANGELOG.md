# ประวัติ General Cashflow

## 9 ตุลาคม 2026 — เพิ่มผู้ใช้งาน Admin เพ็ญและจุ๋ม

- เพิ่ม เพ็ญ (`admin_pen`) และ จุ๋ม (`admin_jum`) ในตัวเลือก Admin และ allowlist ฝั่ง server โดยใช้การตรวจ PIN 6 หลักเดิม; บัญชีแยกถูกสร้างเมื่อเข้าสู่ระบบสำเร็จครั้งแรก ไม่ต้องเปลี่ยน schema.
- สถานะ: Local บน branch `codex/cashflow-admin-pen-jum` จาก `cashflow/production-base`; ยังไม่ deploy Production.
- ผลทดสอบบน SSD: auth/domain 4/4, client 44/44 และ Vite build ผ่าน; browser แสดงรายชื่อครบห้าคน เลือกทั้งสองชื่อเปิดช่อง PIN ได้ และเปลี่ยนชื่อแล้วล้าง PIN เดิม.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-09T08-08-38-333Z-bfc4cc46/reports/command.log`; รายงาน `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.md`; ภาพ `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.jpg`.
- ค้าง: ขออนุมัติ Production ตาม AGENTS.md, ตรวจความตรงของฐาน source กับ release ที่ออนไลน์ และปล่อยเฉพาะชุดงานนี้; Railway มี staged changes ของงานอื่นจึงห้าม accept-deploy ทั้งชุด.

## 7 ตุลาคม 2026 — token อ่านแยกสำหรับ Business MCP

- เพิ่ม `CASHFLOW_DOT_EXTRA_TOKENS_JSON` ให้ endpoint reconciliation ตรวจ token hash และสิทธิ์สาขา/วันหมดอายุแยกกัน โดยไม่เปลี่ยน token เดิมและยังอ่านอย่างเดียว.
- สถานะ: Local ยังไม่ deploy Production.
- ผลทดสอบ: `dotReconciliation.test.js` ผ่านบน SSD 22/22 รวม token ใหม่/เดิม, สิทธิ์สาขา, GET-only และข้อมูลที่ไม่รู้ต้องคง null.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-07T14-37-44-802Z-941486ea/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: ตั้ง token ใหม่ใน secret store, ผูก Gateway, ตรวจ live ครบ และขออนุมัติ deploy.
