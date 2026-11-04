import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { overviewDefaults, overviewDate, overviewMoney as money } from './receiptsOverviewState.js';
import { mobileInitialRange } from './mobileAdminState.js';
import { groupCalendarReceipts, receiptDateState } from './receiptCalendar.js';
import { thailandBusinessDate } from './cashierReceiptSync.js';
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WEEKDAY_NAMES = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const shiftMonth = (month, delta) => {
  const [year, index] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, index - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
};
const monthDays = (month) => {
  const [year, index] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`);
};
const dayTone = (status) => !status ? '' : status === 'CLOSED' ? 'done' : ['CHECKED_OK', 'CHECKED_VARIANCE'].includes(status) ? 'checked' : 'todo';
const dayWord = { todo: 'รอตรวจ', checked: 'ตรวจแล้ว', done: 'ปิดแล้ว' };
const varianceText = (value) => value === null || value === undefined ? '—' : Math.abs(value) < 0.01 ? 'ยอดตรง' : `${value > 0 ? 'เกิน' : 'ขาด'} ${money(Math.abs(value))}`;

// Phone admin home: pick a day from the strip, then open one branch. Reading never creates receipts.
export default function MobileAdminOverview({ view, branches, onOpenReview }) {
  const today = thailandBusinessDate();
  const initial = mobileInitialRange(window.location.search, today);
  const [selected, setSelected] = useState(initial.from === initial.to ? initial.from : '');
  const [month, setMonth] = useState((initial.from === initial.to ? initial.from : today).slice(0, 7));
  const [receipts, setReceipts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const stripRef = useRef(null);
  const active = view === 'mobile-receipts';
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const days = monthDays(month);
    setBusy(true); setError('');
    api.receipts({ from: days[0], to: days[days.length - 1] }).then(rows => {
      if (cancelled) return;
      setReceipts(rows);
      // Without a chosen day, start on the latest day that already has work.
      setSelected(current => current && current.startsWith(month) ? current : (rows.map(row => String(row.receipt_date).slice(0, 10)).filter(date => date <= today).sort().pop() || (today.startsWith(month) ? today : days[0])));
    }).catch(err => { if (!cancelled && !err.authExpired) setError(err.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [month, revision, active]);
  const byDate = useMemo(() => groupCalendarReceipts(receipts), [receipts]);
  // Cash lines for the chosen day come from the read-only overview report.
  const [cashRows, setCashRows] = useState({});
  useEffect(() => {
    if (!active || !selected) return undefined;
    const controller = new AbortController();
    setCashRows({});
    api.receiptsOverview({ ...overviewDefaults(selected), from: selected, to: selected, date_basis: 'sale', tab: 'daily', page_size: 100 }, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCashRows(Object.fromEntries(data.rows.map(row => [String(row.branch_id), row.lines?.find(line => line.channel_code === 'CASH') || null]))); })
      .catch(() => { /* cash detail is optional; the card still opens the receipt */ });
    return () => controller.abort();
  }, [selected, revision, active]);
  useEffect(() => {
    stripRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selected, busy, active]);
  if (!active) return null;
  const dayReceipts = receipts.filter(row => String(row.receipt_date).slice(0, 10) === selected);
  const future = selected > today;
  return <section className="ma-page ma-days" aria-busy={busy}>
    <div className="ma-month">
      <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => { setSelected(''); setMonth(m => shiftMonth(m, -1)); }}><ChevronLeft size={20}/></button>
      <strong>{THAI_MONTHS[Number(month.slice(5, 7)) - 1]} {Number(month.slice(0, 4)) + 543}</strong>
      <button type="button" aria-label="เดือนถัดไป" disabled={month >= today.slice(0, 7)} onClick={() => { setSelected(''); setMonth(m => shiftMonth(m, 1)); }}><ChevronRight size={20}/></button>
    </div>
    <div className="ma-day-strip" ref={stripRef} role="group" aria-label="เลือกวันขาย">
      {monthDays(month).map(date => {
        const info = byDate.get(date);
        const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
        return <button type="button" key={date} aria-pressed={date === selected} aria-label={`${overviewDate(date)}${info ? ` ${info.status_label || ''}` : ''}`} disabled={date > today} onClick={() => setSelected(date)} className={`tone-${dayTone(info?.status) || 'none'}`}>
          <small>{weekday}</small><strong>{Number(date.slice(8))}</strong><em>{dayWord[dayTone(info?.status)] || ''}</em>
        </button>;
      })}
    </div>
    {error && <div role="alert" className="ma-error"><strong>โหลดข้อมูลไม่สำเร็จ</strong><p>{error}</p><button onClick={() => setRevision(v => v + 1)}>ลองอีกครั้ง</button></div>}
    {busy && <div className="ma-loading" role="status"><RefreshCw size={18} className="spin"/> กำลังโหลด…</div>}
    {!busy && !error && selected && <>
      <h2 className="ma-day-title">{WEEKDAY_NAMES[new Date(`${selected}T00:00:00Z`).getUTCDay()]}ที่ {Number(selected.slice(8))} {THAI_MONTHS[Number(selected.slice(5, 7)) - 1]}</h2>
      <div className="ma-branch-list">{branches.map(branch => {
        const receipt = dayReceipts.find(row => String(row.branch_id) === String(branch.id));
        const state = receiptDateState(receipt);
        const cash = cashRows[String(branch.id)];
        const cashCounted = cash && cash.received !== null && cash.received !== undefined;
        const cashOff = cashCounted && cash.variance !== null && Math.abs(Number(cash.variance)) >= 0.01;
        return <button type="button" key={branch.id} className="ma-branch-card" disabled={!receipt} aria-label={`ตรวจเงินสด ${branch.name}`} onClick={() => onOpenReview(receipt.id)}>
          <span className="ma-branch-name"><strong>{branch.name}</strong><small>{receipt ? state.label : future ? 'ยังไม่ถึงวันขาย' : 'ยังไม่มีใบรับเงิน'}</small></span>
          {receipt && <span className="ma-branch-cash">
            <small>เงินสด</small>
            <strong>{receipt.status === 'DRAFT' ? '—' : money(cash?.cashier)}</strong>
            {receipt.status !== 'DRAFT' && cash && <em className={cashCounted ? cashOff ? 'is-off' : 'is-ok' : 'is-todo'}>{cashCounted ? cashOff ? varianceText(Number(cash.variance)) : 'นับแล้ว ตรง' : 'รอนับเงิน'}</em>}
          </span>}
          {receipt && <ChevronRight size={20}/>}
        </button>;
      })}</div>
    </>}
  </section>;
}
