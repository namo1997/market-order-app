# ประวัติการแก้ไข workspace

## 2026-10-08 — Local: อ่านสินค้าที่สั่งไว้เพื่อเทียบกับบิล LINE

เพิ่ม GET /api/bill-order-reference/lines แบบ SELECT-only พร้อม tokenเฉพาะ/allowlistสาขา/วันสั่งที่ชัดเจน/ขอบเขต1000แถว ไม่เรียกการรับของหรือสร้าง schema. ตารางสินค้าใน Bill Capture เป็นข้อมูลเสริมแยกจากสินค้า/ใบสั่งต้นฉบับ. อัปเดตแผนที่โมดูล ordering. MockDB + real loopbackHTTP auth/scope/GET-only tests ผ่านบน /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-08T04-53-25-030Z-a2914437. ยังไม่เชื่อม Production/MySQLจริง ไม่ deploy และไม่แก้ canonical dirtyworktree; ต้องตั้งค่า branchmapping/tokenและตรวจฐานปล่อยปัจจุบันก่อนเปิดใช้งานจริง. รายละเอียด Bill Capture อยู่ line-bill-capture/CHANGELOG.md.
