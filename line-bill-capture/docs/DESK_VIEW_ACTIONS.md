# ปุ่มเดิม → โต๊ะเทียบเอกสาร (Local)

รายการนี้อ่านจากปุ่มจริงใน `public/index.html` และส่วนเสริมของ review panel ไม่เพิ่ม endpoint
ทุกปุ่มเลือก bucket/item เดิมก่อนเรียก handler ปุ่มที่ disabled ในต้นทางยัง disabled ในโต๊ะ

| สถานะ | ปุ่ม/ชุดควบคุมเดิม | บนโต๊ะ |
|---|---|---|
| คู่รอตรวจ | confirm/reject/change | ยืนยัน/ไม่ใช่/⋯ เปลี่ยนสลิป |
| คู่รอตรวจ | combine-match | ⋯ จ่ายรวมหลายใบ เปิด picker เดิม |
| คู่รอตรวจ | expense-entry-open | ไอคอนข้อมูลค่าใช้จ่าย และ ⋯ |
| คู่รอตรวจ | #more, workflow-problems, notes/teach | ⋯ รายละเอียด/แก้ปัญหา และแผงปุ่มทั้งหมด |
| บิลไม่มีคู่ | selected-pick-slip | หาสลิป |
| บิลไม่มีคู่ | selected-request-transfer | ขอโอน เปิดพรีวิวและ checkbox เดิมก่อนส่ง |
| บิลไม่มีคู่ | confirm-cash-payment | เงินสด เปิด dialog เดิม |
| บิลไม่มีคู่ | selected-amount/selected-save-amount | ⋯ แก้ยอดบิล ย้าย form เดิมเข้าแผ่นลอย |
| สลิปไม่มีคู่ | selected-pick-bill | หาบิล |
| สลิปไม่มีคู่ | selected-edit-amount | ⋯ แก้ยอดสลิป |
| สลิปไม่มีคู่ | selected-create-receipt + workflow checks | ⋯ แก้ปัญหา/แผงปุ่มทั้งหมด คง acknowledgement เดิม |
| บิล/สลิป | combine-unmatched | ⋯ จ่ายรวมหลายใบ |
| รายการเดี่ยว | classify-bill/slip/incoming | ⋯ ประเภทเอกสาร หรือปุ่มหลักของ “อื่น ๆ” |
| รายการเดี่ยว | selected-not-document / openNotDocument | ⋯ ไม่ใช่เอกสารการเงิน / ไม่เกี่ยว ใน “อื่น ๆ” ใช้ dialog เดิม |
| รูปอื่น | หน้าประกอบบิล | ⋯ หน้าบิล / งานหลายเอกสาร ส่งไปมุมมองรายการ เพราะไม่มีปุ่มจัดหน้าบิลเดิม |
| ต้องกรอกยอด | selected-amount/selected-save-amount | กรอกยอดจากบิล เปิดฟอร์มเดิม ไม่สร้างค่าศูนย์แทน NULL |
| คู่ติดธงยอด | review-flag-document/announced | ตัวเลือก ยอดในเอกสาร / ยอดที่แจ้ง |
| คู่ติดธงยอด | review-flag-total/manual | ไอคอนดินสอ เปิดช่องกรอกและปุ่มเดิม |
| ทุกงาน | skip-current / การเลือกคิว | ข้าม (S), ←/→ และแถบคิว ไม่บันทึกการตัดสินใจ |
| ทุกงาน | ปุ่มอื่นที่ยังไม่มี shortcut | ⋯ รายละเอียดและปุ่มทั้งหมด ย้าย reviewpanel เดิมเข้าแผ่นลอยบนโต๊ะ |
| ทุกงาน | chatpanel/chatlist | แท็บซ้าย C และฟอง focus 5 วินาที |
| วัน | closeday/day-prev/day-next | ปิดรอบ/วันก่อน/วันถัดไป ใช้ปุ่มเดิม |

ข้อยกเว้น: งานหลายเอกสาร/คืนเงินสำรองจ่าย และถังที่ซับซ้อนตาม handoff คงมุมมองรายการไว้
“อื่น ๆ” ไม่มี selected-not-document ในหน้าเดิม จึงเปิด `openNotDocument(row,'รูป')` เดิมโดยตรง
เช่นเดียวกับการกดปุ่มนั้นในถังอื่น; ไม่มีการเขียน category เอง

การเทียบรายการปุ่มและการเปิด dialog ผ่าน browser checks ใช้ SSD copy เท่านั้น
ไม่ได้อ้างว่าทดสอบยืนยันทุกการเงินหรือจัดประเภทผ่าน browser จริงในรอบนี้
