import { useEffect, useState } from 'react';
import { BookOpen, Building2, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, Moon, Sun, WalletCards } from 'lucide-react';
import './apLedger.css';
import { formatApReference, readApThemePreference, saveApTheme, systemApTheme } from './apLedgerUi.js';
const money = v => v == null ? 'ยังไม่ทราบ' : new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const tabs = [['ledger','ทะเบียนเจ้าหนี้'],['journal','สมุดรายวันซื้อ'],['trial','งบทดลอง'],['reconcile','กระทบยอด']];
const statusText = { CREDIT_PAYMENT: 'จ่ายซัพเครดิต', PAID_PURCHASE: 'ซื้อจ่ายทันที', PASS_THROUGH: 'เงินผ่านพี่เก้ง', REVIEW_TRANSACTION: 'รอตรวจประเภท', AMBIGUOUS_SUPPLIER: 'ซัพซ้ำหลายกฎ', PNL_EXCLUDED: 'P&L ไม่นับ', OPEN_ROUND: 'รอบยังไม่ปิด', PNL_PERIOD_ONLY: 'P&L ย้ายเดือน' };
const defaultLoad = async params => { const { request } = await import('./api.js'); return request(`/ap/report?${params}`); };
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
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    setThemePreference(next); saveApTheme(next);
  };
  useEffect(() => {
    let current = true; setBusy(true); setData(null); setError(''); setPage(0);
    loadReport(new URLSearchParams({ month, branch })).then(r => { if (current) setData(r); }).catch(() => { if (current) setError('ยังไม่มีข้อมูล AP ที่นำเข้าสำหรับเดือนนี้ หรือไม่สามารถอ่านฐานจำลองได้'); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  },[month,branch,loadReport]);
  const account = code => data?.accounts.find(a => a.code === code)?.name || code;
  const branchName = code => data?.branches.find(b => b.code === code)?.name || code || 'ไม่ระบุสาขา';
  const supplierName = key => data?.sources?.find(s => s.key === key)?.supplierName || 'ไม่ระบุซัพ';
  const matches = r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
  const rows = !data ? [] : tab === 'journal' ? data.journals.filter(matches) : tab === 'reconcile' ? data.reconciliation.cases.filter(matches) : [];
  const paged = rows.slice(page*25,page*25+25);
  const amountTotal = field => data?.branchRows.reduce((n,r) => n + Math.round(Number(r[field])*100),0)/100;
  return <main className="ap-page" data-mode={dark ? 'dark' : 'light'}>
    <div className="ap-wrap">
      <div className="ap-masthead"><span><Building2 size={16}/> SOLAO <span className="ap-divider">/</span> GENERAL CASHFLOW</span><div><span className="ap-readonly">อ่านอย่างเดียว{preview === 'offline' ? ' · ไฟล์บน SSD' : preview ? ' · Local preview' : ''}</span><button aria-label={dark ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'} className="ap-theme" onClick={toggleTheme}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button></div></div>
      <header className="ap-heading"><div><p className="ap-eyebrow">บัญชีซื้อ · AP LEDGER V0</p><h1>เจ้าหนี้ & สมุดรายวันซื้อ</h1><p className="ap-subtitle">ติดตามเงินจ่ายซัพ พร้อมหลักฐานและส่วนต่างที่ต้องตรวจ</p></div><div className="ap-filters"><label>เดือนบัญชี<input aria-label="เดือนบัญชี" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><label>สาขา<select aria-label="สาขา" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">ทุกสาขา</option>{(data?.branches || [{code:'KK',name:'สาขาคันคลอง'},{code:'SK',name:'สาขาสันกำแพง'}]).map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></label></div></header>
      {busy && <div className="ap-notice" role="status">กำลังอ่านข้อมูลบัญชี…</div>}
      {error && <div className="ap-notice" role="alert">{error}</div>}
      {data && <>
        <aside className="ap-notice"><CircleHelp size={20}/><div><strong>ยังปิดยอดเจ้าหนี้ไม่ได้ — ขาดยอดยกมาและบิลรับของ</strong><p>ชุดนี้แสดงเงินจ่ายจริงที่บันทึกใน Cashflow / LINE Bill จึงยังยืนยันยอดซื้อเกณฑ์คงค้างและอายุหนี้ไม่ได้ รายการบัญชีเป็นรายการชั่วคราวตามหลักฐานจ่าย</p></div></aside>
        <div className="ap-cards">
          <div className="ap-card"><span>ซื้อจ่ายทันทีจาก LBC</span><strong>{money(amountTotal('paidPurchase'))}</strong><small>ยังไม่ยืนยันวันที่รับของ · บาท</small></div>
          <div className="ap-card"><span>จ่ายซัพเครดิตที่ระบุรายซัพได้</span><strong>{money(amountTotal('supplierPaid'))}</strong><small>Dr เจ้าหนี้ / Cr เงินจ่าย · บาท</small></div>
          <div className="ap-card ap-card-unknown"><span>เจ้าหนี้คงค้าง ณ สิ้นเดือน</span><strong>ยังไม่ทราบ</strong><small>ต้องมียอดยกมา + ใบรับของครบ</small></div>
          <div className="ap-card"><span>เงินผ่านพี่เก้งที่ระบุได้</span><strong>{money(amountTotal('passThrough'))}</strong><small>ข้อมูลบิลรวมอาจไม่ระบุผู้รับ · บาท</small></div>
        </div>
        <nav className="ap-tabs" aria-label="รายงานบัญชี">{tabs.map(([id,label])=><button key={id} aria-current={tab===id ? 'page' : undefined} className={tab===id?'active':''} onClick={()=>{setTab(id);setPage(0);setSearch('');}}>{id==='ledger'?<WalletCards size={17}/>:<BookOpen size={17}/>} {label}</button>)}</nav>
        <section className="ap-panel">
          <div className="ap-panel-title"><div><h2>{tabs.find(t=>t[0]===tab)[1]}</h2><p>{tab==='ledger'?'ยอดซื้อและคงค้างว่างไว้เมื่อหลักฐานไม่ครบ รอบรับ 1–15 จ่าย 20 · รับ 16–สิ้นเดือน จ่าย 5':tab==='journal'?'ไม่มีใบรับของที่ยืนยันให้ลงซื้อเครดิต · แสดงรายการจากหลักฐานจ่ายชั่วคราว':tab==='trial'?'งบทดลองการเคลื่อนไหวในขอบเขต AP เท่านั้น · ไม่ใช่งบทดลองทั้งบริษัท':'อ้างอิงบิลเดียวกับ P&L เดิม · ไม่บวกค่าใช้จ่าย AP ซ้ำเข้ากำไรขาดทุน'}</p></div><span className="ap-balanced"><CheckCheck size={16}/> Dr = Cr</span></div>
          {tab==='ledger' && <><div className="ap-toolbar"><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> แสดงทะเบียนทั้งหมด</label><span>ยอดยกมาและอายุหนี้: รอหลักฐาน</span></div><Table rowTitle={r=><><strong>{r.name}</strong><small>{branchName(r.branch)} · {formatApReference(r.reference)}</small></>} rowKey={r=>r.key} rows={data.ledger.filter(r=>all || Number(r.paid)!==0)} columns={[
            ['name','ผู้จำหน่าย',r=><><strong>{r.name}</strong><small>{formatApReference(r.reference)}</small></>],['branch','สาขา',r=>branchName(r.branch)],['opening','ยกมา',r=>money(r.opening),true],['purchases','ซื้อเครดิต',r=>money(r.purchases),true],['paid','จ่ายตาม LBC',r=>money(r.paid),true],['closing','คงค้าง',r=>money(r.closing),true],['aging','อายุหนี้',()=> <span className="ap-pending">รอบิลรับของ</span>]
          ]}/><div className="ap-footnote">จ่ายวันที่ 5–6 จัดเป็นการชำระของเดือนก่อนตามกฎเจ้าของ ไม่สร้างยอดซื้อเดือนก่อนหรือยอดยกมาทดแทนเอง</div></>}
          {tab==='journal' && <><div className="ap-toolbar"><input aria-label="ค้นหารายการบัญชี" placeholder="ค้นหาซัพ / เลขบิล" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length} รายการบัญชี</span></div><Table rowTitle={r=><><strong>{supplierName(r.sourceKey)}</strong><small>{branchName(r.branch)} · {r.date}</small><small>{formatApReference(r.sourceKey)}</small></>} rows={paged} columns={[
            ['date','วันที่จ่าย'],['branch','สาขา',r=>branchName(r.branch)],['sourceKey','ที่มา',r=><><span className="ap-reference">{formatApReference(r.sourceKey)}</span><small>{r.description}</small></>],['lines','รายการบัญชี',r=>r.lines.map((l,i)=><div className="ap-entry" key={i}><span>{account(l.account)}</span><span>{Number(l.dr)>0?'Dr':'Cr'} {money(Number(l.dr)>0?l.dr:l.cr)}</span></div>)],['flags','สถานะ',r=><span className="ap-pending">{r.type==='payment'?'จ่ายเจ้าหนี้':'ตามหลักฐานจ่าย'}<small>{r.flags.includes('PAYMENT_FOR_PREVIOUS_MONTH')?'ของเดือนก่อน':'วันรับของยังไม่ทราบ'}</small></span>]
          ]}/></>}
          {tab==='trial' && <><div className="ap-trial-total"><div><span>เดบิต</span><strong>{money(data.balance.dr)}</strong></div><div><span>เครดิต</span><strong>{money(data.balance.cr)}</strong></div><div><span>ส่วนต่าง</span><strong>{money(data.balance.difference)}</strong></div></div><Table rows={data.trialBalance} rowKey={r=>r.account} columns={[
            ['account','บัญชี',r=><>{account(r.account)}<small>{r.account}</small></>],['opening','ยอดก่อนเดือนในชุดนี้',r=>money(r.opening),true],['dr','เดบิต',r=>money(r.dr),true],['cr','เครดิต',r=>money(r.cr),true],['closing','สุทธิ Dr−Cr',r=>money(r.closing),true]
          ]}/><div className="ap-footnote">ยอดก่อนเดือน 0.00 หมายถึงไม่มีรายการก่อนเดือนในชุดนำเข้า ไม่ใช่ยอดยกมาที่รับรองของบริษัท</div></>}
          {tab==='reconcile' && <><div className="ap-recon-summary"><div><span>LBC ตามวันจ่าย</span><strong>{money(data.reconciliation.lbc)}</strong></div><div><span>ต้นทุน/ค่าใช้จ่ายชั่วคราว AP</span><strong>{money(data.reconciliation.journalCost)}</strong></div><div><span>P&L เดิม เฉพาะ LBC</span><strong>{money(data.reconciliation.pnlLbc)}</strong></div></div><div className="ap-footnote">{data.reconciliation.bankConclusion} · จับคู่แล้ว {data.reconciliation.matchedCount} รายการ</div><details className="ap-details"><summary>รายการธนาคาร {data.reconciliation.statements.length} รายการ · รวม {money(data.reconciliation.statementTotal)} บาท</summary><p>ยืนยันรับเข้า {money(data.reconciliation.incomingTotal)} · ยืนยันจ่ายออก {money(data.reconciliation.outgoingTotal)} · ยังไม่ทราบทิศทาง {money(data.reconciliation.unknownTotal)}</p><Table rows={data.reconciliation.statements} columns={[
            ['key','อ้างอิง',r=>formatApReference(r.key)],['date','วันที่'],['amount','ยอด',r=>money(r.amount),true],['direction','ทิศทาง',r=>({incoming:'รับเข้า',outgoing:'จ่ายออก',unknown:'ไม่ทราบ'})[r.direction]],['status','สถานะ',()=> 'ยังไม่จับคู่ซัพ']
          ]}/></details><div className="ap-toolbar"><input aria-label="ค้นหากระทบยอด" placeholder="ค้นหาซัพ / เลขบิล" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length} แหล่งรายการ</span></div><Table rowTitle={r=><><strong>{r.supplierName || 'ไม่ระบุซัพ'}</strong><small>{branchName(r.branch)} · {formatApReference(r.sourceKey)}</small></>} rows={paged} rowKey={r=>r.sourceKey} columns={[
            ['sourceKey','แหล่งข้อมูล',r=><><span className="ap-reference">{formatApReference(r.sourceKey)}</span><small>{r.supplierName || 'ไม่ระบุซัพ'} · {branchName(r.branch)}</small></>],['amount','ยอด LBC',r=>money(r.amount),true],['pnl','P&L เดิม',r=>money(r.pnl),true],['journalCost','ต้นทุน AP',r=>money(r.journalCost),true],['difference','AP − P&L',r=>money(r.difference),true],['reason','เหตุผล',r=><><span className="ap-pending">{statusText[r.status]}</span><small>{r.reason}{r.purchasePeriod ? ` · ของเดือน ${r.purchasePeriod}`:''}</small></>]
          ]}/></>}
          {['journal','reconcile'].includes(tab) && <div className="ap-pagination"><span>หน้า {page+1} / {Math.max(1,Math.ceil(rows.length/25))}</span><button disabled={!page} aria-label="หน้าก่อน" onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/></button><button disabled={(page+1)*25>=rows.length} aria-label="หน้าถัดไป" onClick={()=>setPage(p=>p+1)}><ChevronRight size={17}/></button></div>}
        </section>
        <details className="ap-details ap-limitations"><summary>ขอบเขตข้อมูลและสิ่งที่ต้องติดตาม</summary><ul>{data.limitations.map(l=><li key={l}>{l}</li>)}</ul><p>ที่มา snapshot: {new Date(data.capturedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · รหัสชุด {data.fingerprint.slice(0,12)}</p></details>
        <footer className="ap-footer">GENERAL CASHFLOW <span>บัญชีคู่ · บาท / สตางค์ · ไม่แก้ข้อมูลต้นทาง</span></footer>
      </>}
    </div>
  </main>;
}
