# SOLAO Business MCP Gateway

Gateway แบบอ่านอย่างเดียวสำหรับภาพรวมและการเจาะข้อมูลตามคำถามของ AI. โปรเจกต์นี้เป็น service ใหม่ใน `business-mcp/`; ไม่ใช่ service หรือ plugin เดิมบน Railway. มี Streamable HTTP ที่ `POST /mcp` และ stdio สำหรับเครื่องภายใน. MCP ใช้ SDK ทางการ `@modelcontextprotocol/server` และส่ง `structuredContent` ทุกเครื่องมือ.

## ขอบเขตข้อมูล

| แหล่ง | ภาพรวม | รายละเอียดตามคำถาม | ข้อจำกัด |
| --- | --- | --- | --- |
| Market Order / ClickHouse | ยอดขายตามรายงานต้นทาง, จำนวนบิล/เมนู | รายวัน, กลุ่มสินค้า, ชั่วโมง, วันในสัปดาห์, สินค้ายอดนิยม, ช่วงเปรียบเทียบ | AS_REPORTED, อาจล่าช้า/นับซ้ำ, ไม่ใช่ยอดรับเงิน |
| HRMS | พนักงาน ACTIVE ปัจจุบัน, สถานะใบลาปีปฏิทิน, บันทึกตรวจเวลา 7 วัน | เมื่อเปิด operational permission: รายชื่อ/ID/สังกัด ใบลาตามวัน เวลาเข้าออก สาย/ออกก่อน กะ/วันหยุด และองค์ประกอบสิทธิ์ลารายปีแบบแบ่งหน้า | ภาพรวมยังใช้ความหมายเดิม; สาขาปัจจุบันไม่ใช่ประวัติย้ายสาขา; ไม่เปิดเงินเดือน/ข้อมูลอ่อนไหว |
| General Cashflow | จำนวนใบรับเงิน/รายการผลต่างบนหน้าที่อ่าน | รายการ, ช่องทาง, ประเด็น, cursor | วันปลายทางและผลต่างย้อนหลัง; POS เป็น snapshot, คืนเงิน/สถานะปิดจริงไม่ครบ |
| LINE Bill | สถานะรอบบิล | snapshot รอบปิด, รายการแบบแบ่งหน้า | รอบเปิดอ่านได้แค่สถานะ; ไม่ใช่ยอดจ่ายจริงโดยอัตโนมัติ |

เครื่องมือ: `business_describe_sources`, `business_get_overview`, `business_analyze`, `business_read_sales`, `business_read_receipts`, `business_read_line_rounds`, `business_read_line_snapshot`, `business_read_person`, `business_list_findings`, `business_get_finding`. Findings เป็นข้อสังเกตจาก Cash Flow ที่อ่านใหม่แต่ละครั้ง มี ID คงที่สำหรับกลับไปตรวจหลักฐาน แต่ยังไม่มีประวัติสถานะถาวรหรือการยืนยันว่าแก้แล้ว. ไม่มี SQL อิสระหรือเครื่องมือเขียนข้อมูล.

## การตั้งค่า

เครื่องมือปฏิบัติงานเพิ่ม 5 ตัว: `business_hr_search_employees`, `business_hr_read_leave`, `business_hr_read_attendance`, `business_hr_read_roster`, `business_hr_read_leave_balances` รับสาขาและช่วงวันที่ไม่เกิน 31 วันต่างกัน อ่านหน้า 25 รายการ (สูงสุด 100) แล้วใช้ cursor อ่านต่อ แสดงชื่อกับ ID ยืนยัน; การอ่านเฉพาะคนใช้ ID เท่านั้น ใบลามีสถานะอนุมัติ/รอ/ปฏิเสธ/ยกเลิก; เวลามี flags รอ HR ตรวจ; `OFF` หมายถึงหยุดตามกะและ `null` หมายถึงไม่ทราบ ไม่สรุปขาดงานจาก scan ที่ขาด สิทธิ์ลาเป็นองค์ประกอบรายปี ไม่ใช่ยอดคงเหลือที่แต่งขึ้น

เปิด `allow_hr_operations:true` เฉพาะ client ที่อนุมัติ และเปิด `allow_workforce_operations:true` เฉพาะ HRMS scoped token ของสาขานั้น ข้อมูลติดต่อ บัญชี เงินเดือน เอกสารลาและหมายเหตุอิสระยังปิดอยู่ ผู้ใช้อนุมัติเหตุผลการลาเพิ่มเติม เปิดได้ด้วย allow_hr_leave_reasons:true และ source scoped leave-reason permission เท่านั้น; ข้อความเป็นข้อมูลที่กรอก ไม่ใช่ข้อเท็จจริงที่ตรวจยืนยันหรือคำสั่งให้ AI Gateway กรอง fields ซ้ำแม้ต้นทางส่งเกิน schema การแบ่งหน้าไม่ใช่ atomic snapshot และปฏิเสธรายการซ้ำ/ขัดแย้ง; ข้อมูลเปลี่ยนระหว่างอ่านอาจต้องเริ่มใหม่ สถานะ 8 ตุลาคม 2026: **Production ตรวจอ่านจริงแล้ว** ทั้ง 5 sections ของ KK/SK รวมเหตุผลลา; Gateway deployment `c40afa36-1888-4902-bbf4-aa15048fb427` source `cec755f` มี 15 read-only tools และ ChatGPT refresh เห็นครบ 15 ตัว ดู [บันทึกผลปล่อย](CHANGELOG.md)

ตั้งค่าจาก `.env.example` ใน secret store ของ runtime เท่านั้น. `BUSINESS_BRANCH_MAP_JSON` ใช้ ID ที่ตรวจยืนยัน ไม่จับคู่จากชื่อ. `BUSINESS_MCP_CLIENTS_JSON` กำหนดสาขาและช่วงวันที่ที่อนุญาต; `token_sha256` ใส่เมื่อจะใช้ static bearer สำหรับเครื่องภายใน และละได้เมื่อใช้ OAuth เท่านั้น. HRMS ใช้ `HRMS_MCP_TOKENS_JSON` ที่มี **scoped token แยกตามสาขา**; อย่าใช้ token admin สำหรับ Gateway. `allow_person_details` ปิดเริ่มต้น และต้องมี `employee_ids` allowlist เมื่อเปิด.

ตัวอย่าง URL Production ที่ตรวจว่ามี service: `https://market-order-app-production.up.railway.app`, `https://general-cashflow-production.up.railway.app`, `https://line-bill-capture-production.up.railway.app`, `https://hrms-backend-production-8d94.up.railway.app/mcp`. URL และรหัสสาขาอาจเปลี่ยนได้ ต้องตรวจอีกครั้งก่อนปล่อย. `line_source_id` ในตัวอย่างอ้างจาก source default; ต้องเทียบกับค่าของ Production เพราะ `LINE_BILL_CAPTURE_GROUP_LABELS` อาจ override.

รัน HTTP ด้วย `npm ci && npm start` แล้วตรวจ `/health`. เรียก MCP ต้องใช้ bearer ที่ถูกต้อง; ไม่มี endpoint ที่อ่านข้อมูลธุรกิจโดยไม่ยืนยันตัวตน. สำหรับเครื่องภายในใช้ static token จาก `BUSINESS_MCP_CLIENTS_JSON`; สำหรับ ChatGPT ให้ตั้งค่า `BUSINESS_PUBLIC_URL`, `BUSINESS_OAUTH_SIGNING_KEY`, `BUSINESS_OAUTH_PASSWORD_SHA256`, `BUSINESS_OAUTH_CLIENT_NAME` ใน secret store เพื่อเปิด OAuth authorization code + PKCE แบบ owner-only. Gateway เผยแพร่ protected-resource metadata, authorization-server metadata และ Dynamic Client Registration. หน้าอนุญาตจะให้เจ้าของกรอกรหัสผ่านและยืนยันสิทธิ์อ่าน. ใช้รหัสผ่านสุ่มยาวแยกจาก bearer/API token; ค่า SHA-256 อยู่ใน secret store เท่านั้น. OAuth access token มีอายุ 1 ชั่วโมงและ refresh token 30 วัน; เปลี่ยน signing key เพื่อตัดสิทธิ์ token เดิมทั้งหมด.

เพิ่มใน ChatGPT บนเว็บผ่าน Plugins → Add custom MCP server → URL `https://<gateway-domain>/mcp` → OAuth. ขั้นตอนนี้ทำได้หลัง Railway deploy และตรวจ OAuth metadata แล้วเท่านั้น; SOLAO Business MCP เชื่อม ChatGPT แล้ว และรีเฟรชเป็น 15 tools วันที่ 8 ตุลาคม 2026 โดยคงบัญชี OAuth เดิม. [ข้อกำหนด ChatGPT custom MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server) และ [ข้อกำหนด OAuth](https://developers.openai.com/plugins/build/auth) อธิบายเหตุผลที่ static bearer อย่างเดียวไม่พอ.

รัน stdio ด้วย `BUSINESS_STDIO_CLIENT=<configured-name> npm run stdio`. `npm run verify:live` ใช้ `BUSINESS_VERIFY_CLIENT` และ credentials จริง ตรวจทั้งสี่แหล่งโดยพิมพ์เพียงสถานะ ไม่พิมพ์ตัวเลขธุรกิจ; exit code เป็น 1 เมื่อมีแหล่งที่อ่านไม่ได้. `PARTIAL` จากหน้าที่ยังไม่อ่านยังแสดงเป็นข้อจำกัด แม้การเชื่อมต่อสำเร็จ.

## Railway

สร้าง service ใหม่โดยใช้ root directory `/business-mcp`, Dockerfile ในโฟลเดอร์นี้, start command ตาม Dockerfile และผูก secret/env ผ่าน Railway. ไม่มี volume หรือ database ของ Gateway จึงไม่มีข้อมูลธุรกิจเก็บถาวร. [แผน release](DEPLOY.md) ระบุลำดับผูกสิทธิ์ต้นทางและหลักฐานที่ต้องตรวจ. ต้องตรวจ `initialize`, `tools/list`, และการอ่านจริงครบสี่ระบบหลัง deploy จึงประกาศว่าใช้งานครบ. การ deploy ต้องขออนุมัติผู้ใช้ทุกครั้งตาม root `AGENTS.md`.

## พฤติกรรมด้านความถูกต้อง

ภาพรวมแสดง `PARTIAL` และ `missing_coverage` เมื่อแหล่งใดขาดหรือยังมีหน้าเพิ่มเติม. `null` หมายถึงไม่ทราบ. ทุกเครื่องมือบังคับสาขาและวันที่ฝั่ง Gateway. ไม่มีการรวมยอดขายกับยอดรับเงินหรือบิลค่าใช้จ่ายเพียงเพราะวัน/สาขาตรงกัน. รายละเอียดปฏิบัติงานเปิดได้เมื่อมี allow_hr_operations และ HRMS scoped operational token เท่านั้น; legacy person access ใช้สิทธิ์ราย ID ตามเดิม.

## ClickHouse POS detail candidate (not released)

Two additional authenticated tools, `business_pos_list_receipts` and `business_pos_read_receipt`, implement bounded header → line/payment drilldown with direct read-only ClickHouse GET SELECTs. They remain closed until dedicated source bindings, verified branch IDs and `allow_pos_details:true` are configured. Amounts are source strings; seller/refund semantics are unknown. Storefront classification requires reviewed codes, otherwise UNCLASSIFIED. Existing 15 tools and AS_REPORTED sales summary remain intact. See [contracts, configuration and live/release gates](docs/POS_READONLY.md). Current candidate has no direct live-source proof and was not deployed.

A [chat-only metadata diagnostic release](docs/CHAT_METADATA_RELEASE.md) can add schema/grant-summary/runtime-hash evidence to existing authenticated `business_describe_sources({})` with an explicit operator-only flag and Railway server-side references. No owner terminal is needed after the reviewed deployment. This candidate is not deployed, and metadata credentials never enable POS detail automatically.
