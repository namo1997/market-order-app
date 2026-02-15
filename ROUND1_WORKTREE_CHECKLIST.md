# Round 1: จัดระเบียบไฟล์ค้าง (Worktree)

อัปเดตล่าสุด: 2026-02-15 (หลังจัด Batch A-D)
สาขางาน: `codex/round1-organize-worktree`

## สถานะปัจจุบัน
- ไฟล์ค้างทั้งหมด: 6 รายการ
- เหลือเฉพาะเอกสาร/ไฟล์ระบบ (ไม่ใช่โค้ดฟีเจอร์หลัก)
- จุดกระจุกหลัก:
  - `client/src` (37 รายการ)
  - `server/src` (32 รายการ)

## เป้าหมายรอบนี้
1. แยกงานที่ค้างเป็นชุดเล็กที่ตรวจสอบง่าย
2. กันความเสี่ยงจากไฟล์ปน (log / เอกสาร / ไฟล์ทดลอง)
3. เตรียมพร้อมสำหรับรอบถัดไป (ทดสอบ + deploy)

## ชุดงานที่ต้องแยก (Commit Batches)

### Batch A: สิทธิ์ + กลุ่มสินค้า + Login/Function
โฟกัส: ตรรกะสิทธิ์การเห็นเมนูคำสั่งซื้อ และการแยกกลุ่มภายใน

ไฟล์หลัก:
- `client/src/contexts/AuthContext.jsx`
- `client/src/pages/user/FunctionSelect.jsx`
- `client/src/pages/auth/Login.jsx`
- `client/src/pages/admin/masters/SupplierManagement.jsx`
- `server/src/controllers/auth.controller.js`
- `server/src/middleware/auth.js`
- `server/src/models/supplier.model.js`
- `server/src/routes/auth.routes.js`

### Batch B: คำสั่งซื้อ/รับสินค้า/เดินซื้อ
โฟกัส: flow การสั่งซื้อ, รับสินค้า, พิมพ์/ประวัติ, เดินซื้อ

ไฟล์หลัก:
- `client/src/pages/user/ReceiveOrders.jsx` (ใหม่)
- `client/src/pages/user/ProductList.jsx`
- `client/src/pages/user/OrderHistory.jsx`
- `client/src/pages/admin/OrdersToday.jsx`
- `client/src/pages/admin/OrderHistory.jsx`
- `client/src/pages/admin/PurchaseWalk.jsx`
- `server/src/controllers/orders.controller.js`
- `server/src/models/order.model.js`
- `server/src/routes/orders.routes.js`

### Batch C: ระบบคลัง (Inventory)
โฟกัส: dashboard/การเคลื่อนไหว/ยอดคงเหลือ/variance

ไฟล์หลัก:
- `client/src/pages/inventory/*` (ใหม่)
- `client/src/api/inventory.js` (ใหม่)
- `server/src/controllers/inventory.controller.js` (ใหม่)
- `server/src/models/inventory.model.js` (ใหม่)
- `server/src/routes/inventory.routes.js` (ใหม่)
- `server/database/migrations/*` (ใหม่)

### Batch D: Master Data และโครงสร้าง API
โฟกัส: products, supplier-master, departments, users, settings

ไฟล์หลัก:
- `client/src/pages/admin/masters/*`
- `client/src/api/admin.js`
- `client/src/api/master.js`
- `client/src/api/products.js`
- `server/src/controllers/products.controller.js`
- `server/src/controllers/suppliers.controller.js`
- `server/src/controllers/supplier-masters.controller.js` (ใหม่)
- `server/src/models/product.model.js`
- `server/src/models/supplier-master.model.js` (ใหม่)
- `server/src/routes/products.routes.js`
- `server/src/routes/product-groups.routes.js` (ใหม่)
- `server/src/routes/supplier-masters.routes.js` (ใหม่)

### Batch E: เอกสาร/ไฟล์ระบบ
โฟกัส: แยกสิ่งที่ไม่ควรเข้า production commit

ไฟล์ที่ต้องพิจารณา:
- `AI_GUIDE.md`
- `PROGRESS.md`
- `README.md`
- `server/.server.log` (ไม่ควรอยู่ใน commit งานฟีเจอร์)
- `รายการ.pdf` (ไฟล์เอกสารท้องถิ่น)

## กติกาการ commit รอบ 1
- commit ทีละ batch เท่านั้น
- ทุก batch ต้องผ่านอย่างน้อย:
  - `npm --prefix client run build`
  - `node --check server/src/server.js`
- ยังไม่ push จนกว่าจะผ่าน batch สำคัญ (A + B)

## สถานะดำเนินการ
- [x] สร้างกิ่งงานแยกสำหรับรอบนี้
- [x] ทำแผนแยกไฟล์ค้างเป็น batch
- [x] จัด staging ตาม Batch A
- [x] จัด staging ตาม Batch B
- [x] จัด staging ตาม Batch C
- [x] จัด staging ตาม Batch D
- [ ] แยกไฟล์เอกสาร/ไฟล์ระบบ (Batch E)

## Commit ที่ทำแล้วในรอบนี้
- `8fc4eab` chore: add round1 worktree organization checklist
- `87fa1f3` feat: separate internal group permissions from product visibility
- `6b8ee26` feat: organize order receiving and purchase walk workflow changes
- `4d542e0` feat: add inventory module pages and backend endpoints
- `ccf2d2d` feat: consolidate master data, stock-check, and product-group modules
