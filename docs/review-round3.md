# ผลตรวจรอบ 3 (Claude, 15 ต.ค. 2569) — commit 0ac5eb4..6f99b79

ผลเทสต์บน SSD: **97 / 97 pass, 0 fail, 0 skip** รัน 2 รอบผลเท่ากัน (log: `/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-review-round3/test-run-{1,2}.log`) · ไม่มี `.skip/.only/todo`
**ผ่านด่าน server** — ไม่มี Critical/High ค้าง

## สถานะ R2
| # | ผล | หลักฐาน |
|---|---|---|
| R2-1 prompt OCR | ✅ | prompt เต็ม + `response_format: json_schema` + กฎ พ.ศ./หลายหน้า/ข้อมูลเท่านั้น; เทสต์ "OCR prompt & JSON schema include all required fields" |
| R2-2 alias | ✅ | ตัดสินใน JS ใต้ `SELECT … FOR UPDATE`; admin override, ผู้ใช้ต่างกัน ≥3 คน, ไม่เรียนรู้ supplier `none`, ตาราง `supplier_product_alias_events` |
| R2-3 OCR ค้าง pending | ✅ | try ครอบหลัง claim + reclaim เมื่อเกิน 2 นาที; เทสต์ stale pending |
| R2-4 ไม่ ALTER ตารางเดิม | ✅ | เทสต์ "NEVER alters existing tables"; จำนวน 2 ตำแหน่ง |
| R2-5 void/ตารางยังไม่มี | ✅ | 503 `RECEIVING_NOT_READY` |
| R2-6 รับสะสม 2 บิล | ✅ | เทสต์ cumulative 2-bill + ข้ามบรรทัด qty 0 |
| R2-7 void คืน quantity/notes | ✅ | prev columns + เทสต์ |
| R2-8..R2-12 | ✅ | validate multiplier/confidence, clamp line_no, 429 RATE_LIMITED + ล้าง bucket, JSON เสีย 422, order ยกเลิก/เพดานบรรทัด |
| เทสต์ที่ขาด (404/409/rollback void/Promise.all client_uuid/ข้อ 3,5,7,13,14) | ✅ | อยู่ในเทสต์รวม 12 ชุด |

## ค้าง (Low — ไม่บล็อก แต่ต้องทำก่อนขึ้น Production)
| # | ที่ | เรื่อง |
|---|---|---|
| R3-1 | `receiving-documents-settlement.js` 1022, `receiving-ocr.service.js` 950, `receiving-documents.model.js` 918 บรรทัด | เกิน ~800 ตาม AGENTS.md §5 → แยก module (alias-learning, rate-limit, prompt/schema) |
| R3-2 | `server/tests/receiving-documents.test.mjs` | เทสต์รวมเป็นชุดใหญ่ 12 ชุด — ล้มแล้วหาสาเหตุยาก ควรแยกเป็น test ย่อยต่อกรณี |
| R3-3 | fake DB | พิสูจน์ตรรกะได้ แต่ lock/unique/DECIMAL ต้องยืนยันกับ **MySQL จริงบน SSD** (ทำในขั้นทดสอบเอกสารจริง) |
| R3-4 | rate limit | ยังอยู่ในหน่วยความจำ process เดียว (หลาย replica จะนับแยก) — Production ปัจจุบัน 1 replica ยอมรับได้ ระบุในความเสี่ยง |

## ขั้นต่อไป
1. client: หน้ารับสินค้าใหม่ครบ flow (สร้างเอกสาร → ถ่ายบิล → OCR → แก้บรรทัด → เซ็น → ยืนยัน) — ยังไม่มีใน `client/src`
2. ทดสอบบิลจริง ≥20 ใบกับ MySQL จริงบน SSD
3. เชื่อมผลยืนยันรับของเข้า AP ledger (`cashflow/ap-ledger-v0`) ตาม `docs/receiving-accounting.md`
