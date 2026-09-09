import OverviewStatement from './OverviewStatement.jsx';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Banknote, ChevronLeft, ChevronRight, FileText, RefreshCw, Search, Store, X } from 'lucide-react';
import { api } from './api.js';
import { overviewDefaults, overviewMoney as money, overviewDate as date, overviewWeekday, overviewRequest } from './receiptsOverviewState.js';
import './receiptsOverview.css';

const statuses = [['DRAFT','ยังไม่ส่ง'],['SUBMITTED','รอตรวจ'],['CHECKED_OK','ตรวจแล้วครบ'],['CHECKED_VARIANCE','ตรวจแล้วมีส่วนต่าง'],['NEEDS_CORRECTION','ต้องแก้ไข'],['CLOSED','ปิดเอกสารแล้ว'],['MISSING','ไม่มีเอกสาร'],['FUTURE','ยังไม่ถึงวัน'],['PENDING','รอยืนยันยอดรับ'],['WAITING_RECEIPT','รอรับเงิน'],['WAITING_EVIDENCE','รอหลักฐาน'],['LATE_EVIDENCE','หลักฐานย้อนหลังไม่ตรง'],['RECEIVED','มียอดรับยืนยันครบ'],['VARIANCE','มีส่วนต่าง'],['EVIDENCE','ต้องตรวจหลักฐาน']];
const nonzero = n => n !== null && n !== undefined && Math.abs(Number(n)) >= 0.01;
const CHANNEL_BRAND = {
  CREDIT_CARD_SCB: { src: '/brands/scb.svg', alt: 'SCB' },
  CREDIT_CARD_KBANK: { src: '/brands/kbank.svg', alt: 'KBank' },
  CREDIT_CARD_KTC: { src: '/brands/ktc.svg', alt: 'KTC' },
  QR_KPLUS: { src: '/brands/kbank.svg', alt: 'KBank' },
  PROMPTPAY: { src: '/brands/scb.svg', alt: 'SCB' },
  GRAB: { src: '/brands/grab.svg', alt: 'Grab' },
  QR_KRUNGSRI: { src: '/brands/krungsri.svg', alt: 'Krungsri' },
};
const ChannelHeader = ({ channel }) => {
  const brand = CHANNEL_BRAND[channel.code];
  const Fallback = channel.code === 'CASH' ? Banknote : Store;
  return <span className="ro-channel-heading">
    {brand ? <img src={brand.src} alt={brand.alt} /> : <Fallback aria-hidden="true" size={20} strokeWidth={2.2} />}
    <span>{channel.label}</span>
  </span>;
};
const Metric = ({ label, value, note, tone, onClick, actionLabel }) => onClick
  ? <button type="button" className={`ro-metric clickable ${tone || ''}`} onClick={onClick} aria-label={actionLabel || label}><span>{label}</span><strong>{value}</strong><small>{note}</small></button>
  : <div className={`ro-metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
const Amount = ({ value, variance = false }) => <span className={`ro-number ${variance && nonzero(value) ? 'ro-negative' : ''}`}>{money(value)}</span>;
const DailyAmount = ({ line, receivedBasis }) => line ? <div className="ro-money-cell">
  {!receivedBasis && line.cashier !== null && <div><span>แคชเชียร์</span><Amount value={line.cashier}/></div>}
  <div className="primary"><span>รับแล้ว</span><Amount value={line.received}/></div>
  {line.attention && <small className="ro-negative">{line.receipt_state}</small>}
</div> : <span className="ro-muted">—</span>;
const Day = ({ row }) => <><strong>{date(row.date)}</strong><small>{overviewWeekday(row.date)}</small><span className="ro-branch">{row.branch_name}</span></>;
const State = ({ row }) => {
  const [expanded, setExpanded] = useState(false);
  const reasons = row.reasons || [];
  return <div className="ro-state"><span className={`ro-badge ${row.status === 'FUTURE' ? 'muted' : row.attention ? 'warn' : 'ok'}`}>{row.status_label}</span>{row.receipt_state && row.receipt_state !== row.status_label && <small className="ro-pay-state">{row.receipt_state}</small>}{row.unknown_count > 0 && <small>รอยืนยัน {row.unknown_count} ช่องทาง</small>}{reasons.length === 1 && <small className="ro-negative">{reasons[0]}</small>}{reasons.length > 1 && !expanded && <><small className="ro-negative">{reasons[0]}</small><button type="button" className="ro-reasons-toggle" aria-expanded="false" aria-label={`ดูเหตุผลทั้งหมด ${reasons.length} ข้อ`} onClick={() => setExpanded(true)}>ดูทั้งหมด +{reasons.length - 1}</button></>}{reasons.length > 1 && expanded && <><ul className="ro-reasons-list">{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><button type="button" className="ro-reasons-toggle" aria-expanded="true" onClick={() => setExpanded(false)}>ย่อ</button></>}</div>;
};
const saved = () => { try { return { ...overviewDefaults(), ...JSON.parse(sessionStorage.getItem('cashflow-overview') || '{}') }; } catch { return overviewDefaults(); } };
const FollowupAction = ({ row, onWork, onDetail, onStatement, canStatement }) => {
  const text = (row.reasons || []).join(' ');
  if (/เอกสาร|ส่งยอด|รอตรวจ|แก้ไข|ปิดวัน/.test(text)) return <button type="button" className="ro-detail-button" onClick={() => onWork(row)}>เปิดงานรับเงิน</button>;
  if (/แคชเชียร์|POS|เงินทอน|ส่วนต่าง|ไม่ตรง/.test(text)) return <button type="button" className="ro-detail-button" onClick={() => onWork(row)}>เปิดงานรับเงิน</button>;
  if (/หลักฐาน|จับคู่|รหัส|ซ้ำ/.test(text)) return <button type="button" className="ro-detail-button" onClick={() => onDetail(row)}>ดูหลักฐาน</button>;
  if (/รอรับ|รอตรวจนับ|ยังไม่ทราบ|ไม่มีเอกสาร/.test(text)) return canStatement
    ? <button type="button" className="ro-detail-button" onClick={onStatement}>ตรวจ Statement</button>
    : <span className="ro-muted">รอตรวจไฟล์ Statement</span>;
  return <button type="button" className="ro-detail-button" onClick={() => onDetail(row)}>เปิดรายละเอียด</button>;
};

function ReceiptDetail({ receipt, onWork, onEvidence }) {
  return <section className="ro-receipt-detail">
    <div className="ro-detail-heading"><div><h3>{date(receipt.date)} · {receipt.branch_name}</h3><p>{receipt.status_label} · เอกสาร #{receipt.receipt_id}</p></div><button className="ro-primary" onClick={() => onWork(receipt)}><ArrowUpRight size={16}/> เปิดงานรับเงิน</button></div>
    <div className="ro-detail-totals"><Metric label="ยอด POS" value={money(receipt.pos)}/><Metric label="เงินทอนตั้งต้น" value={money(receipt.float)}/><Metric label="รายการอื่น" value={money(receipt.misc)}/><Metric label="ผลต่างยืนยันปิดวัน" value={money(receipt.confirmed_variance)} note={receipt.confirmed_source === 'POST_CLOSE_ADJUSTMENT' ? 'รวมรายการปรับปรุงหลังปิดแล้ว' : receipt.confirmed_source === 'SAVED_RECONCILIATION' ? 'ยอดบันทึกเดิม ไม่มีภาพยอดตอนปิด' : receipt.status === 'CLOSED' ? 'ตามยอดยืนยันปิดวัน' : 'ยังไม่ปิดเอกสาร'}/></div>
    <div className="ro-detail-table"><table><caption>รายละเอียดรายช่องทาง · หน่วยบาท</caption><thead><tr><th>ช่องทาง / บัญชี</th><th>แคชเชียร์</th><th>ก่อนหัก</th><th>รายการหัก</th><th>คาดรับสุทธิ</th><th>รับที่ยืนยัน</th><th>ผลต่างรับ</th><th>ปรับปรุง</th></tr></thead><tbody>{receipt.lines.map(l => <tr key={l.id}><th>{l.channel_label}<small>{l.account_label || 'ยังไม่ระบุบัญชี'}</small>{l.batch_key && <small>ชุดโอน {l.batch_key} · วันขาย {l.sale_dates.map(date).join(', ')}</small>}</th><td><Amount value={l.cashier}/></td><td><Amount value={l.before}/></td><td><Amount value={l.fee}/></td><td><Amount value={l.expected}/></td><td><Amount value={l.received}/><small>{l.receipt_state}</small></td><td><Amount value={l.variance} variance/></td><td><Amount value={(l.line_adjustment || 0) + (l.adjustment || 0)}/></td></tr>)}</tbody></table></div>
    <p className="ro-help">เงินสดรับที่ยืนยัน = ยอดตรวจนับ − เงินทอน · รายการหักและปรับปรุงแสดงแยกจากเงินรับ · — หมายถึงยังยืนยันไม่ได้</p>
    {receipt.reasons.length > 0 && <div className="ro-reasons"><strong><AlertTriangle size={16}/> สิ่งที่ต้องติดตาม</strong><ul>{receipt.reasons.map((reason,i) => <li key={i}>{reason}</li>)}</ul></div>}
    <div className="ro-detail-columns"><section><h4>หลักฐาน ({receipt.attachments?.length || 0})</h4>{receipt.attachments?.map(a => <button className="ro-evidence" key={a.id} onClick={() => onEvidence(a)}><FileText size={16}/><span>{a.original_name}<small>{a.attachment_type}</small></span><ArrowUpRight size={15}/></button>)}{!receipt.attachments?.length && <p className="ro-help">ยังไม่มีไฟล์หลักฐาน</p>}</section><section><h4>ผู้ดำเนินการและหมายเหตุ</h4><dl><dt>ผู้ส่งยอด</dt><dd>{receipt.submitted_by || '—'}<small>{receipt.submitted_at || ''}</small></dd><dt>ผู้ตรวจ</dt><dd>{receipt.checked_by || '—'}<small>{receipt.checked_at || ''}</small></dd><dt>ผู้ปิดเอกสาร</dt><dd>{receipt.closed_by || '—'}<small>{receipt.closed_at || ''}</small></dd></dl><p>{receipt.review_note || 'ยังไม่มีบันทึกกันลืม'}</p>{receipt.correction_note && <p className="ro-negative">ส่งกลับ: {receipt.correction_note}</p>}{receipt.misc_items?.map(i => <p key={i.id}>{i.label} · {money(i.amount)}</p>)}</section></div>
    <details className="ro-disclosure"><summary>รายการต้นทางและชุดโอน ({receipt.lines.reduce((n,l) => n + l.transactions.length, 0)} รายการ)</summary><div className="ro-detail-table"><table><thead><tr><th>วันที่ต้นทาง</th><th>ช่องทาง / อ้างอิง</th><th>จำนวนเงิน</th><th>ประเภทหลักฐาน</th><th>ไฟล์ต้นทาง</th></tr></thead><tbody>{receipt.lines.flatMap(l => l.transactions.map(t => <tr key={`${l.id}:${t.id}`}><td>{date(t.date)}</td><td>{l.channel_label}<small>{t.reference || t.description}</small></td><td><Amount value={t.amount}/></td><td>{t.bank_evidence ? 'รายการรับจากธนาคาร' : 'รายงาน / ยังไม่ยืนยันเงินเข้า'}</td><td>{t.import_name}</td></tr>))}</tbody></table></div></details>
    <details className="ro-disclosure"><summary>ประวัติและรายการปรับปรุงหลังปิด</summary>{receipt.adjustments?.map(a => <p key={a.id}>ครั้งที่ {a.revision} · {money(a.amount)} บาท · {a.reason} · {a.actor_name || '—'}</p>)}{receipt.audit?.map(a => <p key={a.id}>{a.created_at} · {a.action} · {a.actor_name || '—'} {a.note || ''}</p>)}{!receipt.adjustments?.length && !receipt.audit?.length && <p>ไม่มีประวัติที่บันทึกไว้</p>}</details>
  </section>;
}

export default function ReceiptsOverview({ active, onOpenWork, onOpenEvidence, canImportStatement = false }) {
  const [statementOpen, setStatementOpen] = useState(false);
  const [filters, setFilters] = useState(saved);
  const [report, setReport] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState(null);
  const [extraOpen, setExtraOpen] = useState(() => { try { const f = JSON.parse(sessionStorage.getItem('cashflow-overview') || '{}'); return Boolean(f.channel_id || f.account_id || f.status); } catch { return false; } });
  const [details, setDetails] = useState([]);
  const [detailError, setDetailError] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const scroll = useRef(null);
  const returnScroll = useRef({ left: 0, top: 0 });
  const drawer = useRef(null);
  const previousFocus = useRef(null);
  const change = changes => { setSelection(null); setReport(null); setBusy(true); setFilters(f => overviewRequest(f, changes)); };

  useEffect(() => { sessionStorage.setItem('cashflow-overview', JSON.stringify(filters)); }, [filters]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setBusy(true); setError(''); setReport(null);
    api.receiptsOverview(filters, { signal: controller.signal }).then(data => {
      setReport(data);
      setMetadata(data);
      requestAnimationFrame(() => scroll.current?.scrollTo(returnScroll.current.left, returnScroll.current.top));
    }).catch(err => { if (err.name !== 'AbortError' && !err.authExpired) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [filters, revision, active]);

  useEffect(() => {
    if (!selection || !active) return;
    const controller = new AbortController();
    previousFocus.current = document.activeElement;
    drawer.current?.focus();
    setDetails([]); setDetailError(''); setDetailBusy(true);
    const ids = selection.receipt_ids || [selection.receipt_id];
    Promise.all(ids.filter(Boolean).map(id => api.receiptsOverview({ ...filters, basis: 'sale', tab: 'daily', receipt_id: id, channel_id: '', account_id: '', from: '1900-01-01', to: '1900-01-01', status: '', attention: false, page: 1 }, { signal: controller.signal })))
      .then(results => setDetails(results.flatMap(r => r.rows)))
      .catch(err => { if (err.name !== 'AbortError') setDetailError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setDetailBusy(false); });
    return () => { controller.abort(); previousFocus.current?.focus?.(); };
  }, [selection, active]);

  const open = row => { returnScroll.current = { left: scroll.current?.scrollLeft || 0, top: scroll.current?.scrollTop || 0 }; setSelection(row); };
  const canOpen = row => Boolean(row.receipt_id || row.receipt_ids?.length);
  const openRow = row => { if (canOpen(row)) open(row); };
  const onRowKeyDown = (e, row) => {
    if (e.target.closest('button,a')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(row); }
  };
  const work = row => { setSelection(null); onOpenWork(row); };
  const field = (label, key, options) => <label>{label}<select aria-label={label} value={filters[key]} onChange={e => change({ [key]: e.target.value })}><option value="">ทั้งหมด</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const optionText = (options, value) => options.find(([v]) => String(v) === String(value))?.[1] || '';
  const extraDefs = [
    { key: 'channel_id', label: 'ช่องทาง', text: optionText((metadata?.all_channels || []).map(c => [c.id, c.label]), filters.channel_id) },
    { key: 'account_id', label: 'บัญชี', text: optionText((metadata?.accounts || []).map(a => [a.id, `${a.label}${a.last4 && !a.label.includes(a.last4) ? ` ••••${a.last4}` : ''}`]), filters.account_id) },
    { key: 'status', label: 'สถานะ', text: optionText(statuses, filters.status) },
  ].filter(d => filters[d.key]);
  const extraCount = extraDefs.length;
  const extraChips = extraDefs.map(d => <span className="ro-chip" key={d.key}>{d.label}: {d.text}<button type="button" onClick={() => change({ [d.key]: '' })} aria-label={`ล้างตัวกรอง${d.label}`}>×</button></span>);
  const clearExtra = () => change({ channel_id: '', account_id: '', status: '' });
  const selectMonth = (value) => {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const next = overviewDefaults(`${value}-01`);
    change({ from: next.from, to: next.to });
  };
  const stepMonth = (offset) => {
    const base = filters.from || overviewDefaults().from;
    const next = new Date(Date.UTC(Number(base.slice(0,4)), Number(base.slice(5,7))-1+offset, 1));
    selectMonth(next.toISOString().slice(0,7));
  };
  const [hiddenChannels,setHiddenChannels]=useState([]);
  const selectableChannels=(report?.channels || []).filter(c=>c.code!=='OTHER_UNKNOWN');
  const visibleChannels=selectableChannels.filter(c=>!hiddenChannels.includes(c.id));
  const countUnit=filters.tab==='transactions'?'ธุรกรรม':'วัน–สาขา';
  const summary = report?.summary;
  const daily = filters.tab === 'daily';
  const receivedBasis = report?.basis === 'received';
  const pending = filters.tab === 'followups';

  return <section className="ro-workspace" hidden={!active} data-generated-at={report?.generated_at || ''} data-build-commit={import.meta.env.VITE_BUILD_COMMIT || 'development'}>
    <div className="ro-title"><div><span className="ro-eyebrow">FINANCE / DAILY CONTROL</span><h2>ภาพรวมรับเงิน</h2><p>รับแล้วเท่าไร · ยังรอเท่าไร · ต้องทำอะไรต่อ</p></div><div className="ro-title-actions">{canImportStatement && <button className="ro-primary" onClick={()=>setStatementOpen(true)}><FileText size={16}/> นำเข้า / ตรวจ Statement</button>}<button className="ro-refresh" aria-label="รีเฟรชภาพรวม" onClick={() => setRevision(r => r+1)} disabled={busy}><RefreshCw size={17} className={busy ? 'spin' : ''}/></button></div></div>
    <div className="ro-toolbar">
      <div className="ro-toolbar-group" role="group" aria-label="เลือกเดือนและสาขา"><div className="ro-month-stepper"><button onClick={()=>stepMonth(-1)} aria-label="เดือนก่อนหน้า"><ChevronLeft size={18}/></button><input type="month" aria-label="เลือกเดือนรายงาน" value={filters.from?.slice(0,7) || ''} onChange={e=>selectMonth(e.target.value)}/><button onClick={()=>stepMonth(1)} aria-label="เดือนถัดไป"><ChevronRight size={18}/></button><button className="ro-today" onClick={()=>selectMonth(overviewDefaults().from.slice(0,7))}>เดือนนี้</button></div>{field('สาขา','branch_id',(metadata?.branches || []).map(b => [b.id,b.name]))}</div>
      <div className="ro-toolbar-group" role="group" aria-label="ฐานวันที่"><div className="ro-basis"><button className={filters.basis === 'sale' ? 'selected' : ''} onClick={() => change({ basis: 'sale' })}>วันที่ขาย</button><button className={filters.basis === 'received' ? 'selected' : ''} onClick={() => change({ basis: 'received' })}>วันที่รับเงินจริง</button></div><small className="ro-basis-hint">ยอดและวันที่เปลี่ยนตามฐานที่เลือก</small></div>
    </div>
    <details className="ro-extra" open={extraOpen} onToggle={e => setExtraOpen(e.target.open)}>
      <summary>ตัวกรองเพิ่มเติม{extraCount > 0 && <span className="ro-extra-count">{extraCount} เงื่อนไข</span>}</summary>
      <div className="ro-scope">{field('ช่องทาง','channel_id',(metadata?.all_channels || []).map(c => [c.id,c.label]))}{field('บัญชีปลายทาง','account_id',(metadata?.accounts || []).map(a => [a.id,`${a.label}${a.last4 && !a.label.includes(a.last4) ? ` ••••${a.last4}` : ''}`]))}{field('สถานะ','status',statuses)}</div>
      {extraCount > 0 && <div className="ro-extra-foot"><div className="ro-chips">{extraChips}</div><button type="button" onClick={clearExtra}>ล้างตัวกรองเพิ่มเติม</button></div>}
    </details>
    <div className="ro-summary" aria-busy={busy}><Metric label="รับเงินยืนยันแล้ว" value={money(summary?.received)} note={`${receivedBasis ? 'ตามวันที่รับเงินจริง' : 'ของวันขาย'} · หน่วยบาท`} tone="hero" onClick={() => change({ tab: 'transactions' })} actionLabel="ดูรายการรับเงิน"/><Metric label="ยังรอยืนยัน" value={`${summary?.pending_count ?? '—'} ${countUnit}`} note={summary?.pending_expected != null ? `ยอดคาดรับรวมของกลุ่มนี้ ${money(summary.pending_expected)} บาท (รวมส่วนที่รับแล้ว)` : 'ยังไม่ทราบยอด'} onClick={() => change({ tab: 'followups', attention: false })} actionLabel="ดูรายการที่ยังไม่ครบ"/><Metric label="ต้องตรวจเพิ่ม" value={`${summary?.attention ?? '—'} ${countUnit}`} note="กลุ่มนี้อาจรวมรายการจากกล่องยังรอยืนยัน ห้ามนำจำนวนมาบวกกัน" tone="attention" onClick={() => change({ tab: 'followups', attention: true })} actionLabel="เปิดรายการพร้อมเหตุผล"/></div>
    <div className="ro-table-header"><div className="ro-tabs" role="tablist" aria-label="รายงานรับเงิน">{[['daily','สรุปรายวัน'],['transactions','รายการรับเงิน'],['followups','เงินรอรับและข้อแตกต่าง']].map(([id,label]) => <button role="tab" aria-selected={filters.tab === id} key={id} onClick={() => change({ tab:id })}>{label}</button>)}</div><label className="ro-attention-toggle"><input type="checkbox" checked={filters.attention} onChange={e => change({ attention:e.target.checked })}/> เฉพาะรายการต้องติดตาม</label></div>
    <p className="ro-basis-note">{report?.note || 'กำลังโหลดรายงาน'} <span>{report ? `ข้อมูลล่าสุด ${new Date(report.generated_at).toLocaleString('th-TH')} · ` : ''}หน่วย: บาท · — ยังยืนยันไม่ได้</span></p>
    {error && <div className="ro-error" role="alert">{error}<button onClick={() => setRevision(r=>r+1)}>ลองอีกครั้ง</button></div>}
    {daily && <details className="ro-extra ro-column-picker"><summary>เลือกช่องทางที่แสดง ({visibleChannels.length}/{selectableChannels.length})</summary><div className="ro-column-options">{selectableChannels.map(c=><label key={c.id}><input type="checkbox" checked={!hiddenChannels.includes(c.id)} onChange={e=>setHiddenChannels(current=>e.target.checked?current.filter(id=>id!==c.id):[...current,c.id])}/>{c.label}</label>)}<button onClick={()=>setHiddenChannels([])}>แสดงทั้งหมด</button></div><p>ซ่อนเฉพาะคอลัมน์ ยอดรวมยังรวมทุกช่องทางตามตัวกรอง</p></details>}
    <div className={`ro-table-scroll ${busy ? 'loading' : ''}`} ref={scroll} onScroll={e => { returnScroll.current = { left:e.currentTarget.scrollLeft, top:e.currentTarget.scrollTop }; }} aria-busy={busy}>
      <table className="ro-table"><caption className="ro-sr">{daily ? 'สรุปรายวัน' : pending ? 'งานติดตามรายวัน' : 'รายการรับเงิน'}</caption><thead><tr><th className="ro-frozen">{receivedBasis ? 'วันที่รับเงินจริง' : 'วันที่ขาย'} / สาขา</th>{daily ? <>{visibleChannels.map(c => <th key={c.id}><ChannelHeader channel={c}/><small>ยอดรับที่ยืนยัน</small></th>)}<th>รวมรับแล้ว<small>เฉพาะยอดที่มีข้อมูล</small></th></> : pending ? <><th>ช่องทางที่ต้องตาม</th><th>คาดรับสุทธิ</th><th>รับที่ยืนยัน</th><th>สิ่งที่ต้องตรวจ</th><th>ระยะเวลารอ</th><th>การดำเนินการ</th></> : <><th>{receivedBasis ? 'วันขายอ้างอิง' : 'วันที่รับเงินจริง'}</th><th>ช่องทาง / บัญชี</th><th>ก่อนหัก / รายการหัก</th><th>เงินรับ</th><th>หลักฐาน / อ้างอิง</th></>}<th>สถานะ / การตรวจสอบ</th><th>รายละเอียด</th></tr></thead>
      <tbody>{!busy && !error && report?.rows.length === 0 && <tr><td colSpan={20}><div className="ro-empty"><Search size={28}/><strong>ไม่พบรายการตามเงื่อนไขนี้</strong><span>ปรับช่วงวันที่หรือตัวกรองเพื่อดูรายการอื่น</span></div></td></tr>}{report?.rows.map(row => <tr key={row.key} onClick={e => { if (!e.target.closest('button,a')) openRow(row); }} onKeyDown={canOpen(row) ? e => onRowKeyDown(e, row) : undefined} tabIndex={canOpen(row) ? 0 : undefined} data-clickable={canOpen(row) ? 'true' : undefined} className={row.status === 'FUTURE' ? 'ro-future' : row.attention ? 'ro-row-attention' : ''}>
        <th className="ro-frozen"><Day row={row}/></th>{daily ? <>{visibleChannels.map(c => { const l = row.lines.find(l => l.channel_id === c.id); return <td key={c.id} className={l?.attention ? 'ro-cell-attention' : ''}><DailyAmount line={l} receivedBasis={receivedBasis}/></td>; })}<td className="ro-total"><div className="ro-total-value"><span>รับรวม</span><Amount value={row.received}/></div>{row.unknown_count > 0 && <small>ยังยืนยันไม่ครบ</small>}</td></> : pending ? <><td>{row.lines.filter(l=>l.attention).map(l=><span className="ro-channel-tag" key={l.id}>{l.channel_label}</span>)}</td><td><Amount value={row.expected}/>{row.lines.some(l=>l.expected === null) && <small>ยังไม่ทราบครบทุกช่องทาง</small>}</td><td><Amount value={row.received}/></td><td className="ro-reason-cell">{row.reasons.slice(0,3).map((s,i)=><div key={i}>{s}</div>)}</td><td>{row.lines.some(l=>l.waiting_days !== null) ? `${Math.max(0,...row.lines.map(l=>l.waiting_days || 0))} วัน` : '—'}<small>ยังไม่ระบุวันครบกำหนด</small></td><td><FollowupAction row={row} onWork={work} onDetail={openRow} onStatement={() => setStatementOpen(true)} canStatement={canImportStatement}/></td></> : <><td>{receivedBasis ? (row.sale_dates || [row.receipt_date]).map(date).join(', ') : row.received_date ? date(row.received_date) : row.batch_key && row.received !== null ? row.received_dates.map(date).join(', ') : 'ยังไม่ยืนยันวันรับ'}</td><td>{row.channel_label}<small>{row.account_label || 'ยังไม่ระบุบัญชี'}</small></td><td>{row.before === null ? <small>ดูยอดรวมในรายละเอียดช่องทาง</small> : <><Amount value={row.before}/><small>รายการหัก {money(row.fee)}</small></>}</td><td><Amount value={row.received}/></td><td className="ro-reason-cell">{row.evidence_basis}<small>{row.reference || row.description || ''}</small></td></>}<td><State row={row}/></td><td>{row.receipt_id || row.receipt_ids?.length ? <button className="ro-detail-button" onClick={() => open(row)} aria-label={`รายละเอียด ${row.date} ${row.branch_name}`}>เปิดดู <ArrowUpRight size={15}/></button> : <span className="ro-muted">—</span>}</td>
      </tr>)}</tbody></table></div>
    <div className="ro-footer"><span>{busy ? 'กำลังโหลด…' : `${report?.pagination.total ?? 0} รายการ`} · ยอดสรุปรวมทุกหน้า</span><div><button disabled={busy || filters.page <= 1} onClick={() => change({ page:filters.page-1 })} aria-label="หน้าก่อนหน้า"><ChevronLeft size={17}/></button><span>หน้า {filters.page} / {Math.max(1,report?.pagination.pages || 0)}</span><button disabled={busy || filters.page >= (report?.pagination.pages || 0)} onClick={() => change({ page:filters.page+1 })} aria-label="หน้าถัดไป"><ChevronRight size={17}/></button></div></div>
    {statementOpen && active && <OverviewStatement onConfirmed={()=>setRevision(r=>r+1)} onClose={()=>setStatementOpen(false)}/>}
    {selection && active && <div className="ro-modal-backdrop" onClick={() => setSelection(null)}><aside className="ro-drawer" role="dialog" aria-modal="true" aria-label="รายละเอียดรับเงิน" tabIndex={-1} ref={drawer} onClick={e=>e.stopPropagation()} onKeyDown={e=>{ if(e.key==='Escape') setSelection(null); if(e.key==='Tab'){ const nodes=[...drawer.current.querySelectorAll('button:not([disabled]), summary, a[href]')]; if(e.shiftKey && document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey && document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();} } }}><header><div><span className="ro-eyebrow">RECEIPT DETAILS</span><h2>รายละเอียดรับเงิน</h2></div><button onClick={()=>setSelection(null)} aria-label="ปิดรายละเอียด"><X size={22}/></button></header>{detailBusy && <p role="status">กำลังโหลดรายละเอียด…</p>}{detailError && <div className="ro-error" role="alert">{detailError}</div>}{details.map(r=><ReceiptDetail key={r.key} receipt={r} onWork={work} onEvidence={onOpenEvidence}/>)}{!detailBusy && !details.length && !detailError && <p>ไม่พบเอกสารต้นทางในขอบเขตที่เลือก</p>}</aside></div>}
  </section>;
}
