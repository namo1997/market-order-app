## 11 ตุลาคม 2026 — Local: ตัดสรุปยอด/เอกสาร และบันทึกกันลืมบนมือถือ

- ผู้ใช้สั่ง "สรุปยอด / เอกสาร และ บันทึกกันลืม · มีข้อความ เอาออกเลย". ซ่อนเฉพาะมือถือแอดมิน (CSS ≤760px); Desktop ยังมีทั้งสองส่วน ข้อมูลบันทึกกันลืมไม่ถูกลบ.
- Build ผ่าน; browser 375px ไม่มีสองปุ่มนี้และไม่ล้น. รอผู้ใช้อนุมัติ deploy.

## 11 ตุลาคม 2026 — Production: มือถือหน้าเดียว เน้นเงินสด

- ผู้ใช้ขอ "ลดปุ่มมากที่สุด เอาหน้าหลักออก แสดงวันที่ไว้เลย", "เน้นไปที่เงินสด", "ข้อความง่ายๆ แสดงไปเลย" และสั่งเอาขึ้น. ต่อจาก release `23de8c5` (deployment `eca0764f`).
- มือถือแอดมินเหลือหน้าเดียว "รับเงิน": เดือน + แถบวันที่เห็นตลอดพร้อมคำสถานะ (รอตรวจ/ตรวจแล้ว/ปิดแล้ว) + การ์ดแต่ละสาขาแสดงเงินสดที่แคชเชียร์ส่งและ รอนับเงิน/นับแล้ว ตรง/ขาด-เกิน. ตัดหน้าหลัก, แถบเมนูล่าง, ช่องเดือน/สาขา/โหลดใหม่, ทั้งหมด/ต้องตรวจ, แบ่งหน้า. อ่านข้อมูลด้วย GET `/api/daily-receipts` (ทั้งเดือน) และ `/api/reports/receipts-overview` (วันที่เลือก) เดิม ไม่สร้างใบรับเงิน.
- หน้าตรวจ: เปิดที่เงินสด, ช่องทางอื่นเป็นแถวข้อความแสดงทันที, การ์ดวันเป็นข้อมูลอย่างเดียว (เปลี่ยนวันจากหน้ารับเงิน), ซ่อนแถบความคืบหน้าและปุ่มช่องทางที่ไม่มียอดบนมือถือ, หลังยืนยันเงินสดไม่กระโดดไปช่องทางอื่น.
- SSD: client 57, server 344/skip 1 เดิม, build ผ่าน (`/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-11T10-40-37-910Z-41ff3d5f`). Browser Local: เลือกวัน/เดือน, เปิดสาขา, ย้อนกลับคงวันเดิม, 375px ไม่ล้น, Desktop 1280px คงเดิม. ภาพ `/Volumes/SSD Files/SOLAO/cashflow/reports/claude-mobile-cash-*.jpg`.
- Railway deployment `8cb54c12-de83-45ba-85c3-3f4d5f412344` SUCCESS; `/health` commit `8e0b394979db2a2c55ae7186018cda492e2e808b`, source SHA-256 `716b83f7a124fa1d9c435904c634ed8250a14770484553cd19a079f9bc33bb12` / 89 files ตรงกับ commit; bundle มีโค้ดใหม่, API ไม่มี token = 401.
- ข้อจำกัด: คำสถานะบนแถบวันมาจากสถานะใบรับเงินทั้งใบ ไม่ใช่เฉพาะเงินสด; หน้าแรกไม่มีตัวกรองสาขา (แสดงทุกสาขา).

## 11 ตุลาคม 2026 — Production: จัดหน้าตรวจรับเงินมือถือใหม่ + แก้หน้าขาวตอนพิมพ์

- ผู้ใช้ขอให้หน้า `?date=2026-10-01` ใช้บนมือถือดีขึ้น ทดสอบทุกปุ่ม และอนุญาตเปลี่ยนการวางหน้าได้ทั้งหมด; อนุมัติ "ดีพลอยเลย". Claude ทำต่อจากงาน Codex ที่ค้างใน branch `codex/cashflow-mobile-admin` บนฐาน Production `381a59c`. ไม่มีการเปลี่ยน server/src หรือ schema.
- แก้บั๊ก Production: `ReceiptPrintSheet` อ้าง `mobileReceipt` ที่ไม่มีใน scope ทำให้กด "พิมพ์สรุป/พิมพ์รายละเอียด" ของใบที่ปิดแล้วจอขาวทั้งแอป (ทั้งมือถือและคอม).
- มือถือแอดมิน: การ์ดวัน (สาขา/วันที่/สถานะ/ผลต่าง), ช่องทางรับเงินเป็นรายการพร้อมสถานะและแถบความคืบหน้าแทน dropdown, เปิดที่ช่องทางแรกที่ยังไม่ตรวจและเลื่อนไปช่องถัดไปหลังยืนยัน, แถบขั้นตอนของวันติดล่างจอพร้อมข้อความผิดพลาด/สำเร็จ, ส่วนเสริมใช้สไตล์เดียวกัน.
- แก้พฤติกรรม: ปุ่มยืนยันช่องทางบนมือถือกดไม่ได้เมื่อยังไม่กรอกยอดรับจริง (ช่องว่างถูกเก็บเป็น 0); ส่งกลับแก้ไขต้องมีเหตุผล; ปุ่มบันทึกยอดปรับปรุงไม่ค้าง "บันทึกแล้ว" หลังแก้ใหม่; ข้อความบันทึกสำเร็จแสดงจริง (หายเองใน 5 วินาที); ตัวนับช่องทางนับการยืนยันทั้งวัน และช่องที่ยืนยันพร้อมเหตุผลแต่เงินยังไม่เข้าแสดงสีเหลือง; ป้ายหน้าหลักเลือกวันเดียวเป็น "วันขาย"; ประวัติการแก้ไขเป็นภาษาไทยพร้อมเวลา; ปุ่มที่กำลังทำงานไม่ถูกซ่อน; ปรับยอดหลังปิดเข้าถึงได้จากปุ่มในการ์ด. Desktop คงเดิม ยกเว้นแก้พิมพ์, ข้อความ empty state, เหตุผลส่งกลับ และป้ายประวัติ.
- SSD: client 57 ผ่าน, server 344 ผ่าน/skip 1 เดิม, build ผ่าน (`/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-11T10-18-58-039Z-6a34a48a`). Browser Local ทดสอบทุกปุ่มบน QA DB `mobile_audit` (ส่ง/ส่งกลับ/ตรวจทั้งวัน/ปิด/ปรับยอดหลังปิด/แจ้งปัญหา+แนบไฟล์/พิมพ์/บันทึกรูป), 320/375px ไม่ล้น, 1280px คงเดิม. ภาพ `/Volumes/SSD Files/SOLAO/cashflow/reports/claude-mobile-redesign-*.jpg`.
- Railway deployment `eca0764f-005a-4b95-990e-f1eec30989f2` SUCCESS; `/health` commit `23de8c508e56fbaf50038c5a31922a7d9fffeeb9`, source SHA-256 `7073f8f8637dd7874cb24864c71265ce8165606d7697cf6400d423d934a45c12` / 89 files ตรงกับ commit. Bundle ที่ให้บริการมีโค้ดใหม่, API ไม่มี token ยังได้ 401. ตรวจ Production ได้เฉพาะหน้า login (ไม่ใช้ PIN จริง); manifest `/Volumes/SSD Files/SOLAO/cashflow/reports/claude-mobile-redesign-release-20261011/`.
- ข้อจำกัด: บัตร/QR/Grab บนมือถือยังยืนยันไม่ได้จนกว่าจะมี Statement/รายงาน Grab (กติกาเดิมของ server); หน้าแคชเชียร์ไม่ได้ทดสอบครบทุกปุ่ม.

## 11 ตุลาคม 2026 — Production: แอดมินมือถือแนว LINE Bill

- ผู้ใช้สั่ง “อัพเลยครับ ขอลิงค์ด้วย” หลังตรวจหน้าทดลอง; ปล่อยเฉพาะ Cashflow บนฐาน Production `dfc282a`. ไม่มีการเปลี่ยนโค้ด server/src หรือ schema.
- Railway deployment `5858d57d-1319-4d59-b4dd-9cfa8516cb8a` SUCCESS; runtime commit `381a59c3bd27266064888f2ee7a6282366d10b04`, source SHA-256 `a8b1f95f1ab6180c9d078b91532b13c92211fabf4296b612d244553c2ef32b70` / 89 files ตรงกับ committed source.
- Full SSD release checks: server344 ผ่าน/skip1 เดิม, client57 ผ่าน, build ผ่าน. Protected read-only DB comparison หลังปล่อย: schema ไม่เปลี่ยน, 11 ตารางข้อมูลเงินไม่เปลี่ยน, day1 summary ตรง; unauthorized overview ยังคง401.
- Production browser: named Admin login, มือถือ389px ไม่ล้น, หน้าหลัก/รับเงินสองเมนู, วันที่1ทุกสาขา, เปลี่ยนปฏิทิน1→2→1 และเปิดรายละเอียดรับเงิน. การบันทึกเงินทดสอบใน Local QA แยกตามรายการด้านล่าง.
- หลักฐาน release: `/Volumes/SSD Files/SOLAO/cashflow/reports/mobile-release-2026-10-11T07-57-12.414Z`; test log `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-11T07-57-29-577Z-de3c5417/reports/command.log`. ลิงก์ https://general-cashflow-production.up.railway.app/?date=2026-10-01 .
- เหลือเมนูมือถือ หน้าหลัก/รับเงิน; เลือกช่องทางจากคิว ดูหลักฐานภาพ/PDF แล้วกรอกหรือยืนยันทีละช่องทาง พร้อมปุ่มหลักด้านล่าง. คงปฏิทิน วัน สาขา ยอด unknown และ API เดิม.
- พับปัญหา/ประวัติ/วิธีคำนวณ; เพิ่มกล่องยืนยันและกรอกเหตุผลในหน้าแทน native prompt; แก้เปิดไฟล์ปัญหาและการส่งยอดใหม่ให้ใช้ acknowledgement เดิมครบถ้วน. Desktop/cashier ยังคงช่องทางใช้งานเดิม.
- Client57 ผ่านและ build ผ่าน; server344 ผ่าน/skip1 เดิม. Browser Local ตรวจกรอก/สลับช่องทาง/บันทึก/โหลดใหม่บน QA DB แยก, ภาพ/PDF, ปฏิทินและสองสาขา, viewport320/390 ไม่ล้น.
- สำเนาข้อมูลจริง 1 ต.ค. มี 2 สาขาและไฟล์เดิม12ไฟล์ตรง; ไม่นำข้อมูล QA ขึ้น Production. รายงาน `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-11T06-29-29-574Z-eb5fc064/reports/line-bill-design-review-20261011.md`. บันทึก deployment/hash หลังปล่อย; งานนำเข้า Statement/พิมพ์ครบทุกแบบยังไม่รวมในการตรวจนี้.

## 11 ตุลาคม 2026 — Local: ข้อมูลจริงวันขาย 1 ตุลาคม ทุกสาขาในหน้าทดลองมือถือ

- ตามคำขอผู้ใช้ ใช้ existing overview loader อ่าน Production ด้วย REPEATABLE READ / READ ONLY transaction ครั้งเดียว แล้วบันทึก snapshot เฉพาะวันที่ 2026-10-01 ทุกสาขาบน SSD. ไม่เปิด server startup, ไม่ refresh POS, ไม่แก้ข้อมูล Production.
- Snapshot ได้ 2 วัน–สาขา; คง unknown เป็น null. Local preview พอร์ต 5289 อ่าน snapshot เท่านั้น ไม่มี upstream connection/credential; ปิด mutation และยังไม่สำเนาภาพหลักฐาน.
- UI รองรับ optional `preview_snapshot` เพื่อแสดงวันที่จริงแทนเดือน, ป้ายสำเนาอ่านอย่างเดียว และปิดปุ่มแก้ไข/ไฟล์ที่ไม่ได้สำเนา. หน้าใช้งานจริงที่ไม่ส่ง metadata นี้คงพฤติกรรมเดิม.
- SSD tests 56 ผ่าน, build ผ่าน; ตรวจ API เทียบ rows/summary กับ snapshot, filter แต่ละสาขาเก็บ null, ปิด local writes (405), browser แสดงวันที่/ยอดทั้งสองสาขาถูกต้อง. แก้กรอบ `/phone` ให้แสดงเต็มความสูง.
- หลักฐานและ manifest: `/Volumes/SSD Files/SOLAO/cashflow/previews/mobile-real-2026-10-01/`; รูป `mobile-admin-real-day.jpg`. Snapshot เป็นสำเนารายงาน ไม่ใช่ full DB backup. Local เท่านั้น ยังไม่ push/deploy.

## 11 ตุลาคม 2026 — Local: หน้าแอดมินมือถือแบบปุ่มน้อย

- Branch `codex/cashflow-mobile-admin` จาก `cashflow/production-base` (`fec9d4a`; health Production ยืนยัน source `dfc282a` ก่อนเริ่ม). ยังไม่ push/deploy.
- เพิ่มหน้าหลักมือถือ ยอดรับยืนยัน งานต้องตรวจ การ์ดรับเงินที่ขยายรายละเอียด/หลักฐานได้ และแถบล่าง 4 เมนู. รวมเครื่องมือเดิมในเพิ่มเติม; ใช้ GET receipts-overview เดิม ไม่มี schema/server/auth change.
- Admin จอไม่เกิน 760px เริ่มที่หน้าหลัก; Desktop/แคชเชียร์คงเมนูเดิม. เลือกวันที่บนมือถือแทนปฏิทินเต็ม; รักษาตัวกรองระหว่างเปิดตรวจและกลับรายการ. คง unsaved-note guard และ audited actions เดิม.
- เดือนปัจจุบันแสดงถึงวันไทยปัจจุบัน ไม่เอาวันอนาคตขึ้นก่อน; ยอด unknown แสดง —; ระบุวัน–สาขาและจำนวนอาจซ้ำกัน. โหลดผิดพลาดมี retry และไม่แสดงยอดเก่า.
- SSD client tests 56 ผ่าน + build ผ่าน (Vite chunk-size warning เดิม); browser fixture ตรวจ 320/390/430px ไม่ล้นแนวนอน, Desktop 1280px ใช้ nav เดิม, การ์ด/ตัวกรอง/แบ่งหน้า/empty/error/retry/ทางกลับ/logout.
- หลักฐาน `/Volumes/SSD Files/SOLAO/cashflow/reports/mobile-admin-review.md` และภาพ mobile-admin-home.jpg / mobile-admin-receipts.jpg. Preview ใช้ข้อมูลสมมติ ปิดการบันทึก ไม่มีข้อมูลจริง. ยังต้องตรวจ authenticated Production flows หลังอนุมัติ release.

## 11 ตุลาคม 2026 — Production: กฎแนะนำย้ายเดือนตามสมุดรับจ่าย (Google Sheets)

- ผู้ใช้สั่ง "เปลี่ยนให้ตรงกับ Google ชีตเลยครับ ใช้หลักเกณฑ์ใน Google ชีตเป็นหลัก"; deployment `19f4b2ca-7643-48d2-af71-dbd5e0067e77` SUCCESS จาก `dfc282a` บนฐาน `4ba1912`/deployment `9c78df15` (redesign จากแชตอื่น)
- กฎใหม่: ค่าน้ำค่าไฟจ่ายวันที่ 1–7 → เดือนก่อน (หลังวันที่ 7 อยู่เดือนที่จ่าย); ซัพเครดิตและบิลรวมจ่ายซัพ "ชุดรวม … ≥5 สลิป" จ่ายวันที่ 1–15 (ไม่ใช่เงินสด) → เดือนก่อน เพราะสมุดลงซัพรอบ 1–15 วันที่ 15 และรอบ 16–31 วันที่ 31 ของเดือนรับของ
- เหตุผลจากการเทียบ ส.ค. 2569: กฎเดิมย้ายค่าไฟสันกำแพง 48,863.05 (จ่าย 9 ส.ค.) ไป ก.ค. ผิดจากสมุด และไม่จับบิลรวม 6 ส.ค. 516,081.76 (ซัพ ก.ค. รอบ 16–31 ในสมุด 522,206.31); จำลองกฎใหม่: สันกำแพงต่างจากสมุด ~23k, คันคลองที่เหลือส่วนใหญ่คือซัพรอบ 1–15 ส.ค. 406,088 ในรอบ LINE 20 ส.ค. ที่ยังไม่ปิด
- SSD tests: server 344 ผ่าน/skip 1 (ปรับ expectation ช่วงวันเดิมตามคำสั่ง), client 54, build ผ่าน; หลังปล่อย /health commit ตรง, /api/pnl/report ไม่มี token = 401; รายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/aug-2569-gap-review-20261011.md`

## 11 ตุลาคม 2026 — Production: แนะนำเดือนอัตโนมัติ (A) + หมวดภาษี (B) + ประกันสังคม HRMS (C)

- ผู้ใช้อนุมัติ "ดีพลอยเลยครับ"; deployment `cb333e87-c09f-4d40-aba9-aa0ca58a859a` SUCCESS จาก `bb42d93` (branch `cashflow/pnl-month-tax-sso`: 9935152 A/B, 8837eef C cherry-pick จาก cf2e72d, c78f237 + bb42d93 Claude แก้กฎภาษี/เงินสด/ค่าสาธารณูปโภค) บนฐาน `26b3270`/deployment `bddcdc2f`
- ที่มา: ตรวจ ส.ค. 2569 เทียบสมุดรับจ่ายพบหลุด ~932k (`/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/aug-2569-gap-review-20261011.md`)
- หลังปล่อย: `/health` commit `bb42d935…`, source_sha256 `9e5467da…` (84 ไฟล์); `/api/pnl/credit-suppliers`, `/api/pnl/report`, POST `/api/pnl/items/period-month/bulk` ไม่มี token = 401; bundle มี "กำไรหลังภาษี", "ย้ายทั้งหมดที่เลือก", "ส่วนนายจ้างสมทบ"; startup ไม่มี error (migrate pnl_seed_versions, pnl_credit_suppliers, pnl_categories.pnl_group, seed ซัพเครดิต 27 + กฎภาษี)
- ก่อนปล่อย Claude ทดสอบ MySQL 8.4 tmpfs + LINE preview + HRMS จำลอง: แนะนำ 13 รายการ 681,462.98, bulk/audit ถูกต้อง, ยอดสองเดือนคงเดิม, TAX แยกแถว, SSO 2,225+2,225; SSD tests server 341/skip 1, client 51, build ผ่าน
- ไม่ได้ login Admin Production; ผู้ใช้กดยืนยันย้ายเดือนเอง ส่วน กยศ. 960 ถูกจัดเป็น TAX ตามกฎสรรพากร ผู้ใช้อาจเปลี่ยนเป็น STAFF

## 11 ตุลาคม 2026 — Local: แนะนำย้ายเดือนและแยกหมวดภาษี (A/B)

- เพิ่มทะเบียนซัพเครดิต 28 คำค้น พร้อม API admin/audit และ UI เพิ่ม/ลบ/เมนูร้าน; seed version ครั้งเดียวไม่เติมรายการที่คนลบกลับมา. แนะนำเดือนตามข้อความก่อน ซัพเครดิตวันที่ 1–10 และค่าสาธารณูปโภควันที่ 1–15 พร้อมเหตุผล; ไม่แนะนำรายการไม่นับหรือมี period override. คนต้องกดยืนยันเสมอ.
- เพิ่มย้ายเดือนหลายรายการ (สูงสุด 200) ใช้ validation/override/audit เดิมใน transaction เดียว ล้มเหลวรายการเดียว rollback ทั้งชุด. คงหมวด/excluded/note.
- เพิ่ม TAX/pnl_group และกฎภาษี priority50 แบบ seed ครั้งเดียว; แยก opex/operating_profit/tax/net_profit_after_tax ทั้งเดือน/matched/สาขา. net_profit เป็น alias หลังภาษี; manual/recurring ใช้ TAX ได้. UI แสดงก่อนและหลังภาษี.
- Full SSD: server334 ผ่าน + skip1 เดิม, client51 ผ่าน, build ผ่าน. UI fixture 1440/1024/768/390 ไม่มี page horizontal overflow, visible text >=12px, inputs มี labels; bulk selection/create/delete/menu ผ่าน. Log/ภาพ/ผลตรวจและ commit ใน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/month-tax-handoff.md`.
- ทำเฉพาะ A/B ไม่แก้ hrms.js/ไม่ทำ C; ไม่อ่านหรือเขียน Production, ไม่ push/deploy. รอ Claude ตรวจ MySQL 8.4 tmpfs และรวมงาน C จาก cashflow/pnl-hrms-sso. npm vulnerability warnings และ Vite chunk warning เดิมยังคงอยู่.
## 2026-10-11 — Local: ประกันสังคมจาก HRMS (หัวข้อ C)

- รวมส่วนพนักงานที่หักไว้และนายจ้างสมทบจำนวนเท่ากันจาก payroll LOCKED ต่อสาขา ใน STAFF/เดือน payroll. Field ขาด → missing/ยอด null และไม่นับประกันสังคมทั้งรอบ; UI เตือนและแสดงสองส่วนกับหมายเหตุยอดนำส่ง.
- ขยาย overlap LINE/manual ด้วย ประกันสังคม|สปส; เทสต์ต่อสาขา/buckets/cents/zero/missing/unlocked/overlap. ไม่แก้ HRMS source/schema หรือคำนวณ A/B; ไม่มี push/deploy. ผลตรวจและหลักฐานอยู่ SSD reports/pnl-v0/hrms-sso-handoff.md.

## 11 ตุลาคม 2026 — Production: รายจ่ายประจำยอดคงที่ + ปรับ UX หน้ากำไรขาดทุน

- ผู้ใช้สั่ง "ทำให้ครบเลยครับ ให้คุณตรวจงาน และอย่าลืมตรวจ ux ui"; deployment `bddcdc2f-a209-4ac5-8257-736694b0348b` SUCCESS จาก `9b9ba77` (branch `cashflow/pnl-recurring` = 304d8af รายจ่ายประจำ + e48c629 UX + 9b9ba77 หัวคอลัมน์) บนฐาน `193548a`/deployment `194febf6`; ตั้ง `CASHFLOW_BUILD_COMMIT` ก่อน upload จาก root ของ worktree
- หลังปล่อย: `/health` ready, commit `9b9ba77…`, source_sha256 `42d1ff86…` (84 ไฟล์); `/api/pnl/recurring` ไม่มี token = 401; bundle มีฟอร์มรายจ่ายประจำ; startup ไม่มี error (migrate pnl_recurring_* ผ่าน)
- Claude ตรวจก่อนปล่อยกับ MySQL 8.4 tmpfs + LINE Bill preview + POS ก.ย. จริง: create/skip/version/stop/STAFF reject/ช่วงเดือนผิด, ยอดรายเดือน ก.ค.–ม.ค. ถูกต้อง, audit int; UX ที่ 1024/390: หน้ายาวลดจาก 19,281 เป็น 4,933px, รอจัดหมวดเรียงยอด 15 แถว+ค้นหา, ตารางชิดขวา/≈ เฉลี่ย/ยุบหมวด 0, ไม่มี horizontal scroll; หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/claude-e2e-review-20261010.md`
- ไม่ได้ login Admin Production (ไม่ใช้ PIN จริงของผู้ใช้); ผู้ใช้ตั้งรายจ่ายประจำจริงเอง

## 2026-10-11 — Local: P&L UX review fixes

- Reorder P&L into totals/completeness/statement, actionable categorization, movement/exclusion, recurring/manual expenses, rules and collapsed source details. Source summaries retain totals, connection state and critical warnings.
- Sort uncategorized items by amount, search supplier/description, show 15 initially, and expose all items on demand. Compact desktop rows, mobile cards, accessible action disclosures and inline suggested-month actions preserve existing override payloads.
- Right-align tabular amounts, group all-zero categories, hide all-zero special branch columns, emphasize profit totals and sign colors, and annotate monthly prorated contributions with ≈. Recurring cards show full-month and counted-mode values; server calculations remain unchanged.
- Verified on SSD with a 63-item fictional fixture at 1440/1024/768/390px, existing server/client suites, new presentation helper tests and client build. Full evidence and commit: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/pnl-ux-fix-handoff.md`.
- Local only; no push/deploy or Production access.

# ประวัติ General Cashflow

## 2026-10-10 — รายจ่ายประจำยอดคงที่สำหรับ P&L (Local)

- เพิ่ม schema/API/admin UI รายจ่ายประจำ ตั้งครั้งเดียว นับอัตโนมัติทุกเดือน; แก้แบบมีผลตั้งแต่เดือน/ประวัติเวอร์ชัน/หยุด/ข้ามพร้อมเหตุผลและ audit. STAFF ปฏิเสธและใช้ decision guard เดิม.
- รวมค่าใช้จ่าย/COGS/สาขา/ส่วนกลางใน report พร้อม matched proration ตามวันเหมือน manual; เตือน LINE ยอดใกล้กัน ±5% โดยไม่หักเอง. HRMS/POS fallback/ค่าธรรมเนียมคงเดิม.
- Full SSD: server327 pass + skip1 เดิม, client48 pass, build ผ่าน; browser fixture 768px/form/loading/history ผ่าน. รายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/recurring-expenses-handoff.md` พร้อม path log และภาพ.
- Local เท่านั้น ไม่มี push/deploy/Production writes; Claude ตรวจ MySQL 8.4 tmpfs ต่อ. npm dependency vulnerabilities และ Vite chunk warning เดิมยังคงอยู่.

## 2026-10-10 — Production: HRMS ยอดจ่ายจริง + ทิป + POS + ค่าธรรมเนียม

- ผู้ใช้อนุมัติตั้งค่าเชื่อมและ deploy; integration จาก source Production 4c0f1d9 ของ deployment 7d7fce05 คง cashier issue UI แล้ว merge POS/HRMS scope ไม่รวม source dirty อื่น
- HRMS GET-only net LOCKED + APPROVED advance principal + FINALIZED separate tips; ส.ค. 1,084,636 ก.ย. 990,457 ต.ค.ร่างจึง 0 ตามคำยืนยันเจ้าของว่าจ่ายครบ; ตรวจ IDs/ยอดรวมทุกแหล่ง ไม่บวกดอกเบี้ย/หักคืน/ทิป INFO ซ้ำ
- Production audited overrides: #2283 โอนระหว่างบัญชีบริษัท 330,000 ไม่นับซ้ำ; #1299 2,520 + #1374 เงินสด 360 นอก HRMS นับเพิ่ม STAFF พร้อมเหตุผลและประวัติ คง LINE ต้นฉบับและ HRMS ทั้งหมด; #1862 กระดาษการตลาด740 จัด MARKETING และ #1061 ค่าเดินทาง Grab1,500 จัด TRANSPORT จากข้อความต้นทาง ไม่ซ้ำ platform fees
- ค่าธรรมเนียม ส.ค.124,167.37 ก.ย.61,634.84 จาก CLOSED receipts; ใช้ batch allocation ครั้งเดียว และการตลาดรวมใน gross-to-net ไม่บวกซ้ำ ไม่มี schema migration
- เพิ่ม /health source SHA256 จาก runtime source จริง และ build commit argument สำหรับ CLI deployment; JWT ปกติ 90 วันเก็บเฉพาะ server secret ต้องต่ออายุก่อนหมดอายุ
- หลักฐาน read-only/audit ที่ SSD reports/pnl-v0/production-*.json (private files permission600), full SSD server318 pass/1 skip เดิม + client48 pass + Vite build ผ่าน: /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T05-42-16-732Z-82159604/reports/command.log; deployment verification บันทึกตาม release ด้านล่าง

- Deployment สุดท้าย `194febf6-f412-4d60-8889-49ca0362a23e` SUCCESS, source `af749b6b0c5305e9a275cda087fd64f649bdb81f`; รอบแรก `d2d6ee7f` SUCCESS แล้วแทนด้วยรอบสุดท้ายเพื่อให้ Docker ใช้ Git commit ก่อน CLI fallback เมื่อมี Git metadata
- `/health` ready/commit ตรง และ source_sha256 `3fea60805a00bddfa33f5158e8386bc572a28927dfd9934aa81a6f75cec17bf4` ตรง 82 source files กับ worktree; report ไม่มี auth ตอบ401; API ส.ค.–ต.ค. + branch filter KK511,758/SK357,329 ผ่าน, Browser Admin โม แสดง ส.ค.1,084,636/ก.ย.990,457 และตัด330,000 จริง
- เปรียบเทียบ HRMS LOCKED ส.ค./ก.ย.และ approved advance payloads ไม่เปลี่ยน, payroll financial fields ต.ค.ไม่เปลี่ยน (attendance/freshness ต.ค.รับ scan ใหม่จาก live usage); P&L LINE378/manual0 คงเดิม, overrides5รายการตาม audit. Native startup repair เดิมเขียน timestamp/attachment และ audit94รายการ ทำให้ full receipt/line/reconciliation hashes เปลี่ยน; ตรวจ gross/status ของใบรับเงินและ fee allocations ในขอบเขต ส.ค.–ต.ค.ไม่เปลี่ยน ไม่อ้างว่าทุกคอลัมน์ทั่วฐาน byte-identical
- หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/production-pnl-verification-summary.json`, production-branch-verification.json, hrms-protected-deltas.json และ production-startup-audit-private.json. JWT หมดอายุ 8 ม.ค.2570 12:35 ICT ต้องต่ออายุก่อนวันนั้น; เมื่อ token/upstreamเสีย UI แสดง incomplete
- POS ส่วนเสริมไม่มีวันที่ต้องใช้ในข้อมูล Production ปัจจุบัน (มีใบรับเงินทุกวันแล้ว แม้บางวันยังไม่ CLOSED). ไม่แสดงยอด POS ที่ไม่เกิดขึ้นว่าเป็นรายรับใหม่. ทิป ก.ย./ต.ค.ยัง DRAFT ไม่นับ; post-payment corrections ปัจจุบัน0 และยังไม่ import โดยอัตโนมัติ. คำเตือนค่าแรง LINE2,880 ส.ค.เป็นความเสี่ยงแบบกว้าง; ตรวจแล้วเป็นค่าแรงนอก HRMS ตามหลักฐาน/คำยืนยันเจ้าของ

## 2026-10-10 — Local: เสริมรายรับ POS สำหรับวันที่ไม่มีใบรับเงิน

- ตามตัวเลือกที่ผู้ใช้อนุมัติ เพิ่ม read-only POS fallback เฉพาะวันก่อนวันนี้ที่ไม่มี daily_receipts; ใบรับเงินทุกสถานะ/ยอดศูนย์ชนะเสมอ ไม่สร้างหรือแก้ใบรับเงิน
- แยกยอดใบรับเงิน/POS ส่วนเสริม พร้อมวันที่/สถานะ และความครบของใบรับเงินที่ยังไม่ปิด; matched mode ยอมรับ POS + LINE ปิดโดยไม่อ้างว่าตรวจใบรับเงินแล้ว
- ป้องกันนับซ้ำ/ต่างเดือน/วันปัจจุบัน/ต่างสาขา; POS error timeout20s หรือไม่มี mapping แสดงคำเตือน ไม่เติมศูนย์ ไม่เปิดเผย upstream error
- SSD full server311 pass/1 skip เดิม, client48/build ผ่าน. Log: /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-47-47-919Z-d2b64d42/reports/command.log
- Browser component กับ API fixture สมมติ: matched/month/drill-down/POS fail ผ่าน และ 768px scrollWidth=768; ภาพอยู่ reports/pnl-v0/.playwright-cli/ บน SSD ไม่ใช่ Production UI
- รายงาน /Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/pos-fallback-20261010-handoff.md; ไม่มี migration/new env/Production writes/push/deploy รอ Claude ตรวจและผู้ใช้อนุมัติปล่อย


## 10 ตุลาคม 2026 — Production: หน้ากำไรขาดทุน P&L v0

- สถานะ: Production ตามอนุมัติผู้ใช้ “ดีพลอยได้เลยครับ”; deployment `b04bfda1-553f-4915-9600-7a45f2ab060a` SUCCESS จาก source commit `61a032e` (branch `cashflow/pnl-v0` บนฐาน `d1d7fdb` = deployment เดิม `55b6cf9a`)
- ความพยายามแรก `a386ccac` FAILED ตอน build เพราะอัปโหลดด้วย `--path-as-root` จากโฟลเดอร์ general-cashflow ขณะที่ service ตั้ง root directory = `general-cashflow`; ไม่มีผลกับ runtime เดิม แก้โดยอัปโหลดจาก root ของ worktree
- env ใหม่: `PNL_LINE_BILL_BASE_URL`, `PNL_LINE_BILL_EXPORT_TOKEN` (ค่าเดียวกับ token export ของ LINE Bill), `PNL_LINE_GROUP_BRANCH_MAP` (สันกำแพง→SK, คันคลอง→KK) ตั้งด้วย `--skip-deploys` ก่อน upload
- ตรวจหลังปล่อย: `/health` ready, `/api/pnl/report` ไม่มี token ตอบ 401, client bundle มีหน้า P&L, server เริ่มทำงานหลัง migrate ตาราง pnl_* โดยไม่มี error; Claude ไม่ได้ login Admin Production (ไม่ใช้ PIN จริงของผู้ใช้) ผู้ใช้เป็นผู้กดดึงรายจ่ายครั้งแรก
- ก่อนปล่อย Claude ตรวจ E2E กับ MySQL 8.4 จริง + LINE Bill งาน A + ยอด POS ก.ย. จริง: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/claude-e2e-review-20261010.md`
- ค้าง: ผู้ใช้ดึงรายจ่าย ส.ค.–ต.ค., ย้ายบิลสรุปเจ้าหนี้ ส.ค. (467,281.73) ไปเดือน ส.ค., กรอกรายจ่ายที่ไม่ผ่าน LINE (เงินเดือน ค่าเช่า ฯลฯ)

## 10 ตุลาคม 2026 — P&L v0 fix2 (G1 ย้ายเดือนรับรู้รายจ่าย LINE, Local)

- เพิ่ม period_month DATE NULL ทั้ง DDL และ information_schema ensure column ที่รันซ้ำได้. Override รับ YYYY-MM/null, ย้อนหลังได้ไม่เกิน 3 เดือน, ห้ามเดือนอนาคต, เดือนเดียวกับวันจ่ายเก็บ NULL; audit ใช้ item ID integer และรักษาหมวด/การไม่นับเดิม.
- Report โหลดรายการตามวันที่พร้อมรายการย้ายเข้าที่รอบปิดแล้ว และ overrides ครบทั้งสองกลุ่ม. ทั้งเดือนนับเต็มในเดือนปลายทาง; matched เฉลี่ยรายการย้ายเข้าตามวันครบของสาขา/วันเดือน ปัด cents ต่อรายการ และตัดไม่ระบุสาขา. เพิ่ม moved_in/moved_out พร้อมรายการ ยอดเต็ม และยอดหลังตัดไม่นับ.
- คำแนะนำชื่อเดือนไทยเต็ม/ย่อ + ปี พ.ศ. หรือไม่มีปี เป็น pure function และ suggested_period_month เท่านั้น. UI ต้องกดเอง มีช่องเดือน/ย้ายเดือนทั้งรอจัดหมวดและ drill-down, กล่องย้ายเข้า/ออก, วันจ่ายจริง, ย้ายกลับ พร้อมจัดหมวด/ไม่นับได้ตามเดิม; เดือนแสดงไทย + พ.ศ.
- Full SSD suite: server 306 ผ่าน / 1 skip เดิม (opt-in DB), client 48 ผ่าน, Vite build ผ่าน. รวม invariant ยอดสองเดือนคงเดิม และต้นทางลดเท่าปลายทางเพิ่ม. ไม่สร้าง MySQL บน Mac ไม่ push/deploy.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-07-17-615Z-e4225fe8/reports/command.log`; handoff `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix2-handoff.md`. รอ Claude ตรวจ MySQL 8 จริงและ browser/integration; ไม่มีการย้ายบิลจริงในงานนี้.

## 10 ตุลาคม 2026 — P&L v0 fix1 ตาม Claude (F1–F6, Local)

- F1–F2: override audit ใช้ expense item ID; rule audit อ่าน ID หลัง upsert, stable_key อยู่ payload. ทุก mutation มี fake audit ตรวจ integer/null. Public error เฉพาะ pnlError; unexpected error ตอบ PNL_REQUEST_FAILED และ log ข้อความปลอดข้อมูลลับ; permission ยังคง 403.
- F3–F4: ดึงล่าสุดแสดง UTC DATETIME เป็นเวลาไทยตาม Cashflow. UI เริ่มที่เฉพาะวันที่ข้อมูลครบ; POS CLOSED/LINE ปิดรอบตรงกันต่อสาขา, manual เฉลี่ยรายเดือนด้วย cents, ส่วนกลางใช้วันที่ทุกสาขาครบ, ไม่รวมไม่ระบุสาขาพร้อมแสดงยอด. โหมดทั้งเดือนเตือนกำไรสูงเกินจริงเมื่อมีรายรับ CLOSED แต่รายจ่ายไม่ครบ. กล่องจัดหมวด/รายการยังแสดงทั้งเดือน.
- F5: เพิ่ม TRANSPORT/ADMIN และกฎตั้งต้น normalized 14 กฎเมื่อสร้าง rules table ครั้งแรกเท่านั้น; created_by NULL แสดงระบบ พร้อม ALTER MODIFY ที่รันซ้ำได้. ลบกฎแล้ว migrate ซ้ำไม่เติมกลับ.
- F6: vendor frozen consumer/fixtures 20 assets byte-identical กับ manifest รอบก่อนพร้อม provenance, เปลี่ยนเฉพาะ path ของเทสต์เดิมและเลิกใช้ helper เตรียม dependency.
- Full SSD command ตรงตามผู้ใช้ ไม่มี prepare: server 299 ผ่าน / 1 skip เดิม (opt-in DB), client 47 ผ่าน, Vite build ผ่าน. ไม่สร้าง MySQL บน Mac ไม่ push/deploy.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-09T19-33-38-665Z-199998f5/reports/command.log`; handoff `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix1-handoff.md`. รอบแรกพบ permission error 500 และแก้จน rerun ผ่าน; Claude ต้องตรวจ fix1 กับ MySQL 8.4/LINE preview/POS จริงอีกครั้ง.

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

### Local — 10 ต.ค. 2026 เงินจ่ายพนักงาน HRMS และค่าธรรมเนียม

- เจ้าของยืนยันว่า HRMS ถือว่าจ่ายครบ: เพิ่มตัวอ่าน GET เงินเดือนสุทธิรอบ LOCKED + เงินต้นเบิกกลางเดือน APPROVED; ไม่บวกดอกเบี้ย/ยอดหักคืนซ้ำ และไม่แก้ข้อมูล HRMS.
- แยกสาขาผลิต/ส่วนกลาง คืนเฉพาะยอดรวม ปกปิดข้อมูลรายคน; เตือนเชื่อมไม่ได้/สาขาไม่ตรง/ค่าแรง LINE หรือกรอกเองที่อาจซ้ำ. เงินเดือนใช้เดือนรอบเพราะไม่มีวันที่โอนทั้งรอบ; matched เก็บยอด HRMS เต็มพร้อมคำเตือน.
- รวมค่าธรรมเนียมและการตลาดจากใบรับเงิน CLOSED ครั้งเดียว; ชำระเป็นชุดใช้ allocated fee ต่อวัน. รายการอื่นในใบรับเงินยังไม่เหมารวมเป็นรายจ่ายเงินสด.
- ทดสอบ SSD: server 316 ผ่าน + 1 skip เดิม, client 48 ผ่าน, build ผ่าน (มีคำเตือน bundle ขนาดเดิม); browser สมมติตรวจยอด 12,000 + 3,000 = 15,000, ค่า fee, หมวดค่าแรง และ upstream failure.
- หลักฐาน: /Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/hrms-paid-expenses-20261010-handoff.md; full run 2026-10-10T02-18-20-697Z-0f61aed4.
- ค้างก่อน release: ตั้ง HRMS ADMIN read bearer/branch map อย่างปลอดภัย, ตรวจยอดจริงและ MySQL integration, ตรวจซ้ำข้าม LINE/manual. ทิปจ่ายแยกและ post-payment corrections ยังไม่ดึงอัตโนมัติ. ยังไม่ push/deploy.
