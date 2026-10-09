import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import { formatPnlMoney as money, sumPnlRows, thaiMonth, previousMonth } from './profitLoss.js';
import './profitLoss.css';
const send = (method, path, body) => request(`/pnl${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const errorText = (error) => ({
  PNL_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่าการเชื่อม LINE Bill', PNL_SYNC_RUNNING: 'กำลังดึงข้อมูลอยู่ โปรดลองอีกครั้ง',
  LBC_EXPORT_V2_REQUIRED: 'LINE Bill ต้องอัปเดตระบบส่งออกก่อน', INVALID_AMOUNT: 'ยอดต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง',
  INVALID_MONTH: 'เดือนไม่ถูกต้อง', RULE_EXISTS: 'มีกฎนี้แล้ว'
}[error.details?.code] || 'ดำเนินการไม่สำเร็จ โปรดลองอีกครั้ง');
const emptyForm = () => ({ category_code: '', branch_id: '', description: '', amount: '', note: '' });
export default function ProfitLoss({ branches }) {
  const [month, setMonth] = useState(thaiMonth); const [branchId, setBranchId] = useState('');
  const [report, setReport] = useState(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); const [rules, setRules] = useState([]);
  const [form, setForm] = useState(emptyForm); const [editing, setEditing] = useState(null); const [copies, setCopies] = useState([]);
  const generation = useRef(0);
  const reload = async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try {
      const [data, ruleRows] = await Promise.all([request(`/pnl/report?${new URLSearchParams({ month, branch_id: branchId })}`), request('/pnl/rules')]);
      if (current === generation.current) { setReport(data); setRules(ruleRows); }
    } catch (err) { if (current === generation.current) { setError(errorText(err)); setReport(null); } }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => { setReport(null); setSelected(null); setCopies([]); setForm(emptyForm()); setEditing(null); reload(); return () => { generation.current++; }; }, [month, branchId]);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await reload(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } };
  const categories = report?.category_rows.filter((row) => row.code !== 'UNCATEGORIZED') || [];
  const categoryOptions = <><option value="">เลือกหมวด</option>{categories.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</>;
  const branchOptions = <><option value="">ส่วนกลาง</option>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</>;
  const totals = report?.totals;
  const waiting = report?.items.filter((row) => !row.excluded && !row.category_code) || [];
  const excluded = report?.items.filter((row) => row.excluded) || [];
  const filtered = selected === 'REVENUE' ? [] : selected === 'EXCLUDED' ? excluded : report?.items.filter((row) => !row.excluded && (selected === 'COGS' ? categories.find((category) => category.code === row.category_code)?.is_cogs : selected === 'OPEX' ? !categories.find((category) => category.code === row.category_code)?.is_cogs : (row.category_code || 'UNCATEGORIZED') === selected)) || [];
  const selectedManual = report?.manual_expenses.filter((row) => selected === 'COGS' ? categories.find((category) => category.code === row.category_code)?.is_cogs : selected === 'OPEX' ? !categories.find((category) => category.code === row.category_code)?.is_cogs : row.category_code === selected) || [];
  const renderItems = (items) => <div className="pnl-table-scroll"><table><thead><tr><th>วันที่ / ร้าน</th><th>รายละเอียด / ประเภท</th><th>ยอด</th><th>จัดหมวด</th></tr></thead><tbody>{items.map((item) => <ExpenseRow key={item.stable_key} item={item} categories={categories} busy={busy} onSave={(body) => act(() => send('PUT', `/items/${encodeURIComponent(item.stable_key)}/override`, body))} />)}</tbody></table>{items.length === 0 && <p>ไม่มีรายการ</p>}</div>;
  const row = (name, value, key, branchField) => <tr key={key || name}><th>{key ? <button className="pnl-link" onClick={() => setSelected(key)}>{name}</button> : name}</th><td className={value < 0 ? 'pnl-negative' : ''}>{money(value)}</td>{!branchId && report.branch_columns.map((branch) => <td key={branch.key} className={branch[branchField] < 0 ? 'pnl-negative' : ''}>{money(branch[branchField])}</td>)}</tr>;
  return <main className="pnl-page">
    <p className="pnl-notice">ตัวเลขบริหารโดยประมาณ ไม่ใช่งบการเงินหรือแบบภาษี · ยอดรวม VAT</p>
    <div className="pnl-toolbar"><h1>กำไรขาดทุน</h1><label>เดือน<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy}/></label><label>สาขา<select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={busy}><option value="">ทั้งหมด</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><button disabled={busy || loading || !report?.configured} onClick={() => act(() => send('POST', '/sync', { month }))}>{busy ? 'กำลังดำเนินการ…' : 'ดึงรายจ่ายล่าสุด'}</button></div>
    {report && <p>{!report.configured ? 'ยังไม่ได้ตั้งค่าการเชื่อม LINE Bill · ' : ''}ดึงล่าสุด: {report.latest_sync ? `${report.latest_sync.finished_at || report.latest_sync.started_at} · ${{SUCCEEDED:'สำเร็จ',FAILED:'ไม่สำเร็จ',RUNNING:'กำลังดึง'}[report.latest_sync.status]}${report.latest_sync.error_code ? ' · ต้องตรวจการเชื่อมต่อ' : ''}` : 'ยังไม่เคยดึงข้อมูล'}</p>}
    {error && <p role="alert" className="pnl-negative">{error}</p>}
    {loading ? <p role="status">กำลังโหลด…</p> : report && <>
      <div className="pnl-cards">{[['รายรับ', totals.revenue], ['ต้นทุนวัตถุดิบ', totals.cogs], ['ค่าใช้จ่ายอื่น', totals.opex], ['กำไรสุทธิ', totals.net_profit]].map(([label, value]) => <article key={label}><span>{label}</span><strong className={value < 0 ? 'pnl-negative' : ''}>{money(value)} บาท</strong>{label === 'กำไรสุทธิ' && <small>อัตรากำไร {totals.margin_pct == null ? '—' : totals.margin_pct.toFixed(2) + '%'}</small>}</article>)}</div>
      <section className="pnl-completeness">{report.completeness.map((branch) => <details key={branch.branch_id}><summary>{branch.name}: รายรับครบ {branch.revenue_days}/{branch.days_expected} วัน · รายจ่าย LINE ปิดรอบ {branch.expense_days}/{branch.days_expected} วัน {branch.month_close_revision && `· ปิดเดือนแล้ว (rev ${branch.month_close_revision})`}</summary><p>รายรับยังไม่ปิด: {branch.revenue_missing.join(', ') || 'ไม่มี'}</p><p>รายจ่ายยังไม่ปิดหรือไม่มีรอบ: {branch.expense_missing.join(', ') || 'ไม่มี'}</p></details>)}</section>
      <p>วัตถุดิบเป็นยอดซื้อ ยังไม่คิดสต็อก · รายจ่ายนอก LINE ต้องกรอกเอง · รายรับอาจเปลี่ยนเมื่อ POS แก้ย้อนหลัง</p>
      {(report.reimbursement_count + report.incoming_transfer_count > 0) && <p>มีรายการคืนเงิน/เงินเข้า {report.reimbursement_count + report.incoming_transfer_count} รายการ ไม่ได้นับ</p>}
      <section><div className="pnl-table-scroll"><table><thead><tr><th>รายการ</th><th>ยอดรวม (บาท)</th>{!branchId && report.branch_columns.map((branch) => <th key={branch.key}>{branch.name}</th>)}</tr></thead><tbody>
        {row('รายรับ', totals.revenue, 'REVENUE', 'revenue')}{row('ต้นทุนวัตถุดิบ', totals.cogs, 'COGS', 'cogs')}{row('กำไรขั้นต้นโดยประมาณ', totals.gross_profit, null, 'gross_profit')}
        {report.category_rows.map((category) => <tr key={category.code}><th><button className="pnl-link" onClick={() => setSelected(category.code)}>{category.name}{category.is_cogs ? ' (ต้นทุนวัตถุดิบ)' : ''}</button></th><td className={category.amount < 0 ? 'pnl-negative' : ''}>{money(category.amount)}</td>{!branchId && report.branch_columns.map((branch) => <td key={branch.key} className={category.branches[branch.key] < 0 ? 'pnl-negative' : ''}>{money(category.branches[branch.key])}</td>)}</tr>)}
        {row('กำไรสุทธิโดยประมาณ', totals.net_profit, null, 'net_profit')}
      </tbody></table></div></section>
      {selected && <section><h2>รายการ: {selected === 'REVENUE' ? 'รายรับ POS' : selected === 'COGS' ? 'ต้นทุนวัตถุดิบ' : selected === 'OPEX' ? 'ค่าใช้จ่ายอื่น' : selected === 'EXCLUDED' ? 'ไม่นับเป็นค่าใช้จ่าย' : report.category_rows.find((row) => row.code === selected)?.name}</h2><button onClick={() => setSelected(null)}>ปิดรายการ</button>{selected === 'REVENUE' ? <div className="pnl-table-scroll"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>ยอด POS รวม VAT</th><th>สถานะ</th></tr></thead><tbody>{report.revenue_receipts.map((receipt) => <tr key={receipt.id}><td>{receipt.receipt_date}</td><td>{branches.find((branch) => String(branch.id) === String(receipt.branch_id))?.name}</td><td>{money(receipt.gross_sales_expected)}</td><td>{receipt.status === 'CLOSED' ? 'ปิดแล้ว' : 'ยังไม่ปิด'}</td></tr>)}</tbody></table></div> : <>{renderItems(filtered)}{selectedManual.map((item) => <p key={item.id}>กรอกเอง: {item.description} · {money(item.amount)} บาท</p>)}</>}</section>}
      <section><h2>รอจัดหมวด ({waiting.length} รายการ, {money(sumPnlRows(waiting))} บาท)</h2>{renderItems(waiting)}</section>
      <section><h2>ไม่นับเป็นค่าใช้จ่าย · {money(report.excluded_total)} บาท</h2>{renderItems(excluded)}</section>
      <section><h2>รายจ่ายกรอกเอง · {money(report.manual_total)} บาท</h2><div className="pnl-table-scroll"><table><thead><tr><th>รายละเอียด</th><th>หมวด / สาขา</th><th>ยอด</th><th>จัดการ</th></tr></thead><tbody>{report.manual_expenses.map((item) => <tr key={item.id}><td>{item.description}</td><td>{categories.find((row) => row.code === item.category_code)?.name} / {branches.find((row) => row.id === item.branch_id)?.name || 'ส่วนกลาง'}</td><td className={item.amount < 0 ? 'pnl-negative' : ''}>{money(item.amount)}</td><td><button disabled={busy} onClick={() => {setForm({ ...item, branch_id: item.branch_id || '' }); setEditing(item.id);}}>แก้ไข</button><button disabled={busy} onClick={() => act(() => send('DELETE', `/manual-expenses/${item.id}`))}>ลบ</button></td></tr>)}</tbody></table></div>
        <form className="pnl-form" onSubmit={(e) => {e.preventDefault(); act(async () => {await send(editing ? 'PUT' : 'POST', `/manual-expenses${editing ? '/' + editing : ''}`, {...form, month}); setForm(emptyForm()); setEditing(null);});}}>
          <label>หมวด<select required value={form.category_code} onChange={(e) => setForm({...form, category_code:e.target.value})}>{categoryOptions}</select></label><label>สาขา<select value={form.branch_id} onChange={(e) => setForm({...form, branch_id:e.target.value})}>{branchOptions}</select></label><label>รายละเอียด<input required maxLength={300} value={form.description} onChange={(e) => setForm({...form, description:e.target.value})}/></label><label>ยอด (บาท)<input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({...form, amount:e.target.value})}/></label><label>หมายเหตุ<input maxLength={500} value={form.note || ''} onChange={(e) => setForm({...form, note:e.target.value})}/></label><button disabled={busy}>{editing ? 'บันทึกการแก้ไข' : 'ยืนยันเพิ่มรายจ่าย'}</button>{editing && <button type="button" onClick={() => {setEditing(null); setForm(emptyForm());}}>ยกเลิก</button>}
        </form>
        <button disabled={busy} onClick={() => act(async () => { const rows = await request(`/pnl/manual-expenses?${new URLSearchParams({month:previousMonth(month), branch_id:branchId})}`); setCopies(rows); })}>คัดลอกจากเดือนก่อน</button>
        {copies.length > 0 && <div><p>เลือกเติมฟอร์ม แล้วกดยืนยันเพิ่มรายจ่ายเพื่อบันทึก</p>{copies.map((item) => <button key={item.id} onClick={() => {setEditing(null); setForm({...item, branch_id:item.branch_id || ''});}}>{item.description} · {money(item.amount)} บาท</button>)}</div>}
      </section>
      <details><summary>กฎจัดหมวด ({rules.length})</summary>{rules.map((rule) => <p key={rule.id}>{rule.match_field === 'supplier' ? 'ร้าน' : 'วัตถุประสงค์'}: {rule.pattern} → {categories.find((row) => row.code === rule.category_code)?.name} <button disabled={busy} onClick={() => act(() => send('DELETE', `/rules/${rule.id}`))}>ลบกฎ</button></p>)}</details>
    </>}
  </main>;
}
function ExpenseRow({ item, categories, busy, onSave }) {
  const [category, setCategory] = useState(item.category_code || ''); const [rule, setRule] = useState(false);
  useEffect(() => setCategory(item.category_code || ''), [item.category_code]);
  const types = {internal_transfer:'โอนภายใน',loan:'เงินกู้',refund_adjustment:'คืนเงิน',purchase:'ซื้อสินค้า',advance_payment:'สำรองจ่าย',reimbursement:'คืนเงินสำรอง',unknown:'ไม่ระบุ'};
  return <tr><td>{item.business_date}<br/>{item.supplier_name || 'ไม่ระบุร้าน'}<br/>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">ดูบิล</a>}</td><td>{item.description}<br/><small>{types[item.transaction_type] || 'ไม่ระบุประเภท'} {item.unreviewed && '· ยังไม่ตรวจประเภท'} {item.kind === 'PAYMENT_WITHOUT_BILL' && '· จ่ายโดยไม่มีบิล'}</small></td><td className={item.amount < 0 ? 'pnl-negative' : ''}>{money(item.amount)}</td><td><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">ยังไม่จัดหมวด</option>{categories.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select><label><input type="checkbox" checked={rule} onChange={(e) => setRule(e.target.checked)}/>ใช้กับร้านนี้ทุกครั้ง</label><button disabled={busy || (rule && !category)} onClick={() => onSave({category_code:category || null, ...(rule ? {create_rule:'supplier'} : {})})}>บันทึกหมวด</button><button disabled={busy} onClick={() => onSave({excluded:!item.excluded})}>{item.excluded ? 'นับเป็นค่าใช้จ่าย' : 'ไม่นับรายการนี้'}</button></td></tr>;
}
