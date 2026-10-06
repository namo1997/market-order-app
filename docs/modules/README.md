# แผนที่โมดูล market-order-app

ใช้สำหรับคนและ AI agent ทำงานร่วมกันทีละระบบ โดยไม่ต้องอ่านทั้ง repo

- **ทะเบียนโมดูล (machine-readable):** [`modules.json`](modules.json) บอก page, API, ไฟล์ server/client, ตาราง DB, tests และโมดูลที่พึ่งพา
- **เอกสารต่อโมดูล:** `docs/modules/<id>.md` ใช้ [template](_TEMPLATE.md) เดียวกัน
- **ภาพรวม flow และกติกาเดิม:** [`AI_GUIDE.md`](../../AI_GUIDE.md)

## ขอบเขต

ทุกระบบยังอยู่ใน repo และ service `market-order-app` เดียวกัน (ตัดสินใจ 2026-10-05) แต่ละโมดูลมี `status`:

| status | ความหมาย |
|---|---|
| `core` | อยู่ในขอบเขตคำว่า "สั่งของ" |
| `adjacent` | ติดกับการสั่งของ ยังไม่ตัดสิน |
| `candidate-split` | นอกขอบเขต เก็บไว้ก่อน รอรีวิวว่าจะแยกหรือถอด |

| id | ชื่อ | status | review |
|---|---|---|---|
| [ordering](ordering.md) | สั่งของประจำวัน | core | in-progress |
| [receiving](ordering.md#รับสินค้า) | รับสินค้า | core | in-progress |
| master-data | ข้อมูลหลัก | core | not-started |
| auth | เข้าสู่ระบบ | core | deferred |
| purchase-walk | เดินซื้อของ | adjacent | not-started |
| store-po | PO คลัง | adjacent | not-started |
| general-purchase | สั่งซื้อทั่วไป | adjacent | not-started |
| notifications | แจ้งเตือน / chatbot | adjacent | not-started |
| inventory | คลังสินค้า | candidate-split | not-started |
| stock-check | เช็คสต็อก | candidate-split | not-started |
| withdraw | เบิก/โอน | candidate-split | not-started |
| production | แปรรูป / สูตร | candidate-split | not-started |
| sales-pos | ยอดขาย POS | candidate-split | not-started |
| reports | รายงาน / ส่งออกบัญชี | candidate-split | not-started |

Service แยก: `line-bill-capture/` (บิล/สลิปจาก LINE), `general-cashflow/`, `management-accounting/`

## วิธีทำงานกับโมดูล

**AI agent:**
1. อ่าน entry ของโมดูลใน `modules.json` แล้วเปิดเฉพาะไฟล์ใน `server`, `client` และ `tests`
2. อ่าน `docs/modules/<id>.md` ส่วน "บั๊กที่รู้แล้ว" และ "กติกา" ก่อนแก้
3. ถ้าแก้กระทบ `writesTo` หรือ `dependsOn` ต้องเปิดโมดูลนั้นด้วย
4. แก้ route, page หรือตารางเมื่อไหร่ ให้อัปเดต `modules.json` และเอกสารโมดูลในคอมมิตเดียวกัน
5. รัน test หรือ build ผ่าน SSD runner ตาม [`AGENTS.md`](../../AGENTS.md)

**คน:**
- เลือกโมดูลจากตารางด้านบน ดูส่วน "บั๊กที่รู้แล้ว" แล้วสั่ง AI ด้วยรหัสบั๊ก เช่น "แก้ ORD-03"
- เปลี่ยน `review` เป็น `reviewed` เมื่อตรวจครบแล้ว

## รหัสบั๊ก

`<PREFIX>-<เลข>` เช่น `ORD-01` (ordering/receiving), `INV-01`, `PO-01` แต่ละบั๊กมีระดับ, ตำแหน่งไฟล์, อาการ, วิธีแก้ที่เสนอ และสถานะ (`open` / `fixed <commit>` / `wontfix`)
