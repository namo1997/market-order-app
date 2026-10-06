# การค้นหาโค้ดและการเก็บไฟล์เก่าของระบบตลาดสด

กติกานี้ใช้กับทุกระบบย่อยใน repository ตั้งแต่ 4 ตุลาคม 2026 เพื่อให้ AI อ่านโค้ดและคู่มือปัจจุบันก่อนประวัติหรือผลลัพธ์เก่า การซ่อนจากการค้นหาไม่ใช่สิทธิ์ลบไฟล์ และไม่เปลี่ยน Git tracking หรือขั้นตอน release

## เริ่มอ่านและค้นหาที่ไหน

อ่าน `AGENTS.md` และเฉพาะหัวข้อที่เกี่ยวข้องใน `README.md`/`AI_GUIDE.md` ที่ root แล้วอ่าน `AGENTS.md` ของระบบที่แก้ `CLAUDE.md` ชี้มาที่กติกาชุดเดียวกันสำหรับ Claude. ค้นหาเฉพาะ source/tests/config ที่เกี่ยวข้องด้วย `rg` ซึ่งจะใช้ `.ignore` อัตโนมัติ

```sh
# ระบบสั่งของ
rg 'คำค้น' server/src client/src server/tests

# Bill Capture
rg 'คำค้น' line-bill-capture/src line-bill-capture/public line-bill-capture/mobile-admin-v3/src line-bill-capture/scripts

# Cashflow
rg 'คำค้น' general-cashflow/server/src general-cashflow/client/src general-cashflow/server/test general-cashflow/client/test

# บัญชีบริหาร
rg 'คำค้น' management-accounting/server/src management-accounting/client/src management-accounting/server/test
```

Source ปัจจุบัน, tests, `schema.sql`, migrations, ตัวอย่าง env และแผนที่ยังใช้งานต้องค้นหาได้ตามปกติ ไม่ซ่อนทั้งโฟลเดอร์ scripts หรือ docs เพียงเพราะมีเอกสารเก่าปะปน ห้ามสแกนทั้ง repo ด้วย `rg --hidden --no-ignore` หรือเปิดทุก archive เพื่อเริ่มงาน

หากต้องตรวจประวัติ ให้ใช้วันที่และหัวข้อจาก [ดัชนี archive](../archive/README.md) แล้วเปิดไฟล์ที่ระบุโดยตรง หรือใช้ `rg --no-ignore 'คำค้น' <exact-file-or-small-directory>` เฉพาะขอบเขตนั้น ห้ามนำผลผ่านหรือสถานะ Production จากรายงานเก่ามารับรองงานปัจจุบัน

## ตำแหน่งไฟล์แต่ละประเภท

| ประเภท | ตำแหน่งและกติกา |
| --- | --- |
| Source/tests/config และคู่มือปัจจุบัน | อยู่ในระบบเจ้าของไฟล์ตามเดิม และปรับ references เมื่อย้าย |
| สคริปต์เฉพาะกิจที่จบงานแล้ว | `archive/one-off/` พร้อมดัชนีและข้อจำกัดก่อนนำกลับมาใช้ |
| Checklist/รายงานสถานะเก่าที่เป็น source document | `docs/archive/<date-or-topic>/` พร้อมดัชนี |
| Mockup ที่ไม่ได้ serve ในแอป | `<service>/docs/archive/mockups/` เก็บเพื่ออ้างอิงการออกแบบ |
| ผลทดสอบ/build, screenshots, traces, generated reports, DB copies และ backup ใหม่ | SSD ที่ตรวจแล้วเท่านั้น ตาม `/Users/surachart/.solao-tools/SSD_POLICY.md` |
| Backup/หลักฐาน/ผลลัพธ์ที่มีอยู่บน Mac | ข้ามในการค้นหาปกติ คง path และข้อมูลเดิมไว้จนมีงานย้ายที่ตรวจ checksum และผลกระทบแล้ว |

ห้ามสร้าง scratch script, dump, log หรือผลทดสอบใหม่ที่ root, `tmp/`, `output/`, `outputs/` บน Mac งานเฉพาะกิจใหม่ให้สร้างในพื้นที่งานบน SSD ส่วนเครื่องมือ source ที่จะดูแลต่อให้เพิ่มใต้ scripts ของระบบเจ้าของและอธิบายวิธีใช้

`archive/` ใน repo ใช้เก็บ source document/code เก่าเท่านั้น ไม่ใช่ที่เก็บสำเนาฐานข้อมูล รูปบิล วิดีโอส่งมอบ หรือไฟล์แนบใหญ่ ชุดดังกล่าวต้องเก็บและย้ายตามกติกา SSD

## รักษาสถานะนี้เมื่อทำงานต่อ

1. ก่อนเพิ่มไฟล์ ให้เลือกประเภทและเจ้าของไฟล์ หากเป็น generated data/output ให้ตรวจ SSD และใช้ตัวรันกลางก่อนเขียน
2. เมื่อจบงานเฉพาะกิจ ให้เก็บ source ที่จำเป็นใน archive อัปเดตดัชนี ระบุวันที่/เหตุผล/เดิมอยู่ที่ไหน และแก้ links/imports ที่ได้รับผล อย่าย้ายแผนที่ยังใช้งานเพียงเพราะชื่อเก่า
3. เมื่อเพิ่มโฟลเดอร์ artifacts ใหม่ ให้อัปเดต `.ignore`; ถ้าไม่ควร track ใน Git ให้เพิ่ม `.gitignore` ด้วย โดยไม่ซ่อน source/tests ที่ยังต้องดูแล
4. ตรวจ `rg --files` ว่าไม่รวม archive/results/DB copies และยังมี source/tests/schema/migrations ที่เกี่ยวข้อง ตรวจ diff เฉพาะชุดงานก่อนส่งต่อ
5. การค้นหาไม่ใช่การ deploy อย่าสรุปว่า `.ignore` กันไฟล์จาก Railway/Docker แล้ว ต้องตรวจ release scope และ config ของ service แยกตาม workflow เดิม

ไม่ลบ `.git`, backup, raw evidence, patch ที่ยังไม่รวม หรือ archive ทั้งโฟลเดอร์โดยอัตโนมัติ การคัดออกต้องตรวจผู้ใช้งานไฟล์ ความครบของสำเนา และขอบเขตที่ผู้ใช้อนุมัติ

## ตรวจขอบเขตการค้นหา

รัน `node scripts/check-repository-hygiene.mjs` หลังจัดไฟล์หรือแก้ ignore rules ตัวตรวจอ่านรายการ `rg --files --hidden` ตามกติกาปัจจุบัน ยืนยันว่า source/tests/schema/migrations/env examples และ active plan ตัวแทนยังมองเห็น ผลลัพธ์/archive ถูกข้าม และ links ในดัชนี archive ยังเปิดได้ ไม่รัน build, เชื่อม DB หรือสร้าง fixture. ตรวจนี้ครอบคลุมการค้นหาตามรายการที่กำหนด ไม่ใช่การตรวจทุก import หรือการรับรอง Production

ไฟล์ `.ignore` ไม่ทำให้ทุก AI tool เคารพกติกาเอง เครื่องมือที่อ่าน filesystem โดยตรงหรือใช้ `--no-ignore` ยังเปิดไฟล์เหล่านี้ได้ จึงต้องปฏิบัติตาม `AGENTS.md` ด้วย
