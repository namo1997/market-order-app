# P2–P3: inventory ปุ่มเดิมก่อนย้ายเข้าโต๊ะ

ตรวจจาก `public/index.html` เมื่อ 9 ตุลาคม 2026 ก่อนเริ่ม implementation. ขอบเขต Local; ไม่เพิ่ม API, schema, การคำนวณการเงิน หรือการตัดสินใจอัตโนมัติ

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

เดือน: เลขค้างใช้ข้อความ “ค้าง n” ของลิงก์เดิม; ทำต่อเลือกวันที่เก่าสุดต่อกลุ่มจากลิงก์ดังกล่าว ไม่ชี้จากรหัสวันของ DOM ใหม่. มาตรวัดใช้ `confirmed_count` กับจำนวนงานค้างของเดือนเดียวกับ board เดิม; รายการนำเข้าย้อนหลังคงสถานะนำเข้า ไม่แต่งเป็นพร้อมปิด

วงจร flag: ดรอว์เวอร์เดิมยังมี `hidden=false` ระหว่างโหลด context ตาม guard ของต้นฉบับ แต่ถูกซ่อนการแสดงผลเมื่ออยู่โต๊ะ. โมดูลคืน `.flagmanual` ก่อน rerender/ออกจากหน้า และไม่มี wrapper ของ `renderBoard`, `openFlagDetail`, `resolveFlag`, `showFlags`

## ผลตรวจ Local บน SSD

รัน `scripts/desk-board-flags-browser-check.js` ด้วย Playwright CLI session `desk-p23` บนสำเนา SSD `runs/2026-10-09T08-02-40-621Z-378daf77/` พรีวิว loopback `50191`. `reports/desk-p23-check.log` คืน `{passed:true}`:

- Board และ flags: 1120/1280/1440/1920px × สีสว่าง/มืดจากปุ่มเลือกสีจริง รวม 16 layouts ไม่ล้น
- Calendar href/title ครบตรงต้นฉบับ; ทำต่อจากตรงนี้เป็นวันค้างเก่าสุดต่อกลุ่มตรงกับ source links; ingest alert และหัวเดือนส่งต่อ handler เดิม
- รอบทั้งหมดและรายละเอียด flag เป็น node ต้นฉบับที่ย้ายแล้วคืน; board → day → board → flags → board คงโต๊ะ; input/manual คืนเมื่อออกจาก flags
- จำลองโหลด flags/context ล้มเหลวผ่าน GET interception แล้วคลิก retry เดิมสำเร็จ. Choice และ save ส่งต่อ original handler spies; disabled ของยอดแจ้งตามต้นฉบับ
- `writes:[]`, `errors:[]`; ไม่มี browser financial POST, LINE ส่งข้อความ หรือ AI run

ภาพ: `reports/desk-p2-board-{light,dark}-{1120,1280,1440,1920}.png` และ `reports/desk-p3-flags-{light,dark}-{1120,1280,1440,1920}.png`. Flag fixture ใช้รูปจริงในสำเนา #4076 แต่ธง/ยอดแจ้งและ context เป็นข้อมูลสมมติผ่าน GET interception; เอกสารลายมือบางครั้ง OCR หาตำแหน่งยอดไม่ได้ จึงแสดงยอด fallback โดยไม่สร้างกล่องปลอม. ผลนี้ไม่อ้างการบันทึกตัดสินใจจริงหรือผลด้านการเงิน

ตรวจเพิ่มเติมหลังหัวโต๊ะคงปุ่มกลุ่มใน board/flags ด้วย `scripts/desk-board-flags-group-check.js`: `reports/desk-p23-group-check.log` คืน `{passed:true,groupFilterOriginalChange:true,flagsSourceRequestParity:true,writes:[],errors:[]}`. เลือกกลุ่มจริง/ทุกกลุ่มผ่านเมนูโต๊ะส่ง `change` ของ select เดิมทั้งสองหน้า; calendar กรองตามกลุ่ม และ loader flags รับ source_id เดิม. Header พร้อมปุ่มกลุ่มพอดีจอทั้ง 16 layouts. ภาพ header ล่าสุด: `reports/desk-p23-group-{board,flags}-{light,dark}-1440.png`

ตรวจ integration เพิ่มแล้วพบ/แก้ในไฟล์ร่วมโดย root: (1) flags ต้อง bind รูป/ปุ่มขยายเข้า viewer (2) overflow ของ wall ทำให้โต๊ะเลื่อนทั้งแผงเมื่อเปิดรูป (3) ฟอร์มที่ย้ายเข้าแผ่นโต๊ะเกิด id ซ้ำเมื่อ original render สร้างฟอร์มใหม่ ทำให้ save อ่านค่าจากฟอร์มที่ซ่อนอยู่. หลังแก้ `desk-p23-check.log` รันใหม่ผ่าน พร้อม `flagsViewerAndEscape:true`: รูป/expand เปิดรูป flags ปัจจุบันใน viewer, Y ไม่ส่งคำสั่ง, Esc คง flags/รายการเดิม, ไม่มีแท็บใหม่ และ offset โต๊ะเป็น 0 ใน matrix เดิม

`scripts/desk-native-form-browser-check.js` / `reports/desk-native-form-check.log` ผ่าน: draft ทั้งชื่อร้าน/รายการ/ยอด/หมายเหตุคงหลัง render; แต่ละ id มี node เดียวในฟอร์มที่เห็น; handler Save ต้นฉบับอ่าน draft นั้นจริง (stub fetch ดัก decision context ก่อนออก network แล้ว reject จึงไม่บันทึก); fresh source disabled คงอยู่; ปิดแผ่นแล้วคืนฟอร์ม. `writes:[]`, `errors:[]`
