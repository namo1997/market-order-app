import { useEffect, useState } from 'react';
import { BookOpen, Building2, ChevronLeft, ChevronRight, Monitor, Moon, Sun, WalletCards } from 'lucide-react';
import './apLedger.css';
import { AP_MONTHS, formatApMonth, formatApNote, formatApDate, formatApCapturedAt, formatApReference, readApThemePreference, saveApTheme, systemApTheme, matchesApSearch, apLoadErrorState, parseApYear } from './apLedgerUi.js';
import ApBalanceStatus from './ApBalanceStatus.js';
import ApLoadStatus from './ApLoadStatus.js';
import ApOpeningStatus from './ApOpeningStatus.js';
import ApReceiving from './ApReceiving.jsx';
import { AP_AGING_BUCKETS, apAgingTotals, apOpeningState, sumApAmounts, visibleApSuppliers } from './apOpeningUi.js';
const money = v => v == null ? 'ยังไม่ทราบ' : new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const supplierReference = r => /^pnl_credit_suppliers:\d+$/.test(r.reference || '') ? null : formatApReference(r.reference);
const tabs = [['ledger','ทะเบียนเจ้าหนี้'],['journal','สมุดรายวันซื้อ'],['trial','งบทดลอง'],['reconcile','กระทบยอด']];
const statusText = { CREDIT_PAYMENT: 'จ่ายผู้ขายเครดิต', PAID_PURCHASE: 'ซื้อจ่ายทันที', PASS_THROUGH: 'เงินผ่านพี่เก้ง', REVIEW_TRANSACTION: 'รอตรวจประเภท', AMBIGUOUS_SUPPLIER: 'ผู้ขายซ้ำหลายกฎ', PNL_EXCLUDED: 'กำไรขาดทุนไม่นับ', OPEN_ROUND: 'รอบยังไม่ปิด', PNL_PERIOD_ONLY: 'กำไรขาดทุนย้ายเดือน' };
const defaultLoad = async params => { const { request } = await import('./api.js'); return request(`/ap/report?${params}`); };
function MonthPicker({ value, onChange }) {
  const [year, month] = value.split('-');
  const [yearDraft, setYearDraft] = useState(String(Number(year) + 543));
  useEffect(() => setYearDraft(String(Number(year) + 543)), [year]);
  const invalidYear = parseApYear(yearDraft) === null;
  const commitYear = () => {
    const next = parseApYear(yearDraft);
    if (next) onChange(`${next}-${month}`);
  };
  return <div className="ap-month-field"><span id="ap-month-label">เดือนบัญชี</span><div className="ap-month-input" role="group" aria-labelledby="ap-month-label">
    <select aria-label="เดือนบัญชี" value={month} onChange={e => onChange(`${year}-${e.target.value}`)}>{AP_MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}</select>
    <input aria-label="ปีบัญชี (พ.ศ.)" aria-invalid={invalidYear} aria-describedby={invalidYear ? 'ap-year-error' : undefined} title="ปี พ.ศ. กด Enter หรือออกจากช่องเพื่อใช้ปีที่เลือก" type="text" inputMode="numeric" value={yearDraft} onChange={e => setYearDraft(e.target.value)} onBlur={commitYear} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>
  </div>{invalidYear && <span id="ap-year-error" className="ap-field-error" role="status">ตรวจปี พ.ศ.</span>}</div>;
}
function PurchaseJournal({ rows, account, branchName, supplierName }) {
  return <div className="ap-scroll ap-journal-scroll" tabIndex="0" role="region" aria-label="สมุดรายวันซื้อ เลื่อนแนวนอนได้เมื่อขยายข้อความ"><table className="ap-journal"><caption className="ap-sr-only">รายการบัญชีแยกตามเอกสาร หน่วยบาท</caption><colgroup><col/><col className="ap-journal-amount"/><col className="ap-journal-amount"/></colgroup><thead><tr><th scope="col">บัญชี</th><th scope="col" className="num">เดบิต</th><th scope="col" className="num">เครดิต</th></tr></thead>{rows.map(r => <tbody key={r.key}>
    <tr className="ap-journal-document"><th scope="rowgroup" colSpan="3"><strong>{supplierName(r)}</strong><span>{branchName(r.branch)} / {formatApDate(r.date)} / {formatApReference(r.sourceKey)}</span><span>{r.description}</span><small>{r.type === 'opening' ? 'ยอดยกมา' : r.reverses ? 'กลับรายการ' : r.type === 'payment' ? 'จ่ายเจ้าหนี้' : 'ตามหลักฐานจ่าย'}{!r.reverses && r.type !== 'opening' && <> — {r.flags.includes('PAYMENT_FOR_PREVIOUS_MONTH') ? 'ของเดือนก่อน' : 'วันรับของยังไม่ทราบ'}</>}</small></th></tr>
    {r.lines.map((line, i) => <tr key={i}><th scope="row" className={Number(line.cr) !== 0 ? 'ap-credit-account' : ''}>{account(line.account)}</th><td className="num">{Number(line.dr) === 0 ? '—' : money(line.dr)}</td><td className="num">{Number(line.cr) === 0 ? '—' : money(line.cr)}</td></tr>)}
  </tbody>)}</table>{!rows.length && <p className="ap-empty">ไม่มีรายการในขอบเขตนี้</p>}</div>;
}
function MobileSuppliers({ rows, branchName }) {
  return <ul className="ap-suppliers-mobile" aria-label="ทะเบียนเจ้าหนี้">{rows.map(r => <li key={r.key}>
    <div className="ap-supplier-heading"><strong>{r.name}</strong><span>{branchName(r.branch)}</span></div>
    <div className="ap-supplier-paid"><span>จ่ายตามบิลไลน์</span><strong>{money(r.paid)} <small>บาท</small></strong></div>
    <p className="ap-pending">{r.missingOpening ? 'ขาดยอดยกมา' : r.closing == null ? 'รอยอดยกมาในสาขาให้ครบ' : 'คงค้างตามรายการที่มี'}{r.closing != null && ` ${money(r.closing)} บาท`}</p>
    <details><summary>รายละเอียดบัญชี<span className="ap-sr-only"> {r.name}</span></summary><dl>{[['ยกมา', money(r.opening)], ['ซื้อเครดิต', money(r.purchases)], ['คงค้าง', money(r.closing)], ...AP_AGING_BUCKETS.map(([key, label]) => [label, money(r.aging?.[key])]), ['จ่ายล่วงหน้า', money(r.advance)], ...(supplierReference(r) ? [['ที่มา', supplierReference(r)]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
  </li>)}{!rows.length && <li className="ap-empty">ไม่มีรายการในขอบเขตนี้</li>}</ul>;
}
function Table({ columns, rows, rowKey = r => r.key, rowTitle }) {
  return <div className="ap-scroll" tabIndex="0"><table className="ap-data-table" role="table"><thead role="rowgroup"><tr role="row">{columns.map(c => <th scope="col" role="columnheader" key={c[0]} className={c[3] ? 'num' : ''}>{c[1]}</th>)}</tr></thead><tbody role="rowgroup">{rows.map((r,i) => <tr role="row" key={rowKey(r) || i}>{columns.map((c,index) => <td role="cell" key={c[0]} className={[c[3] ? 'num' : '', index === 0 ? 'ap-identity-cell' : '', c[0] === 'branch' && rowTitle ? 'ap-branch-cell' : ''].join(' ')}><span className="ap-cell-label" aria-hidden="true">{c[1]}</span>{index === 0 && rowTitle && <div className="ap-mobile-title">{rowTitle(r)}</div>}<div className={index === 0 && rowTitle ? 'ap-cell-value ap-desktop-title' : 'ap-cell-value'}>{c[2] ? c[2](r) : r[c[0]]}</div></td>)}</tr>)}</tbody></table>{!rows.length && <p className="ap-empty">ไม่มีรายการในขอบเขตนี้</p>}</div>;
}
export default function ApLedger({ loadReport = defaultLoad, preview = false }) {
  const [month,setMonth] = useState('2026-09'), [branch,setBranch] = useState(''), [tab,setTab] = useState('ledger');
  const [data,setData] = useState(null), [busy,setBusy] = useState(true), [error,setError] = useState('');
  const [retry,setRetry] = useState(0);
  const [online,setOnline] = useState(() => globalThis.navigator?.onLine !== false);
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
    const update = () => setOnline(globalThis.navigator?.onLine !== false);
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => { globalThis.removeEventListener?.('online', update); globalThis.removeEventListener?.('offline', update); };
  }, []);
  useEffect(() => {
    if (!online) { setData(null); setBusy(false); return; }
    let current = true; setBusy(true); setData(null); setError(''); setPage(0);
    loadReport(new URLSearchParams({ month, branch })).then(r => { if (current) setData(r); }).catch(error => { if (current) setError(apLoadErrorState(error)); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  },[month,branch,loadReport,retry,online]);
  const account = code => formatApNote(data?.accounts.find(a => a.code === code)?.name || code);
  const branchName = code => data?.branches.find(b => b.code === code)?.name || code || 'ไม่ระบุสาขา';
  const supplierName = journal => data?.sources?.find(s => s.key === journal.sourceKey)?.supplierName || data?.ledger.find(s => journal.lines.some(l => l.supplier === s.key))?.name || 'ไม่ระบุผู้ขาย';
  const matches = r => matchesApSearch(search, tab === 'journal' ? supplierName(r) : r.supplierName || 'ไม่ระบุผู้ขาย', formatApReference(r.sourceKey), r.description || formatApNote(r.reason));
  const rows = !data ? [] : tab === 'journal' ? data.journals.filter(matches) : tab === 'reconcile' ? data.reconciliation.cases.filter(matches) : [];
  const paged = rows.slice(page*25,page*25+25);
  const amountTotal = field => data?.branchRows.reduce((n,r) => n + Math.round(Number(r[field])*100),0)/100;
  const suppliers = visibleApSuppliers(data?.ledger || [], all);
  const opening = apOpeningState(data);
  const closing = data?.controls?.openingComplete ? sumApAmounts(data.branchRows.map(r => r.closing)) : null;
  const aging = apAgingTotals(data);
  const advance = data?.controls?.openingComplete ? sumApAmounts(data.ledger.map(r => r.advance)) : null;
  return <main className="ap-page" data-mode={dark ? 'dark' : 'light'}>
    <div className="ap-wrap">
      <div className="ap-masthead"><span><Building2 size={16} aria-hidden="true"/> SOLAO <span className="ap-divider" aria-hidden="true">/</span> บัญชีซื้อ</span><div><span className="ap-readonly">{preview === 'offline' ? 'อ่านอย่างเดียวบน SSD' : preview ? 'ตัวอย่างในเครื่อง' : 'อ่านอย่างเดียว'}</span><details className="ap-theme-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.removeAttribute('open'); e.currentTarget.querySelector('summary').focus(); } }}><summary className="ap-theme" aria-describedby="ap-theme-help" aria-label={`เลือกธีม ปัจจุบัน${themePreference === 'light' ? 'สว่าง' : themePreference === 'dark' ? 'มืด' : 'ตามระบบ'}`}><span aria-hidden="true">{themePreference === 'light' ? <Sun size={18}/> : themePreference === 'dark' ? <Moon size={18}/> : <Monitor size={18}/>}</span><span>{themePreference === 'light' ? 'สว่าง' : themePreference === 'dark' ? 'มืด' : 'ตามระบบ'}</span><span id="ap-theme-help" className="ap-tooltip" role="tooltip">เลือกธีมการแสดงผล</span></summary><fieldset><legend>ธีมการแสดงผล</legend>{[[null,'ตามระบบ'],['light','สว่าง'],['dark','มืด']].map(([value,label]) => <label key={label}><input type="radio" name="ap-theme" checked={themePreference === value} onChange={e => { selectTheme(value); const menu = e.currentTarget.closest('details'); menu.removeAttribute('open'); menu.querySelector('summary').focus(); }}/>{label}</label>)}</fieldset></details></div></div>
      <header className="ap-heading"><div><h1>เจ้าหนี้และสมุดรายวันซื้อ</h1><p className="ap-subtitle">ติดตามเงินจ่ายผู้ขายและหลักฐาน</p></div><div className="ap-filters"><MonthPicker value={month} onChange={setMonth}/><label>สาขา<select aria-label="สาขา" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">ทุกสาขา</option>{(data?.branches || [{code:'KK',name:'สาขาคันคลอง'},{code:'SK',name:'สาขาสันกำแพง'}]).map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></label></div></header>
      {busy && <div className="ap-notice" role="status">กำลังอ่านข้อมูลบัญชี…</div>}
      <ApLoadStatus state={!online ? 'offline' : error} onRetry={() => setRetry(n => n + 1)}/>
      <ApReceiving month={month} branch={branch} preview={preview}/>
      {data && <>
        <ApOpeningStatus report={data}/>
        <div className="ap-cards">
          <div className="ap-card"><span>ซื้อจ่ายทันทีจากบิลไลน์</span><strong>{money(amountTotal('paidPurchase'))}</strong><small>ยังไม่ยืนยันวันรับของ (บาท)</small></div>
          <div className="ap-card"><span>จ่ายผู้ขายเครดิต</span><strong>{money(amountTotal('supplierPaid'))}</strong><small>ระบุผู้ขายได้ตามหลักฐานจ่าย (บาท)</small></div>
          <div className={`ap-card${closing == null ? ' ap-card-unknown' : ''}`}><span>เจ้าหนี้คงค้าง ณ สิ้นเดือน</span><strong>{money(closing)}</strong><small>{closing == null ? 'รอยอดยกมาในขอบเขตนี้ให้ครบ' : Number(closing) < 0 ? 'ยอดติดลบเป็นจ่ายล่วงหน้า ยังต้องตรวจใบรับของ' : 'ตามรายการที่มี ยังต้องตรวจใบรับของ (บาท)'}</small></div>
          <div className="ap-card ap-card-secondary"><span>เงินผ่านพี่เก้งที่ระบุได้</span><strong>{money(amountTotal('passThrough'))}</strong><small>บิลรวมอาจไม่ระบุผู้รับ (บาท)</small></div>
          <details className="ap-pass-through-mobile"><summary>เงินผ่านพี่เก้ง</summary><p>{money(amountTotal('passThrough'))} บาท</p><small>บิลรวมอาจไม่ระบุผู้รับ</small></details>
        </div>
        <nav className="ap-tabs" aria-label="รายงานบัญชี">{tabs.map(([id,label])=><button key={id} aria-current={tab===id ? 'page' : undefined} className={tab===id?'active':''} onClick={()=>{setTab(id);setPage(0);setSearch('');}}>{id==='ledger'?<WalletCards size={17}/>:<BookOpen size={17}/>} {label}</button>)}</nav>
        <section className="ap-panel">
          <div className="ap-panel-title"><div><h2>{tabs.find(t=>t[0]===tab)[1]}</h2><p>{tab==='ledger'?'ทะเบียนผู้ขายเครดิต รับของ 1–15 จ่ายวันที่ 20 รับของ 16–สิ้นเดือน จ่ายวันที่ 5 เดือนถัดไป':tab==='journal'?'รายการชั่วคราวตามหลักฐานจ่าย ยังไม่มีใบรับของยืนยันซื้อเครดิต':tab==='trial'?'การเคลื่อนไหวบัญชีซื้อเท่านั้น ไม่ใช่งบทดลองทั้งบริษัท':'ใช้บิลเดียวกับกำไรขาดทุนเดิม ไม่บวกค่าใช้จ่ายซ้ำ'}</p></div><ApBalanceStatus balance={data.balance}/></div>
          {tab==='ledger' && <><div className="ap-toolbar"><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> แสดงทะเบียนทั้งหมด</label><span>{opening.state === 'complete' ? 'ยอดตามรายการที่มี หน่วยบาท' : opening.label}</span></div><div className="ap-ledger-layout"><div className="ap-ledger-register"><div className="ap-suppliers-desktop"><Table rowTitle={r=><><strong>{r.name}</strong><small>{branchName(r.branch)}{supplierReference(r) && <><br/>{supplierReference(r)}</>}</small></>} rowKey={r=>r.key} rows={suppliers} columns={[
            ['name','ผู้จำหน่าย',r=><><strong>{r.name}</strong>{supplierReference(r) && <small>{supplierReference(r)}</small>}</>],['branch','สาขา',r=>branchName(r.branch)],['opening','ยกมา',r=>money(r.opening),true],['purchases','ซื้อเครดิต',r=>money(r.purchases),true],['paid','จ่ายตามบิลไลน์',r=>money(r.paid),true],['closing','คงค้าง',r=><>{money(r.closing)}<details className="ap-row-aging"><summary>อายุหนี้<span className="ap-sr-only"> {r.name}</span></summary><dl>{AP_AGING_BUCKETS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{money(r.aging?.[key])}</dd></div>)}</dl><p>ยอดยกมานับจากวันยกมา เป็นค่าประมาณ</p></details></>,true]
          ]}/></div><MobileSuppliers rows={suppliers} branchName={branchName}/></div><aside className="ap-aging" aria-label="อายุหนี้ในขอบเขตที่เลือก"><h3>อายุหนี้</h3><p>ทุกผู้ขายในสาขาที่เลือก</p>{aging ? <><table><caption className="ap-sr-only">อายุหนี้ หน่วยบาท</caption><thead><tr><th scope="col">ช่วงอายุ</th><th scope="col" className="num">บาท</th></tr></thead><tbody>{AP_AGING_BUCKETS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td className="num">{money(aging[key])}</td></tr>)}</tbody></table>{advance != null && Number(advance) > 0 && <p>จ่ายล่วงหน้า {money(advance)} บาท แยกจากอายุหนี้</p>}<p>ยอดยกมา: นับจากวันยกมา เป็นค่าประมาณ</p>{Object.values(aging).some(v => v == null) && <p className="ap-pending">บางรายการขาดวันครบกำหนด ยังรวมอายุหนี้ไม่ได้</p>}</> : <p className="ap-pending">รอยอดยกมาในขอบเขตนี้ให้ครบ</p>}</aside></div><div className="ap-footnote">จ่ายวันที่ 5–6 จัดเป็นการชำระของเดือนก่อนตามกฎเจ้าของ ไม่สร้างยอดซื้อเดือนก่อนหรือยอดยกมาทดแทนเอง</div></>}
          {tab==='journal' && <><div className="ap-toolbar"><input aria-label="ค้นหารายการบัญชี" placeholder="ค้นหาผู้ขาย / เลขบิล" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length} รายการบัญชี</span></div><PurchaseJournal rows={paged} account={account} branchName={branchName} supplierName={supplierName}/></>}
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
        <details className="ap-details ap-limitations"><summary>ขอบเขตข้อมูลและสิ่งที่ต้องติดตาม</summary><p>ข้อมูลนี้แสดงเงินจ่ายจากระบบกระแสเงินสดและบิลไลน์ รวมยอดยกมาที่นำเข้า คงค้างและอายุหนี้แสดงตามรายการที่มีเมื่อยอดยกมาครบในสาขา อายุยอดยกมาเป็นค่าประมาณ ใบรับของและรายการจ่ายยังต้องตรวจความครบ ซื้อเครดิตคงเป็น “ยังไม่ทราบ” เมื่อไม่มีหลักฐานครบ การจ่ายผู้ขายเครดิตบันทึกเดบิตเจ้าหนี้และเครดิตเงินจ่าย</p><ul>{data.limitations.map(l=><li key={l}>{formatApNote(l)}</li>)}</ul><p>ข้อมูล ณ {formatApCapturedAt(data.capturedAt)} รหัสชุด {data.fingerprint.slice(0,12)}</p></details>
        <footer className="ap-footer">SOLAO <span>บัญชีคู่ หน่วยบาทและสตางค์ อ่านข้อมูลต้นทางอย่างเดียว</span></footer>
      </>}
    </div>
  </main>;
}
