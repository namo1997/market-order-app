import { LegacyBillPhotos } from './LegacyBillPhotos';
import { Link } from 'react-router-dom';
import { ledgerNumber, ledgerDate, statusLabels } from './receiving-ledger';
export const emptyFilters = { date_from: '', date_to: '', branch_id: '', department_id: '', scope: '', supplier: '', status: '', discrepancy: '' };
export function ReceivingLedgerView({ filters, setFilters, options, data, loading, error, onSearch, onPage, followups, followupError, onReloadFollowups, issues, onReloadIssues }) {
  const change = key => event => setFilters(previous => ({ ...previous, [key]: event.target.value,
    ...(key === 'branch_id' ? { department_id: '' } : {}), ...(key === 'scope' && event.target.value === 'branch' ? { department_id: '' } : {}) }));
  const summary = loading || error ? null : data?.summary;
  const pagination = data?.pagination;
  return <>
    <LegacyBillPhotos />
    <section className="ra-scope-section" aria-labelledby="ra-filter-summary"><h2 id="ra-filter-summary">สรุปตามตัวกรองใบรับ</h2><p className="ra-note">ยอดใช้ตัวกรองที่ค้นหาล่าสุด · มูลค่ารับไม่ใช่ยอดเจ้าหนี้ที่รับรอง</p><div className="ra-summary" aria-label="สรุปใบรับสินค้า">
      <article><span>ใบวันนี้</span><strong>{summary?.today_count != null ? `${summary.today_count.toLocaleString('th-TH')} ใบ` : '—'}</strong><small>{summary ? ledgerDate(summary.today) : error ? 'โหลดข้อมูลไม่สำเร็จ' : 'กำลังโหลด'}</small></article>
      <article><span>ร่างค้าง</span><strong>{summary?.draft_count != null ? `${summary.draft_count.toLocaleString('th-TH')} ใบ` : '—'}</strong><small>ใบรับที่ยังไม่ยืนยัน</small></article>
      <article><span>ยอดบิลที่ยืนยัน</span><strong><span>{ledgerNumber(summary?.confirmed_total)}</span>{summary?.confirmed_total != null && <span> บาท</span>}</strong><small>{summary?.unknown_total_count ? `ยังไม่ระบุยอด ${summary.unknown_total_count} ใบ` : 'ตามตัวกรองที่ใช้'}</small></article>
      <article><span>มูลค่ารับ (ทราบราคา)</span><strong><span>{ledgerNumber(summary?.received_net_total)}</span>{summary?.received_net_total != null && <span> บาท</span>}</strong><small>เฉพาะใบยืนยัน · หลังส่วนลด/ภาษีตามบิล</small>{Boolean(summary?.unvalued_document_count) && <small>ยังคำนวณไม่ได้ {summary.unvalued_document_count} ใบ</small>}</article>
      <article><span>รอราคา</span><strong>{summary?.pending_price_count != null ? `${summary.pending_price_count} รายการ` : '—'}</strong><small>ยังไม่รวมในมูลค่ารับ · เฉพาะใบยืนยันตามตัวกรอง</small></article>
    </div></section>
    <section className="ra-scope-section" aria-labelledby="ra-access-summary"><h2 id="ra-access-summary">งานค้างตามสิทธิ์ของคุณ</h2><p className="ra-note">ทุกสาขาที่มีสิทธิ์ · ไม่เปลี่ยนตามตัวกรองใบรับด้านล่าง</p><div className="ra-summary">
      <article><span>เรื่องตามของค้าง</span><strong>{!followupError && followups?.pending_count != null ? `${followups.pending_count} เรื่อง` : '—'}</strong><small>ตามสิทธิ์สาขาของผู้ใช้ · ไม่ขึ้นกับตัวกรองใบรับ</small></article>
      <article><span>ปัญหารับของค้าง</span><strong>{!issues?.error && issues?.pending_issue_count != null ? `${issues.pending_issue_count} เรื่อง` : '—'}</strong><Link to="/admin/receiving/issues">ดูเรื่องค้าง</Link><small>ทุกสาขาที่มีสิทธิ์ · ไม่ขึ้นกับตัวกรองใบรับ</small></article>
    </div></section>
    {issues?.error && <p role="alert">โหลดจำนวนปัญหารับของไม่สำเร็จ <button onClick={onReloadIssues}>ลองโหลดจำนวนปัญหาอีกครั้ง</button></p>}
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
    <p className="ra-note">สรุปใบรับและมูลค่าใช้ตัวกรองล่าสุด · มูลค่ารับใช้จำนวนรับจริงและราคาเดียวกับสรุปในแอป ไม่ใช่ยอดเจ้าหนี้ที่รับรอง · ขาด/เกินเทียบจำนวนรับกับบิล ไม่รวมรายการที่บิลไม่ระบุจำนวน</p>
    {error && <p role="alert">{error} <button type="button" onClick={onSearch}>ลองใหม่</button></p>}
    {loading ? <p role="status">กำลังโหลดใบรับสินค้า…</p> : data && <>
      <div className="ra-table-scroll" tabIndex={0} aria-label="ตารางใบรับสินค้า เลื่อนซ้ายขวาได้">
        <table><caption>ทะเบียนใบรับสินค้า · {pagination.total} ใบ</caption><thead><tr><th scope="col">วันที่รับ / เลขใบรับ</th><th scope="col">ร้าน / เลขบิล</th><th scope="col">สาขา</th><th scope="col">แผนก / ขอบเขต</th><th scope="col">สถานะ</th><th scope="col">ขาด / เกิน</th><th scope="col" className="ra-number">ยอดบิล (บาท)</th><th scope="col" className="ra-number">มูลค่ารับ (ทราบราคา)</th><th scope="col">รอราคา</th><th scope="col">รายละเอียด</th></tr></thead>
          <tbody>{data.items.length ? data.items.map(doc => <tr key={doc.id}>
            <td>{ledgerDate(doc.delivery_date)}<small>#{doc.id}</small></td><td>{doc.supplier_name_text || 'ไม่ระบุร้าน'}<small>{doc.doc_ref || 'ไม่ระบุเลขบิล'}</small></td>
            <td>{doc.branch_name}</td><td>{doc.scope === 'branch' ? 'ทั้งสาขา' : doc.department_name}</td><td><span className={`ra-status ra-${doc.status}`}>{statusLabels[doc.status] || doc.status}</span></td>
            <td>{doc.has_discrepancy ? <span className="ra-problem">จำนวนต่างจากบิล</span> : '—'}</td><td className="ra-number">{ledgerNumber(doc.total, ' บาท')}</td><td className="ra-number">{ledgerNumber(doc.receipt_value?.received_net, ' บาท')}{!doc.blind && !doc.receipt_value && <small>ยังคำนวณไม่ได้</small>}</td><td>{doc.receipt_value ? `${doc.receipt_value.pending_price_count} รายการ` : '—'}</td>
            <td><Link to={`/admin/receiving/${doc.id}`} aria-label={`ดูใบรับ #${doc.id}`}>ดูใบรับ →</Link></td>
          </tr>) : <tr><td colSpan={10} className="ra-empty">ไม่พบใบรับสินค้าตามตัวกรอง</td></tr>}</tbody>
        </table>
      </div>
      <div className="ra-pagination"><span>หน้า {pagination.page} / {Math.max(1, pagination.total_pages)} · หน้าละ {pagination.page_size} ใบ</span><div>
        <button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>หน้าก่อน</button>
        <button disabled={pagination.page >= pagination.total_pages} onClick={() => onPage(pagination.page + 1)}>หน้าถัดไป</button>
      </div></div>
    </>}
  </>;
}
