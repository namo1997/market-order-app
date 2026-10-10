import { useEffect, useState } from 'react';
import { formatPnlMoney as money, formatPnlMonth, thaiMonth, previousMonth, pnlMonthlyDisplay } from './profitLoss.js';
const blank = (month) => ({ category_code: 'RENT', branch_id: '', description: '', amount: '', note: '', start_month: month, effective_month: month });
const shift = (month, delta) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
};
export default function RecurringExpenses({ report, mode, month, recurring, categories, branches, busy, act, send, request, onLine }) {
  const [form, setForm] = useState(() => blank(month));
  const [editing, setEditing] = useState(null);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [stopMonth, setStopMonth] = useState(shift(month, 1));
  const [history, setHistory] = useState(null);
  useEffect(() => { setForm(blank(month)); setEditing(null); setAction(null); setHistory(null); }, [month]);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const branchName = (id) => branches.find((row) => String(row.id) === String(id))?.name || 'ส่วนกลาง';
  const categoryName = (code) => categories.find((row) => row.code === code)?.name;
  const current = thaiMonth();
  return <section aria-labelledby="pnl-recurring-heading">
    <h2 id="pnl-recurring-heading">รายจ่ายประจำ ({recurring.items.length} รายการ, {money(recurring.total)} บาท/เดือน)</h2>
    <p>ตั้งครั้งเดียว นับทุกเดือนจนกว่าจะหยุด · ยอดคงที่ตามที่ยืนยัน ไม่ต้องแนบหลักฐาน · ข้ามเดือนจะไม่นับยอดของเดือนนั้น</p>
    <div className="pnl-recurring-list">{recurring.items.map((item) => <article key={item.id}>
      <h3>{item.description}</h3><p>{categoryName(item.category_code)} · {branchName(item.branch_id)} · <span className="pnl-nowrap">{money(item.amount)} บาท/เดือน</span></p>{mode === 'matched' && <p>นับในโหมดนี้: <strong>≈ {money(pnlMonthlyDisplay(item, report, mode))} บาท</strong> · ยอดเต็มเดือน {money(item.amount)} บาท</p>}
      <p>เริ่ม {formatPnlMonth(item.start_month.slice(0, 7))}{item.end_month && ` · นับถึง ${formatPnlMonth(item.end_month.slice(0, 7))}`} · <strong>{item.skipped ? 'ข้ามเดือนนี้' : 'ลงอัตโนมัติ'}</strong></p>
      {item.skip_reason && <p>เหตุผลที่ข้าม: {item.skip_reason}</p>}{item.note && <p>หมายเหตุ: {item.note}</p>}
      {recurring.duplicate_warnings.filter((warning) => String(warning.recurring_id) === String(item.id)).map((warning) => <p className="pnl-warning" key={warning.stable_key}>อาจนับซ้ำกับรายการ LINE · {money(warning.amount)} บาท {warning.source_url ? <a href={warning.source_url} target="_blank" rel="noreferrer">ดูรายการ LINE</a> : <button type="button" onClick={() => onLine(item.category_code)}>ดูรายการ LINE</button>}</p>)}
      <div className="pnl-recurring-actions"><button disabled={busy} onClick={() => {setEditing(item.id); setForm({ ...item, branch_id: item.branch_id ?? '', start_month: item.start_month.slice(0, 7), effective_month: month }); setAction(null);}}>แก้ไข</button>
        <button disabled={busy} onClick={() => item.skipped ? act(() => send('DELETE', `/recurring/${item.id}/skips/${month}`)) : (setAction({ type: 'skip', item }), setReason(''))}>{item.skipped ? 'ยกเลิกข้ามเดือนนี้' : 'ข้ามเดือนนี้'}</button>
        <button disabled={busy} onClick={() => {setAction({ type: 'stop', item }); setStopMonth(shift(month, 1));}}>หยุดตั้งแต่เดือน…</button>
        <button className="pnl-link" disabled={busy} onClick={() => act(async () => setHistory(await request(`/pnl/recurring/series/${item.series_id || item.id}`)), false)}>ดูประวัติ</button>
      </div>
    </article>)}</div>
    {recurring.items.length === 0 && <p>ยังไม่มีรายจ่ายประจำในเดือนนี้</p>}
    {action && <form className="pnl-form" onSubmit={(event) => {event.preventDefault(); act(async () => {
      await send(action.type === 'skip' ? 'PUT' : 'POST', action.type === 'skip' ? `/recurring/${action.item.id}/skips/${month}` : `/recurring/${action.item.id}/stop`, action.type === 'skip' ? { reason } : { last_month: previousMonth(stopMonth) }); setAction(null);
    });}}>
      <p>{action.item.description}</p>{action.type === 'skip' ? <label>เหตุผลที่ข้ามเดือนนี้<input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)}/></label> : <label>หยุดตั้งแต่เดือน (เดือนนี้จะไม่นับ)<input required type="month" min={shift(action.item.start_month.slice(0, 7), 1)} max={action.item.end_month ? shift(action.item.end_month.slice(0, 7), 1) : undefined} value={stopMonth} onChange={(event) => setStopMonth(event.target.value)}/><small>เดือนสุดท้ายที่ยังนับ: {stopMonth ? formatPnlMonth(previousMonth(stopMonth)) : '—'}</small></label>}
      <button disabled={busy || (action.type === 'skip' && !reason.trim())}>ยืนยัน{action.type === 'skip' ? 'ข้ามเดือน' : 'หยุด'}</button><button type="button" disabled={busy} onClick={() => setAction(null)}>ยกเลิก</button>
    </form>}
    {history && <div className="pnl-recurring-history"><h3>ประวัติรายจ่ายประจำ</h3><button type="button" onClick={() => setHistory(null)}>ปิดประวัติ</button>{history.map((item) => <article key={item.id}><p>{item.description} · {categoryName(item.category_code)} · {branchName(item.branch_id)} · {money(item.amount)} บาท/เดือน</p><p>{formatPnlMonth(item.start_month.slice(0, 7))} ถึง {item.end_month ? formatPnlMonth(item.end_month.slice(0, 7)) : 'ยังไม่สิ้นสุด'}</p>{item.skips.map((skip) => <p key={skip.month_start}>ข้าม {formatPnlMonth(skip.month_start.slice(0, 7))}: {skip.reason}</p>)}</article>)}</div>}
    <h3>{editing ? 'แก้ไขรายจ่ายประจำ' : 'เพิ่มรายจ่ายประจำ'}</h3>
    <form className="pnl-form" onSubmit={(event) => {event.preventDefault(); act(async () => {
      await send(editing ? 'PUT' : 'POST', `/recurring${editing ? '/' + editing : ''}`, { ...form, amount: form.amount.toString().replaceAll(',', '') }); setForm(blank(month)); setEditing(null);
    });}}>
      <label>หมวด<select required value={form.category_code} onChange={update('category_code')}>{categories.filter((row) => row.code !== 'STAFF').map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
      <label>สาขาหรือส่วนกลาง<select value={form.branch_id} onChange={update('branch_id')}><option value="">ส่วนกลาง</option>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>รายละเอียด<input required maxLength={300} placeholder="ค่าเช่าที่ สาขาสันกำแพง" value={form.description} onChange={update('description')}/></label>
      <label>ยอดคงที่ต่อเดือน (บาท)<input required inputMode="decimal" value={form.amount} onChange={update('amount')}/></label>
      <label>{editing ? 'มีผลตั้งแต่เดือน' : 'เริ่มเดือน'}<input required type="month" value={editing ? form.effective_month : form.start_month} min={editing ? form.start_month : shift(current, -12)} max={editing ? form.end_month?.slice(0, 7) : shift(current, 12)} onChange={update(editing ? 'effective_month' : 'start_month')}/></label>
      <label>หมายเหตุ<input maxLength={500} value={form.note || ''} onChange={update('note')}/></label>
      <button disabled={busy}>{editing ? 'ยืนยันบันทึกการแก้ไข' : 'ยืนยันเพิ่มรายจ่ายประจำ'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setForm(blank(month)); }}>ยกเลิก</button>}
    </form>
  </section>;
}
