# P4 / P8 — inventory ปุ่มต้นฉบับและตำแหน่งบนโต๊ะ

สถานะ: source Local ของ phase 2; browser บนสำเนา SSD ผ่านแล้ว ยังไม่ deploy

| งาน | ต้นฉบับ | ตำแหน่งบนโต๊ะ / การส่งต่อ |
|---|---|---|
| งานเสร็จแล้ว | `bucketRows('done')`, `confirmedMatchForItem` | queue ต่อจากงานค้าง; หนึ่งชุดต่อไทล์ ไม่ซ้ำหลายบิลในชุด |
| กรองวิธีจ่าย | `[data-done-payment="all|transfer|cash"]` | ชิป dock ส่ง `.click()` ของปุ่ม filter เดิม |
| ส่งคู่กลับตรวจ | `#unconfirm-pair` | ปุ่มแก้วตัวแดง; confirmation/why/undo เดิม |
| สอนเหตุผล AI | `#teach-done-ai`, `#done-learning-note` | ⋯ เปิด `.done-learning` จริงโดยย้าย node; ไม่สร้าง textarea สำเนา |
| เงินสด | `#edit-cash-payment`, `#void-cash-payment` | dock ใช้ปุ่มต้นฉบับ; recipient/history/quicknotes/form เดิม |
| สร้างใบแทน | `#selected-create-receipt` | ⋯ แสดงเฉพาะเมื่อ handler เดิมมีในรายการนั้น |
| ยกเลิกใบแทน | `.receipt-substitute-void-actions [data-receipt-id]` | ⋯ ต่อหนึ่งใบ; native `dialog.receipt-substitute-void-dialog` และเหตุผลเดิม |
| ฟอร์มค่าใช้จ่าย | `.expense-entry-open`, `.expense-profile-dialog` | ⋯ ใช้ opener/form เดิม |
| เหตุผล | `#why-bg`, `#why-form`, `#why-close`, `#why-note`, `#why-teach-ai`, `#why-skip`, `#why-submit` | overlay เดิมเหนือโต๊ะ; guard/confirmation เดิม |
| เลือกเอกสาร | `#drawerbg`, `#drawerlist`, `#close`, `#picker-search`, `[data-slip]`, `[data-bill]` | drawer เดิม; search/candidates/load retry เดิม |
| เงินสด dialog | `#cash-payment-bg`, `#cash-payment-form`, `#cash-payment-close`, `#cash-payment-cancel`, `#cash-payment-submit`, `#cash-payment-amount`, `#cash-payment-date`, `#cash-payment-recipient`, `#cash-payment-recipient-options`, `#cash-payment-note`, `#cash-payment-history`, `#cash-payment-history-list`, `#cash-payment-quick-notes`, `[data-note]` | overlay เดิมและ node ทุกช่องเดิม |
| ขอโอน | `#transfer-request-bg`, `#transfer-request-form` | overlay เดิม ไม่เปลี่ยนการส่ง LINE |
| ใบแทน | `#receiptbg`, `#receipt-form`, `#receipt-close`, `#receipt-cancel`, `#receipt-submit`, `#receipt-date`, `#receipt-payee`, `#receipt-payer`, `#receipt-account`, `#receipt-amount`, `#receipt-description` | overlay เดิม; create/update validation เดิม |
| ไม่ใช่เอกสาร | `#not-document-bg`, `#not-document-form` | overlay เดิม; AI/learn opt-in เดิม |
| สลิปก่อนเลือก | `#slip-preview-bg`, `#slip-preview-image`, `#slip-preview-zoom`, `#slip-preview-use`, `#slip-preview-close`, `#slip-preview-back` | overlay เดิม; ขยายภาพ/ปิดไม่เปลี่ยนงาน |
| สรุปค่าใช้จ่าย | `#xs-summary`, `#xs-close`, `[data-xs-open-day]`, `[data-xs-item]`, `[data-xs-transaction]` | native dialog เดิม; openDay/jumpToProcess เดิมและคงโต๊ะ |
| ผู้ส่ง | `#sendersbg`, `#refresh-senders`, `#close-senders` | drawer เดิม |
| ภาพเต็ม | `#chatlightbox`, `#chatlightbox-image`, `#chatlightbox-close`, `#chatzoomout`, `#chatzoomreset`, `#chatzoomin` | lightbox/zoom เดิม; OCR ต้องใช้ cache ของ glass-ocr ร่วมกัน |
| ย้อนกลับ | `#undobar`, `#undobutton` | bar เดิมเหนือโต๊ะ; ไม่สร้าง undo handler ใหม่ |

ข้อมูลผู้ยืนยันและเวลามาจาก `reviewed_by/confirmed_at` (fallback `reviewed_at`) หรือ `cash_confirmed_by/cash_confirmed_at`; API รายการเงินสดยังไม่มีชื่อผู้ยืนยัน จึงแสดง “ไม่พบข้อมูล” ไม่สร้างชื่อหรือเวลาเอง หลักฐานเงินสดเป็นบันทึกการจ่าย ไม่สร้างรูปสลิปจำลอง

P8 ไม่มี API ใหม่และไม่เปลี่ยน financial rule: CSS เฉพาะ `body.desk-on`; script จำ opener บนโต๊ะเพื่อคืน focus เมื่อปิด dialog ใน scope เดิม รายการ source/selection เดิมยังเป็นผู้กำหนดงาน

## ผลตรวจ Local — 9 ต.ค. 2569

- `scripts/desk-completed-browser-check.js`: main 118 checks ผ่าน ทั้งคู่ที่ยืนยัน/เงินสด, identity/time, ปุ่มเดิม/guard, textarea จริงและการคืน node, cash quicknotes/cancel, ฟอร์ม why/ใบแทน/ขอโอน/ไม่ใช่เอกสาร, XS และ expense dialog, native lightbox/zoom, viewer zoom/rotate/Escape และ undo handler spy
- 1120/1280/1440/1920 × สว่าง/มืด: หน้าเงินสดไม่ล้น; 8 overlay ที่ใช้จริงเหนือโต๊ะ, สี danger/primary อ่านได้; focus ไม่เลื่อน root จนหัวโต๊ะหาย
- Targeted filter guard 9 checks ผ่านหลังแก้ source observer: cash filter ว่างยังอยู่โต๊ะ, all กลับคู่เดิม, proxy disabled ตรงกับปุ่มต้นฉบับหลัง observer settle โดยไม่ฝืน guard
- `scripts/desk-completed-group-browser-check.js`: 11 checks ผ่าน ชุดที่ยืนยัน 2 บิล/2 สลิปมีไทล์เดียว, รูปครบทุกใบ, ผลรวม/เส้นเชื่อม และ 8 layouts
- Viewer OCR targeted probe: รูป #4106 ใช้ cache เดิมจริง 3 กล่อง, cache bytes เดิมก่อน/หลัง, Escape กลับคิวเดิม (`viewer-cache-result.log`)
- ทุกชุด `errors: []`, `writes: []`; ใช้สถานะสมมติในหน่วยความจำ browser ของสำเนา SSD เท่านั้น ไม่มีการยืนยัน/จ่าย/บันทึก/ส่ง LINE/เรียก AI จริง
- ธงยอดของ P3 เปิดรายละเอียดตรงบนโต๊ะ จึงไม่เปิด `#flagbg` ซ้ำ; coverage ของธงเป็นชุด P2/P3

หลักฐานอยู่ที่ `/Volumes/SSD Files/SOLAO/line-bill-capture/reports/desk-phase2-p48/`:
`result.log`, `filter-guard-result.log`, `group-result.log`, `viewer-cache-result.log`, `p4-confirmed-light-1440.png`, `p4-cash-dark-1920.png`, `p4-confirmed-group-light-1440.png`, `p8-viewer-cached-ocr-1440.png`.
ภาพจับหลัง animation และสีจริงตรงกับชื่อไฟล์; ชื่อผู้ตรวจ/ผู้รับในภาพเป็น fixture สำหรับตรวจ UI
