# ประวัติ Business MCP Gateway

## 7 ตุลาคม 2026 — สร้าง Gateway รุ่นแรก

- สร้าง MCP HTTP/stdio สำหรับอ่านภาพรวมและรายละเอียดจาก Market Order, HRMS, General Cashflow และ LINE Bill แบบ read-only พร้อมสิทธิ์สาขา/วัน/บุคคลและ `PARTIAL`/`missing_coverage`.
- สถานะ: Local เท่านั้น ยังไม่ deploy Production.
- ผลทดสอบ: MCP `initialize`, `tools/list`, read tool, HTTP bearer, OAuth PKCE/refresh, สิทธิ์/ความครอบคลุม และ findings ผ่านบน SSD 10/10. Market Order adapter อ่านรายงาน Production จริงสำเร็จหนึ่งวันหนึ่งสาขา; HRMS/Cashflow plugin ของเดิมอ่าน Production ได้ แต่ Gateway ใหม่ยังไม่ได้รับ token ต้นทาง.
- หลักฐานทดสอบ: `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-07T14-37-44-807Z-65242dd4/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: bind token scoped HRMS, Cashflow, LINE Bill ผ่าน secret store; ตั้ง OAuth secrets และ public URL; ตรวจ mapping LINE Production; รัน `npm run verify:live` ให้ครบสี่ระบบ; ขออนุมัติก่อน deploy Railway และเชื่อม ChatGPT.
