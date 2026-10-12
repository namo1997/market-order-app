import { useEffect, useState } from 'react';
import { formatPnlMoney as money, formatPnlDate } from './profitLoss.js';

const label = (treatment) => treatment === 'before_adjustment' ? 'ก่อนปรับรายได้' : 'ค่าธรรมเนียมสุทธิ';

function BasisRow({ row, branchName, busy, readOnly, save, clear }) {
  const [treatment, setTreatment] = useState(row.treatment);
  const [reason, setReason] = useState(row.reason || '');
  const [reference, setReference] = useState(row.reference || '');
  useEffect(() => { setTreatment(row.treatment); setReason(row.reason || ''); setReference(row.reference || ''); },
    [row.version, row.source_fingerprint, row.treatment, row.reason, row.reference]);
  const current = row.treatment === 'before_adjustment' ? row.before_adjustment_fee : row.net_fee;
  const next = treatment === 'before_adjustment' ? row.before_adjustment_fee : row.net_fee;
  const delta = current == null || next == null ? null : next - current;
  return <details className="pnl-source">
    <summary>{formatPnlDate(row.business_date)} · {branchName} · {label(row.treatment)} · {current == null ? 'ยังไม่มีค่าธรรมเนียมยืนยัน' : `${money(current)} บาท`}</summary>
    <p>สุทธิ {row.net_fee == null ? 'ยังไม่ทราบ' : money(row.net_fee)} บาท · ก่อนปรับรายได้ {row.before_adjustment_fee == null ? 'ยังไม่ทราบ' : money(row.before_adjustment_fee)} บาท · ปรับรายได้ {row.income_adjustment_amount == null ? 'ยังไม่ทราบ' : money(row.income_adjustment_amount)} บาท</p>
    {row.preference_status === 'default' && <p className="pnl-warning">ยังไม่ได้ตรวจเลือกฐานจากชีทของวันนี้ · กำลังใช้ค่ามาตรฐานเดิม</p>}
    {row.preference_status === 'stale' && <p role="alert" className="pnl-warning">ข้อมูลต้นทางเปลี่ยนหรือไม่ครบ · หยุดใช้ค่าที่เคยเลือก และใช้ค่าธรรมเนียมสุทธิระหว่างรอตรวจใหม่</p>}
    {row.reference && <p>อ้างอิงเดิม: {row.reference} · {row.reason}</p>}
    <form className="pnl-form" onSubmit={(event) => { event.preventDefault(); save({ treatment, reason, reference,
      expected_version: row.version, source_fingerprint: row.source_fingerprint }); }}>
      <label>ฐานค่าธรรมเนียมตามชีท<select aria-label="ฐานค่าธรรมเนียมตามชีท" value={treatment} disabled={busy || readOnly || !row.source_fingerprint} onChange={(e) => setTreatment(e.target.value)}>
        <option value="net">ค่าธรรมเนียมสุทธิ</option><option value="before_adjustment">ก่อนปรับรายได้</option>
      </select></label>
      <label>ชีทและช่องอ้างอิง<input aria-label="ชีทและช่องอ้างอิง" required maxLength="300" value={reference} disabled={busy || readOnly} onChange={(e) => setReference(e.target.value)}/></label>
      <label>เหตุผลที่เลือกฐานนี้<textarea aria-label="เหตุผลที่เลือกฐานนี้" required maxLength="500" value={reason} disabled={busy || readOnly} onChange={(e) => setReason(e.target.value)}/></label>
      {delta != null && <p>หากบันทึก ค่าใช้จ่ายจะเปลี่ยน {delta > 0 ? '+' : ''}{money(delta)} บาท และกำไรเปลี่ยน {delta < 0 ? '+' : ''}{money(delta === 0 ? 0 : -delta)} บาทในรายงานทั้งเดือน</p>}
      {!row.source_fingerprint && <p role="alert" className="pnl-warning">ต้องมีรายงาน Grab ที่ตรงกับใบรับเงินก่อนเลือกฐานใหม่</p>}
      <button disabled={busy || readOnly || !row.source_fingerprint || !reason.trim() || !reference.trim()}>บันทึกฐานของวันนี้</button>
      {row.preference_status !== 'default' && <button type="button" disabled={busy || readOnly || !reason.trim()}
        onClick={() => clear({ expected_version: row.version, reason })}>กลับไปใช้ค่ามาตรฐาน</button>}
    </form>
  </details>;
}

export default function GrabFeeBasis({ status, branches, busy, readOnly, basis, save, clear }) {
  const rows = status?.grab_sheet_basis_rows || [];
  if (!rows.length && !status?.unavailable_grab_sheet_basis_line_ids?.length) return null;
  return <details className="pnl-source"><summary>ตรวจฐานค่าธรรมเนียม Grab ตามชีท · {rows.length} รายการ</summary>
    <p>แต่ละวันอาจใช้ค่าธรรมเนียมสุทธิหรือก่อนปรับรายได้ต่างกัน ให้ตรวจสูตรและช่องในชีทก่อนเลือก ระบบคำนวณยอดจากรายงาน Grab พร้อมบันทึกเหตุผลและประวัติ</p>
    <p>การเลือกมีผลกับรายงานตามชีท คงยอดเงินธนาคาร รายการจ่ายจริง และประวัติปิดใบรับเงินเดิม</p>
    {status?.unavailable_grab_sheet_basis_line_ids?.length > 0 && <p role="alert" className="pnl-warning">ใบรับเงินของค่าที่เคยเลือกยังไม่ปิดหรือไม่พร้อม จึงยังไม่นับค่าธรรมเนียมรายการ {status.unavailable_grab_sheet_basis_line_ids.join(', ')}</p>}
    {basis !== 'sheet' ? <p>เลือกวิธีนับ “ค่าธรรมเนียมตามชีทคันคลอง / สันกำแพง” เพื่อดูและแก้ฐานรายวัน</p> : rows.map((row) => <BasisRow key={row.receipt_line_id} row={row}
      branchName={branches.find((branch) => String(branch.id) === String(row.branch_id))?.name || 'ไม่ระบุสาขา'}
      busy={busy} readOnly={readOnly} save={(body) => save(row.receipt_line_id, body)} clear={(body) => clear(row.receipt_line_id, body)}/>)}
  </details>;
}
