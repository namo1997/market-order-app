import { validateStatementFile } from './statementValidation.js';
import { roundMoney } from './money.js';
export function verifyStatementAccount(metadata, accounts = []) {
  const number = String(metadata?.accountNumber || '').replace(/\D/g, '');
  const matches = number.length === 10 ? accounts.filter(a => String(a.account_number || '').replace(/\D/g, '') === number && /kasikorn|กสิกร|kbank/i.test(a.bank_name || '') && Boolean(Number(a.is_active))) : [];
  return { number, status: matches.length === 1 ? 'MATCHED' : matches.length > 1 ? 'AMBIGUOUS' : number ? 'UNKNOWN' : 'MISSING', account: matches.length === 1 ? {id:matches[0].id,label:matches[0].label,bank:matches[0].bank_name,name:matches[0].account_name,branch:matches[0].branch_name,branch_id:matches[0].branch_id,additional_route_keys:matches[0].additional_route_keys || []} : null };
}
export function overviewStatement(parsed, accounts = []) {
  if (parsed.profile?.code !== 'KASIKORN_DEPOSIT_STATEMENT') throw Object.assign(new Error('รอบนี้รองรับ Statement เงินฝากกสิกร CSV ตามตัวอย่างเท่านั้น'), { statusCode: 422 });
  const rows = parsed.rows.filter(r => Number(r.amount) > 0).map((r, index) => {
    const description = String(r.description || '');
    const grabName = /บจก\.\s*แกร็บแท็กซี่|\bGRAB\b/i.test(description);
    const grabAccount = /\bX3812\b/i.test(description);
    const channel = /EDC\/K SHOP\/MYQR/i.test(description) ? 'QR กสิกร' : grabName && grabAccount ? 'GRAB food' : /รับเงินจากการขาย.*เต็มจำนวน\/ผ่อนชำระ\/คะแนนสะสม/.test(description) ? 'บัตรกสิกร' : 'เงินเข้าอื่น · ต้องตรวจ';
    const reasons = [];
    if (channel === 'เงินเข้าอื่น · ต้องตรวจ') reasons.push(grabName || grabAccount ? 'ข้อมูลผู้โอน Grab ไม่ครบหรือไม่ตรงรูปแบบที่รู้จัก ต้องตรวจต้นทาง' : 'ยังระบุประเภทเงินเข้าไม่ได้ ตรวจผู้โอนและเอกสารอ้างอิง');
    return { date:r.transactionDate, amount:r.amount, description, channel, row_index:r.rowIndex || index+1, source_hash:r.uniqueHash || null, reasons };
  });
  const seen = new Map();
  for (const row of rows) {
    if (!row.date) row.reasons.push('อ่านวันที่รับเงินจริงไม่ได้');
    if (row.source_hash) {const previous = seen.get(row.source_hash); if (previous) { const reason='ข้อมูลรายการเหมือนกันในไฟล์ อาจซ้ำ ต้องตรวจเลขอ้างอิง'; row.reasons.push(reason); if (!previous.reasons.includes(reason)) previous.reasons.push(reason); } else seen.set(row.source_hash,row);}
  }
  // Compare individual transfers only within the same channel in this file.
  for (const channel of ['GRAB food','QR กสิกร','บัตรกสิกร']) {
    const group=rows.filter(r=>r.channel===channel), sorted=group.map(r=>Number(r.amount)).sort((a,b)=>a-b);
    if(sorted.length < 5) continue;
    const middle=Math.floor(sorted.length/2), median=sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
    for(const row of group) if(Number(row.amount)>median*3) row.reasons.push(`ยอดสูงกว่าค่ากลางของช่องทางในไฟล์เกิน 3 เท่า (ค่ากลาง ${roundMoney(median)} บาท) เป็นจุดให้ตรวจ ไม่ใช่ข้อสรุปว่าผิด`);
  }
  if (!rows.length) throw Object.assign(new Error('ไม่พบรายการเงินเข้าในไฟล์'), { statusCode: 422 });
  const groups = new Map();
  for (const r of rows) { const key=r.date+'|'+r.channel; const g=groups.get(key)||{date:r.date,channel:r.channel,count:0,amount:0}; g.count++;g.amount=roundMoney(g.amount+Number(r.amount));groups.set(key,g); }
  const verification=verifyStatementAccount(parsed.metadata, accounts);
  return { verification, validation:validateStatementFile(parsed.metadata, rows, verification), profile: parsed.profile.label, alerts: rows.filter(r=>r.reasons.length), grab: {count:rows.filter(r=>r.channel==='GRAB food').length,total:roundMoney(rows.filter(r=>r.channel==='GRAB food').reduce((n,r)=>n+Number(r.amount),0)),note:'ตรวจชื่อผู้โอนและเลขท้าย X3812 แล้ว ยังต้องเทียบชุดโอนกับรายงาน Grab เพื่อยืนยันยอดครบ'}, count: rows.length, total: roundMoney(rows.reduce((n,r)=>n+Number(r.amount),0)), rows, daily: [...groups.values()].sort((a,b)=>String(a.date || '').localeCompare(String(b.date || ''))) };
}

export function allocateOverviewGrab(rows, evidence) {
  const grab=rows.filter(r=>r.channel==='GRAB food');
  return grab.map(row=>{
    const d=new Date(`${row.date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);
    const saleDate=Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
    const matches=evidence.filter(e=>e.sale_date===saleDate && e.net !== null && e.net !== undefined && Number(e.net)>0 && roundMoney(Number(e.net))===roundMoney(Number(row.amount)));
    const duplicate=grab.filter(r=>r.date===row.date && roundMoney(Number(r.amount))===roundMoney(Number(row.amount))).length>1;
    const e=matches.length===1&&!duplicate?matches[0]:null;
    return {row_index:row.row_index,received_date:row.date,sale_date:saleDate,amount:row.amount,branch_code:e?.branch_code||null,branch_name:e?.branch_name||null,receipt_id:e?.receipt_id||null,line_id:e?.line_id||null,reparsed_report_id:e?.reparsed_report_id||null,reason:e?'ยอดตรงกับรายงาน Grab ของสาขาและวันขายก่อนวันรับ 1 วัน':matches.length>1||duplicate?'ยอดเท่ากันหลายรายการหรือหลายสาขา รอหลักฐานระบุชุดโอน':'ยังไม่พบรายงาน Grab ที่ยอดสุทธิตรงกับวันขายก่อนวันรับ 1 วัน'};
  });
}
