# นำเข้าอีเมลแบบอ่านต่อจากจุดเดิม — 29 ตุลาคม 2026

ผู้ใช้อนุมัติแก้ตัวนำเข้า ลดการอ่านซ้ำ และนำเข้าหลักฐานค้างให้ครบเมื่อ 29 ตุลาคม 2026. ขอบเขตเริ่มต้นคือช่วงย้อนหลัง 45 วันของตัวนำเข้าเดิมทั้งห้าแหล่ง; การยืนยันรับเงินจริง ปิดเอกสาร ปรับยอดย้อนหลัง หรือแก้ชีทยังอยู่นอกงานนี้.

Live target: Apps Script `ดึงข้อมูลรับเงินเข้า`, project `1Mxaj5LfLEQoFRbyDuj0lPSRE2ms3RNQVZaImeXlEesXcMTS3wreqhG4i`, บัญชี `solao.acc@gmail.com`. ห้าม push `.clasp.json` ของ monthly Sheet ไปที่โครงการนี้. เก็บ CONFIG/token เดิมในโครงการ ไม่ใส่ค่า credential ลง Git.

เพิ่ม `google-apps-script/CashflowMailRuntime.gs` และเปลี่ยนเฉพาะ body ของ `importGrabReports`, `importKplusShopReports`, `importScbBusinessAnywhereReports`, `importKrungsriReports`, `importKrungthaiBusinessReports` เป็น `return cashflowMailRun_('<grab|kplus|scb|krungsri|krungthai>');`. เก็บ helper/trigger เดิม รวม Grab รอบ 00:00/12:00 Asia/Bangkok. รัน `probeCashflowMailApi` ก่อนสลับ handlers เพื่อยืนยัน API/บัญชี; ไม่มีเหตุผลให้เปลี่ยน credential หรือขยาย OAuth scope. หาก Google แจ้งว่า Gmail API ยังไม่เปิด ต้องเปิด service ในโครงการเดิมและตรวจ scope เดิมก่อน; ไม่ fallback ไปสแกนเธรดเก่า.

Runtime ใช้ Gmail REST API ผ่าน OAuth ของ Apps Script เดิมและ UrlFetch; อ่านเฉพาะ message IDs ตาม query ที่ตรึงช่วงเวลา ไม่ใช้ thread.getMessages(). บันทึก IDs/pageToken/index ทุกข้อความ และเลื่อน watermark เมื่อครบทุกหน้าเท่านั้น. รอบปกติมี overlap สองวันเพื่อรับอีเมลที่มาถึงช้า; marker รายข้อความข้ามก่อนอ่าน MIME/ไฟล์แนบ. งานที่ไม่ถึงเวลาไม่เรียก Gmail. โควตาหรือ rate limit ใช้ shared backoff; ไม่วนยิงทุกห้านาทีขณะพัก.

เก็บ marker รุ่นเดิมทั้งหมด. รุ่นใหม่ใช้ `cashflow:mail:v3:state:<source>`, `:done:<source>:<messageId>`, `:file:<source>:<digest>`, `:failure:<source>:<messageId>`, `:last:<source>` และ `cashflow:mail:v3:pause-until`. Marker สำเร็จเกิดหลัง HTTP 2xx JSON success=true ที่ไม่ใช่ FAILED เท่านั้น. หลักฐานที่อ่านไม่ครบไม่แทนด้วยศูนย์; failure ledger เก็บรหัสที่ผ่านการกรองและรอ retry แยกจาก scan checkpoint. ไฟล์สำเร็จในข้อความที่มีไฟล์อื่นล้มเหลวไม่ถูกส่งซ้ำ. ไม่มีการลบ dedup/audit/เอกสารเดิม; legacy Gmail labels ไม่ใช้เป็นข้อพิสูจน์การนำเข้า.

`continueCashflowMailBackfill` ทำงานเป็นชุด มีกรอบเวลาและจำนวนข้อความ; เป็นการใช้ native inbox-import API เดิม. ไม่เขียนฐานข้อมูลตรงและไม่ยืนยัน/ปิดวัน. Server Grab เดิมรองรับ attachment checksum และคง CLOSED; bank single-file message IDs คงเดิม และหลายไฟล์เพิ่ม checksum ต่อท้าย ID โดยคง original ID เป็น prefix. ต้องเทียบผล DB/checksum และ snapshot hash ของ CLOSED หลังนำเข้า; HTTP success ไม่ใช่หลักฐานเงินเข้าธนาคาร.

Source/tests ใช้ built-in Node VM services mocks และรันผ่าน SSD snapshot. หลักฐานส่วนตัวอยู่ `/Volumes/SSD Files/SOLAO/cashflow/reports/email-import-repair-20261029/`; สำรอง source ที่มี credentials อยู่ `/Volumes/SSD Files/SOLAO/cashflow/backups/mail-import-live-20261029/` เท่านั้น. สถานะเริ่มต้น Local; ต้องบันทึกผล live readback/API probe/ingestion แยกหลังทำจริง.

`inspectCashflowMailStatus` อ่าน checkpoint/failure/checksum/importId โดยไม่เรียก Gmail หรือ API; log ย่อยขนาดเล็กให้เก็บกลับจาก editor ได้ครบและไม่ dump credentials. `inspectCashflowKrungsriFailure` อ่าน ZIP ที่ค้างหนึ่งฉบับเพื่อวินิจฉัย โดยไม่ post/import/แก้ retry.

Krungsri ส่ง ZIP ที่มีเพียง `SUMMARY_YYYYMMDD.csv` ในวันที่ไม่มีธุรกรรมด้วย. `/api/inbox-imports/krungsri` ยอมรับเฉพาะรูปแบบที่ยืนยันชื่อ ZIP, merchant, วันจริงและชื่อ CSV ตรงกัน พร้อม header/ครบทุกช่องทาง/GRAND TOTAL ที่ระบุ count/gross/fee/net เป็นศูนย์อย่างชัดเจน. เก็บต้นฉบับ ZIP และ metadata/audit แต่ไม่สร้าง bank transaction และไม่ผูกยอดรายวัน; สถานะ `PENDING_REVIEW` เพื่อเก็บหลักฐานให้ผู้ตรวจ. รายงานที่ขาดข้อมูลหรือมีธุรกรรมบวกยังต้องมีไฟล์รายละเอียด; parser ของธนาคารอื่นไม่ใช้ opt-in นี้. รายงานที่มีรายละเอียดอยู่แล้วคงการข้าม SUMMARY เพื่อไม่รวมยอดซ้ำ.

อ้างอิง: [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas). ไม่อ้างว่า REST API ไม่มีโควตา และไม่เดาเวลาคืนโควตา.
