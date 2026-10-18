import { Link } from 'react-router-dom';
import { ledgerNumber, ledgerDate, statusLabels } from './receiving-ledger';
export const emptyFilters = { date_from: '', date_to: '', branch_id: '', department_id: '', scope: '', supplier: '', status: '', discrepancy: '' };
export function ReceivingLedgerView({ filters, setFilters, options, data, loading, error, onSearch, onPage, followups, followupError, onReloadFollowups }) {
  const change = key => event => setFilters(previous => ({ ...previous, [key]: event.target.value,
    ...(key === 'branch_id' ? { department_id: '' } : {}), ...(key === 'scope' && event.target.value === 'branch' ? { department_id: '' } : {}) }));
  const summary = data?.summary;
  const pagination = data?.pagination;
  return <>
    <div className="ra-summary" aria-label="สรุปใบรับสินค้า">
      <article><span>ใบวันนี้</span><strong>{summary ? summary.today_count.toLocaleString('th-TH') : '—'}</strong><small>{summary ? ledgerDate(summary.today) : 'กำลังโหลด'}</small></article>
      <article><span>ร่างค้าง</span><strong>{summary ? summary.draft_count.toLocaleString('th-TH') : '—'}</strong><small>ใบรับที่ยังไม่ยืนยัน</small></article>
      <article><span>ยอดรวมที่ยืนยัน</span><strong>{summary ? ledgerNumber(summary.confirmed_total, ' ฿') : '—'}</strong><small>{summary?.unknown_total_count ? `ยังไม่ระบุยอด ${summary.unknown_total_count} ใบ` : 'บาท · ตามตัวกรองที่ใช้'}</small></article>
      <article><span>เรื่องตามของค้าง</span><strong>{followups ? followups.pending_count : '—'}</strong><small>ตามสิทธิ์สาขาของผู้ใช้ · ไม่ขึ้นกับตัวกรองใบรับ</small></article>
    </div>
    {followupError && <p role="alert">โหลดเรื่องตามของไม่สำเร็จ <button onClick={onReloadFollowups}>ลองโหลดเรื่องตามของอีกครั้ง</button></p>}
    <form className="ra-filters" onSubmit={onSearch}>
      <label>วันที่รับตั้งแต่<input type="date" value={filters.date_from} onChange={change('date_from')} /></label>
      <label>ถึงวันที่<input type="date" min={filters.date_from || undefined} value={filters.date_to} onChange={change('date_to')} /></label>
      <label>สาขา<select value={filters.branch_id} onChange={change('branch_id')}><option value="">ทุกสาขา</option>{options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>ขอบเขต<select value={filters.scope} onChange={change('scope')}><option value="">ทุกขอบเขต</option><option value="department">แผนก</option><option value="branch">ทั้งสาขา</option></select></label>
      <label>แผนก<select disabled={filters.scope === 'branch'} value={filters.department_id} onChange={change('department_id')}><option value="">ทุกแผนก</option>{options.departments.filter(d => !filters.branch_id || Number(d.branch_id) === Number(filters.branch_id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>ร้าน<input type="search" maxLength={255} value={filters.supplier} onChange={change('supplier')} placeholder="ค้นหาชื่อร้าน" /></label>
      <label>สถานะ<select value={filters.status} onChange={change('status')}><option value="">ทุกสถานะ</option>{Object.entries(statusLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>ขาด / เกิน<select value={filters.discrepancy} onChange={change('discrepancy')}><option value="">ทั้งหมด</option><option value="yes">มีจำนวนรับต่างจากบิล</option><option value="no">ไม่มีจำนวนรับต่างจากบิล</option></select></label>
      <button className="ra-primary" disabled={loading} type="submit">ค้นหา</button>
      <button type="button" onClick={() => setFilters({ ...emptyFilters })}>ล้างตัวกรอง</button>
    </form>
    <p className="ra-note">สรุปใบรับทั้งสามช่องคำนวณจากตัวกรองที่ใช้ล่าสุด · ขาด/เกินเทียบจำนวนรับกับบิล ไม่รวมรายการที่บิลไม่ระบุจำนวน</p>
    {error && <p role="alert">{error} <button type="button" onClick={onSearch}>ลองใหม่</button></p>}
    {loading ? <p role="status">กำลังโหลดใบรับสินค้า…</p> : data && <>
      <div className="ra-table-scroll" tabIndex={0} aria-label="ตารางใบรับสินค้า เลื่อนซ้ายขวาได้">
        <table><caption>ทะเบียนใบรับสินค้า · {pagination.total} ใบ</caption><thead><tr><th>วันที่รับ / เลขใบรับ</th><th>ร้าน / เลขบิล</th><th>สาขา</th><th>แผนก / ขอบเขต</th><th>สถานะ</th><th>ขาด / เกิน</th><th className="ra-number">ยอดรวม (บาท)</th><th>รายละเอียด</th></tr></thead>
          <tbody>{data.items.length ? data.items.map(doc => <tr key={doc.id}>
            <td>{ledgerDate(doc.delivery_date)}<small>#{doc.id}</small></td><td>{doc.supplier_name_text || 'ไม่ระบุร้าน'}<small>{doc.doc_ref || 'ไม่ระบุเลขบิล'}</small></td>
            <td>{doc.branch_name}</td><td>{doc.scope === 'branch' ? 'ทั้งสาขา' : doc.department_name}</td><td><span className={`ra-status ra-${doc.status}`}>{statusLabels[doc.status] || doc.status}</span></td>
            <td>{doc.has_discrepancy ? <span className="ra-problem">จำนวนต่างจากบิล</span> : '—'}</td><td className="ra-number">{ledgerNumber(doc.total)}</td>
            <td><Link to={`/admin/receiving/${doc.id}`} aria-label={`ดูใบรับ #${doc.id}`}>ดูใบรับ →</Link></td>
          </tr>) : <tr><td colSpan={8} className="ra-empty">ไม่พบใบรับสินค้าตามตัวกรอง</td></tr>}</tbody>
        </table>
      </div>
      <div className="ra-pagination"><span>หน้า {pagination.page} / {Math.max(1, pagination.total_pages)} · หน้าละ {pagination.page_size} ใบ</span><div>
        <button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>หน้าก่อน</button>
        <button disabled={pagination.page >= pagination.total_pages} onClick={() => onPage(pagination.page + 1)}>หน้าถัดไป</button>
      </div></div>
    </>}
  </>;
}
