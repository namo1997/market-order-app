# โต๊ะเทียบเฟส 2: P5–P7

สถานะ Local: `desk-complex.js`/`.css` เป็นชั้นแสดงผล ใช้การเลือกถังและปุ่มต้นฉบับที่ parent `LbcDesk` เลือกให้ก่อนวาด ไม่เพิ่ม endpoint หรือเปลี่ยนกติกาบันทึก

| ข้อ | ปุ่ม/ฟอร์มต้นฉบับ | ตำแหน่งบนโต๊ะ | Guard/พฤติกรรม |
| --- | --- | --- | --- |
| P5 | `confirm-match-group` | dock สีเขียวของชุด | disabled ตามปุ่มเดิมเมื่อยอดรวมต่าง |
| P5 | `reject-match-group` | dock แก้วตัวแดง | handler `updateMatchGroup` เดิม |
| P5 | `edit-match-group` | ⋯ แก้ชุดเอกสาร | เปิด picker เดิม |
| P5 | `group-auto-match` | picker เดิม เหนือโต๊ะ | เสนอชุดตามยอดเดิม ไม่บันทึกทันที |
| P5 | `clear-group-bills`, `clear-group-slips` | picker เดิม ฝั่งบิล/สลิป | ล้างการเลือกใน dialog |
| P5 | `save-match-group` | picker เดิม ด้านล่าง | disabled ตามยอดรวม/จำนวน และคำยืนยันเดิม |
| P5 | `.candidate`, `retry-picker-load` | picker สลิปเดิม จาก batch-pick-slip | ยังใช้ loading/retry/candidate handler เดิม |
| P5 | `batch-pick-slip` | dock รอบจ่าย | เลือกสลิปที่ใกล้เคียง ผ่าน drawer เดิม |
| P5 | `batch-combine` | dock รอบจ่าย | เลือกหลายสลิปผ่าน group picker เดิม |
| P6 | `reimbursement-substitute` | dock ปุ่มหลัก | เปิด receipt dialog เดิม |
| P6 | `reimbursement-existing` | ⋯ ใช้บิล/ใบเสร็จที่ยืนยันแล้ว | แสดงเมื่อปุ่มต้นฉบับมีอยู่เท่านั้น |
| P6 | `reimbursement-no-receipt` | ⋯ ไม่ต้องมีใบแทน | guard หมายเหตุจำเป็นจาก handler เดิม |
| P6 | `reimbursement-reject` | dock แก้วตัวแดง | ปฏิเสธความเชื่อมโยงตาม handler เดิม |
| P6 | `reimbursement-note` | ⋯ หมายเหตุหลักฐาน | ย้าย `.pairfeedback` ต้นฉบับเข้า sheet ชั่วคราว ไม่ clone textarea |
| P6 | `receipt-*` | receipt dialog ต้นฉบับ | ไม่กด submit ในการตรวจ browser |
| P7 | `selected-pick-bill` | dock หน้าประกอบ/Other เมื่อมีปุ่มต้นฉบับ | source ปัจจุบันมีเฉพาะถังสลิป จึงไม่สร้างปุ่มเขียนใหม่ในถังที่ไม่รองรับ |
| P7 | `pause-ai` | dock รอ AI อ่าน | ใช้ปุ่มหยุดรอบเดิม แสดงสถานะ/จำนวน/เวลาจากข้อมูลเดิม |
| P7 | `selected-repair-state` | dock ตกหล่น | ใช้ repair-match-state handler เดิม |
| P7 | รายละเอียด/การจัดหมวดเดิม | dock หน้าประกอบ/Other และ ⋯ | sheet ย้าย `reviewpanel` เดิมเข้ามา ไม่สลับมุมมอง |
| P5–P7 | เปิดในมุมมองรายการ | ⋯ ทุกงาน | ทางสำรองที่ผู้ใช้ร้องขอ |

ชุดรวมแสดงรูปทุกใบเป็นสองกองเลื่อนภายในได้ ชิปผลรวมแต่ละฝั่งใช้ `amount`/`sumDocs` นิยามเดิม เส้นเชื่อมเป็นชิปต่อชิปและแสดงเขียว/แดงตามส่วนต่าง ไม่เทียบยอดใบแรกแทนทั้งชุด รูปอยู่ใน `.paper` จึงใช้ OCR/cache เดิม ผู้ใช้คลิกเปิดรูปเต็มได้ทุกใบ

คืนเงินสำรองแสดงเอกสารสำรองและคืนเงินฝั่งซ้ายครบทั้งสองรูป หลักฐานซื้อจริงฝั่งขวาได้จากบิลคู่ที่ยืนยันแล้วเท่านั้น ถ้าไม่มีแสดง “ยังไม่มีใบเสร็จจากร้าน” ไม่สร้างเอกสารซื้อจากสลิปเอง

ถังตกหล่นแปลสถานะเฉพาะข้อความ UI เช่น `pending` เป็น “รออ่าน” และ `manual_review` เป็น “รอตรวจด้วยคน” โดยไม่เปลี่ยนค่า raw data ถัง AI-pending มีเฉพาะสถานะและหยุดรอบ ไม่มีปุ่มยืนยันคู่

ขอบเขตเดิมที่พิสูจน์จาก source: หน้าประกอบที่ขาดหน้ารวมและ Other ที่ AI ระบุว่าเป็นหน้าต่อ **ไม่มี** `selected-pick-bill` ใน `itemReview`/`enhanceReceiptAction` ปัจจุบัน จึงแสดงรูป แชท คำแนะนำและข้อมูล/การจัดหมวดเดิมบนโต๊ะ ปุ่มหาบิลจะพร้อมทันทีถ้า source เพิ่มความสามารถนั้นในอนาคต

ผล Local 9 ต.ค. 2026: `desk-complex-browser-check.js` ผ่าน 56 เลย์เอาต์ (ชุดรวม, รอบจ่าย, คืนเงินสำรอง, หน้าประกอบ, รอ AI, ตกหล่น, Other ที่มีคำแนะนำหน้าต่อ × 1120/1280/1440/1920 × สว่าง/มืด) ไม่มี dock/stage ล้นหรือเลื่อนโต๊ะด้านข้าง

พิสูจน์ native group picker: เปิด/ปิดกลับงานเดิม, ล้างบิลแล้ว save disabled, เสนอชุดที่ยอดตรงแล้ว save พร้อม, ล้างสลิปแล้ว disabled; แก้ยอดจำลองแล้ว confirm disabled และเส้นรวมเป็นแดง หมายเหตุคืนเงินใช้ textarea เดิมและรักษาร่าง เปิด dialog ใบแทนเดิมแล้วกลับงานเดิม และ “ไม่ต้องมีใบแทน” ยังต้องมีเหตุผลตาม guard เดิม สะพาน handler 9 รายการผ่านด้วย spy ของปุ่มต้นฉบับ โดยไม่กดบันทึกการเงินจริง

หลักฐาน: `/Volumes/SSD Files/SOLAO/line-bill-capture/runs/2026-10-09T08-02-40-621Z-378daf77/reports/desk-complex-browser-result.json` และ `desk-phase2-p5-group.png`, `desk-phase2-p5-group-difference.png`, `desk-phase2-p5-batch.png`, `desk-phase2-p6-reimbursement.png`, `desk-phase2-p7-*.png` ใน reports เดียวกัน ผล `passed:true`, `writes:[]`, `errors:[]`

การตรวจใช้รูป/id จาก preview SSD และปรับประเภท ยอด และความเชื่อมโยง **ในหน่วยความจำ browser**; GET รายการ candidate ของ picker คืน rows จำลองชุดเดียวกันเพื่อให้ source-wide pool ไม่แทนที่ fixture ตัวทดสอบบล็อกทุก HTTP method ที่เขียน ภาพเหล่านี้เป็นหลักฐาน workflow Local ไม่ใช่คู่จริงหรือสถานะ Production Native picker ที่โหลดข้อมูลจริงของ preview ถูกเปิดตรวจด้วย แต่ภาพข้ามวันที่ไม่ได้อยู่ในสำเนาวันนี้อาจโหลดไม่ได้

ก่อนรัน browser check ให้เปิด session จาก SSD reports แล้วตั้ง `window.__deskEvidenceDirectory` เป็น absolute SSD reports path ผ่าน `page.addInitScript`/`page.evaluate` ตัวตรวจจะหยุดถ้า evidence path ไม่อยู่ใต้ `/Volumes/SSD Files/SOLAO/` และทุก screenshot ใช้ path นี้โดยตรง
