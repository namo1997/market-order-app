import { Link } from 'react-router-dom';
import { orderingLabel, kindLabels, emptySupplierFilters, branchCodesText } from './receiving-suppliers';

const branchesText = item => {
  const seen = item.branches_seen?.length ? `เคยรับของแล้ว: ${item.branches_seen.join(', ')}` : '';
  return { note: item.branches_note || '', seen };
};

// Registry table. Presentational only: the page owns loading and the search state.
export function ReceivingSuppliersView({ filters = emptySupplierFilters, setFilters = () => {}, onSearch, onReset, data, loading, error }) {
  const change = key => event => setFilters(previous => ({ ...previous, [key]: event.target.value }));
  const items = data?.items || [];
  return <>
    <form className="ra-filters ra-supplier-filters" onSubmit={onSearch} role="search" aria-label="ค้นหาร้านค้า">
      <label>ค้นหาชื่อหรือรหัสร้าน<input type="search" maxLength={100} value={filters.q} onChange={change('q')} placeholder="เช่น เจ๊แวว, AP-014 หรือรหัสตามสาขา" /></label>
      <label>ประเภท<select value={filters.kind} onChange={change('kind')}><option value="">ทุกประเภท</option>
        {Object.entries(kindLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <button className="ra-primary" disabled={loading} type="submit">ค้นหา</button>
      <button type="button" onClick={onReset}>ล้างตัวกรอง</button>
    </form>
    <p className="ra-note">ชื่อย่อในบิลคือข้อความที่ร้านเขียนบนบิล (เช่น "ทB") เทียบกับสินค้าในระบบ ใช้ช่วยอ่านบิลอัตโนมัติ · การแก้ไขทุกครั้งมีบันทึกว่าใครทำเมื่อไร และปิดใช้ได้โดยไม่ลบประวัติ</p>
    {error && <p role="alert">{error} <button type="button" onClick={onSearch}>ลองใหม่</button></p>}
    {loading ? <p role="status">กำลังโหลดรายชื่อร้าน…</p> : data && <>
      <div className="ra-table-scroll ra-supplier-table" tabIndex={0} aria-label="ตารางร้านค้า เลื่อนซ้ายขวาได้">
        <table><caption>ร้านค้าและชื่อย่อในบิล · {items.length.toLocaleString('th-TH')} ร้าน</caption>
          <thead><tr><th className="ra-col-shop">ร้าน</th><th className="ra-col-code">รหัส</th><th>ส่งให้สาขา</th><th>การสั่ง</th><th className="ra-col-bill">รูปแบบบิล</th><th className="ra-number">ชื่อย่อที่ใช้งาน</th><th className="ra-col-action">จัดการ</th></tr></thead>
          <tbody>{items.length ? items.map(item => {
            const branches = branchesText(item);
            const codes = item.branch_codes || [];
            return <tr key={item.supplier_key}>
              <td data-label="ร้าน" className="ra-col-shop"><span className="ra-shop-name">{item.name}</span><span className="ra-chip ra-chip-kind">{kindLabels[item.kind] || item.kind}{item.is_active ? '' : ' · ปิดใช้งาน'}</span></td>
              <td data-label="รหัส" className="ra-col-code"><span className="ra-code">{item.code || '—'}</span>
                {codes.length > 0 && <>
                  <span className="ra-sr">รหัสตามสาขา: {branchCodesText(codes)}</span>
                  <span className="ra-chips" aria-hidden="true">{codes.map(entry => <span className="ra-chip" key={entry.code}>{entry.branch_note ? `${entry.code} · ${entry.branch_note}` : entry.code}</span>)}</span>
                </>}</td>
              <td data-label="ส่งให้สาขา">{branches.note || (branches.seen ? '' : 'ยังไม่ระบุ')}{branches.seen && <small>{branches.seen}</small>}</td>
              <td data-label="การสั่ง"><span className={`ra-mode ra-mode-${item.ordering_mode || 'unknown'}`}>{orderingLabel(item.ordering_mode)}</span></td>
              <td data-label="รูปแบบบิล" className="ra-decision ra-col-bill"><span className="ra-clamp" title={item.bill_format_note || undefined}>{item.bill_format_note || '—'}</span></td>
              <td data-label="ชื่อย่อที่ใช้งาน" className="ra-number">{item.alias_active_count}{item.alias_disabled_count > 0 && <small>ปิดใช้ {item.alias_disabled_count}</small>}</td>
              <td data-label="จัดการ" className="ra-col-action"><Link className="ra-manage-link" to={`/admin/receiving/suppliers/${encodeURIComponent(item.supplier_key)}`} aria-label={`จัดการร้าน ${item.name}`}>จัดการชื่อย่อ →</Link></td>
            </tr>;
          }) : <tr><td colSpan={7} className="ra-empty">ไม่พบร้านตามตัวกรอง</td></tr>}</tbody>
        </table>
      </div>
      {data.truncated && <p className="ra-note" role="status">แสดงเฉพาะ {data.limit} ร้านแรก กรุณาค้นหาให้แคบลง</p>}
    </>}
  </>;
}
