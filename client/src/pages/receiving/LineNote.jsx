import { useState } from 'react';

const reasons = ['ซื้อผิด', 'สั่งนอกรอบ', 'โทรสั่ง', 'อื่นๆ'];
// A saved reason alone (other than "อื่นๆ", which asks for detail) needs no open textarea.
const reasonOnly = note => reasons.includes(note) && note !== 'อื่นๆ';

// Off-order items must pick a reason, so that select always stays visible. The free
// note is collapsed behind a button until it is used (or already holds text).
export function LineNote({ line, disabled, onChange }) {
  // 0 = untouched, 1 = opened with the button (focus the field), 2 = being edited (stay open even if emptied)
  const [asked, setAsked] = useState(0);
  const note = line.note || '';
  const open = asked > 0 || (note !== '' && !(!line.order_item_id && reasonOnly(note)));
  return <div className="rc-stack ra-line-note">
    {!line.order_item_id && <label>เหตุผลของนอกใบสั่ง<select disabled={disabled} value={reasons.includes(note) ? note : ''} onChange={event => onChange({ note: event.target.value })}><option value="">เลือกเหตุผล</option>{reasons.map(reason => <option key={reason}>{reason}</option>)}</select></label>}
    {open
      ? <label>หมายเหตุรายการ (ไม่เกิน 300 ตัวอักษร)<textarea autoFocus={asked === 1} maxLength={300} value={note} disabled={disabled} onChange={event => { setAsked(2); onChange({ note: event.target.value }); }} /></label>
      : <button type="button" className="ra-note-add" disabled={disabled} aria-label={`เพิ่มหมายเหตุ ${line.product_name || 'รายการ'}`} onClick={() => setAsked(1)}>+ หมายเหตุ</button>}
  </div>;
}
