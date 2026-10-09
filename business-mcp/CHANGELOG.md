# ประวัติ Business MCP Gateway

## 9 ตุลาคม 2026 — Production 17 tools พร้อมอ่านสินค้า/เมนูรายตัว

- ผู้ใช้อนุมัติ “อัปได้เลยครับ”; ปล่อยจาก branch รวม `business/integration-20261009-sales-items` source commit `4ed496dd4129308366ab82a67531fff96485e2f5` ด้วย official Railway CLI 5.63.4 พร้อม message/short commit; deployment `d40cc782-70f4-4e9f-92a3-6c44a3c06931` SUCCESS
- Hash runtime code/package ทั้ง 15 ไฟล์ตรง commit จาก startup manifest ใน deployment logs; push job/integration และเลื่อน/push `business/production-base` ไป source ที่ปล่อยแล้ว ไม่ deploy จาก SSD simulation copy
- ตรวจ Production MCP initialize/tools/list (17 read-only) ทั้ง protocol เดิมและ modern envelope, health, OAuth discovery และการปฏิเสธไม่มี bearer ผ่าน; อ่านสดครบ 4 แหล่งทั้ง KK/SK โดย Cash Flow PARTIAL เพราะยังมีหน้าเพิ่มเติม
- เครื่องมือสินค้าใหม่ค้นชื่อ/อ่านรหัสตรงได้จริงทั้งสองสาขา จำนวน/ยอดตรงกับรายงาน ClickHouse ของสินค้าอันดับ 21 นอก top 20 เดิม แบ่งหน้าไม่ซ้ำ missing คง null/PARTIAL ปฏิเสธสาขา/ช่วงวันที่นอกสิทธิ์ ไม่มีการเขียนข้อมูลธุรกิจหรือแก้ source services
- รีเฟรชเครื่องมือใน ChatGPT บัญชี SOLAO Business MCP ของ SURACHART (Primary) เดิมแล้ว หน้าแอปแสดง Read17 และ `business_search_sales_items`/`business_read_sales_item` ไม่เปลี่ยน OAuth/permission; ไม่ได้ทดสอบบนโทรศัพท์ผู้ใช้โดยตรง
- งาน Railway POS staged เดิม patch `030a6027-1e77-46c1-b272-393faacc0b86` จำนวน 11 รายการยัง STAGED, updatedAt/hash ตรงก่อนปล่อยทุกประการ; live source/env/config hash คงเดิม ไม่ accept_deploy/ลบ/รวมงานค้าง ไม่เพิ่ม service/volume/replica/credentials
- หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-sales-items-production-20261009.md`; runtime `business-mcp-sales-items-runtime-production-20261009.json`; live `business-mcp-sales-items-production-live-20261009.json`; staged `business-mcp-sales-items-after-upload-20261009.json`; ChatGPT `business-mcp-chatgpt-17-tools-20261009.jpg`/`.txt` ใน reports เดียวกัน; local tests 27/27 แยกจาก live evidence
- ข้อจำกัดคงอยู่: AS_REPORTED/unknown freshness/ต้นทางอาจนับซ้ำ; รายตัวเป็นยอดรวมขายตามช่วง ไม่ใช่ stock/cost/profit/unit price/item bill count; source cap 1000 ต่อคำค้น คำค้น quote/backslash ต้องใช้คำบางส่วนหรือ barcode; งาน POS direct/metadata เดิมยังไม่ปล่อย

## 9 ตุลาคม 2026 — Local candidate ค้นสินค้าและอ่านยอดขายรายรหัส

- เพิ่ม `business_search_sales_items` / `business_read_sales_item` จาก API รายงาน Market Order/ClickHouse เดิม อ่านชื่อ/รหัส/กลุ่ม จำนวนและยอดขายรายสินค้าภายในสาขา/วันที่ที่อนุญาต เครื่องมือรวม candidate 17 ตัว ไม่มี SQL อิสระหรือการเขียนข้อมูลธุรกิจ
- ไม่จำกัดเฉพาะ top 20 เดิม; คำค้นต้นทาง cap 1000, Gateway หน้า 25/สูงสุด 100 พร้อม cursor ผูกสิทธิ์/query/snapshot ปฏิเสธรหัสซ้ำ ผลขัดแย้ง และคำค้น SQL escape ที่ต้นทางยังไม่ได้ parameterize รหัสใกล้เคียงไม่รวมยอด; missing/unknown คง null/PARTIAL
- แยกยอดสินค้าออกจาก summary/daily/hourly/ช่วงเปรียบเทียบของทั้งสาขา ใช้ AS_REPORTED/SALE_DATE/freshness null ไม่อ้างสต็อก ต้นทุน กำไร หน่วย จำนวนบิล หรือราคาต่อหน่วย
- ทดสอบบน SSD 27/27 ผ่าน รวม regressions เดิมและ startup manifest/hash/health/auth; authenticated local MCP HTTP อ่าน Production source จริงของ KK/SK วันที่ 8 ตุลาคม เลือกสินค้าอันดับ 21 อ่านจำนวน/ยอดตรงต้นทาง ค้นชื่อ แบ่งหน้า และปฏิเสธนอกสิทธิ์ผ่านทั้งสองสาขา แยกจาก mock tests และ Production deploy
- `npm start`/Docker ใช้ `scripts/start-http.mjs` เพิ่ม log SHA-256 เฉพาะ code/package ที่ runtime สำหรับ release provenance เมื่อ SSH ไม่มี key ไม่มี env/credential/ธุรกิจใน manifest แก้เอกสาร HR token ให้ตรงเหตุผลลาที่อนุมัติและปล่อยไปแล้ว ไม่เปลี่ยน HR policy
- สถานะ Local เท่านั้น branch `codex/business-sales-items-20261009` จาก `business/production-base` cec755f พร้อม postrelease docs cherry-pick d8a03e5; Production ยัง deployment `c40afa36-1888-4902-bbf4-aa15048fb427` / 15 tools ไม่ deploy/push/เลื่อน base
- หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-sales-items-local-20261009.md`; live `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-sales-items-live-2026-10-09T07-10-40-913Z.json`; tests `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-09T07-09-08-153Z-c1018862/reports/command.log`
- งานค้าง: ขออนุมัติ release Gateway เท่านั้นและตรวจวิธีคงงาน Railway staged patch 030a6027 จำนวน 11 รายการจาก `business/pos-readonly-20261008`/dd5c6a0 ที่ยังไม่รวม ห้ามเผลอ accept_deploy งานอื่น; หลังปล่อยตรวจ runtime/hash/live 4 sources+items/scope/ChatGPT แล้ว push/เลื่อน production-base ตามกติกา

## 8 ตุลาคม 2026 — Production 15 tools พร้อมเหตุผลการลาและ ChatGPT

- Gateway deployment `c40afa36-1888-4902-bbf4-aa15048fb427` SUCCESS; source `cec755f9a8ee93f0844a6c8f0f2c9deda487c0fe` commit ก่อน upload พร้อม message; runtime src/scripts/package 12 ไฟล์ hash ตรง source ทั้งหมด และ health ผ่าน
- HRMS backend deployment `72524eef-2c39-40db-ba31-64184dc4fb54` source snapshot `6151121`; อ่านสดครบทั้ง 5 sections และทุกหน้าของ KK/SK รวมเหตุผลลา ผ่าน authenticated Gateway HTTP พร้อม scope denial/cross-branch filtering; ทุก tool มี readOnlyHint ไม่มีเขียนข้อมูลธุรกิจ
- `npm run verify:live` บน runtime ผ่าน: connected_all_sources=true ครบ 4 ระบบ × 2 สาขา; Cash Flow PARTIAL เพราะยังมีหน้าเพิ่มเติม ไม่ใช่ขาดการเชื่อมต่อ กะบาง employee-days เป็น null/PARTIAL เพราะยังไม่ตั้งค่า
- รีเฟรช SOLAO Business MCP ในบัญชี ChatGPT เดิมแล้ว เห็น Read15 และเครื่องมือ HR ใหม่ทั้ง 5 โดยคง OAuth เดิม; หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-chatgpt-15-tools-20261008.png`
- Gateway tests 17/17 บน SSD ผ่าน; ไม่สร้าง service/DB/volume เพิ่ม ยังคง 1 replica/memory 0.5 GB อ่านเมื่อเรียกตามคำถาม
- หลักฐานและขอบเขต `/Volumes/SSD Files/SOLAO/hrms/reports/mcp-operations-production-20261008.md`; live HTTP `/Volumes/SSD Files/SOLAO/hrms/reports/mcp-operations-production-http-20261008.json`; runtime `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-runtime-production-20261008.json`
- รายละเอียดชื่อ/เหตุผลลาเปิดตามอนุมัติเฉพาะ KK/SK ช่วง 2026–2027; เงินเดือน บัญชี ข้อมูลติดต่อ เอกสารแนบลา และหมายเหตุ attendance อิสระปิด ไม่สรุปความผิด/ขาดงานจากข้อมูลไม่ครบ; ข้อจำกัดต้นทาง Market/CF/LINE คงเดิม

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

- ก่อน deploy ผู้ใช้อนุมัติเปิดเหตุผลการลาเพิ่ม: allow_hr_leave_reasons ของ owner ต้องเปิดคู่กับ global/token source permission; projection กรองซ้ำและ cursor ผูกกับ permission พร้อมระบุข้อความที่กรอก/ยังไม่ยืนยัน ไม่เปิดเอกสารแนบหรือทะเบียนข้อมูลติดต่อ/เงินเดือน
