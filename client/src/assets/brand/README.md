# ไอคอนแอปและ splash รับสินค้า โซลาว

สัญลักษณ์ลังรับของ ใบส่งของ และลูกศรรับเข้า สร้างด้วย image generation ต้นฉบับเดียวกับชุดภาพประกอบ ไม่มีตัวหนังสือหรือโลโก้ภายนอก สี navy `#1E3168`, gold `#C8941C`, cream `#F7F5F0` ตามทิศทางแบรนด์ มีเฉดแปรผันเล็กน้อยใน raster ชื่อแอป “รับสินค้า โซลาว” ให้กำหนดเป็น Android label ในรอบเชื่อม native

## ไฟล์

| ไฟล์/กลุ่ม | ขนาด px | การใช้งาน |
| --- | --- | --- |
| `app-icon-1024.png` | 1024×1024 | ภาพไอคอนเต็มพื้น cream สำหรับต้นฉบับส่งต่อ ไม่ใช่ adaptive foreground |
| `adaptive-foreground-1024.png` | 1024×1024 RGBA | foreground โปร่งใส ตัวภาพอยู่กลางกรอบและอยู่ในวงปลอดภัย |
| `adaptive-background-1024.png` | 1024×1024 RGB | background cream ทึบ เต็มกรอบ |
| `android/mipmap-{density}/ic_launcher.png` | 48 / 72 / 96 / 144 / 192 | legacy launcher mdpi / hdpi / xhdpi / xxhdpi / xxxhdpi |
| `android/mipmap-{density}/ic_launcher_foreground.png` | 108 / 162 / 216 / 324 / 432 | adaptive foreground 108dp |
| `android/mipmap-{density}/ic_launcher_background.png` | 108 / 162 / 216 / 324 / 432 | adaptive background 108dp เต็มกรอบ |
| `android/drawable-{density}/splash_icon.png` | 288 / 432 / 576 / 864 / 1152 | Android 12 splash icon กรอบ 288dp เนื้อภาพอยู่ในวงกลาง 192dp |
| `android/drawable-night-{density}/splash_icon.png` | 288 / 432 / 576 / 864 / 1152 | รุ่นมืดพร้อมวง cream 188dp อยู่ในวงปลอดภัย 192dp |
| `splash-light-2732.png` | 2732×2732 | splash เต็มจอพื้น cream เนื้อภาพอยู่กลาง |
| `splash-dark-2732.png` | 2732×2732 | splash เต็มจอพื้น `#101522` พร้อมแผ่น cream กลางภาพ |
| `splash-light-1080x2400.png` / `splash-dark-1080x2400.png` | 1080×2400 | splash แนวตั้งอัตราส่วน 360×800 ที่ 3x ใช้เป็นต้นฉบับเต็มจอสำหรับอัตราส่วนนี้ |

ทั้ง foreground และ background เป็นสี่เหลี่ยมเต็มกรอบ **ไม่ใส่ rounded mask ลงไฟล์** launcher เป็นผู้ตัดรูป รอบ 2 ขยายสัญลักษณ์เดิมจากกว้าง 410 เป็น 517px ใน master 1024px โดยจัดตำแหน่งตามรูปทรงจริงให้พิกเซลที่มองเห็นอยู่ในวงกลางประมาณ 63.5dp ภายใน safe circle 66dp ของ canvas 108dp ไม่ได้ออกแบบเครื่องหมายใหม่หรือบังคับให้กรอบสี่เหลี่ยมของรูปต้องอยู่ในวงทั้งหมด ไฟล์ legacy และ background คงเดิม

Splash master 2732px รอบ 2 มีเครื่องหมายกว้าง 850px รุ่นมืดมีแผ่น cream เส้นผ่านศูนย์กลาง 1100px เมื่อปรับตาม **ความกว้าง** เป็น 360px เครื่องหมายกว้างประมาณ 112px ให้จัดกลางและเติมพื้นที่ด้านบน/ล่างด้วยสีพื้นของธีม ห้ามใช้ `cover` กับ master สี่เหลี่ยมบนจอยาวเพราะขนาดเครื่องหมายจะเปลี่ยน

สำหรับจอ 360×800 ใช้ไฟล์แนวตั้ง 1080×2400 โดยตรง: เครื่องหมายกว้าง 336px ที่ 3x หรือ 112px บนจอจริง แผ่น cream รุ่นมืดกว้างประมาณ 145px ไม่ใช่ขนาดเครื่องหมาย ไม่มีชื่อแอปหรือข้อความในภาพ หลักฐาน `splash-fullscreen-{light,dark}-360x800-r2.png` ลดจากไฟล์แนวตั้งเหล่านี้จริง

Android 12+ ใช้ native splash API กับ `splash_icon.png` แยกจากภาพเต็มจอ: คงกรอบ 288dp / เครื่องหมาย 128dp / วง cream รุ่นมืด 188dp ภายในวงปลอดภัย 192dp ของเดิมไว้ ตรวจทุก density แล้ว ไม่ขยาย native icon ตามอัตราของ full-screen splash

## วิธีต่อ Android ในรอบถัดไป

รอบนี้ยังไม่มีการแก้ Android resources, manifest, Capacitor หรือธีม ให้คัดลอกเฉพาะเมื่อมีคำสั่งรวมงานและตรวจชื่อ resource ชนกับของเดิมก่อน

1. นำ `android/mipmap-*`, `drawable-*` รวม `drawable-night-*` ไปไว้ใน `app/src/main/res/` ของ native project ที่ยืนยันแล้ว
2. สร้าง `res/mipmap-anydpi-v26/ic_launcher.xml` สำหรับ adaptive icon อ้างสอง layer:

```xml
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
```

3. ผูก `android:icon`/round icon ตาม config เดิมของ native project; Android รุ่นเก่าใช้ `ic_launcher.png` ตาม density
4. ธีม Android 12+ ใช้ `windowSplashScreenAnimatedIcon` อ้าง `@drawable/splash_icon`; พื้น light เป็น cream, พื้น night เป็น `#101522` ไฟล์ที่ให้มาเตรียมตาม mode ไม่มี system icon background เพิ่ม โดยรุ่น night มีวง cream อยู่ใน PNG แล้ว
5. Android เลือก `drawable-night-*` เมื่อใช้ธีม night จึงมี cream รองรับเครื่องหมาย navy โดยอัตโนมัติ ตรวจให้ธีมใช้ night จริงตามโหมดแอป สำหรับ full-screen splash ใช้ไฟล์ dark ที่เตรียมให้ได้
6. ตรวจ launcher แบบวงกลม/squircle, Android รุ่นก่อน/หลัง 12, orientation, center crop และ theme บน APK จริง งานนี้ตรวจเฉพาะไฟล์และภาพ proof

หลักฐานรอบ 2 บน SSD: `icon-masks-48px-light-r2.png` / `icon-masks-48px-dark-r2.png` แสดงวงกลมและสี่เหลี่ยมมนที่ 48px จริง พร้อมภาพขยาย 3x แบบ nearest-neighbor โดยจำลอง viewport กลาง 72dp ของ adaptive layer 108dp ก่อนตัด mask; ไฟล์ 48×48 แยกและ native splash 288dp ทั้งสองธีมอยู่ใน `r2-proof/` ภาพเหล่านี้เป็นการประกอบตรวจ assets ไม่ใช่ screenshot ของ launcher/Android จริง

alt ที่เสนอเมื่อแสดงเป็นภาพในเว็บ: “สัญลักษณ์แอปรับสินค้า โซลาว ลังวัตถุดิบและใบส่งของ” หากชื่อแอปอยู่ข้างภาพแล้วให้ใช้ alt ว่าง ไอคอนแอปไม่ได้ใช้เป็นเครื่องหมายรับของสำเร็จ สีเขียวและเช็กจึงไม่อยู่ในโลโก้

ต้นฉบับเครื่องมือสร้างภาพอยู่ใน SSD `reports/receiving-illustrations/raw/app-icon.png` และไฟล์ส่งต่อขนาด 1024 อยู่ในโฟลเดอร์นี้ ข้อจำกัดสำเนาภายในที่เครื่องมือสร้างชั่วคราวระบุในรายงานบน SSD
