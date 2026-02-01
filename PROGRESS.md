# ความคืบหน้า (สรุปสำหรับกลับมาทำต่อ)

วันที่บันทึก: 2025-02-14

## สิ่งที่ทำแล้ว (ล่าสุด)
- หน้ารายการของประจำ (`/admin/settings/stock-templates`) เป็นตารางขนาดเล็ก + มีตัวกรองซัพพลายเออร์
- เพิ่มตัวเลือก "ไม่มี Max/Min" ต่อสินค้า และช่อง Min/Max แบบกรอกง่าย
- เพิ่มคอลัมน์ "กรอกทุกวัน" สำหรับสินค้า (เก็บใน `stock_templates.daily_required`)
- หน้าประวัติคำสั่งซื้อ (พิมพ์ตามสาขา/ซัพพลายเออร์):
  - เรียงสาขาตามการเดินซื้อของเป็นลำดับ: ผลิตคันคลอง -> สาขาคันคลอง -> ผลิตสันกำแพง -> สาขาสันกำแพง
  - ตัดทศนิยม .0 ออก (เช่น 5.0 -> 5)
- เมนูหน้า "สั่งซื้อสินค้า": แสดงเฉพาะ "สั่งซื้อสินค้า" และ "การสั่งซื้อของฉัน" พร้อมปุ่มย้อนกลับ
- เพิ่มปุ่มย้อนกลับในหน้าเช็คสต็อกและเบิกสินค้า (รวมหน้าเช็คสต็อกที่ปิดการใช้งาน)
- หน้าเช็คสต็อก: สินค้าแบบ "กรอกทุกวัน" ต้องกรอกเสมอ ส่วนสินค้าไม่บังคับสามารถเว้นว่างได้ (ไม่คำนวณสั่งซื้อ)

## ไฟล์ที่แก้ไขหลัก
- `client/src/pages/admin/masters/StockTemplateManagement.jsx`
- `client/src/pages/admin/OrderHistory.jsx`
- `client/src/components/layout/Navigation.jsx`
- `client/src/pages/user/StockCheck.jsx`
- `client/src/pages/user/Cart.jsx`
- `client/src/pages/user/OrderHistory.jsx`
- `client/src/pages/user/FunctionSelect.jsx` (ใหม่)
- `client/src/pages/user/Withdraw.jsx` (ใหม่)
- `client/src/api/stock-check.js`
- `server/src/models/stock-check.model.js`
- `server/src/controllers/stock-check.controller.js`
- `server/database/schema.sql`

## หมายเหตุสำคัญ
- เพิ่มคอลัมน์ `daily_required` ใน `stock_templates` (มี auto-alter ใน model)
- ต้องรีสตาร์ท backend หลังอัปเดตโครงสร้างเพื่อให้คอลัมน์ใหม่ถูกสร้าง

## สถานะ Git ตอนนี้
มีไฟล์ที่ยังไม่ได้ commit/push:
- `client/src/App.jsx`
- `client/src/api/stock-check.js`
- `client/src/components/layout/Navigation.jsx`
- `client/src/pages/admin/OrderHistory.jsx`
- `client/src/pages/admin/masters/StockTemplateManagement.jsx`
- `client/src/pages/user/Cart.jsx`
- `client/src/pages/user/OrderHistory.jsx`
- `client/src/pages/user/StockCheck.jsx`
- `client/src/pages/user/FunctionSelect.jsx`
- `client/src/pages/user/Withdraw.jsx`
- `server/database/schema.sql`
- `server/src/controllers/stock-check.controller.js`
- `server/src/models/stock-check.model.js`
