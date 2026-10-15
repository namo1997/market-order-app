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

ทั้ง foreground และ background เป็นสี่เหลี่ยมเต็มกรอบ **ไม่ใส่ rounded mask ลงไฟล์** launcher เป็นผู้ตัดรูป foreground ใช้ภาพอยู่ในกรอบกลาง 410×410 บน master 1024px ซึ่งอยู่ในวงปลอดภัย 66/108 ของ canvas; เว้นพื้นที่เผื่อเอฟเฟกต์ launcher ส่วน legacy ใช้พื้นที่มากกว่าเพื่อให้อ่านออกที่ 48px

Splash master วางแผ่นกลาง 768×768px ที่พิกัด `(982,982)` บนภาพ 2732px เนื้อเครื่องหมายไม่เกิน 560×560px ไม่ฝังชื่อแอปหรือข้อความบน splash เพื่อหลีกเลี่ยงการถูกครอป เมื่อใช้เต็มจอให้รักษาจุดศูนย์กลางและตรวจ safe area บนอุปกรณ์จริง Android 12+ ใช้ native splash API กับ `splash_icon.png` แทนการเอาภาพเต็ม 2732px ไปใส่ช่อง icon

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

alt ที่เสนอเมื่อแสดงเป็นภาพในเว็บ: “สัญลักษณ์แอปรับสินค้า โซลาว ลังวัตถุดิบและใบส่งของ” หากชื่อแอปอยู่ข้างภาพแล้วให้ใช้ alt ว่าง ไอคอนแอปไม่ได้ใช้เป็นเครื่องหมายรับของสำเร็จ สีเขียวและเช็กจึงไม่อยู่ในโลโก้

ต้นฉบับเครื่องมือสร้างภาพอยู่ใน SSD `reports/receiving-illustrations/raw/app-icon.png` และไฟล์ส่งต่อขนาด 1024 อยู่ในโฟลเดอร์นี้ ข้อจำกัดสำเนาภายในที่เครื่องมือสร้างชั่วคราวระบุในรายงานบน SSD
