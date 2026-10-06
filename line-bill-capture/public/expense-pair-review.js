// ระยะ 5: เปลี่ยนการนำเสนอเท่านั้น คง handler ยืนยัน/ยกเลิก/Undo และการนับงานเดิม
function expenseDisplayText(value) { return String(value || '').replace(/\d[\d\s-]{6,}\d/gu, number => `••••${number.replace(/\D/g,'').slice(-4)}`); }
function expenseQueueTitle(row) {
  const value = expenseDisplayText(row?.supplier_name || row?.bill_purpose || row?.ai_summary || `เอกสาร #${row?.id || ''}`).trim();
  return (row?.match_status === 'confirmed' ? value.replace(/\s*(?:ยังไม่มี|ไม่พบ)หลักฐาน.*$/u,'').trim() || value : value).slice(0,160);
}
function expenseSenderDetails(userId) { return userId ? `<details class="expense-sender-details"><summary>รายละเอียดผู้ส่ง</summary><span>LINE user ID: ${esc(userId)}</span></details>` : ''; }
function expenseReasonModel(input, confirmed = false) {
  const unique = [...new Set((input || []).filter(value => typeof value === 'string' && value.trim()).map(value=>expenseDisplayText(value.trim())))];
  const negative = reason => /ไม่มี|ไม่พบ|ยังไม่มี|ไม่สามารถ|ไม่ชัด/u.test(reason);
  const ordered = [...unique.filter(reason=>!negative(reason)), ...unique.filter(negative)];
  const selected = confirmed ? ordered.filter(reason=>!negative(reason)).slice(0,5) : ordered.slice(0,5);
  return { selected, remaining: unique.filter(reason=>!selected.includes(reason)), confirmed };
}
function expenseReasonsMarkup(input, confirmed = false) {
  const model = expenseReasonModel(input,confirmed);
  const list = rows => `<ol>${rows.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ol>`;
  const historical = confirmed ? '<p class="muted">ข้อมูลอ้างอิงตอนจับคู่ ก่อนคนตรวจยืนยัน</p>' : '';
  return `<div class="expense-pair-reasons">${confirmed?'<p class="muted">เหตุผลตอนเสนอคู่ · สถานะปัจจุบันคือคนยืนยันแล้ว</p>':''}${model.selected.length?list(model.selected):'<p class="muted">ไม่มีเหตุผลเพิ่มเติมที่ใช้ตัดสินใจ</p>'}${model.remaining.length?`<details><summary>ดูทั้งหมด (${model.selected.length+model.remaining.length} ข้อ)</summary>${historical}${list(model.remaining)}</details>`:''}</div>`;
}
function expensePairRoundStatus() {
  if (S.view !== 'day') return;
  const day = S.days.find(row=>row.business_date===S.start && row.source_id===S.source);
  const reopened = day?.closing_status==='open' && day?.reopened_reason;
  const total = document.getElementById('total'), banner = document.getElementById('reopenbanner');
  total.hidden = Boolean(reopened);
  if (reopened) {
    const work = dayWorkCount();
    banner.hidden = false; banner.classList.add('expense-round-action');
    banner.textContent = work ? `รอบเปิดใหม่ · ยังมีงานค้าง ${work} รายการ — ตรวจงานค้างก่อนปิดรอบอีกครั้ง` : 'รอบเปิดใหม่ · ตรวจงานครบแล้ว — ตรวจสรุปและกดปิดรอบอีกครั้ง';
    banner.title = expenseDisplayText(day.reopened_reason);
  } else { banner.classList.remove('expense-round-action'); }
}
window.addEventListener('DOMContentLoaded',()=>{
  const previousRender=render; render=function(){previousRender();expensePairRoundStatus()};
  const previousBuckets=renderBuckets; renderBuckets=function(){previousBuckets();expensePairRoundStatus()};
  expensePairRoundStatus();
});
