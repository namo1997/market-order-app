# ฟอร์มค่าใช้จ่าย Liquid Glass — แนวที่ผู้ใช้อนุมัติ 9 ต.ค. 2569

ใช้แนว production_ui_implementation จาก tasteful-ui: อิงหน้าจอเดิม, DESK_PHASE3_HANDOFF P3.2 และตัวอย่าง Local ที่ผู้ใช้ตอบ “ใช้แบบนี้ต่อ”. เนื้อหาเกือบทึบ กระจกเฉพาะหัว/ท้าย IBM Plex Sans Thai และสีเดิมของระบบ น้ำเงินเลือก เขียวตรวจแล้ว ส้มยังไม่ครบ.

เป้าหมายคือดูหลักฐานและกรอกช่องจำเป็นได้ในจอแรก 1280×800 ขึ้นไป: ซ้ายหลักฐานสลับบิล/สลิป, ขวาช่องเรียงเลข ชิปจาก select เดิม และช่องเพิ่มเติม/OCR/ประวัติใน disclosure. แถบล่างคงที่ใช้บันทึกการตรวจ สถานะ และปุ่มบันทึกเดิม. จอ 1100–1279 ยังเข้าถึงได้ด้วยการเลื่อนขวา.

ชั้นแสดงผลเฉพาะ theme-glass ≥1100px. ย้าย original nodes; ไม่คัดลอกฟอร์ม/payload, ไม่แก้ backend/API/schema, ไม่เติมเดือนหรือใช้ข้อเสนอเอง. ความจำเป็น/ความพร้อมมาจากฟอร์มเดิม. Non-expense แสดงไม่ใช้กับรายการนี้และรักษาทางล้างหมวดเดิม. Classic/mobile ต้องคืน original DOM และไม่มีสไตล์ใหม่ทำงาน. รักษา dirty drafts, source evidence, optimistic revision/pair/invoice conflict, reload, beforeunload และการกรอกหลังปิดรอบ.

ตรวจภาพสว่าง/มืด 1280/1440/1920, controls/focus/errors, purchase/government_remittance, multi-page/single, drafts/reload/409. ทดสอบเขียนเฉพาะ fixture SSD. งานทั้งหมด Local; commit/deploy ยังไม่ได้รับอนุญาต.
