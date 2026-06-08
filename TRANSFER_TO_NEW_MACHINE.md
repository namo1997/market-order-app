# ย้ายโปรเจคไปเครื่องใหม่

เอกสารนี้ใช้สำหรับ clone โปรเจคจาก GitHub แล้วรันต่อบนเครื่องใหม่

## 1. ติดตั้งโปรแกรมพื้นฐานบนเครื่องใหม่

- Git
- Node.js 20 หรือใหม่กว่า
- MySQL

## 2. Clone โปรเจค

```bash
git clone https://github.com/namo1997/market-order-app.git
cd market-order-app
```

## 3. ติดตั้ง dependencies

```bash
npm --prefix server install
npm --prefix client install
```

## 4. ตั้งค่า env

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

จากนั้นแก้ค่าใน `server/.env` ให้ตรงกับเครื่องใหม่ โดยเฉพาะ:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`
- `JWT_SECRET`
- token หรือ webhook ต่างๆ ถ้าต้องใช้ LINE, Discord, OpenAI, ClickHouse หรือ Railway sync

ไฟล์ `.env` เป็นข้อมูลลับและไม่ควร push ขึ้น GitHub

## 5. เตรียมฐานข้อมูล

ถ้าเป็นเครื่องใหม่ที่ยังไม่มีข้อมูล ให้สร้าง database แล้ว import schema:

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS market_order_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p market_order_db < server/database/schema.sql
mysql -u root -p market_order_db < server/database/seed.sql
```

ถ้าต้องการย้ายข้อมูลจริงจากเครื่องเดิม ให้ export/import dump แทนการใช้ seed:

```bash
mysqldump -u root -p market_order_db > market_order_db.sql
mysql -u root -p market_order_db < market_order_db.sql
```

## 6. รันโปรเจค

เปิด 2 terminal:

```bash
npm --prefix server run dev
```

```bash
npm --prefix client run dev
```

ค่า default:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- Health check: `http://localhost:8000/health`
- Database health: `http://localhost:8000/health/db`
