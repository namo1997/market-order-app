# Monthly Daily Sheet Sync

This directory is the local source of truth for the bound Google Apps Script project used by the
monthly General Cashflow spreadsheet. The Apps Script project ID is stored in `.clasp.json`; OAuth
credentials are stored by `clasp` outside this repository and must not be committed.

```bash
npm install
npm run pull
npm run status
npm run push
```

Run `npm run pull` before editing, review `npm run status`, then use `npm run push` to publish source
changes to Apps Script. Do not use `clasp push --force` without reviewing the remote project first.

## เชื่อม Gmail เข้าระบบรับเงิน

โปรเจกต์เดียวกันนี้นำเข้าอีเมล Krungsri Biz Mung-Mee, Grab, K SHOP, SCB Business Anywhere และ
Krungthai Business เข้า General Cashflow ได้ โดย token จะเก็บใน Apps Script Script Properties
และไม่อยู่ในไฟล์ซอร์ส

1. เปิด Apps Script > Project Settings > Script Properties
2. เพิ่ม property `CASHFLOW_GMAIL_INBOX_TOKEN` ให้ตรงกับค่าเดียวกันบน Railway
3. รัน `testGeneralCashflowServerConnection` เพื่อตรวจว่า Railway ตอบสนอง
4. รัน `importAllGeneralCashflowInboxReports` เพื่อทดลองนำเข้า
5. รัน `installGeneralCashflowInboxTrigger` เพียงครั้งเดียว เพื่อตรวจ Gmail ทุก 5 นาที

ใน Google Sheet สามารถใช้เมนู `General Cashflow` เพื่อสั่งนำเข้าและติดตั้ง trigger ได้เช่นกัน
