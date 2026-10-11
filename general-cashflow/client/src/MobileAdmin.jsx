import { useEffect, useState } from 'react';
import { ArrowUpRight, Banknote, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardCheck, FileSpreadsheet, FileText, House, LayoutGrid, LogOut, RefreshCw, Settings, Sunrise } from 'lucide-react';
import { api } from './api.js';
import { overviewDefaults, overviewDate, overviewMoney as money } from './receiptsOverviewState.js';
import { mobileMonthRange, mobileInitialRange } from './mobileAdminState.js';
import './mobileAdmin.css';

export const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
export const mobileStartView = (user) => user?.role === 'admin' && isPhone() ? 'mobile-home' : 'dashboard';
const titles = { 'mobile-home': 'ภาพรวม', 'mobile-receipts': 'รับเงิน', 'mobile-more': 'เพิ่มเติม', dashboard: 'ตรวจรับเงิน', overview: 'ภาพรวมรับเงิน', pnl: 'กำไรขาดทุน', report: 'รายงาน', brief: 'งานค้าง', inbox: 'ไฟล์อีเมล', settings: 'ตั้งค่า' };
const primary = [['mobile-home', 'หน้าหลัก', House], ['mobile-receipts', 'รับเงิน', Banknote]];
export function MobileAdminNav({ user, view, onNavigate }) {
  const current = ['dashboard', 'overview'].includes(view) ? 'mobile-receipts' : primary.some(([id]) => id === view) ? view : 'mobile-more';
  return <>
    <header className="ma-header"><div className="ma-logo"><Banknote size={22}/></div><div><h1>{titles[view] || 'ภาพรวม'}</h1></div><span className="ma-user">{user.full_name || user.username}</span></header>
    <nav className="ma-nav" aria-label="เมนูแอดมินมือถือ">{primary.map(([id, label, Icon]) => <button key={id} type="button" aria-current={current === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={22}/><span>{label}</span></button>)}</nav>
  </>;
}

export function MobileAdminMore({ onNavigate, onLogout }) {
  return <section className="ma-page"><p className="ma-eyebrow">เครื่องมือแอดมิน</p><div className="ma-menu">{[
    ['overview', 'ภาพรวมแบบตาราง', 'Statement และปิดยอดเดือน', FileSpreadsheet],
    ['dashboard', 'ตรวจรับเงิน', 'ตรวจยอดและหลักฐานรายวัน', ClipboardCheck],
    ['brief', 'สรุปงานค้าง', 'งานที่ต้องติดตาม', Sunrise],
    ['inbox', 'ไฟล์อีเมล', 'Statement และไฟล์นำเข้า', FileText],
    ['report', 'รายงาน', 'ค้นย้อนหลังและส่งออก', ChartNoAxesCombined],
    ['settings', 'ตั้งค่า', 'สาขา บัญชี และช่องทางรับเงิน', Settings],
  ].map(([id, label, note, Icon]) => <button key={id} onClick={() => onNavigate(id)}><Icon size={22}/><span><strong>{label}</strong><small>{note}</small></span><ChevronRight size={18}/></button>)}</div><button className="ma-logout" onClick={onLogout}><LogOut size={18}/> ออกจากระบบ</button></section>;
}

export function MobileAdminOverview({ view, branches, onNavigate, onOpenWork, onOpenEvidence, Calendar }) {
  const [filters, setFilters] = useState(() => ({ ...overviewDefaults(), ...mobileInitialRange(window.location.search), page_size: 12 }));
  const [report, setReport] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const home = view === 'mobile-home';
  const active = home || view === 'mobile-receipts';
  const change = (values) => { setReport(null); setBusy(true); setFilters(f => ({ ...f, ...values, page: values.page ?? 1 })); };
  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setBusy(true); setError(''); setReport(null);
    // Overview is read-only; entering the phone home never creates a receipt.
    const query = home ? { ...filters, attention: false, page: 1 } : filters;
    api.receiptsOverview(query, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setReport(data); setSnapshot(data.preview_snapshot || null); }
    }).catch(err => { if (!controller.signal.aborted && !err.authExpired) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [filters, revision, home, active]);
  const openReceipts = (attention) => { change({ attention }); onNavigate('mobile-receipts'); };
  const summary = report?.summary;
  if (!active) return null;
  return <section className="ma-page" aria-busy={busy}>
    <div className="ma-filters"><label><span>{snapshot ? 'วันที่ขาย' : 'เดือนขาย'}</span><input type={snapshot ? 'date' : 'month'} aria-label={snapshot ? 'วันที่ข้อมูลจริง' : 'เดือนขาย'} disabled={Boolean(snapshot)} value={snapshot?.date || filters.from.slice(0, 7)} onInput={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { const period = mobileMonthRange(e.target.value); change({ from: period.from, to: period.to }); } }}/></label><label><span>สาขา</span><select aria-label="สาขามือถือ" value={filters.branch_id} onChange={e => change({ branch_id: e.target.value })}><option value="">ทุกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="ma-icon" aria-label="โหลดข้อมูลใหม่" disabled={busy} onClick={() => setRevision(v => v + 1)}><RefreshCw size={19} className={busy ? 'spin' : ''}/></button></div>
    {!snapshot && Calendar && <details className="ma-calendar"><summary>ปฏิทิน{filters.from === filters.to ? ` · ${overviewDate(filters.from)}` : ''}</summary><Calendar branchId={filters.branch_id} allowAllBranches date={filters.from} refreshKey={revision} onDateChange={date => change({ from: date, to: date })}/>{filters.from === filters.to && <button className="ma-primary" onClick={() => change(mobileMonthRange(filters.from.slice(0, 7)))}>ดูทั้งเดือน</button>}</details>}
    {snapshot && <p className="ma-note">ข้อมูลจริง {overviewDate(snapshot.date)} · สำเนาอ่านอย่างเดียว</p>}
    {error && <div role="alert" className="ma-error"><strong>โหลดข้อมูลไม่สำเร็จ</strong><p>{error}</p><button onClick={() => setRevision(v => v + 1)}>ลองอีกครั้ง</button></div>}
    {busy && <div className="ma-loading" role="status"><RefreshCw size={18} className="spin"/> กำลังโหลดข้อมูล…</div>}
    {!busy && !error && report && <>
      {home ? <>
        <section className="ma-balance"><span>รับเงินยืนยันแล้ว</span><strong>{money(summary?.received)}</strong><small>บาท · {snapshot ? 'วันขาย ' : 'ตามวันขาย ถึง '}{overviewDate(snapshot?.date || filters.to)}</small><button onClick={() => openReceipts(false)}>ดูรายการรับเงิน <ArrowUpRight size={18}/></button></section>
        <div className="ma-metrics"><div><span>ยังรอยืนยัน</span><strong>{summary?.pending_count ?? '—'}<small>วัน–สาขา</small></strong></div><button onClick={() => openReceipts(true)}><span>ต้องตรวจเพิ่ม <ChevronRight size={16}/></span><strong>{summary?.attention ?? '—'}<small>วัน–สาขา</small></strong></button></div>
        <p className="ma-note">สองกลุ่มอาจซ้ำกัน · ยอดรวมทุกหน้า</p>
        <h2 className="ma-section-title">ทำต่อ</h2><button className="ma-task" onClick={() => openReceipts(true)}><span className="ma-task-icon"><ClipboardCheck size={24}/></span><span><strong>ตรวจรายการรับเงิน</strong><small>ดูยอดและหลักฐานทีละวัน</small></span><ChevronRight size={20}/></button>
        <details className="ma-explanation"><summary>ยอดนี้นับอย่างไร</summary><p>{report.note}</p><p>— หมายถึงยังยืนยันไม่ได้ ไม่ใช่ยอดศูนย์</p><p>ข้อมูลล่าสุด {new Date(report.generated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p></details>
      </> : <>
        <div className="ma-segment" aria-label="รายการรับเงิน"><button aria-pressed={!filters.attention} onClick={() => change({ attention: false })}>ทั้งหมด</button><button aria-pressed={filters.attention} onClick={() => change({ attention: true })}>ต้องตรวจ</button></div>
        <div className="ma-list-heading"><h2>{filters.attention ? 'รายการที่ต้องตรวจ' : 'รายการรับเงิน'}</h2><span>{report.pagination.total} วัน–สาขา</span></div>
        <p className="ma-note">ยอดรับที่ยืนยัน · บาท · — ยังยืนยันไม่ได้</p>
        <div className="ma-receipts">{report.rows.map(row => <article key={row.key} className="ma-receipt"><button className="ma-receipt-title" type="button" aria-label={`ตรวจรับเงิน ${row.branch_name}`} disabled={!row.receipt_id || Boolean(snapshot)} onClick={() => onOpenWork(row)}><div><strong>{row.branch_name}</strong><small>{overviewDate(row.date)}</small></div><div className="ma-row-amount"><strong>{money(row.received)}</strong><span className={`ma-status ${row.attention ? 'warn' : ''}`}>{row.status_label}</span></div><ChevronRight size={17}/></button><details className="ma-receipt-info"><summary>ดูสรุปและไฟล์</summary><div className="ma-receipt-body">{row.reasons?.length > 0 && <ul className="ma-reasons">{row.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}{row.lines?.map(line => <div className="ma-channel" key={line.id ?? line.channel_id}><span>{line.channel_label}<small>{line.receipt_state}</small></span><strong>{money(line.received)}</strong></div>)}{row.attachments?.map(file => <button className="ma-evidence" key={file.id} disabled={Boolean(snapshot && !snapshot.attachments_copied)} title={snapshot && !snapshot.attachments_copied ? 'สำเนานี้มีเฉพาะข้อมูล ยังไม่ได้โหลดไฟล์หลักฐาน' : undefined} onClick={() => onOpenEvidence(file)}><FileText size={17}/><span>{file.original_name}</span><ArrowUpRight size={16}/></button>)}{snapshot && row.attachments?.length > 0 && <p className="ma-note">แสดงชื่อไฟล์ · ยังไม่ได้โหลดภาพหลักฐาน</p>}{snapshot ? <p className="ma-note">สำเนาอ่านอย่างเดียว · ไม่แก้ข้อมูลจริง</p> : row.receipt_id ? <button className="ma-primary" onClick={() => onOpenWork(row)}>ตรวจรับเงิน <ArrowUpRight size={17}/></button> : <p className="ma-note">{row.status === 'FUTURE' ? 'ยังไม่ถึงวันขาย' : 'ยังไม่มีใบรับเงิน'}</p>}</div></details></article>)}</div>
        {!report.rows.length && <div className="ma-empty"><ClipboardCheck size={30}/><h3>{filters.attention ? 'ไม่มีรายการต้องตรวจในช่วงนี้' : 'ไม่มีรายการในช่วงนี้'}</h3><p>ลองเปลี่ยนเดือนหรือสาขา</p></div>}
        <div className="ma-pagination"><button aria-label="หน้าก่อนหน้า" disabled={filters.page <= 1} onClick={() => change({ page: filters.page - 1 })}><ChevronLeft size={20}/></button><span>{filters.page} / {Math.max(1, report.pagination.pages)}</span><button aria-label="หน้าถัดไป" disabled={filters.page >= report.pagination.pages} onClick={() => change({ page: filters.page + 1 })}><ChevronRight size={20}/></button></div>
      </>}
    </>}
  </section>;
}
