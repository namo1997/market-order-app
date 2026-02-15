# ระบบสั่งซื้อสินค้าตลาดสด (Market Order System)

Web Application สำหรับการสั่งซื้อสินค้าตลาดสด เหมาะกับการใช้งานบนมือถือ

## Tech Stack

### Backend
- **Node.js** + **Express.js**
- **MySQL** 9.5
- **JWT** Authentication
- **ES Modules**

### Frontend
- **React** 19
- **Vite**
- **Tailwind CSS**
- **React Router**
- **Axios**

## Project Structure

```
market-order-system/
├── server/                    # Backend (Node.js + Express)
│   ├── database/
│   │   ├── schema.sql        # Database schema
│   │   └── seed.sql          # Sample data
│   ├── src/
│   │   ├── config/           # Database connection
│   │   ├── middleware/       # JWT auth, error handling
│   │   ├── models/           # Database queries
│   │   ├── controllers/      # Business logic
│   │   ├── routes/           # API endpoints
│   │   ├── utils/            # Helpers (JWT)
│   │   └── server.js         # Entry point
│   ├── .env                  # Environment variables
│   └── package.json
│
└── client/                    # Frontend (React + Vite)
    ├── src/
    │   ├── api/              # API client
    │   ├── components/       # Reusable components
    │   ├── contexts/         # State management
    │   ├── pages/            # Page components
    │   └── App.jsx
    └── package.json
```

## Getting Started

### 1. ติดตั้ง Dependencies

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### 2. ตั้งค่า Database

Database ถูกสร้างและเติมข้อมูลตัวอย่างเรียบร้อยแล้ว

**ข้อมูลตัวอย่าง:**
- 3 สาขา (กรุงเทพ, เชียงใหม่, ภูเก็ต)
- 7 แผนก
- 10 users (3 admins, 7 users)
- 20 สินค้า
- 5 suppliers
- 10 units

**Users สำหรับทดสอบ:**

| Username | Role | สาขา | แผนก |
|----------|------|------|------|
| admin_bkk | admin | กรุงเทพ | ขาย |
| somchai_s | user | กรุงเทพ | ขาย |
| suda_k | user | กรุงเทพ | ครัว |
| admin_cnx | admin | เชียงใหม่ | ขาย |
| peter_s | user | เชียงใหม่ | ขาย |

### 3. ตั้งค่า Environment Variables

ไฟล์ `server/.env` ถูกสร้างแล้ว แก้ไขตามต้องการ:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=market_order_db
DB_PORT=3306

JWT_SECRET=market-order-secret-key-2026-change-this-in-production
JWT_EXPIRES_IN=7d

PORT=8000
NODE_ENV=development

CORS_ORIGIN=http://localhost:5173
```

### 4. เริ่มต้นใช้งาน

```bash
# เริ่ม Backend (Terminal 1)
cd server
npm start

# เริ่ม Frontend (Terminal 2)
cd client
npm run dev
```

- **Backend**: http://localhost:8000
- **Frontend**: http://localhost:5173
- **Health Check**: http://localhost:8000/health

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/auth/branches` | ดึงรายการสาขา | - |
| GET | `/api/auth/departments/:branchId` | ดึงแผนกตามสาขา | - |
| GET | `/api/auth/users/:departmentId` | ดึง users ตามแผนก | - |
| POST | `/api/auth/login` | Login | - |
| GET | `/api/auth/me` | ดึงข้อมูล user ปัจจุบัน | ✓ |

### Products

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/products` | ดึงรายการสินค้า | ✓ |
| GET | `/api/products/:id` | ดึงข้อมูลสินค้า | ✓ |
| GET | `/api/products/meta/suppliers` | ดึงรายการ suppliers | ✓ |
| GET | `/api/products/meta/units` | ดึงรายการ units | ✓ |

### Orders

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/orders/status` | เช็คสถานะเปิด/ปิดรับออเดอร์ | ✓ |
| GET | `/api/orders/my-orders` | ดึงคำสั่งซื้อของตัวเอง | ✓ |
| GET | `/api/orders/:id` | ดึงรายละเอียดคำสั่งซื้อ | ✓ |
| GET | `/api/orders/receiving` | โหลดรายการรับของของตัวเอง | ✓ |
| PUT | `/api/orders/receiving` | บันทึกรับของของตัวเอง | ✓ |
| POST | `/api/orders` | สร้างคำสั่งซื้อใหม่ | ✓ |
| PUT | `/api/orders/:id` | แก้ไขคำสั่งซื้อ (draft only) | ✓ |
| POST | `/api/orders/:id/submit` | ส่งคำสั่งซื้อ | ✓ |
| DELETE | `/api/orders/:id` | ลบคำสั่งซื้อ (draft only) | ✓ |

### Admin (Admin Only)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/admin/orders` | ดึงคำสั่งซื้อทั้งหมด | Admin |
| GET | `/api/admin/orders/by-branch` | แยกตามสาขา/แผนก | Admin |
| GET | `/api/admin/orders/by-supplier` | แยกตาม supplier | Admin |
| POST | `/api/admin/orders/close` | ปิดรับคำสั่งซื้อ | Admin |
| POST | `/api/admin/orders/open` | เปิดรับคำสั่งซื้อ | Admin |
| PUT | `/api/admin/order-items/:itemId/purchase` | บันทึกการซื้อจริง | Admin |
| PUT | `/api/admin/orders/:orderId/status` | เปลี่ยนสถานะคำสั่งซื้อ | Admin |

## API Examples

### 1. Login

```bash
# Step 1: ดึงรายการสาขา
curl http://localhost:8000/api/auth/branches

# Step 2: ดึงรายการแผนกตามสาขา (branchId = 1)
curl http://localhost:8000/api/auth/departments/1

# Step 3: ดึงรายการ users ตามแผนก (departmentId = 1)
curl http://localhost:8000/api/auth/users/1

# Step 4: Login (userId = 1 = admin_bkk)
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId": 1}'
```

### 2. ดึงรายการสินค้า

```bash
curl http://localhost:8000/api/products \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. สร้างคำสั่งซื้อ

```bash
curl -X POST http://localhost:8000/api/orders \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "product_id": 1,
        "quantity": 2.5,
        "requested_price": 25.00
      },
      {
        "product_id": 6,
        "quantity": 1.0,
        "requested_price": 180.00
      }
    ]
  }'
```

### 4. Admin: ดูคำสั่งซื้อทั้งหมดแยกตาม supplier

```bash
curl http://localhost:5000/api/admin/orders/by-supplier?date=2026-01-11 \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## Database Schema

### Tables
1. **branches** - สาขา
2. **departments** - แผนก
3. **users** - ผู้ใช้
4. **units** - หน่วยสินค้า
5. **suppliers** - ซัพพลายเออร์
6. **products** - สินค้า
7. **order_status_settings** - การเปิด/ปิดรับออเดอร์
8. **orders** - คำสั่งซื้อ
9. **order_items** - รายการสินค้าในคำสั่งซื้อ

## Features

### สำหรับผู้ใช้ทั่วไป
- ✅ Login แบบ 3 steps (เลือกสาขา → แผนก → ชื่อ)
- ✅ ดูรายการสินค้า (ค้นหา, filter ตาม supplier)
- ✅ เพิ่มสินค้าในตะกร้า
- ✅ สร้างคำสั่งซื้อ (draft)
- ✅ แก้ไขคำสั่งซื้อ (ก่อนส่ง)
- ✅ ส่งคำสั่งซื้อ
- ✅ ดูประวัติคำสั่งซื้อ

### สำหรับ Admin
- ✅ ดูคำสั่งซื้อทั้งหมด
- ✅ แยกคำสั่งซื้อตามสาขา/แผนก
- ✅ แยกคำสั่งซื้อตาม supplier (สรุปรายการต้องซื้อ)
- ✅ เปิด/ปิดรับคำสั่งซื้อ
- ✅ บันทึกการซื้อจริง (ราคา, ซื้อครบหรือไม่)
- ✅ เปลี่ยนสถานะคำสั่งซื้อ

## Development Status

### ✅ เสร็จแล้ว (พร้อมใช้งาน 100%)
- ✅ ตั้งค่าโปรเจกต์และติดตั้ง dependencies
- ✅ ติดตั้ง MySQL และสร้าง database พร้อม sample data
- ✅ Backend APIs ทั้งหมด (Authentication, Products, Orders, Admin)
- ✅ JWT Authentication
- ✅ Frontend setup (React + Vite + Tailwind CSS)
- ✅ หน้า Login (3-step selection)
- ✅ หน้า Product List และ Cart
- ✅ หน้า Order History
- ✅ หน้า Admin (Order Management, Purchase Recording)
- ✅ Authentication & Cart Context
- ✅ Responsive design (mobile-first)

### 📋 ยังไม่ได้ทำ (Optional)
- Settings API (CRUD สำหรับ users, products, suppliers, etc.)
- Admin: แยกตามสาขา/แผนก (UI เพิ่มเติม)
- Production deployment

## Testing

ทดสอบ backend ได้ทันทีด้วย:

```bash
cd server
npm start
```

เข้าไปที่ http://localhost:5000/health ควรเห็น:

```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2026-01-11T..."
}
```

## Notes

- Backend พร้อมใช้งานเต็มรูปแบบแล้ว
- Frontend กำลังพัฒนา (ขั้นตอนต่อไป)
- ใช้ JWT สำหรับ authentication (ไม่มี password)
- สามารถทดสอบ API ด้วย Postman หรือ curl ได้ทันที

## License

MIT
