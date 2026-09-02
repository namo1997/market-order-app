import {
  applyDeterministicChatRules,
  isDailyMarketSheetVisual,
  isMarketAccountReimbursement,
  marketAnnouncementFromText,
  preserveKnownTransferFromMarketContext,
  resolveContextSenderId,
  scoreSequencePair,
  selectBillAnnouncementContext,
  selectNearestTypedContext
} from '../src/ai-worker.js';
import {
  extractCpAxtraBillReference,
  extractCpAxtraSlipReference
} from '../src/cp-axtra.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const market = applyDeterministicChatRules({
  category: 'other',
  confidence: 0.9,
  category_confidence: 0.9,
  raw_text: 'ตลาดวันที่ 10/7/2569 รวม 52 รายการ ตารางสรุปรายการสินค้า',
  evidence: []
}, [{ text: 'ตลาด 10/7/69\nรับ 30,000.-\nจ่าย 8,041.-\nทอน 21,959.-\nเงินในบัญชีขาดเกิน +5.-\nโอนเพิ่ม 8,036.- บาท' }]);
assert(market.category === 'bill', 'Market sheet must be a bill');
assert(market.bill_total_value === 8041, 'Market bill must retain the actual spend');
assert(market.announced_amount === 8036, 'Market bill must match the adjusted transfer amount');

const marketChat = [{ text: 'ตลาด 11/7/69\nรับ 30,000.-\nจ่าย 8,975.-\nทอน 21,025.-\nเงินในบัญชีขาดเกิน +26.-\nโอนเพิ่ม 8,949.- บาท' }];
const actualMarketSheet = {
  category: 'bill',
  raw_text: 'ตลาดสด 11/7/2569; รวม 57 รายการ; รับ 30,000.-; จ่าย 8,975.-; ทอน 21,025.-; เงินในบัญชีขาดเกิน +26.-',
  evidence: []
};
assert(isDailyMarketSheetVisual(actualMarketSheet), 'Daily market sheet structure must be recognized');
const correctedActualMarket = applyDeterministicChatRules(actualMarketSheet, marketChat);
assert(correctedActualMarket.bill_total_value === 8975, '11 July market sheet must use the spend amount');
assert(correctedActualMarket.announced_amount === 8949, '11 July market sheet must use the adjusted transfer amount');

const fuelBill = applyDeterministicChatRules({
  category: 'bill',
  bill_total_value: 2000,
  bill_purpose: 'ค่าน้ำมันรถตลาด',
  raw_text: 'BANGCHAK ใบเสร็จรับเงิน H DIESEL 56.038L รวมเป็นเงิน 2,000.00 บริษัท โซลาว จำกัด',
  summary: 'บิลค่าน้ำมันรถตลาดจากบางจาก ยอดรวม 2,000 บาท',
  evidence: []
}, marketChat);
assert(!isDailyMarketSheetVisual(fuelBill), 'Fuel receipt containing the word market must not be a market sheet');
assert(fuelBill.bill_total_value === 2000 && fuelBill.bill_purpose === 'ค่าน้ำมันรถตลาด', 'Nearby market chat must not overwrite the fuel bill');

const makroPage = applyDeterministicChatRules({
  category: 'bill_page',
  raw_text: 'makro ใบส่งของ/ใบกำกับภาษี/ใบเสร็จรับเงิน หน้าที่ 2 จาก 3 รายการสินค้า มีต่อหน้า 3',
  summary: 'ใบกำกับภาษี Makro หน้าที่ 2 จาก 3 แสดงรายการสินค้า',
  evidence: []
}, marketChat);
assert(!isDailyMarketSheetVisual(makroPage), 'Makro item pages must not be treated as a market sheet');
assert(makroPage.category === 'bill_page' && !makroPage.bill_total_value, 'Nearby market chat must not overwrite a Makro continuation page');

const fuelBillTime = Date.parse('2026-07-11T19:04:26+07:00');
const fuelSlipTime = Date.parse('2026-07-11T19:37:39+07:00');
const fuelContext = [
  { text: '@Jum ค่าน้ำมันรถตลาด ยอด 2,000.-นะคะ', event_timestamp_ms: fuelBillTime + 32_000, sender_user_id: 'J' },
  { text: 'ตลาด 11/7/69 รับ 30,000 จ่าย 8,975 โอนเพิ่ม 8,949', event_timestamp_ms: fuelBillTime + 3 * 60_000, sender_user_id: 'J' }
];
const fuelReimbursement = applyDeterministicChatRules({
  category: 'transfer',
  slip_amount_value: 2000,
  raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ไปยัง น.ส.ศิริลักษณ์ เวียงแสง XXX-X-X7193-X จำนวนเงิน 2,000.00 บาท',
  summary: 'สลิปโอนเงินสำเร็จจาก บจก. โซลาว จำนวน 2,000 บาท',
  evidence: []
}, [], { item: { event_timestamp_ms: fuelSlipTime }, conversationContext: fuelContext });
assert(fuelReimbursement.payment_role === 'reimbursement', 'Fuel repayment to the market account must be reimbursement');
assert(/ค่าน้ำมันรถตลาด/.test(fuelReimbursement.bill_purpose), 'Fuel reimbursement must retain its chat purpose');
assert(/บัญชีตลาดสำรองจ่าย/.test(fuelReimbursement.summary), 'Fuel reimbursement summary must explain who paid first');
assert(isMarketAccountReimbursement(fuelReimbursement), 'Fuel transfer must satisfy the guarded market-account reimbursement predicate');
const dailyMarketTransfer = applyDeterministicChatRules({
  category: 'transfer',
  slip_amount_value: 8949,
  payment_role: 'ordinary_payment',
  raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ไปยัง น.ส.ศิริลักษณ์ เวียงแสง XXX-X-X7193-X จำนวนเงิน 8,949.00 บาท',
  summary: 'สลิปโอนเงินเข้าบัญชีตลาด 8,949 บาท',
  evidence: []
}, [], { item: { event_timestamp_ms: fuelSlipTime + 3 * 60_000 }, conversationContext: fuelContext });
assert(dailyMarketTransfer.payment_role === 'ordinary_payment', 'Daily market top-up must not become an expense reimbursement');

const protectedSlip = preserveKnownTransferFromMarketContext({
  category: 'bill',
  bill_total_value: 8949,
  bill_purpose: 'บิลตลาด 11/7/69',
  summary: 'บิลตลาดจากข้อความใกล้รูป'
}, {
  category: 'transfer',
  slip_amount_text: '2,000.00',
  slip_amount_value: 2000,
  ai_summary: 'สลิปโอนเงินสำเร็จ 2,000 บาท'
});
assert(protectedSlip.category === 'transfer', 'A known transfer must not become a market bill from nearby chat');
assert(protectedSlip.slip_amount_value === 2000 && protectedSlip.bill_total_value === null, 'Protected transfer must retain only its slip amount');

const shopee = applyDeterministicChatRules({
  category: 'other',
  confidence: 0.99,
  category_confidence: 0.99,
  vendor_name: 'LongBeach Syrup',
  raw_text: 'รายละเอียดคำสั่งซื้อ; ชำระเงินภายใน 23:59:48; ร้านแนะนำ LongBeach Syrup; รวมคำสั่งซื้อ ฿496; หมายเลขคำสั่งซื้อ 260710B39WGA96; ยอดชำระเงิน ฿496',
  evidence: []
}, []);
assert(shopee.category === 'bill', 'Shopee order detail must be a bill');
assert(shopee.bill_total_value === 496, 'Shopee bill must use the final order amount');
assert(/^Shopee/.test(shopee.bill_purpose), 'Shopee bill purpose must support channel matching');

const lazada = applyDeterministicChatRules({
  category: 'other',
  confidence: 0.95,
  category_confidence: 0.95,
  vendor_name: 'pw639shop',
  raw_text: 'Lazada รายละเอียดคำสั่งซื้อ ร้าน pw639shop หมายเลขคำสั่งซื้อ LAZ-123 รวมคำสั่งซื้อ ฿2,970',
  evidence: []
}, []);
assert(lazada.category === 'bill' && lazada.bill_total_value === 2970, 'Lazada order detail must remain a bill');
assert(/^Lazada/.test(lazada.bill_purpose), 'Lazada must not be mislabeled as Shopee');

const voucher = applyDeterministicChatRules({
  category: 'other', raw_text: 'ใบสำคัญจ่าย PAYMENT VOUCHER วันที่ 9.9.69 รวม 1,904', evidence: []
}, []);
assert(voucher.category === 'bill', 'Payment vouchers must enter the bill side of the workflow');
assert(voucher.document_class === 'payment_voucher', 'Payment vouchers must retain their auditable subtype');
assert(voucher.bill_total_value === 1904, 'Payment vouchers must use the printed total as the bill amount');

const documentTime = Date.parse('2026-07-10T12:00:00+07:00');
const contextMessages = [
  { text: 'ตลาด 8/7/69 รับ 30000 จ่าย 13985 โอนเพิ่ม 13984', event_timestamp_ms: Date.parse('2026-07-08T12:00:00+07:00'), sender_user_id: 'U1' },
  { text: 'ตลาด 10/7/69 รับ 30000 จ่าย 8041 โอนเพิ่ม 8036', event_timestamp_ms: Date.parse('2026-07-10T12:01:00+07:00'), sender_user_id: 'U1' },
  { text: 'ข้อความใกล้รูป', event_timestamp_ms: documentTime + 30_000, sender_user_id: 'U1' }
];
const selectedMarket = marketAnnouncementFromText(contextMessages, {
  analysis: { raw_text: 'บิลตลาด วันที่ 10/7/2569' },
  item: { event_timestamp_ms: documentTime }
});
assert(selectedMarket?.transferTotal === 8036, 'Market context must select the announcement for the document date');
const nearest = selectNearestTypedContext({ messages: contextMessages, senderUserId: 'U1', centerMs: documentTime, limit: 1 });
assert(nearest[0]?.text === 'ข้อความใกล้รูป', 'Typed context must prefer the message nearest to the image');
const afterFirst = selectNearestTypedContext({
  messages: [
    { text: 'รายละเอียดของรูปก่อน', event_timestamp_ms: documentTime - 5_000, sender_user_id: 'U1' },
    { text: 'รายละเอียดของรูปนี้', event_timestamp_ms: documentTime + 15_000, sender_user_id: 'U1' }
  ],
  senderUserId: 'U1',
  centerMs: documentTime,
  limit: 1,
  preferAfter: true
});
assert(afterFirst[0]?.text === 'รายละเอียดของรูปนี้', 'Typed context must prefer the same-sender message after the image');

const billImageTime = Date.parse('2026-08-09T18:33:04+07:00');
const linkedAfter = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 2400 },
  item: { event_timestamp_ms: billImageTime, sender_user_id: 'J' },
  messages: [
    { id: 1, text: 'ยอด 200', event_timestamp_ms: billImageTime - 20_000, sender_user_id: 'J' },
    { id: 2, text: 'ยอด 2,400 บาท', event_timestamp_ms: billImageTime + 35_000, sender_user_id: 'J' }
  ]
});
assert(linkedAfter?.amount === 2400 && linkedAfter.messageId === 2, 'Post-image exact announcement must beat unrelated previous text');
const noWrongPrevious = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 475.08 },
  item: { event_timestamp_ms: billImageTime, sender_user_id: 'J' },
  messages: [{ id: 3, text: 'ยอด 19,758.89', event_timestamp_ms: billImageTime - 20_000, sender_user_id: 'J' }]
});
assert(noWrongPrevious === null, 'A different amount before the image must not be attached as bill context');
const postImageBeatsPreviousExact = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 2400 },
  item: { event_timestamp_ms: billImageTime, sender_user_id: 'J' },
  messages: [
    { id: 10, message_type: 'text', text: 'ยอด 2,400 บาท', event_timestamp_ms: billImageTime - 10_000, sender_user_id: 'J' },
    { id: 11, message_type: 'image', event_timestamp_ms: billImageTime, sender_user_id: 'J' },
    { id: 12, message_type: 'text', text: 'ค่าผัก ยอด 2,350 บาท', event_timestamp_ms: billImageTime + 8_000, sender_user_id: 'J' }
  ]
});
assert(postImageBeatsPreviousExact?.amount === 2350 && postImageBeatsPreviousExact.messageId === 12, 'Immediate post-image detail must beat an exact amount before the image');
assert(postImageBeatsPreviousExact?.purpose === 'ค่าผัก', 'The post-image announcement must also replace the previous image purpose');
const interleavedProductNames = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 3719 },
  item: { event_timestamp_ms: billImageTime, sender_user_id: 'J' },
  messages: [
    { id: 13, message_type: 'text', text: '@Jum สั่งน่องแก้ว 5.615 กก. ยอด 3,719.- นะคะ', event_timestamp_ms: billImageTime - 60_000, sender_user_id: 'J' },
    { id: 14, message_type: 'image', event_timestamp_ms: billImageTime, sender_user_id: 'J' },
    { id: 141, message_type: 'image', event_timestamp_ms: billImageTime + 30_000, sender_user_id: 'J', capture_category: 'other' },
    { id: 15, message_type: 'text', text: '@Jum สั่งเอ็นแก้ว 20 กก. ยอด 3,580.- นะคะ', event_timestamp_ms: billImageTime + 60_000, sender_user_id: 'J' }
  ]
});
assert(interleavedProductNames?.purpose === 'เอ็นแก้ว 20 กก.', 'The next product announcement must not inherit the previous product name');
assert(interleavedProductNames?.amount === 3580, 'The next product announcement amount must win even when visual OCR copied the previous amount');
const canonicalSenderContext = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 3719 },
  item: {
    event_timestamp_ms: billImageTime,
    sender_user_id: 'line-export-user-j',
    sender_canonical_user_id: 'U-real-j'
  },
  messages: [
    { id: 16, message_type: 'text', text: '@Jum สั่งเอ็นแก้ว 20 กก. ยอด 3,580.- นะคะ', event_timestamp_ms: billImageTime + 60_000, sender_user_id: 'U-real-j' }
  ]
});
assert(canonicalSenderContext?.purpose === 'เอ็นแก้ว 20 กก.', 'Imported pseudo sender IDs must resolve to the canonical LINE sender before context selection');
assert(resolveContextSenderId({
  item: { id: 1821, sender_user_id: 'line-export-user-j' },
  messages: [{ capture_item_id: 1821, original_sender_user_id: 'line-export-user-j', sender_user_id: 'U-real-j' }]
}) === 'U-real-j', 'The worker must resolve an imported image sender to the canonical sender used by nearby messages');
const imageBatchUsesFollowingContext = selectBillAnnouncementContext({
  analysis: { category: 'bill', bill_total_value: 2400 },
  item: { event_timestamp_ms: billImageTime, sender_user_id: 'J' },
  messages: [
    { id: 20, message_type: 'image', event_timestamp_ms: billImageTime, sender_user_id: 'J' },
    { id: 21, message_type: 'image', event_timestamp_ms: billImageTime + 10_000, sender_user_id: 'J' },
    { id: 22, message_type: 'text', text: 'ยอด 2,400 บาท', event_timestamp_ms: billImageTime + 20_000, sender_user_id: 'J' }
  ]
});
assert(imageBatchUsesFollowingContext?.amount === 2400, 'A detail message after a consecutive image batch must attach to the batch');
assert(imageBatchUsesFollowingContext?.messageId === 22, 'The first typed detail after an image batch must be retained as evidence');

const matchingConfig = {
  amountTolerance: 5,
  percentTolerance: 0.02,
  maxMatchHours: 48,
  requireSameSource: true,
  sourceFallbacks: {}
};
const fuelReimbursementPair = scoreSequencePair({
  bill: {
    id: 62,
    category: 'bill',
    source_id: 'G1',
    sender_user_id: 'J',
    event_timestamp_ms: fuelBillTime,
    bill_total_value: 2000,
    bill_purpose: 'ค่าน้ำมันรถตลาด',
    ai_summary: 'บิลค่าน้ำมันรถตลาดจากบางจาก ยอดรวม 2,000 บาท',
    ai_raw_text: 'BANGCHAK H DIESEL รวมเป็นเงิน 2,000.00',
    ai_confidence: 0.99
  },
  slip: {
    ...fuelReimbursement,
    id: 70,
    source_id: 'G1',
    sender_user_id: 'JUM',
    event_timestamp_ms: fuelSlipTime,
    ai_confidence: 0.99
  },
  config: matchingConfig
});
assert(fuelReimbursementPair?.exactAmount, 'Market-account fuel reimbursement must match its exact bill');
assert(fuelReimbursementPair?.identityConfirmed, 'Market-account reimbursement context must confirm bill identity');
const marketBill = {
  id: 46,
  category: 'bill',
  source_id: 'G1',
  sender_user_id: 'Ub8d8',
  event_timestamp_ms: documentTime,
  bill_total_value: 8041,
  announced_amount: 8036,
  bill_purpose: 'บิลตลาด 10/7/69',
  ai_summary: 'บิลตลาด 10/7/69 ยอดซื้อ 8,041 บาท ยอดโอนหลังปรับยอด 8,036 บาท',
  ai_raw_text: 'รายการซื้อของตลาดสด',
  ai_confidence: 0.98
};
const exactMarketSlip = {
  id: 55,
  category: 'transfer',
  source_id: 'G1',
  sender_user_id: 'Ub64b',
  event_timestamp_ms: documentTime + 60 * 60 * 1000,
  slip_amount_value: 8036,
  ai_raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ไปยัง น.ส. ศิริลักษณ์ เวียงแสง xxx-x-x7193-x จำนวน 8,036 บาท',
  ai_confidence: 0.99,
  payment_role: 'ordinary_payment'
};
const wrongMarketSlip = { ...exactMarketSlip, id: 27, slip_amount_value: 7796, event_timestamp_ms: documentTime + 24 * 60 * 60 * 1000 };
const exactMarketPair = scoreSequencePair({ bill: marketBill, slip: exactMarketSlip, config: matchingConfig });
const wrongMarketPair = scoreSequencePair({ bill: marketBill, slip: wrongMarketSlip, config: matchingConfig });
assert(exactMarketPair?.exactAmount && exactMarketPair.identityConfirmed, 'Adjusted market amount 8,036 must match slip 8,036');
assert(wrongMarketPair === null, 'The 7,796 slip must not be proposed for the 8,036 market transfer');
assert(scoreSequencePair({ bill: marketBill, slip: { ...exactMarketSlip, slip_amount_value: null }, config: matchingConfig }) === null, 'A slip without an amount must not enter the match queue');

const makroBill = {
  id: 467,
  category: 'bill',
  source_id: 'G1',
  event_timestamp_ms: Date.parse('2026-07-25T17:32:03+07:00'),
  vendor_name: 'Makro',
  doc_ref: '041871065939',
  bill_total_value: 2250,
  ai_raw_text: 'Tax Invoice No. 041871065939 Ref 1: 0410609232 Ref 2: 041871065939',
  ai_confidence: 0.99
};
const makroSlip = {
  id: 900,
  category: 'transfer',
  source_id: 'G1',
  event_timestamp_ms: Date.parse('2026-07-25T20:53:00+07:00'),
  slip_amount_value: 2250,
  ai_raw_text: 'CP AXTRA PCL. SMARTONE รหัสลูกค้า 0410609232 เลขที่อ้างอิง 041871065939 จำนวน 2,250.00',
  ai_confidence: 0.99,
  payment_role: 'ordinary_payment'
};
assert(extractCpAxtraBillReference(makroBill) === '041871065939', 'Makro Ref 2 must equal its tax invoice number');
assert(extractCpAxtraSlipReference(makroSlip) === '041871065939', 'CP AXTRA slip must use the payment reference, not the bank transaction id');
const exactMakroPair = scoreSequencePair({ bill: makroBill, slip: makroSlip, config: matchingConfig });
assert(exactMakroPair?.identityConfirmed && exactMakroPair?.reasons.some((reason) => /041871065939/.test(reason)), 'Exact CP AXTRA Ref 2 must confirm the Makro identity');
const noReferenceMakroPair = scoreSequencePair({
  bill: {
    ...makroBill,
    id: 903,
    doc_ref: null,
    bill_total_value: 1925.17,
    ai_raw_text: 'makro Delivery Note/Receipt รายละเอียดบนภาพอ่านไม่ชัด'
  },
  slip: {
    ...makroSlip,
    id: 904,
    slip_amount_value: 1925.17,
    ai_raw_text: 'CP AXTRA PCL. SMARTONE จำนวน 1,925.17 บาท'
  },
  config: matchingConfig
});
assert(noReferenceMakroPair?.identityConfirmed, 'Makro and CP AXTRA must be recognized as the same merchant when the bill reference is unreadable');
assert(noReferenceMakroPair?.score >= 55, 'An exact same-day Makro/CP AXTRA amount must remain eligible for human review without a readable reference');
assert(scoreSequencePair({
  bill: makroBill,
  slip: { ...makroSlip, id: 901, ai_raw_text: makroSlip.ai_raw_text.replace('041871065939', '041871065936') },
  config: matchingConfig
}) === null, 'A different CP AXTRA Ref 2 must reject an otherwise identical amount and time');
assert(scoreSequencePair({
  bill: { ...makroBill, id: 902, vendor_name: 'ร้านอื่น', ai_raw_text: 'ใบเสร็จร้านอื่น', doc_ref: null },
  slip: makroSlip,
  config: matchingConfig
}) === null, 'A CP AXTRA slip must never be proposed for a non-Makro bill');

console.log('AI deterministic rules test passed');
