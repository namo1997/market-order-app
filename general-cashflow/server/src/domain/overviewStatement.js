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

export function allocateOverviewGrab(rows, evidence, lagDays = SETTLEMENT_LAG_DAYS) {
  const grab=rows.filter(r=>r.channel==='GRAB food').sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.row_index-b.row_index);
  const taken=new Set();
  const allocations=new Map();
  // Grab normally pays the next day; later payments are matched only when a
  // single unused report of an earlier day has exactly the same net amount.
  for (const row of grab) {
    const duplicate=grab.filter(r=>r.date===row.date && roundMoney(Number(r.amount))===roundMoney(Number(row.amount))).length>1;
    let e=null, saleDate=addDays(row.date,-1), ambiguous=duplicate, lag=null;
    if (!duplicate) for (let days=1; days<=lagDays; days++) {
      const date=addDays(row.date,-days);
      const matches=evidence.filter(x=>x.sale_date===date && !taken.has(x) && x.net !== null && x.net !== undefined && Number(x.net)>0 && roundMoney(Number(x.net))===roundMoney(Number(row.amount)));
      if (matches.length>1) { ambiguous=true; saleDate=date; break; }
      if (matches.length===1) { e=matches[0]; saleDate=date; lag=days; taken.add(e); break; }
    }
    allocations.set(row.row_index,{row_index:row.row_index,received_date:row.date,sale_date:saleDate,amount:row.amount,branch_code:e?.branch_code||null,branch_name:e?.branch_name||null,receipt_id:e?.receipt_id||null,line_id:e?.line_id||null,reparsed_report_id:e?.reparsed_report_id||null,reason:e?(lag===1?'ยอดตรงกับรายงาน Grab ของสาขาและวันขายก่อนวันรับ 1 วัน':`ยอดตรงกับรายงาน Grab ของวันขายก่อนวันรับ ${lag} วัน (เงินเข้าช้า)`):ambiguous?'ยอดเท่ากันหลายรายการหรือหลายสาขา รอหลักฐานระบุชุดโอน':`ยังไม่พบรายงาน Grab ที่ยอดสุทธิตรงกับวันขายย้อนหลัง 1-${lagDays} วัน`});
  }
  return rows.filter(r=>r.channel==='GRAB food').map(r=>allocations.get(r.row_index));
}

export const KBANK_CARD_FEE_RATE = { min: 0.015, max: 0.035 };
// Settlements can arrive late (weekends, holidays, bank delays). Look back this
// many days from the deposit date for the sale it belongs to.
export const SETTLEMENT_LAG_DAYS = 4;

export const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

// QR settles the full sale amount; card settles the gross less a normal fee.
export const qrSettles = (amount, line) => roundMoney(amount) > 0 && roundMoney(amount) === roundMoney(line.expected);
export const kbankCardSettles = (amount, line) => {
  const gross = roundMoney(line.cashier_amount || 0);
  if (!(gross > 0)) return false;
  const rate = (gross - roundMoney(amount)) / gross;
  return rate >= KBANK_CARD_FEE_RATE.min && rate <= KBANK_CARD_FEE_RATE.max;
};

// Pair deposits with open sales lines of one channel. First, all deposits of a
// day together settle that day's sale (split transfers). Remaining deposits
// pair with the single sale within the lag window they settle (late money).
// Anything ambiguous is left unmatched for review rather than guessed.
export function matchDepositsToSales(rows, lines, settles, { lagDays = SETTLEMENT_LAG_DAYS, used = new Set(), sameDayFallback = false } = {}) {
  const matched = new Map();
  const taken = new Set(used);
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) || []), row]);
  for (const [date, group] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const sameDay = lines.filter(l => l.sale_date === date && !taken.has(l.id));
    const total = roundMoney(group.reduce((sum, r) => sum + Number(r.amount), 0));
    if (sameDay.length === 1 && settles(total, sameDay[0])) {
      for (const row of group) matched.set(row.row_index, sameDay[0]);
      taken.add(sameDay[0].id);
    }
  }
  const remaining = rows.filter(r => !matched.has(r.row_index)).sort((a, b) => a.date.localeCompare(b.date) || a.row_index - b.row_index);
  for (const row of remaining) {
    const earliest = addDays(row.date, -lagDays);
    const fits = lines.filter(l => !taken.has(l.id) && l.sale_date <= row.date && l.sale_date >= earliest && settles(Number(row.amount), l));
    if (fits.length !== 1) continue;
    matched.set(row.row_index, fits[0]);
    taken.add(fits[0].id);
  }
  // QR money is normally same-day; when nothing else fits, keep the same-day
  // pairing so a cashier typo shows as a variance instead of hiding the money.
  if (sameDayFallback) for (const [date, group] of byDate) {
    const open = group.filter(r => !matched.has(r.row_index));
    if (open.length !== group.length) continue;
    const sameDay = lines.filter(l => l.sale_date === date && !taken.has(l.id));
    if (sameDay.length !== 1) continue;
    for (const row of group) matched.set(row.row_index, sameDay[0]);
    taken.add(sameDay[0].id);
  }
  return matched;
}
