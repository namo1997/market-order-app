# SOLAO Glass

กระจกเฉพาะชั้นควบคุมลอย เนื้อหาและตัวเลขพื้นทึบ Navy คือปุ่มหลัก Gold ใช้เป็นเครื่องหมายแบรนด์เท่านั้น สีเขียว/อำพัน/แดงบอกสถานะพร้อมไอคอนและคำเสมอ

## เริ่มใช้

```jsx
import { GlassBar, PrimaryAction, IconButton, NumberField } from '../../design';

<section className="solao sg-with-bar" data-theme="auto" lang="th">
  <NumberField label="รับจริง" value={quantity} onValueChange={setQuantity} unit="กก." />
  <GlassBar>
    <IconButton icon="camera" label="ถ่ายบิล" onClick={takePhoto} />
    <PrimaryAction onClick={confirm}>ยืนยัน</PrimaryAction>
  </GlassBar>
</section>
```

Import จาก `design` หรือ `design/components` จะโหลด CSS ให้อัตโนมัติ ไม่ต้องแก้ main.jsx หาก import ไฟล์ component โดยตรง ต้อง import `design/styles.css` เอง ทุก component ต้องอยู่ใต้ `.solao` และตั้ง `data-theme="light"`, `"dark"` หรือ `"auto"` (หรือไม่ระบุ = ตามเครื่อง) ที่ root นั้น

- `GlassBar`: fixed ล่างจอ 430px + safe area; ใส่ `sg-with-bar` บน root หรือพื้นที่เนื้อหาเพื่อเว้นระยะให้แถบล่าง; `inline` สำหรับตัวอย่าง/พื้นที่ฝัง หลีกเลี่ยง ancestor ที่มี transform/filter เพราะทำให้ fixed เปลี่ยนตำแหน่ง
- `PrimaryAction`: `icon`, `busy`, `disabled`, `type` (ค่าเริ่มต้น button) ขณะ busy จะล็อกการกดและประกาศ aria-busy ให้ caller เปลี่ยนข้อความเป็น “กำลังบันทึก”
- `IconButton`: ต้องมี `label` ภาษาไทย ใช้เป็นชื่อสำหรับโปรแกรมอ่านหน้าจอและ native tooltip
- `Sheet`: controlled `open`, `onDismiss`, `title`, `actions`; ใช้ native dialog จับ focus/คืน focus/กด Escape ปิด ต้อง mount ใต้ `.solao` และใช้ WebView ที่รองรับ `HTMLDialogElement.showModal()` เปิดครั้งละแผ่น
- `Segmented`: `label`, `value`, `onChange`, `options=[{value,label,icon?,disabled?}]`; radio ใช้ Tab/ลูกศรได้ และความกว้างไม่เปลี่ยนเมื่อเลือก
- `StatusPill`: `status="ok|review|error"`; children เปลี่ยนคำสั้นได้
- `ListCard`: `title`, `subtitle`, `leading`, `trailing`, children; เป็น article ไม่ผูก onClick ให้ทั้งใบจนปุ่มซ้อนกัน
- `NumberField`: controlled **string** `value`, `onValueChange`; `label`, `unit`, `error`, `hint`, `readOnly`, `disabled`, input props และ ref ได้ ไม่คำนวณเงิน/ปัดเศษ/แปลง Number; validation และแปลงสตางค์เป็นหน้าที่ชั้นธุรกิจ
- `EmptyState`: `title`, `description?`, `icon?`, `action?`
- `Toast`: `open`, `status`, `onDismiss?`; แจ้งสำเร็จ role=status / ผิดพลาด role=alert อยู่จน caller ปิด ไม่มี timer; ใส่ `sg-toast-floating` เมื่อต้องการลอยเหนือเนื้อหาและให้ root อยู่ตลอดระยะประกาศ
- `Icon`: `name`, `size=24`, `label?`; ไม่ใส่ label เมื่ออยู่ในปุ่มที่มีชื่อแล้ว รายชื่อใน `icons/names.js` ใช้ SVG sprite เส้นชุดเดียวที่วาดเอง

ดู `DesignPreview.jsx` โดย render แยกใน harness ของผู้ตรวจ ไม่ผูก route และไม่เรียก API จริง ตัวอย่างมีธีมคู่, sheet ที่เปิดได้, สถานะผิด/กำลังทำ/disabled, ไอคอนครบ และค่าระบบ

## ห้ามทำ

ไม่เกิน 1 ปุ่มหลัก + 2 ปุ่มรองต่อหน้ารับสินค้า คำบนปุ่ม 1–2 คำ ห้ามใช้ gold เป็นข้อความบน cream ห้ามวางตัวเลขบนกระจก ห้ามลดเนื้อหาต่ำกว่า 15px หรือเป้าแตะต่ำกว่า 48px ห้ามนำ `.solao` ไปครอบทั้งแอปเดิมโดยไม่ตรวจหน้าอื่น ห้ามพึ่ง CDN/เรียกฟอนต์ภายนอกตอนรัน

ฟอนต์ IBM Plex Sans Thai 400/500/600/700 เป็น woff2 ครบชุดอักขระจาก IBM โดยตรง (`public/fonts/SOURCES.json` มี commit/URL/SHA-256) ใช้ใบอนุญาต OFL ใน `OFL.txt` ไม่ใช้ Looped เพิ่มเพื่อลดไฟล์ซ้ำ ชุดหลักมีเลขละตินและ tabular-nums พร้อมใช้ เส้นทาง `/fonts/` ต้องถูกบรรจุพร้อม APK หรือเสิร์ฟจาก public root ใน WebView; การ self-host ไม่ได้ทำให้ทั้งเว็บเป็น PWA/cache อัตโนมัติ

CSS เคารพ reduced motion/transparency, contrast และ forced colors มีพื้นทึบ fallback เมื่อไม่มี backdrop-filter การเคลื่อนไหวเป็น CSS เท่านั้น ไม่เพิ่ม dependency

## Preview รอบ 2

ที่ `design-preview.html` จอ ≤700px เป็นหน้ารับสินค้าเต็ม viewport ใช้ `GlassBar` fixed และ `sg-with-bar` พร้อมรายการเลื่อนผ่านด้านหลัง ไม่ซ่อน overflow แนวนอน บน desktop ยังคงสองธีมแบบ inline สำหรับเทียบกัน

- `?view=mobile&theme=light` และ `?view=mobile&theme=dark` เปิดมือถือเต็มจอทุกความกว้าง
- `?view=catalog` เปิด catalog บนมือถือ; คำกำกับธีมอยู่ใน catalog เท่านั้น
- “ดูบิล” เปิดภาพ SVG บิลสมมติ; “แก้จำนวน” เปิด Sheet พร้อม validation; ปุ่มบันทึกตัวอย่างถูกปิดเมื่อค่าผิด
- `sample-quantity.js` เป็น validation **เฉพาะตัวอย่าง** (จำนวนบวก ≤99,999.99 ทศนิยม ≤2) คำนวณส่วนต่างเป็นจำนวนเต็มหน่วยย่อย โดยไม่เปลี่ยน API/business rules หรือ props ของ component
- Toast เริ่มปิด เปิดหลังบันทึกจำลองและปิดทันทีเมื่อแก้จำนวน ตัวอย่างไม่มี persistence/API
- กระจก light tint 74% / dark 76% มี specular gradient บางจากซ้ายบนและ inset ขอบแสง; เนื้อหายังคงทึบ หลีกเลี่ยงใส่ข้อความรองเหนือภาพ arbitrary โดยไม่ตรวจ contrast เพิ่ม

ต้องตรวจ soft keyboard และ safe area จริงใน APK/WebView ก่อนใช้งาน Production; viewport resize บน desktop ไม่ใช่หลักฐานแทนเครื่องจริง
