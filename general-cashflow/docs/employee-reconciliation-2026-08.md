# บันทึกปรับเงินพนักงาน — สิงหาคม 2569

บันทึก11ตุลาคม2569. ชีทคันคลอง/บ้านเจ๊เป็นหลัก; กำไรคือขาย−จ่ายและทิปไม่นับเป็นค่าใช้จ่าย. ไม่แก้ชีทหรือlocked payroll. รายการnativeด้านล่างทำผ่านUIปกติ; sourceแพตช์fee/tips/SSOยังเป็นLocal ไม่push/deploy.

| รายการ | ค่าใช้จ่ายก่อน → หลัง (บาท) | สถานะ / หลักฐาน / audit |
|---|---:|---|
| LINEทิปKK #1103 | 13,700 → 0 | Production; กองทิป/ข้อความ/คู่เอกสารตรงHRMS; #25905 |
| LINEทิปSK #1133 | 8,674 → 0 | Production; กองทิป/สลิป#1143/ข้อความ; #25852 |
| LINEเบิกKK #1105 | 11,000 → 0 | Production; ต้นฉบับตรงHRMSเงินต้น6คน; #25906 |
| LINEเบิกSK #1129 | 12,000 → 0 | Production; ต้นฉบับตรงHRMSเงินต้น7คน; #25907 |
| LINEเบิกผลิต #1131 | 4,000 → 0 | Production; ต้นฉบับตรงHRMSเงินต้น2คน; #25908 |
| PartTimeKK รายจ่ายกรอกเองid3 | 0 → 4,375 | Production; BN36/คำยืนยันแยกนอกHRMS; #25909 |
| จัดSTAFF #2115/#1999/#1101 | ยอดเดิมคงเดิม | Production; #25902–25904 ไม่เพิ่มรายจ่ายซ้ำ |
| ปิดรอบKK1ส.ค./sync | 0 → 59,941 | Production;7รายการรวมเงินเดือน4,257; sync#25901 |
| สะท้อนรอบKK3ส.ค.เปิดที่ต้นทาง | 34,985.56 → 0 ในรายงาน | Sync#25901; เปิดก่อนsync งานนี้ไม่ได้เปิดรอบหรือลบเอกสาร |
| HRMSทิปเป็นเงินผ่าน | 22,374 → 0 | Local; คงfinalizedtip/allocations/netเดิม |
| FeeKKGrab/SCBรายงาน | +2,825 / −10 | Local; ฐานชีทและหลักฐานsettlementตรง ไม่แก้receipt/statement |
| SSOยอดนำส่งจริงแทนรอบHRMS | 50,670 → 52,520 | Localproposal; payrollก.ค./จ่ายส.ค.,วันที่25จากA30/DM30 ยังไม่ยืนยันธนาคารหรือบันทึกProduction |

เงินต้นHRMS27,000คงนับครั้งเดียว. LINE/ขนส่งที่ระบบนับแล้ว13,967ไม่เพิ่มซ้ำ. กำไรProductionล่าสุด1,106,749.99; Localรวมกติกาใหม่1,124,458.99 เทียบชีทหลังแยกKKทิป970,965.855261682 ยังต่าง153,493.134738318. เงินพนักงานเหลือ1,930: กยศ.1,920ที่รอบ30ส.ค.ยังปิดไม่ได้ และค่าแรงSK10ไม่มีรายละเอียด. ช่องว่างรายจ่ายอื่น150,124.03ยังต้องตรวจ ไม่บันทึกยอดชดเชย.

## หลักฐานและการทำต่อ

- SSDรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/employee-aug-reconciliation-20261011-1791714550564/result.md`; ตาราง `adjustment-ledger.csv`, final `comparison-final.json`, ภาพ `local-profit-final.png`/`local-tips-final.png`/`local-sso-final.png`. ข้อมูลรายคน/ต้นฉบับอยู่privateSSD ไม่ใส่ในGit.
- Worktree `/Users/surachart/.codex/worktrees/cashflow-aug-fee-sheet/ระบบสั่งของตลาดสด`, branch `codex/cashflow-aug-fee-sheet`; fee f06874b, tips696c798, รวมverifiedmobile8e0b394ด้วยmerge05e1f07. ก่อนreleaseตรวจProductionidentity/รวมฐานlatestอีกครั้งและขออนุมัติfee+tips+SSOพร้อมกัน.
- SSDrun `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-11T12-54-56-376Z-a65ae995`: server355ผ่าน/skip1เดิม, client57/buildผ่าน. NativeMySQL9.5migration/API/auditrollbackผ่านบนSSD/loopback;ไม่ได้ใช้Production8.4.
- SSOproposal `sso-confirmed-proposal.json`: month2026-08/payroll_month2026-07/payment_date2026-08-25/amount52520.00/หลักฐานnote. หลังอนุมัติreleaseจึงmigrateและบันทึกผ่านnormaladminUI พร้อมauditใหม่และตรวจไม่ซ้ำ. ไม่มีProductionแถวในงานLocalนี้.
- กยศ.สลิป#2237ยังไม่มีบิลคู่ อีกคู่#2239/#2241ยืนยันแล้ว; ปุ่มปิดรอบdisabled. [เปิดรอบ30ส.ค.คันคลอง](https://line-bill-capture-production.up.railway.app/admin?view=day&date=2026-08-30&group=C92c8a7b4a5099db619f6464e10eefab5&bucket=slip&item=2237). ไม่สร้างใบแทนหรือฝืนเช็กผ่าน.
- ชีทอ้างอิง08.69: [คันคลอง](https://docs.google.com/spreadsheets/d/1kvcifyqPzPR9y-YOyLxfjqsaq_3CYvVh15X-1ZkxeOU/edit#gid=1809388051), [บ้านเจ๊](https://docs.google.com/spreadsheets/d/1x6Ep5BxLmF1-mcpZnnXhdW-Lt3H_M5bLW1iuQsvSg7Q/edit#gid=1604204069). ไม่มีSheetwrite.
