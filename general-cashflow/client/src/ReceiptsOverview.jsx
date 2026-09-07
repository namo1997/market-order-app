import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, FileText, RefreshCw, Search, X } from 'lucide-react';
import { api } from './api.js';
import { overviewDefaults, overviewMoney as money, overviewDate as date, overviewWeekday, overviewRequest } from './receiptsOverviewState.js';
import './receiptsOverview.css';

const statuses = [['DRAFT','ยังไม่ส่ง'],['SUBMITTED','รอตรวจ'],['CHECKED_OK','ตรวจแล้วครบ'],['CHECKED_VARIANCE','ตรวจแล้วมีส่วนต่าง'],['NEEDS_CORRECTION','ต้องแก้ไข'],['CLOSED','ปิดเอกสารแล้ว'],['MISSING','ไม่มีเอกสาร'],['FUTURE','ยังไม่ถึงวัน'],['PENDING','รอยืนยันยอดรับ'],['WAITING_RECEIPT','รอรับเงิน'],['WAITING_EVIDENCE','รอหลักฐาน'],['LATE_EVIDENCE','หลักฐานย้อนหลังไม่ตรง'],['RECEIVED','มียอดรับยืนยันครบ'],['VARIANCE','มีส่วนต่าง'],['EVIDENCE','ต้องตรวจหลักฐาน']];
const nonzero = n => n !== null && n !== undefined && Math.abs(Number(n)) >= 0.01;
const Metric = ({ label, value, note, tone }) => <div className={`ro-metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
const Amount = ({ value, variance = false }) => <span className={`ro-number ${variance && nonzero(value) ? 'ro-negative' : ''}`}>{money(value)}</span>;
const Day = ({ row }) => <><strong>{date(row.date)}</strong><small>{overviewWeekday(row.date)}</small><span className="ro-branch">{row.branch_name}</span></>;
const State = ({ row }) => <div className="ro-state"><span className={`ro-badge ${row.status === 'FUTURE' ? 'muted' : row.attention ? 'warn' : 'ok'}`}>{row.status_label || row.receipt_state}</span>{row.unknown_count > 0 && <small>รอยืนยัน {row.unknown_count} ช่องทาง</small>}{row.reasons?.length > 0 && <small className="ro-negative" title={row.reasons.join(' • ')}>{row.reasons[0]}{row.reasons.length > 1 ? ` +${row.reasons.length - 1}` : ''}</small>}</div>;
const saved = () => { try { return { ...overviewDefaults(), ...JSON.parse(sessionStorage.getItem('cashflow-overview') || '{}') }; } catch { return overviewDefaults(); } };

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

export default function ReceiptsOverview({ active, onOpenWork, onOpenEvidence }) {
  const [filters, setFilters] = useState(saved);
  const [report, setReport] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState(null);
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
  const work = row => { setSelection(null); onOpenWork(row); };
  const field = (label, key, options) => <label>{label}<select aria-label={label} value={filters[key]} onChange={e => change({ [key]: e.target.value })}><option value="">ทั้งหมด</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const summary = report?.summary;
  const daily = filters.tab === 'daily';
  const receivedBasis = report?.basis === 'received';
  const pending = filters.tab === 'followups';

  return <section className="ro-workspace" hidden={!active} data-generated-at={report?.generated_at || ''} data-build-commit={import.meta.env.VITE_BUILD_COMMIT || 'development'}>
    <div className="ro-title"><div><span className="ro-eyebrow">FINANCE / DAILY CONTROL</span><h2>ภาพรวมรับเงิน</h2><p>ทุกวัน ทุกช่องทาง · ตรวจยอดและติดตามงานจากจุดเดียว</p></div><div className="ro-title-right"><span><CalendarDays size={16}/> {date(filters.from)} – {date(filters.to)}</span><small>{report ? `ข้อมูลล่าสุด ${new Date(report.generated_at).toLocaleString('th-TH')}` : 'กำลังเตรียมข้อมูล'}</small></div></div>
    <div className="ro-filters"><div className="ro-basis" aria-label="ฐานวันที่"><button className={filters.basis === 'sale' ? 'selected' : ''} onClick={() => change({ basis: 'sale' })}>วันที่ขาย</button><button className={filters.basis === 'received' ? 'selected' : ''} onClick={() => change({ basis: 'received' })}>วันที่รับเงินจริง</button></div><label>จากวันที่<input type="date" value={filters.from} onChange={e => change({ from: e.target.value })}/></label><label>ถึงวันที่<input type="date" value={filters.to} onChange={e => change({ to: e.target.value })}/></label>{field('สาขา','branch_id',(metadata?.branches || []).map(b => [b.id,b.name]))}{field('ช่องทาง','channel_id',(metadata?.all_channels || []).map(c => [c.id,c.label]))}{field('บัญชีปลายทาง','account_id',(metadata?.accounts || []).map(a => [a.id,`${a.label}${a.last4 ? ` ••••${a.last4}` : ''}`]))}{field('สถานะ','status',statuses)}<button className="ro-refresh" aria-label="รีเฟรชภาพรวม" onClick={() => setRevision(r => r+1)} disabled={busy}><RefreshCw size={17} className={busy ? 'spin' : ''}/></button></div>
    <div className="ro-summary" aria-busy={busy}><Metric label={receivedBasis ? 'รับที่ยืนยันในช่วงวันรับ' : 'รับที่ยืนยันของวันขาย'} value={money(summary?.received)} note="บาท · รวมยอดที่ยืนยันได้ อาจยังไม่ครบทุกช่องทาง"/><Metric label="ยอดแคชเชียร์ตามผลกรอง" value={money(summary?.cashier)} note={receivedBasis ? 'ดูยอดแคชเชียร์ในมุมมองวันที่ขาย' : 'บาท · รวมเงินทอนในช่องเงินสด'}/><Metric label="ต้องติดตาม" value={summary?.attention ?? '—'} note={filters.tab === 'daily' ? 'วัน / สาขา ตามผลกรองทั้งหมด' : 'รายการตามผลกรองทั้งหมด'} tone="attention"/><Metric label="ยังยืนยันยอดรับไม่ได้" value={summary?.unknown_count ?? '—'} note="ช่องทาง / วันที่ขาดข้อมูล" tone="pending"/></div>
    <div className="ro-table-header"><div className="ro-tabs" role="tablist" aria-label="รายงานรับเงิน">{[['daily','สรุปรายวัน'],['transactions','รายการรับเงิน'],['followups','เงินรอรับและข้อแตกต่าง']].map(([id,label]) => <button role="tab" aria-selected={filters.tab === id} key={id} onClick={() => change({ tab:id })}>{label}</button>)}</div><label className="ro-attention-toggle"><input type="checkbox" checked={filters.attention} onChange={e => change({ attention:e.target.checked })}/> เฉพาะรายการต้องติดตาม</label></div>
    <p className="ro-basis-note">{report?.note || 'กำลังโหลดรายงาน'} <span>หน่วย: บาท · — ยังยืนยันไม่ได้</span></p>
    {error && <div className="ro-error" role="alert">{error}<button onClick={() => setRevision(r=>r+1)}>ลองอีกครั้ง</button></div>}
    <div className={`ro-table-scroll ${busy ? 'loading' : ''}`} ref={scroll} onScroll={e => { returnScroll.current = { left:e.currentTarget.scrollLeft, top:e.currentTarget.scrollTop }; }} aria-busy={busy}>
      <table className="ro-table"><caption className="ro-sr">{daily ? 'สรุปรายวัน' : pending ? 'งานติดตามรายวัน' : 'รายการรับเงิน'}</caption><thead><tr><th className="ro-frozen">{receivedBasis ? 'วันที่รับเงินจริง' : 'วันที่ขาย'} / สาขา</th>{daily ? <>{!receivedBasis && <th>ยอด POS<small>เงินทอนแยก</small></th>}{report?.channels.map(c => <th key={c.id}>{c.label}<small>{receivedBasis ? 'ยอดรับที่ยืนยัน' : 'แคชเชียร์ / รับที่ยืนยัน'}</small></th>)}<th>รวมรับที่ยืนยัน<small>เฉพาะยอดที่มีข้อมูล</small></th>{!receivedBasis && <><th>เงินทอน / อื่นๆ</th><th>ผลต่างแคชเชียร์<small>เทียบ POS + เงินทอน</small></th><th>ผลต่างปิดวัน<small>รวมปรับปรุงแล้ว</small></th></>}</> : pending ? <><th>ช่องทางที่ต้องตาม</th><th>คาดรับสุทธิ</th><th>รับที่ยืนยัน</th><th>สิ่งที่ต้องตรวจ</th><th>ระยะเวลารอ</th></> : <><th>{receivedBasis ? 'วันขายอ้างอิง' : 'วันที่รับเงินจริง'}</th><th>ช่องทาง / บัญชี</th><th>ก่อนหัก / รายการหัก</th><th>เงินรับ</th><th>หลักฐาน / อ้างอิง</th></>}<th>สถานะ / การตรวจสอบ</th><th>รายละเอียด</th></tr></thead>
      <tbody>{!busy && !error && report?.rows.length === 0 && <tr><td colSpan={20}><div className="ro-empty"><Search size={28}/><strong>ไม่พบรายการตามเงื่อนไขนี้</strong><span>ปรับช่วงวันที่หรือตัวกรองเพื่อดูรายการอื่น</span></div></td></tr>}{report?.rows.map(row => <tr key={row.key} onClick={e => { if (!e.target.closest('button,a') && (row.receipt_id || row.receipt_ids?.length)) open(row); }} className={row.status === 'FUTURE' ? 'ro-future' : row.attention ? 'ro-row-attention' : ''}>
        <th className="ro-frozen"><Day row={row}/></th>{daily ? <>{!receivedBasis && <td><Amount value={row.pos}/></td>}{report.channels.map(c => { const l = row.lines.find(l => l.channel_id === c.id); return <td key={c.id} className={l?.attention ? 'ro-cell-attention' : ''}>{l ? <>{!receivedBasis && <Amount value={l.cashier}/>}<small className="ro-received"><Amount value={l.received}/>{!receivedBasis && ' รับยืนยัน'}</small>{l.attention && <small className="ro-negative">{l.receipt_state}</small>}</> : <span className="ro-muted">—</span>}</td>; })}<td className="ro-total"><Amount value={row.received}/>{row.unknown_count > 0 && <small>ยังยืนยันไม่ครบ</small>}</td>{!receivedBasis && <><td><Amount value={row.float}/><small>อื่นๆ {money(row.misc)}</small></td><td><Amount value={row.cashier_variance} variance/></td><td><Amount value={row.confirmed_variance} variance/></td></>}</> : pending ? <><td>{row.lines.filter(l=>l.attention).map(l=><span className="ro-channel-tag" key={l.id}>{l.channel_label}</span>)}</td><td><Amount value={row.expected}/>{row.lines.some(l=>l.expected === null) && <small>ยังไม่ทราบครบทุกช่องทาง</small>}</td><td><Amount value={row.received}/></td><td className="ro-reason-cell">{row.reasons.slice(0,3).map((s,i)=><div key={i}>{s}</div>)}</td><td>{row.lines.some(l=>l.waiting_days !== null) ? `${Math.max(0,...row.lines.map(l=>l.waiting_days || 0))} วัน` : '—'}<small>ยังไม่ระบุวันครบกำหนด</small></td></> : <><td>{receivedBasis ? (row.sale_dates || [row.receipt_date]).map(date).join(', ') : row.received_date ? date(row.received_date) : row.batch_key && row.received !== null ? row.received_dates.map(date).join(', ') : 'ยังไม่ยืนยันวันรับ'}</td><td>{row.channel_label}<small>{row.account_label || 'ยังไม่ระบุบัญชี'}</small></td><td>{row.before === null ? <small>ดูยอดรวมในรายละเอียดช่องทาง</small> : <><Amount value={row.before}/><small>รายการหัก {money(row.fee)}</small></>}</td><td><Amount value={row.received}/></td><td className="ro-reason-cell">{row.evidence_basis}<small>{row.reference || row.description || ''}</small></td></>}<td><State row={row}/></td><td>{row.receipt_id || row.receipt_ids?.length ? <button className="ro-detail-button" onClick={() => open(row)} aria-label={`รายละเอียด ${row.date} ${row.branch_name}`}>เปิดดู <ArrowUpRight size={15}/></button> : <span className="ro-muted">—</span>}</td>
      </tr>)}</tbody></table></div>
    <div className="ro-footer"><span>{busy ? 'กำลังโหลด…' : `${report?.pagination.total ?? 0} รายการ`} · ยอดสรุปรวมทุกหน้า</span><div><button disabled={busy || filters.page <= 1} onClick={() => change({ page:filters.page-1 })} aria-label="หน้าก่อนหน้า"><ChevronLeft size={17}/></button><span>หน้า {filters.page} / {Math.max(1,report?.pagination.pages || 0)}</span><button disabled={busy || filters.page >= (report?.pagination.pages || 0)} onClick={() => change({ page:filters.page+1 })} aria-label="หน้าถัดไป"><ChevronRight size={17}/></button></div></div>
    {selection && active && <div className="ro-modal-backdrop" onClick={() => setSelection(null)}><aside className="ro-drawer" role="dialog" aria-modal="true" aria-label="รายละเอียดรับเงิน" tabIndex={-1} ref={drawer} onClick={e=>e.stopPropagation()} onKeyDown={e=>{ if(e.key==='Escape') setSelection(null); if(e.key==='Tab'){ const nodes=[...drawer.current.querySelectorAll('button:not([disabled]), summary, a[href]')]; if(e.shiftKey && document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey && document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();} } }}><header><div><span className="ro-eyebrow">RECEIPT DETAILS</span><h2>รายละเอียดรับเงิน</h2></div><button onClick={()=>setSelection(null)} aria-label="ปิดรายละเอียด"><X size={22}/></button></header>{detailBusy && <p role="status">กำลังโหลดรายละเอียด…</p>}{detailError && <div className="ro-error" role="alert">{detailError}</div>}{details.map(r=><ReceiptDetail key={r.key} receipt={r} onWork={work} onEvidence={onOpenEvidence}/>)}{!detailBusy && !details.length && !detailError && <p>ไม่พบเอกสารต้นทางในขอบเขตที่เลือก</p>}</aside></div>}
  </section>;
}
