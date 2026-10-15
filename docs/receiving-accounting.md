# หลังยืนยันรับของ: บันทึกบัญชีอย่างไร (v0)

เอกสารนี้ต่อจาก `POST /api/receiving-documents/:id/confirm` และใช้คู่กับ AP ledger ใน General Cashflow (branch `cashflow/ap-ledger-v0`, `general-cashflow/server/src/ap/`) ซึ่งทดสอบกับข้อมูลจริง ก.ย. 2569 จาก snapshot Cashflow + LINE Bill แล้ว

## หลักการ (บัญชีคู่ เกณฑ์คงค้าง)
| เหตุการณ์ | วันที่ลงบัญชี | Dr | Cr |
|---|---|---|---|
| ยืนยันรับของ (มีบิล/ใบรับของ) ซัพเครดิต | `delivery_date` ของเอกสารรับของ | ต้นทุนวัตถุดิบ `COGS_FOOD` (ร้านใช้ periodic — ยังไม่ตัดสต๊อกรายตัว) + ภาษีซื้อ `INPUT_VAT` เฉพาะบิลเป็นใบกำกับภาษีเต็มรูป | เจ้าหนี้การค้า `AP` (แยกซัพ) |
| ซื้อจ่ายสดทันที (ตลาดสด/ไม่มีเครดิต) | วันที่รับของ | ต้นทุนตามหมวด | เงินสด / ธนาคาร |
| จ่ายเงินซัพเครดิต | วันที่จ่ายจริง | `AP` | เงินสด / ธนาคาร (ระบุบัญชีจาก statement ได้เมื่อมีหลักฐานผูกซัพ) |
| void เอกสารรับของ / รับคืน / ใบลดหนี้ | วันที่ void/ลดหนี้ | กลับรายการเดิมทั้งหมด (สลับ Dr/Cr) | — ห้ามลบประวัติ; ลดหนี้บางส่วนต้องระบุบรรทัดเอง |

- ภาษีซื้อ = `amount × 7/107` (ปัดเป็นสตางค์) เฉพาะเมื่อยืนยันว่าเป็นใบกำกับภาษีเต็มรูป ไม่งั้นรวมในต้นทุนและติดธง `VAT_EVIDENCE_MISSING_INCLUDED_IN_COST`
- เงินคิดเป็นสตางค์จำนวนเต็มทั้งระบบ; ทุก journal ต้อง Dr = Cr (ตรวจทั้งในโค้ดและ CHECK constraint)

## กฎของเจ้าของที่ต้องเคารพ
- รอบจ่ายซัพเครดิต: รับของวันที่ 1–15 → ครบกำหนดวันที่ 20; 16–สิ้นเดือน → วันที่ 5 เดือนถัดไป (`dueDate()`)
- จ่ายซัพวันที่ 5–6 = ชำระของเดือนก่อน (`paymentPeriod()`)
- เงินจ่ายร้านเนื้อย่างพี่เก้ง = เงินผ่าน (`PASS_THROUGH`) ไม่ใช่ต้นทุนร้าน
- ข้อมูลจริงคือระบบ Cashflow และ LINE Bill — สมุด Google Sheets เดือน ก.ย. ยังไม่ได้ลงจริง ห้ามใช้อ้างอิง

## 3-way match (ใบสั่ง – ใบรับของ – บิล)
ใช้ `threeWayMatch({ order_items, receiving_documents, bill_items })` ใน AP ledger โดย `itemKey` = `order_item_id` เดียวกันทั้งสามฝั่ง:
- ใบสั่ง: `order_items` (quantity, หน่วย, ราคาที่สั่ง)
- ใบรับของ: บรรทัดเอกสารรับของที่ confirmed (`quantity_received`, `unit_price` ฐาน)
- บิล: ผล OCR ที่คนแก้แล้ว (`quantity_billed`, `unit_price`, `amount`)
ส่วนต่างจำนวน/ราคา/หน่วย → สถานะ `pending` + รายการส่วนต่างให้ฝ่ายบัญชีตรวจ ก่อนนับเป็นยอดเจ้าหนี้ที่รับรอง

## ไม่นับซ้ำกับ P&L เดิม
- P&L เดิมใน Cashflow รับรู้ค่าใช้จ่ายจากบิล/การจ่ายใน LINE Bill (`lbc:bill:<id>`)
- เอกสารรับของต้องเก็บ `lbc_capture_id` (มีคอลัมน์ตามแผน) เมื่อจับคู่กับบิลใน LINE Bill ได้ → AP ledger ใช้ key ร่วม `lbc:bill:<id>` แหล่งเดียว ไม่บวกซ้ำ
- เมื่อยังจับคู่ไม่ได้: รายการรับของเป็นต้นทุนเกณฑ์คงค้าง ส่วนการจ่ายใน LINE Bill ของซัพเครดิตเป็น Dr AP / Cr เงิน (ไม่ใช่ต้นทุนซ้ำ) — ตรงกับที่ AP ledger ทำอยู่แล้ว (`CREDIT_PAYMENT`)

## ส่งข้อมูลจากระบบรับสินค้าไป AP ledger (adapter)
ขั้นแรก (ไม่ต้อง deploy เพิ่ม): export อ่านอย่างเดียวรายวัน
```
receiving_documents (status=confirmed|void) + lines → JSON
{ source_key: "receiving:<id>", branch_code, delivery_date, supplier_master_id, supplier_name_text,
  doc_ref, total, vat, full_tax_invoice: bool|null, lbc_capture_id|null, status,
  lines: [{ order_item_id, product_id, quantity_received, unit_price, amount }] }
```
AP ledger นำเข้าเป็น `ap_sources` (source_type `RECEIVING`) แล้วโพสต์ `bill` journal; void → `reverseJournal()`

## สิ่งที่เจ้าของต้องตัดสิน
1. ยอดเจ้าหนี้ยกมา ณ 31 ส.ค. 2569 รายซัพ (ไม่มีข้อมูลนี้ → ยอดคงค้างและอายุหนี้ยังแสดง "ยังไม่ทราบ")
2. ซัพรายไหนออกใบกำกับภาษีเต็มรูป (เพื่อแยกภาษีซื้อ)
3. ยืนยันใช้ระบบสต๊อกแบบ periodic (ลงต้นทุนเมื่อรับของ) ไปก่อน
4. ใครเป็นผู้ตรวจรายการ 3-way match ที่ไม่ตรง (ฝ่ายบัญชี/หัวหน้าสาขา)
