# ปุ่มเดิม → โต๊ะเทียบเอกสาร (Local)

## เฟส 2 — inventory จากหน้าเดิม (P1)

| ปุ่ม/ชุดเดิม | บนโต๊ะ | เงื่อนไข |
|---|---|---|
| tab-board, flagbadge, flagcount | เมนูระบบซ้ายบน | ใช้ click เดิมและ badge จำนวนเดิม |
| xs-open, senders, logout | เมนูระบบซ้ายบน | สรุปค่าใช้จ่าย/ผู้ส่ง/dialog เดิม; logout สีแดง |
| global-search-wrap, global-search, global-search-clear, global-search-results | แผ่นค้นหา, ⌘K | ย้าย node เดิมแล้วคืน คง keyboard/input/results เดิม |
| aimenu, ai-menu-toggle, run, rematch, retryfailed | แผ่น AI ผ่าน toggle เดิม | คง disabled และคำเตือนเดิม ไม่สั่ง AI เมื่อเปิดเมนู |
| ai | ข้อความเล็กในแผ่น AI | ไม่กลับไปเป็นป้ายบนแถบบน |
| reload | ไอคอนโหลดใหม่ด้านขวา | ใช้ handler เดิมไม่เรียก AI |
| reread, pause-ai, printday | ⋯ ของรอบ | แสดงเฉพาะ control เดิมที่ไม่ hidden และอยู่หน้าวัน |
| group + option เดิม | ปุ่มกลุ่มบนแถบทุกหน้า | ตั้งค่าและ dispatch change เหมือน select เดิม; board/flags มีทุกกลุ่ม |
| day-prev, day-next, closeday | แถบวันและปิด/เปิดรอบ | คง disabled และข้อความตามต้นทาง |

P2–P8 ใช้โมดูลและ inventory แยกตามงานด้านล่าง; ส่วนตารางแรกเป็นปุ่มงานเดิมที่ยังใช้ในเฟส 2

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
| รูปอื่น | หน้าประกอบบิล | รูป/แชทและชุดควบคุมเดิมบนโต๊ะ; ไม่มีปุ่มจัดหน้าบิลเดิมจึงไม่สร้างเส้นทางเขียนเพิ่ม |
| ต้องกรอกยอด | selected-amount/selected-save-amount | กรอกยอดจากบิล เปิดฟอร์มเดิม ไม่สร้างค่าศูนย์แทน NULL |
| คู่ติดธงยอด | review-flag-document/announced | ตัวเลือก ยอดในเอกสาร / ยอดที่แจ้ง |
| คู่ติดธงยอด | review-flag-total/manual | ไอคอนดินสอ เปิดช่องกรอกและปุ่มเดิม |
| ทุกงาน | skip-current / การเลือกคิว | ข้าม (S), ←/→ และแถบคิว ไม่บันทึกการตัดสินใจ |
| ทุกงาน | ปุ่มอื่นที่ยังไม่มี shortcut | ⋯ รายละเอียดและปุ่มทั้งหมด ย้าย reviewpanel เดิมเข้าแผ่นลอยบนโต๊ะ |
| ทุกงาน | chatpanel/chatlist | แท็บซ้าย C และฟอง focus 5 วินาที |
| วัน | closeday/day-prev/day-next | ปิดรอบ/วันก่อน/วันถัดไป ใช้ปุ่มเดิม |

เฟส 2: งานหลายเอกสาร/คืนเงินสำรองจ่ายและทุกถังอยู่ในโต๊ะ; ทุกงานมี “เปิดในมุมมองรายการ” ใน ⋯ เป็นทางสำรอง
“อื่น ๆ” ไม่มี selected-not-document ในหน้าเดิม จึงเปิด `openNotDocument(row,'รูป')` เดิมโดยตรง
เช่นเดียวกับการกดปุ่มนั้นในถังอื่น; ไม่มีการเขียน category เอง

การเทียบรายการปุ่มและการเปิด dialog ผ่าน browser checks ใช้ SSD copy เท่านั้น
ไม่ได้อ้างว่าทดสอบยืนยันทุกการเงินหรือจัดประเภทผ่าน browser จริงในรอบนี้

## เฟส 2 — inventory ครบ P2–P8

ตารางต่อไปนี้รวมทางเข้าของ control ต้นฉบับ P1–P8 ไว้ในเอกสารหลัก ทุกทางใช้ handler และ guard เดิม ปุ่มที่ต้นฉบับไม่มีจะไม่สร้างคำสั่งเขียนแทน

### P2 หน้ารวม และ P3 ตรวจยอด

| หน้า/องค์ประกอบเดิม | ทางเข้าในโต๊ะ | การทำงานเดิม |
| --- | --- | --- |
| `#month-prev`, `#month-today`, `#month-next` | หัวเดือน | คลิกปุ่มเดิม → `changeCalendarMonth` |
| `#group` ใน board/flags | เลือกกลุ่มบนหัวโต๊ะ (คงแสดงทั้งสองหน้า) | อ่าน options เดิม, set value และ dispatch `change`; listener เดิมกรอง `S.bSource` / `S.flagSource`, มีตัวเลือกทุกกลุ่ม |
| `#board a.calendar-run[data-open]` | แคปซูลวัน / ทำต่อจากตรงนี้ | คลิกลิงก์วัน/กลุ่มเดิม → `openDay`; href และ title เดิมคงไว้ |
| `#board .calendar-day[data-open-date]` | วันว่างในปฏิทิน | คลิกเซลล์เดิม (รองรับเปิดวันไม่มีรูป) |
| `.month-stat` สี่ใบ | ตัวเลขหนึ่งแถว | ต้นฉบับเป็น article ไม่มี handler; ไม่สร้างการตัดสินใจ/เส้นทางใหม่ |
| `#board .round-table` | แผ่นลอย “รอบทั้งหมด” | ย้าย node เดิมให้คลิก/คีย์บอร์ดตาม handler เดิม แล้วคืนที่เดิมเมื่อปิด |
| `.ingestalert`, `#ingest-alert-open` | แคปซูลเตือนบนสุด | ข้อความเดิม และคลิกปุ่มเดิม |
| `#flaglist .flagcard[data-flag-id]` | คิวรูปด้านล่าง | คลิกการ์ดเดิม → `openFlagDetail` |
| `#flag-document` | ตัวเลือกยอดในเอกสาร | คลิกเดิม → `resolveFlag` ด้วยยอดเอกสาร; ปุ่มนี้บันทึกทันทีตาม flow เดิม |
| `#flag-use` | ตัวเลือกยอดแจ้งในแชท | คลิกเดิม → `resolveFlag` ด้วย `use_announced`; disabled ตามเดิม |
| `.flagmanual` (`#flag-total`, `#flag-save`) | ช่องกรอก/บันทึกยอดในแท่นคำถาม | ย้าย input และปุ่มจริง; handler เดิมอ่าน node เดิม ไม่ auto-fill/auto-submit |
| `#flag-pair` | ⋯ ไปจับคู่เอกสาร | คลิกเดิม → `openFlagInDay`; โต๊ะคงโหมดเมื่อกลับไปวัน |
| `#flagchat` | ฟองข้อความซ้ายของรูป | ใช้ข้อความ context เดิม; ไม่เรียก context API เพิ่ม |
| `#retry-flags`, `#retry-flag-context` | ปุ่มโหลดอีกครั้งในตำแหน่ง error | คลิกปุ่มเดิม |
| `.flagmeta`, รายละเอียด/ประวัติแชท | ⋯ รายละเอียดต้นฉบับ | ย้ายรายละเอียดต้นฉบับเข้าแผ่นลอยเมื่อจำเป็น |

รายละเอียดและผลทดสอบ: [DESK_PHASE2_P23_ACTIONS.md](DESK_PHASE2_P23_ACTIONS.md)

### P5 ชุด/รอบจ่าย, P6 คืนเงินสำรอง และ P7 ถังที่เหลือ

| ข้อ | ปุ่ม/ฟอร์มต้นฉบับ | ตำแหน่งบนโต๊ะ | Guard/พฤติกรรม |
| --- | --- | --- | --- |
| P5 | `confirm-match-group` | dock สีเขียวของชุด | disabled ตามปุ่มเดิมเมื่อยอดรวมต่าง |
| P5 | `reject-match-group` | dock แก้วตัวแดง | handler `updateMatchGroup` เดิม |
| P5 | `edit-match-group` | ⋯ แก้ชุดเอกสาร | เปิด picker เดิม |
| P5 | `group-auto-match` | picker เดิม เหนือโต๊ะ | เสนอชุดตามยอดเดิม ไม่บันทึกทันที |
| P5 | `clear-group-bills`, `clear-group-slips` | picker เดิม ฝั่งบิล/สลิป | ล้างการเลือกใน dialog |
| P5 | `save-match-group` | picker เดิม ด้านล่าง | disabled ตามยอดรวม/จำนวน และคำยืนยันเดิม |
| P5 | `.candidate`, `retry-picker-load` | picker สลิปเดิม จาก batch-pick-slip | ยังใช้ loading/retry/candidate handler เดิม |
| P5 | `batch-pick-slip` | dock รอบจ่าย | เลือกสลิปที่ใกล้เคียง ผ่าน drawer เดิม |
| P5 | `batch-combine` | dock รอบจ่าย | เลือกหลายสลิปผ่าน group picker เดิม |
| P6 | `reimbursement-substitute` | dock ปุ่มหลัก | เปิด receipt dialog เดิม |
| P6 | `reimbursement-existing` | ⋯ ใช้บิล/ใบเสร็จที่ยืนยันแล้ว | แสดงเมื่อปุ่มต้นฉบับมีอยู่เท่านั้น |
| P6 | `reimbursement-no-receipt` | ⋯ ไม่ต้องมีใบแทน | guard หมายเหตุจำเป็นจาก handler เดิม |
| P6 | `reimbursement-reject` | dock แก้วตัวแดง | ปฏิเสธความเชื่อมโยงตาม handler เดิม |
| P6 | `reimbursement-note` | ⋯ หมายเหตุหลักฐาน | ย้าย `.pairfeedback` ต้นฉบับเข้า sheet ชั่วคราว ไม่ clone textarea |
| P6 | `receipt-*` | receipt dialog ต้นฉบับ | ไม่กด submit ในการตรวจ browser |
| P7 | `selected-pick-bill` | dock หน้าประกอบ/Other เมื่อมีปุ่มต้นฉบับ | source ปัจจุบันมีเฉพาะถังสลิป จึงไม่สร้างปุ่มเขียนใหม่ในถังที่ไม่รองรับ |
| P7 | `pause-ai` | dock รอ AI อ่าน | ใช้ปุ่มหยุดรอบเดิม แสดงสถานะ/จำนวน/เวลาจากข้อมูลเดิม |
| P7 | `selected-repair-state` | dock ตกหล่น | ใช้ repair-match-state handler เดิม |
| P7 | รายละเอียด/การจัดหมวดเดิม | dock หน้าประกอบ/Other และ ⋯ | sheet ย้าย `reviewpanel` เดิมเข้ามา ไม่สลับมุมมอง |
| P5–P7 | เปิดในมุมมองรายการ | ⋯ ทุกงาน | ทางสำรองที่ผู้ใช้ร้องขอ |

รายละเอียดและผลทดสอบ: [DESK_PHASE2_P567_ACTIONS.md](DESK_PHASE2_P567_ACTIONS.md)

### P4 งานยืนยันแล้ว และ P8 dialog เดิม

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

รายละเอียดและผลทดสอบ: [DESK_PHASE2_P48_ACTIONS.md](DESK_PHASE2_P48_ACTIONS.md)

ข้อจำกัดจาก source: หน้าประกอบ/Other ที่ AI ระบุเป็นหน้าต่อไม่มี `#selected-pick-bill` ใน review panel ปัจจุบัน จึงมีรูป แชท คำแนะนำและชุดจัดหมวดเดิมบนโต๊ะตามเงื่อนไข handoff; เงินสดไม่มีชื่อผู้ยืนยันจาก API จึงแสดง “ไม่พบข้อมูล”. ไม่มี endpoint ใหม่

P8 ฟอร์มเดิมรวมช่องและการกระทำย่อย `#transfer-request-confirm/submit/cancel`, `#not-document-submit/cancel`, `.cashquicknote`, `.cashhistory-item`, `expense-profile-*`, `.xs-cell`, `.xs-item`, `#chatzoom*` และปุ่มยกเลิกใบแทนใน `receipt-substitute-void.js`; control ภายในคงอยู่ใน dialog ต้นฉบับ ไม่สร้างสำเนาที่มี id ซ้ำ
