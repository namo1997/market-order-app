# ประวัติ General Cashflow

## 7 ตุลาคม 2026 — token อ่านแยกสำหรับ Business MCP

- เพิ่ม `CASHFLOW_DOT_EXTRA_TOKENS_JSON` ให้ endpoint reconciliation ตรวจ token hash และสิทธิ์สาขา/วันหมดอายุแยกกัน โดยไม่เปลี่ยน token เดิมและยังอ่านอย่างเดียว.
- สถานะ: Local ยังไม่ deploy Production.
- ผลทดสอบ: `dotReconciliation.test.js` ผ่านบน SSD 22/22 รวม token ใหม่/เดิม, สิทธิ์สาขา, GET-only และข้อมูลที่ไม่รู้ต้องคง null.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-07T14-37-44-802Z-941486ea/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: ตั้ง token ใหม่ใน secret store, ผูก Gateway, ตรวจ live ครบ และขออนุมัติ deploy.

## 8 ตุลาคม 2026 — ปล่อย token Gateway บน Production

- สถานะ: Production; deployment `630c9563-2991-473b-8f49-53e119c770d8` SUCCESS จาก source commit `066d515`; runtime `dotReconciliation.js` SHA256 `9497e7faa840bf4d3d6c2a5715cbb5d7606868666fb5e4789f72c4343168299e` ตรงกัน
- เพิ่ม token hash ใน `CASHFLOW_DOT_EXTRA_TOKENS_JSON` สำหรับ KK/SK หมดอายุ 8 ต.ค. 2027 โดยไม่เปลี่ยน primary token; connector เดิมและ Gateway อ่านจริงได้ทั้งคู่
- เทสต์ DOT 22/22 ก่อนปล่อย; Gateway overview/receipt pagination อ่าน Production จริงแบบ scoped ผ่านแล้ว และยังแจ้ง PARTIAL เมื่อมีหน้าถัดไป
- Push branch งานและ `cashflow/production-base` ไป source release ที่ยืนยันแล้ว ไม่เปลี่ยนสาขาฐาน LINE Bill
- อัปซ้ำ message commit ที่ถูกต้อง deployment `9dbefcb3-90a4-4be3-98ac-198535bc67d9` ถูก SKIPPED เพราะ source เดิม; ข้อความอ้างอิงในอัปแรกคลาดเคลื่อน จึงใช้ runtime hash และ commit จริงข้างต้นเป็นหลักฐาน
- รายงาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-details-20261008.json`; ยังคงข้อจำกัด POS snapshot/refunds/resolution และไม่ถือ residual candidates เป็นยอดขายครบช่วง
