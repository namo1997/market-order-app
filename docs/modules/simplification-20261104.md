# ลดงานซ้ำและแก้ release HOLD — Local 4 พฤศจิกายน 2026

งานนี้ต่อจาก candidate d0786fa1 บนฐาน Production bbd5dfc0 ไม่ใช่ audit tree เดือนสิงหาคม และยังไม่ deploy/push/config mutation

## สัญญาที่เปลี่ยน

- S01: หน้าปรับสต็อกสามหน้าส่ง PIN ที่ผู้ใช้กรอกให้ server ตรวจ ยกเลิก/ว่างไม่ส่ง และคงยืนยันยอด ไม่มี PIN ฝังในเงื่อนไข client; server production ยังต้องตั้ง PIN ที่ไม่ใช่ default
- S02: POST /api/orders/production/print-log ยอมรับเฉพาะคู่ 0/0 แบบ explicit เป็นทุกสาขา เหมือน GET print-items; คงผู้ใช้ฝ่ายผลิตและ audit ไม่ยอมให้ null/ค่าที่หายกลายเป็นรวมทุกสาขา
- S06: GET /api/general-purchase?summary=true เพิ่ม page/page_size (เริ่ม30 สูงสุด100), pagination และ stats.byStatus; counts ใช้ branch/department scope เดียวกันข้ามสถานะ รายการไม่มีรูป/items/timeline เต็ม; GET เดิมไม่ส่ง summary และ GET/:id คงสัญญาเต็ม
- ยอดใน summary card มาจาก SUM item estimated_price/actual_price ตามฐานการแสดงเดิม ไม่ใช้ header total ที่อาจต่างในเอกสารเก่า; ไม่มีการเปลี่ยนยอดใน DB
- S05: รายงานยอดขายรับวันที่จริงไม่เกิน366วัน ใช้วันไทยโดย default และ UTC สำหรับคำนวณช่วงก่อนหน้า; จำกัด branch/limit/search; ใช้ Pareto prefix แทน query เมนูซ้ำและเรียง barcode เมื่อยอดเท่ากัน
- รายงานยอดขายรวมเฉพาะ query ที่เหมือนกันและยังทำงานอยู่ ไม่ cache ตัวเลขหลังจบ; cacheเฉพาะ metadata ว่ามีกลุ่มสินค้า60วินาที; UIยกเลิกคำขอเก่าและโหลด autocomplete เมื่อfocus

## ลดความซ้ำซ้อนโดยรักษางานเดิม

- S03: ซ่อนเมนูรายงานเตรียมสร้าง คงURLเดิม; S07: ข้อความ/เมนู readonly ตามสิทธิ์; S08: กดรอรับแล้วเปิดเอกสารเป้าหมายในหน้ารับ; S09: ลบเฉพาะแท็บcreateที่เข้าไม่ได้ คงmanual-item modal/loaderที่ใช้ร่วม
- S06: providerโหลดรายการเมื่อเข้าworkspaceเท่านั้น แบ่งหน้าและโหลดรายละเอียดเมื่อเปิด; จำนวนรวมมาจากserveraggregate ไม่ใช่จำนวนแถวในหน้า
- S10: กระดิ่งหยุดขณะซ่อน/offline กลับมาแล้วrefresh รวมคำขอซ้อน และอ่านใหม่หลังบันทึก; ยังใช้รายการเพื่อส่งreceiving:followupsให้คิว ไม่ตัดเหลือcountอย่างเดียวจนคิวขาดรายละเอียด
- S12: ระบุชื่อรับสินค้าใหม่/เดิมให้ชัด คงlegacyprimaryและwriteflowตามที่เจ้าของเลือก ไม่retireระบบใด
- S04: schema settings/receiving columns ตรวจครั้งเดียวต่อprocess มีretryเมื่อผิดพลาด ค่าตั้งอ่านสดและหลายkeyอ่านเป็นชุด รักษาTEXTที่กว้างกว่า ไม่ALTERซ้ำทุกครั้ง
- S11: startBackgroundJobกันเริ่มjobซ้ำในprocess; push/sales syncรวมรอบที่ซ้อนกัน คงfinalretry failed_window และfollowupแม้ไม่มีFCM ยังไม่แบ่งhistorical auto-receive transactionเป็นbatchเพราะต้องพิสูจน์catchup/lockingแยก

## เลข PO อัตโนมัติที่ตรวจเพิ่ม

- ช่องเลข PO เว้นว่างให้serverจัดสรร; ใช้MAXnumeric suffixของprefixGPOตามวันที่ ไม่ขึ้นกับpo_dateที่แก้ได้หรือcustomเลขอื่น
- unique po_numberชนระหว่างออกพร้อมกัน: rollback/releaseแล้วลองใหม่สูงสุด8ครั้ง; เลขที่กรอกเองชนตอบ409ไม่เปลี่ยนให้เอง; PRเดิมออกซ้ำยังติดstatus409; auditครั้งเดียวในtransactionเดิม
- Native10scenariosตรวจpagination/ยอด/itemimages/gap001,003→004/หกคำขอพร้อมกัน/เลขprefixต่างจากpo_date/customเลข/manualduplicate/samePRrace

## ตัวเลือก worker ใหม่ (ไม่เปลี่ยนค่าจริง)

ไม่ตั้งค่า=พฤติกรรมเดิม ค่า literal false ของ BACKGROUND_JOBS_ENABLED ปิดทุกjob; SALES_SYNC_JOB_ENABLED, RECEIVING_PUSH_JOB_ENABLED, RECEIVING_AUTO_JOB_ENABLED ปิดเฉพาะjob หากตั้ง BACKGROUND_JOBS_OWNER จะทำงานเฉพาะเมื่อเท่ากับ BACKGROUND_JOBS_INSTANCE_ID ของinstanceนั้น ต้องตั้งowner/idอย่างถูกต้องก่อนแยกworker ไม่อ้างว่าเลือกworkerProductionแล้ว

## หลักฐานและข้อจำกัด

- Server Node22 รวม725/725 สองรอบ; predeploy45/45; nativeMySQL9.5 เจ็ดสถานการณ์ inventory/order/PO และ PR/PO อีก10สถานการณ์ ผ่านบนinstanceใหม่ที่ตรวจUUID/datadirและปิดแล้ว
- เทสต์ source/API: server/tests/backend-simplification.test.mjs และ sales-report-work.test.mjs; browser: client/tests/frontend-regressions.mjs และ sales-report.browser.mjs
- Client Node22 ผ่าน756/756สองรอบ; browser39/39 และ sales browser2/2; main/receivingbuildผ่าน ผลและSHAอยู่รายงาน SSD `/Volumes/SSD Files/SOLAO/market-order-system/reports/simplification-fixes-20261104/` ต้องใช้ผลสุดท้ายหลังแก้FollowupBellรองรับVMที่ไม่มีdocumentevent API ไม่ใช้รอบกลางที่ล้มเหลวรับรองrelease
- ไม่เปลี่ยนschemaธุรกิจ/ค่าตัวเลข/สิทธิ์ให้กว้างขึ้น ไม่มีการทดสอบClickHouse/AI/LINEจริงหรือAPKอุปกรณ์จริง Dockerถูกguardปฏิเสธเพราะdisk imageอยู่นอกSSD จึงใช้macOS Node22 ไม่อ้างว่าเป็นcontainerbuild
- Config gate JWT/PIN และcritical advisoryของnativeAndroidยังค้าง ต้องแยกจากcode HOLDที่แก้ในงานนี้ งานนี้ไม่เปลี่ยนsecretจริงและไม่ได้รับอนุมัติdeploy
