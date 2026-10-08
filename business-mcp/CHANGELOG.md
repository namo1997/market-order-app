# ประวัติ Business MCP Gateway

## 8 ตุลาคม 2026 — ขยายการอ่านข้อมูลพนักงานตามอนุมัติ

- เพิ่มเครื่องมือปฏิบัติงาน 5 ชุด รายชื่อ/ID/สังกัด ใบลา เวลาเข้าออกและสาย กะ/วันหยุด และองค์ประกอบสิทธิ์ลารายปี ผ่าน `read_workforce_operations` ต้นทาง มีการตรวจสาขา วัน employee ID และ field projection ซ้ำ
- เปิดได้ด้วย `allow_hr_operations:true` เท่านั้น แยกจาก legacy employee allowlist ไม่มีข้อมูลเงินเดือน บัญชี โทรศัพท์/อีเมล เหตุผล/เอกสารลา หรือหมายเหตุอิสระ ไม่มีเครื่องมือเขียนหรือ SQL อิสระ
- การแบ่งหน้าตรวจ duplicate/conflict และผูก cursor กับสิทธิ์/filters; `null` ไม่แปลงเป็นศูนย์ ตารางกะขาดคืน PARTIAL; ยังไม่ยืนยันขาดงานจาก scan ที่ขาด
- สถานะ **Local candidate เท่านั้น** branch `codex/business-hr-operations-20261008` ฐาน `business/production-base` commit `c892e6d`; Production เดิมยัง 10 tools/operational permission ปิด ยังไม่ deploy candidate 15 tools
- Gateway tests 16/16 ผ่านบน SSD `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-08T04-42-31-468Z-7dbd111e/source`; HRMS tests/build และการอ่าน end-to-end บน consistent Production copy ทั้งสองสาขาครบ 5 sections ผ่าน (ไม่ใช่ live API): `/Volumes/SSD Files/SOLAO/hrms/reports/mcp-operations-copy-final-20261008.json`
- ค้าง: release provenance ของ HRMS canonical ซึ่งมีงานหลายแชทต่างจาก snapshot; ซ้อม boot/jobs และตรวจ compatibility ก่อนปล่อย source HRMS/Gateway เปิดเฉพาะ scoped operational flags แล้วพิสูจน์ live ทั้งสองสาขาและ refresh ChatGPT tools
- ผู้ใช้อนุมัติ native clone/snapshot release แยกบน Mac สำหรับงานนี้ และปล่อยเฉพาะ HRMS backend/Gateway พร้อม operational reads KK/SK แล้ว ยังรอตรวจ exact Production release
- Authenticated MCP HTTP บน DB copy ใช้ route/SDK/Gateway adapter จริงทั้งสองสาขาครบห้าชุด ตรวจ deny source permission/branch ผ่าน ธุรกิจทุกตารางไม่เปลี่ยน (audit append 11 บน working copy เท่านั้น): `/Volumes/SSD Files/SOLAO/hrms/reports/mcp-operations-http-copy-20261008.json`

## 7 ตุลาคม 2026 — สร้าง Gateway รุ่นแรก

- สร้าง MCP HTTP/stdio สำหรับอ่านภาพรวมและรายละเอียดจาก Market Order, HRMS, General Cashflow และ LINE Bill แบบ read-only พร้อมสิทธิ์สาขา/วัน/บุคคลและ `PARTIAL`/`missing_coverage`.
- สถานะ: Local เท่านั้น ยังไม่ deploy Production.
- ผลทดสอบ: MCP `initialize`, `tools/list`, read tool, HTTP bearer, OAuth PKCE/refresh, สิทธิ์/ความครอบคลุม และ findings ผ่านบน SSD 10/10. Market Order adapter อ่านรายงาน Production จริงสำเร็จหนึ่งวันหนึ่งสาขา; HRMS/Cashflow plugin ของเดิมอ่าน Production ได้ แต่ Gateway ใหม่ยังไม่ได้รับ token ต้นทาง.
- หลักฐานทดสอบ: `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-07T14-37-44-807Z-65242dd4/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: bind token scoped HRMS, Cashflow, LINE Bill ผ่าน secret store; ตั้ง OAuth secrets และ public URL; ตรวจ mapping LINE Production; รัน `npm run verify:live` ให้ครบสี่ระบบ; ขออนุมัติก่อน deploy Railway และเชื่อม ChatGPT.

## 8 ตุลาคม 2026 — เตรียมปล่อยตามอนุมัติ

- ผู้ใช้อนุมัติปล่อย Cash Flow และสร้าง/deploy Gateway พร้อมสิทธิ์อ่านและตรวจจริงครบสี่ระบบแล้ว
- เพิ่มการรองรับ OAuth client_secret_basic ที่ส่ง client_id ใน Authorization header ตามรูปแบบมาตรฐาน
- สถานะ: กำลังปล่อย Production; service Gateway `4cf6fa47-ca71-4c2b-a3de-fb78f3988e1f` ไม่มี volume/DB, 1 replica, จำกัด memory 0.5 GB
- ตรวจ source Cashflow ที่รันจริง 47 ไฟล์ตรงฐาน a3266e2 ทั้งหมดก่อนปล่อย; กำหนด token Gateway แยกโดยคง primary connector token
- หลักฐาน/งานค้าง: `/Volumes/SSD Files/SOLAO/market-order-system/tmp/mcp-release-20261008`; รอตรวจ deployment, runtime hash, HRMS scoped access และ live MCP/OAuth

- ปรับ overview ให้ LINE Bill คืนจำนวนรอบตามสถานะก่อน โดยอ่านรายการรอบเมื่อถามผ่าน detail tool เพื่อลดขนาดผลลัพธ์ และจำกัด OAuth transaction ที่ค้างในหน่วยความจำ
- Gateway deployment แรก `7672ad2f-1c73-49b4-9678-bbfaffba0973` สำเร็จ; runtime hash ตรง commit `066d515`; MCP initialize/tools/list (10 read-only tools) และ Market/Cashflow/LINE อ่านจริงได้ทั้งสองสาขาแล้ว
- Cashflow deployment `630c9563-2991-473b-8f49-53e119c770d8` SUCCESS และ runtime hash ตรง commit `066d515`; อัปซ้ำเพื่อลง message commit ที่ถูกต้อง `9dbefcb3-90a4-4be3-98ac-198535bc67d9` ถูก Railway SKIPPED เพราะ source ไม่เปลี่ยน รายงานนี้ผูก hash จริงกับ release เพื่อแก้ข้อความอ้างอิงแรกที่คลาดเคลื่อน
- HRMS: ซ้อม boot/งานหน่วงจาก runtime จริงพร้อม flags เป้าหมายบน DB copy ครบ 126 ตาราง ผลก่อน/หลังตรงกันทั้งหมด ไม่มี external writes; เพิ่ม scoped tokens สองสาขาโดยคงสอง token เดิม ปิด sensitive/salary/leave-reason; ไม่อัป source HRMS ใหม่
- หลักฐาน HRMS: `/Volumes/SSD Files/SOLAO/market-order-system/tmp/mcp-release-20261008/hrms-rehearsal/rehearsal-report.json`; source/data copy เป็น simulation ใช้ deploy ไม่ได้

- ตรวจ ChatGPT browser OAuth พบ POST authorize สำเร็จ 302 แต่ form-action CSP เดิมกัน redirect callback; เพิ่ม callback ChatGPT ที่อนุญาตใน CSP และ regression assertion ไม่ใช้การข้ามคำเตือนเบราว์เซอร์

- เชื่อมบัญชี ChatGPT ผ่าน OAuth สำเร็จแล้ว แต่ refresh tools พบ MCP HTTP 400 จาก openai-mcp; ปรับ bridge ให้รักษา protocol/method/name headers และเพิ่ม log เฉพาะหมวด protocol โดยไม่เก็บ payload/credentials กำลังตรวจความเข้ากันได้บน Production ตามอนุมัติเดิม
