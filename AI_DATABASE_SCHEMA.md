# 🗄️ Solao Database Schema for AI

> ไฟล์นี้อธิบายโครงสร้างข้อมูลของร้านอาหาร Solao สำหรับให้ AI เข้าใจและใช้งานได้

อัปเดตเอกสารล่าสุด: 2026-05-21

## สรุปใช้งานจริงสำหรับ AI

- MySQL คือฐานเขียนจริงของแอปสั่งของ/รับของ/คลัง/PR-PO/settings
- ClickHouse คือฐาน POS สำหรับอ่านยอดขายเท่านั้น ห้ามแก้ข้อมูล
- Query ClickHouse ต้อง filter `shopid` เสมอ และนับยอดขายจริงด้วย `transflag = 44`
- ระวัง timezone งานร้านใช้เวลาไทย `Asia/Bangkok`; ถ้า query ช่วงวันที่ใน ClickHouse ให้ตรวจว่า field/driver แปลงเวลาอย่างไร
- ถ้าจะวิเคราะห์ยอดซื้อ/รับ/ค้างรับ ให้ใช้ MySQL report/API ของแอป ไม่ใช่ ClickHouse
- ถ้าจะวิเคราะห์ยอดขายเมนู/บิล/สาขา ให้ใช้ ClickHouse ตาราง `doc`, `docdetail`, `productbarcode`

## MySQL Tables สำคัญของแอป

กลุ่มข้อมูลหลัก:
- Master data: `branches`, `departments`, `users`, `units`, `products`, `product_groups`, `supplier_masters`
- สั่งซื้อประจำวัน: `orders`, `order_items`
- เดินซื้อ/สินค้านอกใบสั่ง: ตารางกลุ่ม `purchase_walk_*`
- คลัง: `inventory_transactions`, `inventory_balance`
- เช็คสต็อก: `stock_checks`, `stock_templates`, `stock_categories`
- PO คลัง: `purchase_orders`, `purchase_order_items`, `purchase_order_receipts`
- PR/PO ทั่วไป: `general_purchase_orders`, `general_purchase_order_items`, `general_purchase_order_logs`
- พนักงานอ้างอิง PR/PO: `employee_refs`
- LINE/Discord chatbot: `chatbot_memories`, `chatbot_query_logs`
- Settings: `system_settings`

หลักแยก flow:
- `orders`/`order_items` = สั่งซื้อประจำวันและรับสินค้า
- `purchase_orders` = PO คลัง รับแล้วเข้า inventory
- `general_purchase_orders` = PR/PO ทั่วไป ไม่เข้า inventory
- ClickHouse = ยอดขาย POS เพื่อรายงาน/สูตรตัดสต็อก ไม่ใช่ข้อมูลคำสั่งซื้อของแอป

---

## 📍 ข้อมูลพื้นฐาน

```yaml
Business: ร้านอาหารโซลาว (Solao Restaurant)
Type: ร้านอาหารอีสาน/ไทย
Branches:
  - คันกลอง (สาขาหลัก)
  - บ้านเจ๊/สันกำแพง (สาขาย่อย)
Location: เชียงใหม่, ประเทศไทย
```

---

## 🔗 ClickHouse Connection
**ข้อกำหนดสำคัญ:** ห้ามแก้ไขข้อมูลใน ClickHouse เด็ดขาด (อ่านได้อย่างเดียวเท่านั้น)

```yaml
Database: dedebi
Shop ID: 2OJMVIo1Qi81NqYos3oDPoASziy
Branch IDs:
  - 2PxT0SwTMlORbcER7eaIqi08v4k  # คันกลอง
  - 2PdQF0n9TADAVUEV2dDeqOo7D9N  # บ้านเจ๊
```

---

## 📊 Tables

### 1. `productbarcode` - รายการสินค้า/เมนู

**วัตถุประสงค์:** เก็บข้อมูลเมนูอาหาร เครื่องดื่ม และวัตถุดิบ

| Column | Type | Description |
|--------|------|-------------|
| `shopid` | String | รหัสร้าน (ใช้ filter) |
| `barcode` | String | **PK** รหัสสินค้า |
| `itemcode` | String | รหัสสินค้าภายใน |
| `name0` | String | ชื่อสินค้า/เมนู |
| `unitname` | String | หน่วย (จาน, กก., ชิ้น, ขวด) |
| `price1` | Float64 | ราคาขาย |
| `groupcode` | String | รหัสกลุ่มสินค้า |
| `groupnames` | String | ชื่อกลุ่มสินค้า |

**ประเภทสินค้า (แยกตาม barcode prefix):**
- `01-xxx` = วัตถุดิบ/เครื่องปรุง
- `02-xxx` = วัตถุดิบแปรรูป
- `HL0xxx` = เมนูอาหาร (คันกลอง)
- `RF0xxx` = เมนูอาหาร (refill/เพิ่ม)
- `DW0xxx` = เครื่องดื่ม
- `DS0xxx` = ของหวาน
- `PSF0xxx` = เมนูพิเศษ

**Query ตัวอย่าง:**
```sql
-- ดึงรายการเมนูอาหาร
SELECT barcode, name0, unitname, price1
FROM dedebi.productbarcode 
WHERE shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND unitname IN ('จาน', 'หม้อ', 'ถ้วย', 'ชุด', 'ไม้')
  AND name0 NOT LIKE '%ยกเลิก%'
```

---

### 2. `doc` - หัวบิลขาย

**วัตถุประสงค์:** เก็บข้อมูลการขายแต่ละบิล

| Column | Type | Description |
|--------|------|-------------|
| `shopid` | String | รหัสร้าน |
| `docno` | String | **PK** เลขที่บิล |
| `docdatetime` | DateTime | วันที่/เวลาขาย |
| `perioddatetime` | DateTime | วันที่ปิดรอบ |
| `totalamount` | Float64 | ยอดรวมบิล |
| `branchid` | String | รหัสสาขา |
| `transflag` | Int16 | **สถานะบิล** |
| `iscancel` | Bool | ยกเลิกหรือไม่ |
| `paytype` | Int16 | ประเภทการชำระ |
| `deliverycode` | String | รหัส delivery |

**⚠️ สำคัญ - transflag:**
```
transflag = 44  → ขายจริง (ใช้ตัวนี้เท่านั้น)
transflag อื่นๆ → void, ยกเลิก, แก้ไข (ไม่นับ)
```

**Query ตัวอย่าง:**
```sql
-- ยอดขายรายวัน
SELECT 
    toDate(docdatetime) as sale_date,
    count(*) as bill_count,
    sum(totalamount) as total_revenue
FROM dedebi.doc 
WHERE shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND transflag = 44
  AND docdatetime >= now() - INTERVAL 7 DAY
GROUP BY sale_date
ORDER BY sale_date DESC
```

---

### 3. `docdetail` - รายการสินค้าในบิล

**วัตถุประสงค์:** เก็บรายละเอียดสินค้าแต่ละรายการในบิล

| Column | Type | Description |
|--------|------|-------------|
| `shopid` | String | รหัสร้าน |
| `docno` | String | เลขที่บิล (FK → doc) |
| `line_number` | UInt32 | ลำดับรายการ |
| `barcode` | String | รหัสสินค้า |
| `itemname` | String | ชื่อสินค้า |
| `qty` | Float64 | จำนวน |
| `price` | Float64 | ราคาต่อหน่วย |
| `sumamount` | Float64 | ยอดรวมรายการ |
| `branchid` | String | รหัสสาขา |
| `transflag` | Int16 | สถานะ |

**Query ตัวอย่าง:**
```sql
-- ยอดขายเมนู 30 วัน
SELECT 
    dd.barcode,
    dd.itemname as menu_name,
    sum(dd.qty) as total_qty,
    sum(dd.sumamount) as total_revenue
FROM dedebi.doc d
JOIN dedebi.docdetail dd 
  ON d.shopid = dd.shopid AND d.docno = dd.docno
WHERE d.shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND d.transflag = 44
  AND d.docdatetime >= now() - INTERVAL 30 DAY
GROUP BY dd.barcode, dd.itemname
ORDER BY total_qty DESC
LIMIT 20
```

---

## 📈 Common Queries

### 1. ยอดขายวันนี้
```sql
SELECT 
    sum(totalamount) as today_revenue,
    count(*) as bill_count
FROM dedebi.doc 
WHERE shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND transflag = 44
  AND toDate(docdatetime) = today()
```

### 2. เมนูขายดี Top 10
```sql
SELECT 
    dd.barcode,
    dd.itemname,
    sum(dd.qty) as qty_sold,
    sum(dd.sumamount) as revenue
FROM dedebi.doc d
JOIN dedebi.docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
WHERE d.shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND d.transflag = 44
  AND d.docdatetime >= now() - INTERVAL 30 DAY
  AND dd.itemname NOT LIKE '%น้ำ%'
  AND dd.itemname NOT LIKE '%ข้าว%'
GROUP BY dd.barcode, dd.itemname
ORDER BY qty_sold DESC
LIMIT 10
```

### 3. ยอดขายแยกสาขา
```sql
SELECT 
    CASE d.branchid
        WHEN '2PxT0SwTMlORbcER7eaIqi08v4k' THEN 'คันกลอง'
        WHEN '2PdQF0n9TADAVUEV2dDeqOo7D9N' THEN 'บ้านเจ๊'
        ELSE 'ไม่ระบุ'
    END as branch_name,
    sum(d.totalamount) as revenue
FROM dedebi.doc d
WHERE d.shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND d.transflag = 44
  AND d.docdatetime >= now() - INTERVAL 30 DAY
GROUP BY d.branchid
```

### 4. ยอดขายรายชั่วโมง (ดู peak time)
```sql
SELECT 
    toHour(docdatetime) as hour,
    count(*) as bill_count,
    sum(totalamount) as revenue
FROM dedebi.doc 
WHERE shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND transflag = 44
  AND docdatetime >= now() - INTERVAL 7 DAY
GROUP BY hour
ORDER BY hour
```

### 5. ค่าเฉลี่ยยอดขายเมนู (สำหรับ forecast)
```sql
SELECT 
    dd.barcode,
    dd.itemname,
    count(DISTINCT toDate(d.docdatetime)) as days_sold,
    sum(dd.qty) as total_qty,
    round(sum(dd.qty) / count(DISTINCT toDate(d.docdatetime)), 2) as avg_daily
FROM dedebi.doc d
JOIN dedebi.docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
WHERE d.shopid = '2OJMVIo1Qi81NqYos3oDPoASziy'
  AND d.transflag = 44
  AND d.docdatetime >= now() - INTERVAL 30 DAY
GROUP BY dd.barcode, dd.itemname
HAVING total_qty > 30
ORDER BY avg_daily DESC
```

---

## 🍽️ เมนูยอดนิยม (30 วันล่าสุด)

| Barcode | เมนู | ยอดขาย |
|---------|------|--------|
| HL0014 | คอหมูย่าง | 2,656 |
| HL0009 | ปีกไก่ทอดน้ำปลา | 1,870 |
| HL0051 | ตำไทย | 1,332 |
| HL0047 | ตำปูปลาร้า | 1,155 |
| HL0139 | ขนมจีน | 1,027 |
| RF0004 | คอหมูย่าง (refill) | 981 |
| HL0048 | ตำโซลาว | 875 |
| HL0090 | ปีกไก่คั่วเกลือ | 800 |
| HL0008 | ปลากระพงทอดน้ำปลา | 709 |
| ALERT1 | ไก่บ้านย่างทั้งตัว | 706 |

---

## 🥬 วัตถุดิบ (Ingredients)

| Barcode | วัตถุดิบ | หน่วย |
|---------|---------|-------|
| 01-001 | น้ำตาลปี๊บ | กรัม |
| 01-005 | น้ำปลาจั่นเพชร | มิลลิลิตร |
| 01-009 | น้ำปลาร้า | กรัม |
| 01-020 | กระเทียมไทย | กรัม |
| 01-044 | ไข่ไก่ | ฟอง |
| 01-057 | กระเพรา | กรัม |
| 01-060 | มะนาวแป้น | ลูก |
| 01-061 | กุ้งเนื้อA | กรัม |
| 01-100 | ปลากะพง | ตัว |
| 01-101 | ปลาทับทิมแบ | ตัว |

---

## 🔧 การใช้งานสำหรับระบบสต๊อก

### แนวคิด: ผูกสูตรอาหาร → คำนวณวัตถุดิบ

```
ยอดขายเมนู (จาก ClickHouse)
        ↓
    × สูตรอาหาร (กำหนดเอง)
        ↓
= วัตถุดิบที่ใช้ไป
        ↓
สต๊อกคงเหลือ - วัตถุดิบใช้
        ↓
= ควรสั่งซื้อเท่าไร
```

### ตัวอย่างสูตร

| เมนู | วัตถุดิบ | ปริมาณ/จาน |
|------|---------|-----------|
| ปลากระพงทอดน้ำปลา (HL0008) | ปลากระพง | 0.5 กก. |
| ปลากระพงทอดน้ำปลา (HL0008) | น้ำมันทอด | 0.1 ลิตร |
| ปลากระพงทอดน้ำปลา (HL0008) | แป้งทอดกรอบ | 50 กรัม |
| คอหมูย่าง (HL0014) | หมูคอ | 0.2 กก. |
| ตำไทย (HL0051) | มะละกอ | 0.15 กก. |
| ตำไทย (HL0051) | กุ้งแห้ง | 20 กรัม |

### การคำนวณตัวอย่าง

```
วันนี้ขาย:
- ปลากระพงทอดน้ำปลา 19 จาน
- สูตร: 0.5 กก./จาน

→ ใช้ปลากระพง = 19 × 0.5 = 9.5 กก.

สต๊อกเดิม: 15 กก.
คงเหลือ: 15 - 9.5 = 5.5 กก.

ค่าเฉลี่ย/วัน: 8 กก.
Safety stock: 5 กก.
วันถัดไปต้องสั่ง: 3 วัน

→ ควรสั่ง = (8 × 3 × 1.2) - 5.5 + 5 = 28.3 ≈ 29 กก.
```

---

## ⚠️ ข้อควรระวัง

1. **ต้อง filter `transflag = 44`** เสมอ เพื่อนับเฉพาะยอดขายจริง
2. **ต้อง filter `shopid`** เพราะ database มีหลายร้าน
3. **เวลาใน ClickHouse เป็น UTC** - ต้อง +7 ชั่วโมงสำหรับเวลาไทย
4. **ชื่อเมนูที่มี "[ยกเลิก]"** = เมนูที่ไม่ใช้แล้ว ควร filter ออก

---

## 📞 Support

หากต้องการข้อมูลเพิ่มเติมหรือ query อื่นๆ สามารถถามได้
