// File completeness rules are independent of channel matching and cannot be overridden by a UI request.
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
export function validateStatementFile(metadata, rows, verification) {
  const m=metadata||{},total=rows.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0);
  const rule=(id,label,passed,detail)=>({id,label,status:passed?'PASS':'BLOCK',detail});
  const rules=[
    rule('account','บัญชีตรงกับบัญชีที่เปิดใช้งานเพียงบัญชีเดียว',verification.status==='MATCHED','เทียบเลขบัญชีเต็มและธนาคาร ไม่ใช้เพียงเลขท้ายบัญชี'),
    rule('credit_count','จำนวนรายการฝากตรงกับหัว Statement',Number.isInteger(m.declaredDepositCount)&&m.declaredDepositCount===rows.length,`หัวเอกสาร ${m.declaredDepositCount ?? 'อ่านไม่พบ'} / อ่านได้ ${rows.length} รายการ`),
    rule('credit_total','ยอดฝากรวมตรงถึงสตางค์',m.declaredDepositTotal!==null&&m.declaredDepositTotal!==undefined&&Math.round(m.declaredDepositTotal*100)===total,`หัวเอกสาร ${m.declaredDepositTotal ?? 'อ่านไม่พบ'} / อ่านได้ ${(total/100).toFixed(2)} บาท`),
    rule('period','วันที่รับเงินอยู่ในรอบ Statement',validDate(m.periodFrom)&&validDate(m.periodTo)&&m.periodFrom<=m.periodTo&&rows.every(r=>validDate(r.date)&&r.date>=m.periodFrom&&r.date<=m.periodTo),`รอบเอกสาร ${m.periodFrom || 'อ่านไม่พบ'} ถึง ${m.periodTo || 'อ่านไม่พบ'} ใช้วันที่เงินเข้า ไม่ใช่วันขาย`),
    rule('positive_credit','รายการเงินเข้าเป็นจำนวนบวกที่อ่านได้ครบ',rows.every(r=>Number.isFinite(Number(r.amount))&&Number(r.amount)>0),'ตรวจเฉพาะเงินฝาก ไม่รวมเงินถอนและยอดยกมา'),
  ];
  return {version:1,can_confirm:rules.every(r=>r.status==='PASS'),rules};
}
