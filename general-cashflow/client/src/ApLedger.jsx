import { useEffect, useState } from 'react';
import { BookOpen, Building2, ChevronLeft, ChevronRight, CircleHelp, Monitor, Moon, Sun, WalletCards } from 'lucide-react';
import './apLedger.css';
import { AP_MONTHS, formatApMonth, formatApNote, formatApDate, formatApCapturedAt, formatApReference, readApThemePreference, saveApTheme, systemApTheme } from './apLedgerUi.js';
import ApBalanceStatus from './ApBalanceStatus.js';
const money = v => v == null ? 'ยังไม่ทราบ' : new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const tabs = [['ledger','ทะเบียนเจ้าหนี้'],['journal','สมุดรายวันซื้อ'],['trial','งบทดลอง'],['reconcile','กระทบยอด']];
const statusText = { CREDIT_PAYMENT: 'จ่ายผู้ขายเครดิต', PAID_PURCHASE: 'ซื้อจ่ายทันที', PASS_THROUGH: 'เงินผ่านพี่เก้ง', REVIEW_TRANSACTION: 'รอตรวจประเภท', AMBIGUOUS_SUPPLIER: 'ผู้ขายซ้ำหลายกฎ', PNL_EXCLUDED: 'กำไรขาดทุนไม่นับ', OPEN_ROUND: 'รอบยังไม่ปิด', PNL_PERIOD_ONLY: 'กำไรขาดทุนย้ายเดือน' };
const defaultLoad = async params => { const { request } = await import('./api.js'); return request(`/ap/report?${params}`); };
function MonthPicker({ value, onChange }) {
  const [year, month] = value.split('-');
  const [yearDraft, setYearDraft] = useState(String(Number(year) + 543));
  useEffect(() => setYearDraft(String(Number(year) + 543)), [year]);
  const commitYear = () => {
    const next = Number(yearDraft) - 543;
    if (/^\d{3,5}$/.test(yearDraft) && Number.isInteger(next) && next >= 1 && next <= 9999) onChange(`${String(next).padStart(4, '0')}-${month}`);
    else setYearDraft(String(Number(year) + 543));
  };
  return <div className="ap-month-field"><span id="ap-month-label">เดือนบัญชี</span><div className="ap-month-input" role="group" aria-labelledby="ap-month-label">
    <select aria-label="เดือนบัญชี" value={month} onChange={e => onChange(`${year}-${e.target.value}`)}>{AP_MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}</select>
    <input aria-label="ปีบัญชี (พ.ศ.)" title="ปี พ.ศ. กด Enter หรือออกจากช่องเพื่อใช้ปีที่เลือก" type="number" min="544" max="10542" value={yearDraft} onChange={e => setYearDraft(e.target.value)} onBlur={commitYear} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>
  </div></div>;
}
function Table({ columns, rows, rowKey = r => r.key, rowTitle }) {
  return <div className="ap-scroll" tabIndex="0"><table role="table"><thead role="rowgroup"><tr role="row">{columns.map(c => <th scope="col" role="columnheader" key={c[0]} className={c[3] ? 'num' : ''}>{c[1]}</th>)}</tr></thead><tbody role="rowgroup">{rows.map((r,i) => <tr role="row" key={rowKey(r) || i}>{columns.map((c,index) => <td role="cell" key={c[0]} className={[c[3] ? 'num' : '', index === 0 ? 'ap-identity-cell' : '', c[0] === 'branch' && rowTitle ? 'ap-branch-cell' : ''].join(' ')}><span className="ap-cell-label" aria-hidden="true">{c[1]}</span>{index === 0 && rowTitle && <div className="ap-mobile-title">{rowTitle(r)}</div>}<div className={index === 0 && rowTitle ? 'ap-cell-value ap-desktop-title' : 'ap-cell-value'}>{c[2] ? c[2](r) : r[c[0]]}</div></td>)}</tr>)}</tbody></table>{!rows.length && <p className="ap-empty">ไม่มีรายการในขอบเขตนี้</p>}</div>;
}
export default function ApLedger({ loadReport = defaultLoad, preview = false }) {
  const [month,setMonth] = useState('2026-09'), [branch,setBranch] = useState(''), [tab,setTab] = useState('ledger');
  const [data,setData] = useState(null), [busy,setBusy] = useState(true), [error,setError] = useState('');
  const [themePreference,setThemePreference] = useState(readApThemePreference), [systemTheme,setSystemTheme] = useState(systemApTheme);
  const dark = (themePreference || systemTheme) === 'dark';
  const [search,setSearch] = useState(''), [page,setPage] = useState(0), [all,setAll] = useState(false);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(systemApTheme());
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, []);
  const selectTheme = next => {
    setThemePreference(next); saveApTheme(next);
  };
  useEffect(() => {
    let current = true; setBusy(true); setData(null); setError(''); setPage(0);
    loadReport(new URLSearchParams({ month, branch })).then(r => { if (current) setData(r); }).catch(() => { if (current) setError('ยังไม่มีข้อมูลบัญชีเดือนนี้ หรืออ่านข้อมูลไม่ได้'); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  },[month,branch,loadReport]);
  const account = code => formatApNote(data?.accounts.find(a => a.code === code)?.name || code);
  const branchName = code => data?.branches.find(b => b.code === code)?.name || code || 'ไม่ระบุสาขา';
  const supplierName = key => data?.sources?.find(s => s.key === key)?.supplierName || 'ไม่ระบุผู้ขาย';
  const matches = r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
  const rows = !data ? [] : tab === 'journal' ? data.journals.filter(matches) : tab === 'reconcile' ? data.reconciliation.cases.filter(matches) : [];
  const paged = rows.slice(page*25,page*25+25);
  const amountTotal = field => data?.branchRows.reduce((n,r) => n + Math.round(Number(r[field])*100),0)/100;
  return <main className="ap-page" data-mode={dark ? 'dark' : 'light'}>
    <div className="ap-wrap">
      <div className="ap-masthead"><span><Building2 size={16} aria-hidden="true"/> SOLAO <span className="ap-divider" aria-hidden="true">/</span> บัญชีซื้อ</span><div><span className="ap-readonly">{preview === 'offline' ? 'อ่านอย่างเดียวบน SSD' : preview ? 'ตัวอย่างในเครื่อง' : 'อ่านอย่างเดียว'}</span><details className="ap-theme-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.removeAttribute('open'); e.currentTarget.querySelector('summary').focus(); } }}><summary className="ap-theme" aria-describedby="ap-theme-help" aria-label={`เลือกธีม ปัจจุบัน${themePreference === 'light' ? 'สว่าง' : themePreference === 'dark' ? 'มืด' : 'ตามระบบ'}`}><span aria-hidden="true">{themePreference === 'light' ? <Sun size={18}/> : themePreference === 'dark' ? <Moon size={18}/> : <Monitor size={18}/>}</span><span>{themePreference === 'light' ? 'สว่าง' : themePreference === 'dark' ? 'มืด' : 'ตามระบบ'}</span><span id="ap-theme-help" className="ap-tooltip" role="tooltip">เลือกธีมการแสดงผล</span></summary><fieldset><legend>ธีมการแสดงผล</legend>{[[null,'ตามระบบ'],['light','สว่าง'],['dark','มืด']].map(([value,label]) => <label key={label}><input type="radio" name="ap-theme" checked={themePreference === value} onChange={e => { selectTheme(value); e.currentTarget.closest('details').removeAttribute('open'); }}/>{label}</label>)}</fieldset></details></div></div>
      <header className="ap-heading"><div><h1>เจ้าหนี้และสมุดรายวันซื้อ</h1><p className="ap-subtitle">ติดตามเงินจ่ายผู้ขายและหลักฐาน</p></div><div className="ap-filters"><MonthPicker value={month} onChange={setMonth}/><label>สาขา<select aria-label="สาขา" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">ทุกสาขา</option>{(data?.branches || [{code:'KK',name:'สาขาคันคลอง'},{code:'SK',name:'สาขาสันกำแพง'}]).map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></label></div></header>
      {busy && <div className="ap-notice" role="status">กำลังอ่านข้อมูลบัญชี…</div>}
      {error && <div className="ap-notice" role="alert">{error}</div>}
      {data && <>
        <aside className="ap-notice"><CircleHelp size={20} aria-hidden="true"/><strong>ยังสรุปยอดเจ้าหนี้ไม่ได้ ขาดยอดยกมาและใบรับของ</strong></aside>
        <div className="ap-cards">
          <div className="ap-card"><span>ซื้อจ่ายทันทีจากบิลไลน์</span><strong>{money(amountTotal('paidPurchase'))}</strong><small>ยังไม่ยืนยันวันรับของ (บาท)</small></div>
          <div className="ap-card"><span>จ่ายผู้ขายเครดิต</span><strong>{money(amountTotal('supplierPaid'))}</strong><small>ระบุผู้ขายได้ตามหลักฐานจ่าย (บาท)</small></div>
          <div className="ap-card ap-card-unknown"><span>เจ้าหนี้คงค้าง ณ สิ้นเดือน</span><strong>ยังไม่ทราบ</strong><small>รอยอดยกมาและใบรับของครบ</small></div>
          <div className="ap-card ap-card-secondary"><span>เงินผ่านพี่เก้งที่ระบุได้</span><strong>{money(amountTotal('passThrough'))}</strong><small>บิลรวมอาจไม่ระบุผู้รับ (บาท)</small></div>
        </div>
        <nav className="ap-tabs" aria-label="รายงานบัญชี">{tabs.map(([id,label])=><button key={id} aria-current={tab===id ? 'page' : undefined} className={tab===id?'active':''} onClick={()=>{setTab(id);setPage(0);setSearch('');}}>{id==='ledger'?<WalletCards size={17}/>:<BookOpen size={17}/>} {label}</button>)}</nav>
        <section className="ap-panel">
          <div className="ap-panel-title"><div><h2>{tabs.find(t=>t[0]===tab)[1]}</h2><p>{tab==='ledger'?'รับของ 1–15 จ่ายวันที่ 20 รับของ 16–สิ้นเดือน จ่ายวันที่ 5 เดือนถัดไป':tab==='journal'?'รายการชั่วคราวตามหลักฐานจ่าย ยังไม่มีใบรับของยืนยันซื้อเครดิต':tab==='trial'?'การเคลื่อนไหวบัญชีซื้อเท่านั้น ไม่ใช่งบทดลองทั้งบริษัท':'ใช้บิลเดียวกับกำไรขาดทุนเดิม ไม่บวกค่าใช้จ่ายซ้ำ'}</p></div><ApBalanceStatus balance={data.balance}/></div>
          {tab==='ledger' && <><div className="ap-toolbar"><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> แสดงทะเบียนทั้งหมด</label><span>ยอดยกมาและอายุหนี้: รอหลักฐาน</span></div><Table rowTitle={r=><><strong>{r.name}</strong><small>{branchName(r.branch)}<br/>{formatApReference(r.reference)}</small></>} rowKey={r=>r.key} rows={data.ledger.filter(r=>all || Number(r.paid)!==0)} columns={[
            ['name','ผู้จำหน่าย',r=><><strong>{r.name}</strong><small>{formatApReference(r.reference)}</small></>],['branch','สาขา',r=>branchName(r.branch)],['opening','ยกมา',r=>money(r.opening),true],['purchases','ซื้อเครดิต',r=>money(r.purchases),true],['paid','จ่ายตามบิลไลน์',r=>money(r.paid),true],['closing','คงค้าง',r=>money(r.closing),true],['aging','อายุหนี้',()=> <span className="ap-pending">รอใบรับของ</span>]
          ]}/><div className="ap-footnote">จ่ายวันที่ 5–6 จัดเป็นการชำระของเดือนก่อนตามกฎเจ้าของ ไม่สร้างยอดซื้อเดือนก่อนหรือยอดยกมาทดแทนเอง</div></>}
          {tab==='journal' && <><div className="ap-toolbar"><input aria-label="ค้นหารายการบัญชี" placeholder="ค้นหาผู้ขาย / เลขบิล" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length} รายการบัญชี</span></div><Table rowTitle={r=><><strong>{supplierName(r.sourceKey)}</strong><small>{branchName(r.branch)}<br/>{formatApDate(r.date)}</small><small>{formatApReference(r.sourceKey)}</small></>} rows={paged} columns={[
            ['date','วันที่จ่าย',r=>formatApDate(r.date)],['branch','สาขา',r=>branchName(r.branch)],['sourceKey','ที่มา',r=><><span className="ap-reference">{formatApReference(r.sourceKey)}</span><small>{r.description}</small></>],['lines','รายการบัญชี',r=>r.lines.map((l,i)=><div className="ap-entry" key={i}><span>{account(l.account)}</span><span>{Number(l.dr)>0?'เดบิต':'เครดิต'} {money(Number(l.dr)>0?l.dr:l.cr)}</span></div>)],['flags','สถานะ',r=><span className="ap-pending">{r.type==='payment'?'จ่ายเจ้าหนี้':'ตามหลักฐานจ่าย'}<small>{r.flags.includes('PAYMENT_FOR_PREVIOUS_MONTH')?'ของเดือนก่อน':'วันรับของยังไม่ทราบ'}</small></span>]
          ]}/></>}
          {tab==='trial' && <><div className="ap-trial-total"><div><span>เดบิต</span><strong>{money(data.balance.dr)}</strong></div><div><span>เครดิต</span><strong>{money(data.balance.cr)}</strong></div><div><span>ส่วนต่าง</span><strong>{money(data.balance.difference)}</strong></div></div><Table rows={data.trialBalance} rowKey={r=>r.account} columns={[
            ['account','บัญชี',r=><>{account(r.account)}<small>{r.account}</small></>],['opening','ยอดก่อนเดือนในชุดนี้',r=>money(r.opening),true],['dr','เดบิต',r=>money(r.dr),true],['cr','เครดิต',r=>money(r.cr),true],['closing','สุทธิเดบิต−เครดิต',r=>money(r.closing),true]
          ]}/><div className="ap-footnote">ยอดก่อนเดือน 0.00 หมายถึงไม่มีรายการก่อนเดือนในชุดนำเข้า ไม่ใช่ยอดยกมาที่รับรองของบริษัท</div></>}
          {tab==='reconcile' && <><div className="ap-recon-summary"><div><span>บิลไลน์ตามวันจ่าย</span><strong>{money(data.reconciliation.lbc)}</strong></div><div><span>ต้นทุน/ค่าใช้จ่ายชั่วคราว</span><strong>{money(data.reconciliation.journalCost)}</strong></div><div><span>กำไรขาดทุนเฉพาะบิลไลน์</span><strong>{money(data.reconciliation.pnlLbc)}</strong></div></div><div className="ap-footnote">{formatApNote(data.reconciliation.bankConclusion)} จับคู่แล้ว {data.reconciliation.matchedCount} รายการ</div><details className="ap-details"><summary>รายการธนาคาร {data.reconciliation.statements.length} รายการ รวม {money(data.reconciliation.statementTotal)} บาท</summary><p>ยืนยันรับเข้า {money(data.reconciliation.incomingTotal)} บาท ยืนยันจ่ายออก {money(data.reconciliation.outgoingTotal)} บาท ยังไม่ทราบทิศทาง {money(data.reconciliation.unknownTotal)}</p><Table rows={data.reconciliation.statements} columns={[
            ['key','อ้างอิง',r=>formatApReference(r.key)],['date','วันที่',r=>formatApDate(r.date)],['amount','ยอด',r=>money(r.amount),true],['direction','ทิศทาง',r=>({incoming:'รับเข้า',outgoing:'จ่ายออก',unknown:'ไม่ทราบ'})[r.direction]],['status','สถานะ',()=> 'ยังไม่จับคู่ผู้ขาย']
          ]}/></details><div className="ap-toolbar"><input aria-label="ค้นหากระทบยอด" placeholder="ค้นหาผู้ขาย / เลขบิล" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length} แหล่งรายการ</span></div><Table rowTitle={r=><><strong>{r.supplierName || 'ไม่ระบุผู้ขาย'}</strong><small>{branchName(r.branch)}<br/>{formatApReference(r.sourceKey)}</small></>} rows={paged} rowKey={r=>r.sourceKey} columns={[
            ['sourceKey','แหล่งข้อมูล',r=><><span className="ap-reference">{formatApReference(r.sourceKey)}</span><small>{r.supplierName || 'ไม่ระบุผู้ขาย'}<br/>{branchName(r.branch)}</small></>],['amount','ยอดบิลไลน์',r=>money(r.amount),true],['pnl','กำไรขาดทุนเดิม',r=>money(r.pnl),true],['journalCost','ต้นทุนชั่วคราว',r=>money(r.journalCost),true],['difference','ส่วนต่างต้นทุน',r=>money(r.difference),true],['reason','เหตุผล',r=><><span className="ap-pending">{statusText[r.status]}</span><small>{formatApNote(r.reason)}{r.purchasePeriod ? ` ของเดือน ${formatApMonth(r.purchasePeriod)}`:''}</small></>]
          ]}/></>}
          {['journal','reconcile'].includes(tab) && <div className="ap-pagination"><span>หน้า {page+1} / {Math.max(1,Math.ceil(rows.length/25))}</span><button disabled={!page} aria-label="หน้าก่อน" onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/></button><button disabled={(page+1)*25>=rows.length} aria-label="หน้าถัดไป" onClick={()=>setPage(p=>p+1)}><ChevronRight size={17}/></button></div>}
        </section>
        <details className="ap-details ap-limitations"><summary>ขอบเขตข้อมูลและสิ่งที่ต้องติดตาม</summary><p>ข้อมูลนี้แสดงเงินจ่ายจริงจากระบบกระแสเงินสดและบิลไลน์ ยังยืนยันยอดซื้อเกณฑ์คงค้างและอายุหนี้ไม่ได้ รายการบัญชีเป็นรายการชั่วคราวตามหลักฐานจ่าย การจ่ายผู้ขายเครดิตบันทึกเดบิตเจ้าหนี้และเครดิตเงินจ่าย ยอดซื้อเครดิตและคงค้างแสดงว่า “ยังไม่ทราบ” เมื่อหลักฐานไม่ครบ</p><ul>{data.limitations.map(l=><li key={l}>{formatApNote(l)}</li>)}</ul><p>ข้อมูล ณ {formatApCapturedAt(data.capturedAt)} รหัสชุด {data.fingerprint.slice(0,12)}</p></details>
        <footer className="ap-footer">SOLAO <span>บัญชีคู่ หน่วยบาทและสตางค์ อ่านข้อมูลต้นทางอย่างเดียว</span></footer>
      </>}
    </div>
  </main>;
}
