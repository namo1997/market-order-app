import { Link } from 'react-router-dom';
import { orderingLabel, kindLabels, emptySupplierFilters } from './receiving-suppliers';

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
      <label>ค้นหาชื่อหรือรหัสร้าน<input type="search" maxLength={100} value={filters.q} onChange={change('q')} placeholder="เช่น เจ๊แวว หรือ AP-014" /></label>
      <label>ประเภท<select value={filters.kind} onChange={change('kind')}><option value="">ทุกประเภท</option>
        {Object.entries(kindLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <button className="ra-primary" disabled={loading} type="submit">ค้นหา</button>
      <button type="button" onClick={onReset}>ล้างตัวกรอง</button>
    </form>
    <p className="ra-note">ชื่อย่อในบิลคือข้อความที่ร้านเขียนบนบิล (เช่น "ทB") เทียบกับสินค้าในระบบ ใช้ช่วยอ่านบิลอัตโนมัติ · การแก้ไขทุกครั้งมีบันทึกว่าใครทำเมื่อไร และปิดใช้ได้โดยไม่ลบประวัติ</p>
    {error && <p role="alert">{error} <button type="button" onClick={onSearch}>ลองใหม่</button></p>}
    {loading ? <p role="status">กำลังโหลดรายชื่อร้าน…</p> : data && <>
      <div className="ra-table-scroll" tabIndex={0} aria-label="ตารางร้านค้า เลื่อนซ้ายขวาได้">
        <table><caption>ร้านค้าและชื่อย่อในบิล · {items.length.toLocaleString('th-TH')} ร้าน</caption>
          <thead><tr><th>รหัส</th><th>ร้าน</th><th>ส่งให้สาขา</th><th>การสั่ง</th><th>รูปแบบบิล</th><th className="ra-number">ชื่อย่อที่ใช้งาน</th><th>จัดการ</th></tr></thead>
          <tbody>{items.length ? items.map(item => {
            const branches = branchesText(item);
            return <tr key={item.supplier_key}>
              <td>{item.code || '—'}</td>
              <td>{item.name}<small>{kindLabels[item.kind] || item.kind}{item.is_active ? '' : ' · ปิดใช้งาน'}</small></td>
              <td>{branches.note || (branches.seen ? '' : 'ยังไม่ระบุ')}{branches.seen && <small>{branches.seen}</small>}</td>
              <td><span className={`ra-mode ra-mode-${item.ordering_mode || 'unknown'}`}>{orderingLabel(item.ordering_mode)}</span></td>
              <td className="ra-decision">{item.bill_format_note || '—'}</td>
              <td className="ra-number">{item.alias_active_count}{item.alias_disabled_count > 0 && <small>ปิดใช้ {item.alias_disabled_count}</small>}</td>
              <td><Link to={`/admin/receiving/suppliers/${encodeURIComponent(item.supplier_key)}`} aria-label={`จัดการร้าน ${item.name}`}>จัดการชื่อย่อ →</Link></td>
            </tr>;
          }) : <tr><td colSpan={7} className="ra-empty">ไม่พบร้านตามตัวกรอง</td></tr>}</tbody>
        </table>
      </div>
      {data.truncated && <p className="ra-note" role="status">แสดงเฉพาะ {data.limit} ร้านแรก กรุณาค้นหาให้แคบลง</p>}
    </>}
  </>;
}
