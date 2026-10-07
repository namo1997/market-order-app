// กฎข้อเสนอจากข้อความหลักฐานที่ผู้เรียกคัดเลือกแล้ว ไม่เรียก AI และไม่บันทึกข้อมูล
// purpose ต้องเป็นรายละเอียดที่เชื่อถือได้; billDetail ใช้เฉพาะบิลของรายการนี้
const categories = [
  ['ingredients', /วัตถุดิบ|อาหาร|เนื้อ(?:หมู|วัว|ไก่)|หมู|ไก่|ปลา|กุ้ง|ผัก|ผลไม้|ข้าวสาร|เครื่องปรุง|น้ำมันพืช|เครื่องดื่ม|น้ำดื่ม|นมสด|ไข่(?:ไก่|เป็ด)?|แป้ง|น้ำตาล|เส้นก๋วยเตี๋ยว/u, 'รายละเอียดกล่าวถึงอาหาร เครื่องดื่ม หรือวัตถุดิบ'],
  ['packaging', /บรรจุภัณฑ์|กล่อง(?:อาหาร|ใส่|พลาสติก)|ถุง(?:พลาสติก|หิ้ว|ใส่อาหาร)|แก้ว(?:พลาสติก|กระดาษ)|หลอด(?:ดูด|กาแฟ)|กระดาษทิชชู่|ฟิล์ม(?:ห่อ|ถนอม)|วัสดุสิ้นเปลือง/u, 'รายละเอียดกล่าวถึงบรรจุภัณฑ์หรือวัสดุสิ้นเปลือง'],
  ['personnel', /ค่าแรง|เงินเดือน|ค่าจ้าง|โบนัส|สวัสดิการพนักงาน/u, 'รายละเอียดกล่าวถึงค่าบุคลากร'],
  ['utilities', /ค่าน้ำ(?:ประปา)?(?!ตาล|มัน|ปลา|ดื่ม)|ค่าไฟ(?:ฟ้า)?|ค่าอินเทอร์เน็ต|ค่าโทรศัพท์|แก๊ส(?:หุงต้ม)?/u, 'รายละเอียดกล่าวถึงค่าสาธารณูปโภค'],
  ['premises', /ค่าเช่า|ค่าซ่อม|ซ่อมบำรุง|ค่าทำความสะอาด|ค่าตกแต่ง/u, 'รายละเอียดกล่าวถึงสถานที่หรือซ่อมบำรุง'],
  ['marketing', /ค่าโฆษณา|ค่าโปรโมท|ค่าการตลาด|ค่าออกแบบสื่อ|ค่าป้าย/u, 'รายละเอียดกล่าวถึงการตลาดหรือสื่อ'],
  ['fees', /ค่าธรรมเนียม|ค่าบริการ|ค่าบัญชี|ค่าขนส่ง|ค่าจัดส่ง|ดอกเบี้ย/u, 'รายละเอียดกล่าวถึงค่าบริการหรือค่าธรรมเนียม'],
  ['asset_review', /อุปกรณ์|ทรัพย์สิน|ตู้เย็น|ตู้แช่|เครื่องครัว|คอมพิวเตอร์|เครื่องพิมพ์|ตาชั่ง|โต๊ะ|เก้าอี้/u, 'รายละเอียดกล่าวถึงอุปกรณ์หรือทรัพย์สิน ต้องพิจารณาทางบัญชีต่อ']
];
const identityLine = /^(?:\s*)(?:from|to|ผู้(?:โอน|รับ|จ่าย)|ชื่อ(?:ผู้รับ|บัญชี)|ธนาคาร|บัญชี|recipient|payer|bank)\b|^\s*(?:ผู้รับ|ผู้โอน|ผู้จ่าย|ชื่อบัญชี|ธนาคาร|บัญชี)/iu;
const clean = text => typeof text === 'string' ? text.slice(0,12000).split(/\r?\n/).filter(line => !identityLine.test(line)).join(' ').replace(/ร้านอาหาร|ร้าน(?:ขาย)?(?:ผัก|เนื้อ|ปลา|เครื่องดื่ม)/gu, '').trim() : '';
const excluded = new Set(['loan','internal_transfer','government_remittance']);

export const expenseClassificationSuggestions = ({ purpose = '', billDetail = '', aiSummary = '', isBill = false } = {}) => {
  const selected = clean(purpose), bill = isBill ? clean(billDetail) : '';
  const summary = clean(aiSummary);
  // สรุปที่บอกเพียงชื่อผู้รับหรือธนาคารไม่ใช่หลักฐานค่าใช้จ่าย
  const usableSummary = /ซื้อ|ชำระ|จ่าย|ค่า(?:อาหาร|วัตถุดิบ|แรง|น้ำ|ไฟ|เช่า|บริการ|ธรรมเนียม|โฆษณา)|เงินเดือน|คืนเงิน|เงินกู้|นำส่ง|โอนระหว่าง/u.test(summary) ? summary : '';
  if (selected && usableSummary) {
    const selectedType = expenseClassificationSuggestions({purpose:selected}).transaction_type?.value;
    const summaryType = expenseClassificationSuggestions({purpose:usableSummary}).transaction_type?.value;
    if (selectedType && summaryType && selectedType !== summaryType) return {};
  }
  const text = [selected,bill,usableSummary].filter(Boolean).join(' ');
  if (!text || /ไม่|ยกเลิก|น่าจะ|อาจจะ|ห้าม/u.test(text)) return {};
  const kinds = [];
  if (/เงินกู้|เงินต้น|คืน(?:เงิน)?กู้|ชำระ(?:คืน)?(?:เงิน)?กู้/u.test(text)) kinds.push(['loan','รายละเอียดระบุเงินกู้หรือเงินต้น ไม่เสนอเป็นหมวดค่าใช้จ่าย']);
  if (/นำส่ง|เงินหัก(?:พนักงาน|ไว้)|หัก(?:เงินเดือน|พนักงาน)|ภาษีหัก\s*ณ\s*ที่จ่าย|กยศ|ชำระภาระเดิม/u.test(text)) kinds.push(['government_remittance','รายละเอียดระบุการนำส่งเงินหักหรือชำระภาระเดิม']);
  if (/โอน(?:เงิน)?(?:ระหว่างบัญชี|ภายใน)|โยกเงิน|แลกเงินสด/u.test(text)) kinds.push(['internal_transfer','รายละเอียดระบุการโอนภายในหรือแลกเงินสด']);
  const reimbursement = /คืนเงิน(?:สำรอง|ทดรอง)|คืน(?:เงิน)?(?:ผู้)?สำรองจ่าย|เบิกคืน/u.test(text);
  if (reimbursement) kinds.push(['reimbursement','รายละเอียดระบุคืนเงินสำรองจ่าย']);
  if (/จ่ายล่วงหน้า|ชำระล่วงหน้า|เงินมัดจำ|ค่ามัดจำ/u.test(text)) kinds.push(['advance_payment','รายละเอียดระบุการจ่ายล่วงหน้าหรือมัดจำ']);
  if (!reimbursement && /คืนเงิน|เงินคืน|ปรับปรุงยอด|ปรับยอด/u.test(text)) kinds.push(['refund_adjustment','รายละเอียดระบุคืนเงินหรือปรับยอด']);
  // หลายลักษณะหรือเงินต้นปนดอกเบี้ยต้องให้ผู้ตรวจแยกก่อน ไม่เลือกด้วยลำดับคำ
  if (kinds.length > 1 || kinds.some(([kind]) => kind === 'loan') && /ดอกเบี้ย/u.test(text)) return {};
  const foodText = text.replace(/กล่องอาหาร|ถุงใส่อาหาร|วัสดุสิ้นเปลือง/gu, '');
  const matches = categories.filter(([key,pattern]) => pattern.test(key === 'ingredients' ? foodText : text));
  if (kinds.some(([kind]) => excluded.has(kind)) && /และ(?:จ่าย)?ค่า/u.test(text) && matches.length) return {};
  if (kinds.some(([kind]) => kind === 'internal_transfer') && matches.some(([key]) => key === 'fees')) return {};
  const nature = kinds[0] || (matches.length || /ซื้อ(?:สินค้า|ของ|บริการ)|ชำระค่าสินค้า/u.test(text) ? ['purchase','รายละเอียดระบุสินค้า บริการ หรือค่าใช้จ่ายที่ต้องตรวจหลักฐาน'] : null);
  const result = {};
  if (nature) result.transaction_type = { value:nature[0], reason:nature[1] };
  if (!nature || excluded.has(nature[0])) return result;
  if (matches.length > 1) result.expense_category = { value:'mixed', reason:'รายละเอียดมีหลายหมวด ต้องแยกยอดก่อนใช้เป็นค่าใช้จ่าย' };
  else if (matches.length === 1) result.expense_category = { value:matches[0][0], reason:matches[0][2] };
  return result;
};
