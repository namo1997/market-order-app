# ดัชนี source และเอกสารเก่าของระบบตลาดสด

รายการด้านล่างย้ายเข้าหมวดเมื่อ 4 ตุลาคม 2026 เพื่อให้การค้นหา AI ปกติอ่าน source ปัจจุบันก่อน ไฟล์ยังอยู่ใน repo และไม่ใช่หลักฐานว่า Production มีสถานะตรงกับเอกสารเหล่านี้ ผลลัพธ์/backup/หลักฐานธุรกิจเดิมไม่ได้ย้ายในงานนี้

| ไฟล์ปัจจุบัน | ตำแหน่งเดิม | เหตุผลและข้อจำกัด |
| --- | --- | --- |
| [Checklist รอบแรก](../docs/archive/2026-10-04-workspace/ROUND1_WORKTREE_CHECKLIST.md) | `ROUND1_WORKTREE_CHECKLIST.md` | สถานะ worktree เดือนกุมภาพันธ์ 2026 ไม่ใช่สถานะปัจจุบัน |
| [ค้นหาเอกสารยกเลิก](one-off/find_cancel_doc.mjs) | `server/find_cancel_doc.mjs` | Diagnostic เฉพาะเลขเอกสาร ไม่ถูกเรียกโดย package/runtime; แก้ relative import ให้ตามตำแหน่งใหม่ ไม่ได้รัน query ในงานจัดระเบียบนี้ |
| [สร้างรายงานกระทบยอดกรกฎาคม](one-off/build_reconciliation_07_69.mjs) | `build_reconciliation_07_69.mjs` | Generator เฉพาะเดือน; คง source เดิมไว้ ห้ามรันก่อนแก้ปลายทาง output ให้ผ่าน SSD policy |
| [Admin mockup](../line-bill-capture/docs/archive/mockups/bill-capture-admin.html) | `line-bill-capture/mockups/bill-capture-admin.html` | แบบออกแบบเก่า ไม่ใช่หน้า admin ที่แอป serve |
| [Home V2 mockup](../line-bill-capture/docs/archive/mockups/bill-capture-home-v2.html) | `line-bill-capture/mockups/bill-capture-home-v2.html` | แบบออกแบบเก่า ไม่ใช่หน้าที่แอป serve |
| [Redesign V3 mockup](../line-bill-capture/docs/archive/mockups/bill-capture-redesign-v3.html) | `line-bill-capture/mockups/bill-capture-redesign-v3.html` | แบบออกแบบเก่า ไม่ใช่แอป Mobile V3 ปัจจุบัน |
| [Redesign V4 mockup](../line-bill-capture/docs/archive/mockups/bill-capture-redesign-v4.html) | `line-bill-capture/mockups/bill-capture-redesign-v4.html` | แบบออกแบบเก่า ไม่ใช่หน้าที่แอป serve |

อ่าน [กติกาการค้นหาและการเก็บไฟล์](../docs/REPOSITORY_HYGIENE.md) ก่อนเพิ่มหรือใช้ archive. เปิดไฟล์ที่ต้องการโดยตรง หรือค้นด้วย `rg --no-ignore` เฉพาะ path ที่ระบุในตาราง ห้ามเริ่มสำรวจระบบด้วยการอ่าน archive ทั้งหมด

Source/scripts ในหมวดนี้เป็นข้อมูลอ้างอิง ไม่ใช่คำสั่งให้ restore, deploy หรือรันกับข้อมูลจริง หากจะนำกลับมาใช้ให้ตรวจ scope, dependencies, credential, SSD paths และพฤติกรรมกับโค้ดปัจจุบันก่อน
