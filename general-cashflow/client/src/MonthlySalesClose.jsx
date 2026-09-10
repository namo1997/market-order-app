import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { api } from './api.js';
import './monthlySalesClose.css';

const amount = (value) => value === null || value === undefined
  ? 'ยังไม่ทราบ'
  : Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (month) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return month;
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${month}-01T00:00:00+07:00`));
};

const BranchCloseCard = ({ row, canClose, busy, onCloseMonth }) => {
  const currentClose = row.latest_close?.source_snapshot_sha256 === row.source_snapshot_sha256;
  const changedAfterClose = Boolean(row.latest_close) && !currentClose;
  const state = currentClose ? 'ปิดยอดแล้ว' : changedAfterClose ? 'มีข้อมูลเปลี่ยนหลังปิด' : row.ready_to_close ? 'พร้อมปิดยอด' : 'ยังปิดไม่ได้';
  return <article className={`msc-branch ${currentClose ? 'is-closed' : row.ready_to_close ? 'is-ready' : 'is-blocked'}`}>
    <header>
      <div><span>{row.branch.code}</span><h3>{row.branch.name}</h3></div>
      <strong>{currentClose ? <CheckCircle2 size={16}/> : changedAfterClose ? <RefreshCw size={16}/> : row.ready_to_close ? <FileCheck2 size={16}/> : <AlertTriangle size={16}/>} {state}</strong>
    </header>
    <div className="msc-numbers">
      <div><span>ยอดขายที่ปิด</span><b>{amount(row.summary.recognized_sales)}</b></div>
      <div><span>จำนวนบิล</span><b>{Number(row.summary.bill_count || 0).toLocaleString('th-TH')}</b></div>
      <div><span>รับเงินจริงยืนยันแล้ว</span><b>{amount(row.summary.confirmed_received)}</b></div>
      <div><span>เงินยังรอรับ/หลักฐาน</span><b>{amount(row.summary.pending_receipts)}</b></div>
    </div>
    <div className="msc-progress"><span>ปิดรายวัน {row.completeness.closed_days}/{row.completeness.expected_days} วัน</span><span>รายการเงินค้าง {row.summary.pending_line_count + row.summary.unknown_expected_count}</span></div>
    {row.blockers.length > 0 && <div className="msc-list blocked"><strong>ต้องแก้ก่อนปิดเดือน</strong>{row.blockers.map((item) => <p key={item.code}>{item.message}</p>)}</div>}
    {row.warnings.length > 0 && <div className="msc-list warning"><strong>ส่งไปเป็นรายการติดตามแยก</strong>{row.warnings.map((item) => <p key={item.code}>{item.message}{item.count ? ` (${item.count})` : ''}</p>)}</div>}
    {row.latest_close && <p className="msc-revision">รุ่นล่าสุด r{row.latest_close.revision_number} · ปิดเมื่อ {new Date(row.latest_close.closed_at).toLocaleString('th-TH')}</p>}
    {canClose && !currentClose && <button type="button" className="msc-close-button" disabled={!row.ready_to_close || busy} onClick={() => onCloseMonth(row)}>
      {busy ? <LoaderCircle className="spin" size={17}/> : <FileCheck2 size={17}/>} {changedAfterClose ? 'ตรวจและปิดเป็นรุ่นใหม่' : 'ยืนยันปิดยอดสาขานี้'}
    </button>}
  </article>;
};

export default function MonthlySalesClose({ open, month, canClose = false, onClose, onClosed }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closingBranch, setClosingBranch] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setPreview(await api.monthlySalesClosePreview({ month, branch: 'ALL' })); }
    catch (err) { if (!err.authExpired) setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!open) return undefined;
    load();
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, month]);
  const closeBranch = async (row) => {
    setClosingBranch(row.branch.code); setError('');
    try {
      await api.closeMonthlySales({ month, branch_code: row.branch.code, preview_revision: row.source_snapshot_sha256, note });
      await load();
      onClosed?.();
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    } finally { setClosingBranch(''); }
  };
  if (!open) return null;
  return <div className="msc-backdrop" onMouseDown={onClose}>
    <section className="msc-dialog" role="dialog" aria-modal="true" aria-label={`สรุปปิดยอด ${monthLabel(month)}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="msc-title">
        <div><span>MONTHLY SALES CLOSE</span><h2>สรุปปิดยอด {monthLabel(month)}</h2><p>ตรึงยอดขายที่ปิดรายวัน และแยกเงินรอรับไว้ติดตามต่อ</p></div>
        <button type="button" onClick={onClose} aria-label="ปิดหน้าสรุป"><X size={22}/></button>
      </header>
      {error && <div className="msc-error" role="alert">{error}<button type="button" onClick={load}>ลองใหม่</button></div>}
      {loading && !preview && <div className="msc-loading"><LoaderCircle className="spin" size={22}/> กำลังตรวจข้อมูลทั้งเดือน…</div>}
      {preview && <>
        <div className={`msc-company ${preview.company.status === 'CLOSED_READY' ? 'ready' : ''}`}>
          <div><span>สถานะรวมบริษัท</span><strong>{preview.company.status === 'CLOSED_READY' ? 'ปิดครบทุกสาขาแล้ว' : `ปิดแล้ว ${preview.company.closed_branch_count}/${preview.company.operational_branch_count} สาขา`}</strong></div>
          <div><span>ยอดขายรวมจากสาขาที่ปิดแล้ว</span><strong>{amount(preview.company.summary.recognized_sales)} บาท</strong></div>
        </div>
        {canClose && <label className="msc-note">หมายเหตุการปิดเดือน (ถ้ามี)<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ตรวจครบตามเอกสารปิดวันแล้ว เงินรอรับติดตามต่อในระบบ"/></label>}
        <div className="msc-branches">{preview.branches.map((row) => <BranchCloseCard key={row.branch.code} row={row} canClose={canClose} busy={closingBranch === row.branch.code} onCloseMonth={closeBranch}/>)}</div>
      </>}
    </section>
  </div>;
}
