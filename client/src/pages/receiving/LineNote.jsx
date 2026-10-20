const reasons = ['ซื้อผิด', 'สั่งนอกรอบ', 'โทรสั่ง', 'อื่นๆ'];
export function LineNote({ line, disabled, onChange }) {
  return <div className="rc-stack ra-line-note">
    {!line.order_item_id && <label>เหตุผลของนอกใบสั่ง<select disabled={disabled} value={reasons.includes(line.note) ? line.note : ''} onChange={event => onChange({ note: event.target.value })}><option value="">เลือกเหตุผล</option>{reasons.map(reason => <option key={reason}>{reason}</option>)}</select></label>}
    <label>หมายเหตุรายการ (ไม่เกิน 300 ตัวอักษร)<textarea maxLength={300} value={line.note || ''} disabled={disabled} onChange={event => onChange({ note: event.target.value })} /></label>
  </div>;
}
