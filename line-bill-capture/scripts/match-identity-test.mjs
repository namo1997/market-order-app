// ทดสอบการให้คะแนนชื่อร้าน/ผู้รับเงิน จากกรณีจริงที่ AI ให้คะแนนต่ำในเดือน ต.ค. 2569
// (คู่ที่คนยืนยันแล้วทั้งหมด) ดูรายงาน reports/oct2569-dot-low-score.md บน SSD
import assert from 'node:assert/strict';
import { buildLearnedRecipientPairs, scoreSequencePair } from '../src/ai-worker.js';

const config = { amountTolerance: 5, percentTolerance: 0.02, maxMatchHours: 48, requireSameSource: true, sourceFallbacks: {} };
const t0 = Date.parse('2026-10-10T10:00:00+07:00');
const hour = 60 * 60 * 1000;
const bill = (over) => ({ id: 1, category: 'bill', source_id: 'G1', sender_user_id: 'buyer', event_timestamp_ms: t0, ai_confidence: 0.98, ...over });
const slip = (over) => ({ id: 2, category: 'transfer', source_id: 'G1', sender_user_id: 'payer', event_timestamp_ms: t0 + 1.5 * hour, ai_confidence: 0.99, payment_role: 'ordinary_payment', ...over });

// 1) บัญชีตลาด 7193 สำรองจ่ายแล้วโอนคืน (นพดลพานิช #4423 → #4445)
const refund = scoreSequencePair({
  bill: bill({ vendor_name: 'บริษัท นพดลพานิช จำกัด', bill_purpose: 'วัสดุต่อเติมชั้น 2', bill_total_value: 1161, ai_summary: 'เอกสารวัสดุต่อเติมชั้น 2 ยอด 1,161 บาท' }),
  slip: slip({ slip_amount_value: 1161, ai_raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ไปยัง น.ส.ศิริลักษณ์ เวียงแสง xxx-x-x7193-x จำนวน 1,161 บาท' }),
  config
});
assert.ok(refund, 'คู่โอนคืนบัญชีตลาดต้องถูกเสนอ');
assert.equal(refund.identityConflict, false, 'โอนคืนบัญชีตลาด 7193 ยอดตรง ต้องไม่ถือว่าชื่อขัดแย้ง');
assert.ok(refund.identityConfirmed);
assert.ok(refund.reasons.some((r) => /โอนคืนบัญชีตลาด/.test(r)));
assert.ok(refund.score >= 80, `คะแนนโอนคืนบัญชีตลาดควรสูงขึ้น ได้ ${refund.score}`);

// ยอดไม่ตรงต้องไม่ได้สิทธิ์นี้
const refundOff = scoreSequencePair({
  bill: bill({ vendor_name: 'บริษัท นพดลพานิช จำกัด', bill_total_value: 1161 }),
  slip: slip({ slip_amount_value: 1180, ai_raw_text: 'โอนเงินสำเร็จ ไปยัง น.ส.ศิริลักษณ์ เวียงแสง x7193 จำนวน 1,180 บาท' }),
  config
});
assert.ok(!refundOff || refundOff.identityConflict, 'ยอดไม่ตรงห้ามถือว่าเป็นการโอนคืนบัญชีตลาด');

// นามสกุล "เวียงแสง" อย่างเดียวไม่ใช่บัญชีตลาด (ร้านดอกไม้ #4371 → นาง นิตยา เวียงแสง)
const flower = scoreSequencePair({
  bill: bill({ vendor_name: 'ดอกไม้', bill_total_value: 450 }),
  slip: slip({ slip_amount_value: 450, ai_raw_text: 'โอนเงินสำเร็จ ไปยัง นาง นิตยา เวียงแสง จำนวน 450 บาท' }),
  config
});
assert.equal(flower.reasons.some((r) => /บัญชีตลาด/.test(r)), false, 'นิตยา เวียงแสง ต้องไม่ถูกนับเป็นบัญชีตลาด');

// 2) จำคู่ร้าน → ผู้รับ จากคู่ที่ยืนยันแล้ว (ชัยสแตนเลส → อรรัมภา)
const chaiBill = bill({ vendor_name: 'ร้านชัยสแตนเลส สังกะสี', bill_total_value: 2350 });
const chaiSlip = slip({ slip_amount_value: 2350, ai_raw_text: 'โอนเงินสำเร็จ ไปยัง น.ส. อรรัมภา อินพร ธนาคารกสิกรไทย จำนวน 2,350 บาท' });
const beforeLearning = scoreSequencePair({ bill: chaiBill, slip: chaiSlip, config });
assert.equal(beforeLearning.identityConflict, true, 'ก่อนเรียนรู้ ชื่อร้านกับผู้รับต่างกันต้องยังแสดงความเสี่ยง');
const learnedRecipients = buildLearnedRecipientPairs([
  { billName: 'ร้านชัยสแตนเลส สังกะสี', slip: { ai_raw_text: 'โอนเงินสำเร็จ ไปยัง น.ส. อรรัมภา อินพร ธนาคารกสิกรไทย จำนวน 1,200 บาท' } },
  { billName: 'ห้างหุ้นส่วนจำกัด [ชื่อร้านอ่านไม่ชัด]', slip: { ai_raw_text: 'โอนเงินสำเร็จ ไปยัง นาง กิ่งแก้ว ภูพันธ์ใบ จำนวน 100 บาท' } }
]);
assert.equal(learnedRecipients.size, 1, 'ชื่อร้านที่อ่านไม่ชัดต้องไม่ถูกจำ');
const afterLearning = scoreSequencePair({ bill: chaiBill, slip: chaiSlip, config: { ...config, learnedRecipients } });
assert.equal(afterLearning.identityConflict, false, 'คู่ร้าน→ผู้รับที่เคยยืนยันต้องไม่ถือว่าขัดแย้ง');
assert.ok(afterLearning.score > beforeLearning.score);
assert.ok(afterLearning.reasons.some((r) => /เคยยืนยันแล้ว/.test(r)));
// ผู้รับคนอื่นยังต้องขัดแย้งตามเดิม
const otherRecipient = scoreSequencePair({
  bill: chaiBill,
  slip: { ...chaiSlip, ai_raw_text: 'โอนเงินสำเร็จ ไปยัง นาย สมชาย ใจดี จำนวน 2,350 บาท' },
  config: { ...config, learnedRecipients }
});
assert.equal(otherRecipient.identityConflict, true, 'ผู้รับที่ไม่เคยยืนยันต้องยังแสดงความเสี่ยง');

// 3) TikTok Shop (YYshop #4591 → #4609) และสลิป Shopee ที่บิลไม่บอกช่องทาง (TNW #4667 → #4685)
const tiktok = scoreSequencePair({
  bill: bill({ vendor_name: 'YYshop Thailand', bill_purpose: 'TikTok Shop - ถังขยะตั้งโต๊ะ', bill_total_value: 662.89 }),
  slip: slip({ slip_amount_value: 662.89, ai_raw_text: 'ชำระบิลสำเร็จ ไปยัง โอมิเซะ - ติ๊กต๊อกช็อป Biller จำนวน 662.89 บาท' }),
  config
});
assert.equal(tiktok.identityConflict, false, 'บิลและสลิป TikTok Shop ต้องไม่ขัดแย้ง');
assert.ok(tiktok.reasons.some((r) => /ช่องทางตรงกัน: TikTok Shop/.test(r)));
const shopeeUnknownBill = scoreSequencePair({
  bill: bill({ vendor_name: 'TNW Official Store', bill_purpose: 'ลำโพงเรียกคิว', bill_total_value: 576 }),
  slip: slip({ slip_amount_value: 576, ai_raw_text: 'ชำระเงินสำเร็จ ไปยัง Payment to Shopee Biller จำนวน 576 บาท' }),
  config
});
assert.equal(shopeeUnknownBill.identityConflict, false, 'สลิปจ่ายแพลตฟอร์ม เมื่อบิลไม่บอกช่องทาง ต้องไม่ถือว่าชื่อขัดแย้ง');
const lazadaVsShopee = scoreSequencePair({
  bill: bill({ vendor_name: 'ร้าน A', bill_purpose: 'Lazada - แก้วน้ำ', bill_total_value: 300 }),
  slip: slip({ slip_amount_value: 300, ai_raw_text: 'ชำระเงินสำเร็จ ไปยัง Shopee จำนวน 300 บาท' }),
  config
});
assert.equal(lazadaVsShopee.identityConflict, true, 'ช่องทางต่างกันต้องยังขัดแย้ง');

// 4) ชื่อขัดแย้งแต่ยอดตรง กลุ่มเดียวกัน ห่าง ≤ 6 ชม. หักเบาลง แต่ยังต่ำกว่าเกณฑ์มั่นใจสูง 90
assert.equal(beforeLearning.scoreBreakdown.identityPenalty, -15);
assert.ok(beforeLearning.score < 90, 'คู่ที่ชื่อขัดแย้งต้องยังต่ำกว่าเกณฑ์มั่นใจสูง');
const sameSenderConflict = scoreSequencePair({ bill: chaiBill, slip: { ...chaiSlip, sender_user_id: 'buyer', event_timestamp_ms: t0 }, config });
assert.ok(sameSenderConflict.score < 90, `คะแนนสูงสุดเมื่อชื่อขัดแย้งต้อง < 90 ได้ ${sameSenderConflict.score}`);
const farConflict = scoreSequencePair({ bill: chaiBill, slip: { ...chaiSlip, event_timestamp_ms: t0 + 20 * hour }, config });
assert.equal(farConflict?.scoreBreakdown.identityPenalty ?? -40, -40, 'ห่างเกิน 6 ชม. ต้องหักเต็มเหมือนเดิม');

console.log('match identity test passed');
