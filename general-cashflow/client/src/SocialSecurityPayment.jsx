import { useEffect, useState } from 'react';
import { formatPnlMoney as money, formatPnlMonth, formatPnlDate } from './profitLoss.js';

export default function SocialSecurityPayment({ month, report, branchId, busy, save, clear }) {
  const payment = report.social_security_payment;
  const [form, setForm] = useState({ payroll_month: '', payment_date: '', amount: '', note: '' });
  useEffect(() => { setForm({ payroll_month: payment?.payroll_month?.slice(0, 7) || '', payment_date: payment?.payment_date || '', amount: payment?.amount || '', note: payment?.note || '' }); }, [month, payment?.id, payment?.amount, payment?.payroll_month, payment?.payment_date, payment?.note]);
  return <details className="pnl-source"><summary>ประกันสังคมนำส่งจริง · {payment ? `${money(payment.amount)} บาท` : 'ยังไม่ระบุยอดจ่าย'}</summary>
    <p>ระบุยอดที่นำส่งแล้วตามเดือนจ่าย ระบบจะใช้ยอดนี้แทนประกันสังคมจาก HRMS ของเดือนเดียวกัน โดยคงเงินเดือนสุทธิและเงินเบิกเดิม</p>
    <p>ยอดของทั้งบริษัทแสดงในส่วนกลาง ไม่แบ่งตามสาขาโดยประมาณ · ยอดนำส่งที่ยืนยันนับเต็มจำนวนในทั้งสองช่วงข้อมูล · ยังไม่มีข้อมูลนำส่งจะใช้ประกันสังคมตามรอบ HRMS</p>
    {payment && <p>จ่าย {formatPnlDate(payment.payment_date)} · เงินเดือน {formatPnlMonth(payment.payroll_month.slice(0, 7))} · {money(payment.amount)} บาท · แทนยอด HRMS {money(payment.replaced_hrms_amount)} บาท</p>}
    {branchId ? <p>เลือกทุกสาขาเพื่อบันทึกหรือแก้ยอดของทั้งบริษัท</p> : <form className="pnl-form" onSubmit={event => { event.preventDefault(); save({ ...form, month }); }}>
      <label>เดือนเงินเดือนที่นำส่ง<input type="month" aria-label="เดือนเงินเดือนที่นำส่ง" required value={form.payroll_month} max={month} onChange={e => setForm({ ...form, payroll_month: e.target.value })}/></label>
      <label>วันที่นำส่ง<input type="date" aria-label="วันที่นำส่ง" required value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })}/></label>
      <label>ยอดนำส่งทั้งบริษัท (บาท)<input type="number" aria-label="ยอดนำส่งทั้งบริษัท (บาท)" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
      <label>หลักฐานและเหตุผล<textarea aria-label="หลักฐานและเหตุผล" required maxLength="500" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}/></label>
      <p>บันทึกเพื่อคำนวณ P&amp;L และเก็บประวัติการแก้ไข ไม่มีการโอนเงินหรือแก้ HRMS</p>
      <button disabled={busy || report.local_read_only}>ยืนยันยอดนำส่งจริง</button>
      {payment && <button type="button" disabled={busy || report.local_read_only} onClick={clear}>กลับไปใช้ยอด HRMS</button>}
    </form>}
  </details>;
}
