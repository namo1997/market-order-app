import { useState } from 'react';

export const NOTE_REASONS = ['ซื้อผิด', 'สั่งนอกรอบ', 'โทรสั่ง', 'อื่นๆ'];
const reasons = NOTE_REASONS;
// A saved reason alone (other than "อื่นๆ", which asks for detail) needs no open textarea.
const reasonOnly = note => reasons.includes(note) && note !== 'อื่นๆ';

// Off-order items must pick a reason, so that select always stays visible. The free
// note is collapsed behind a button until it is used (or already holds text).
// `askReason` is off when the whole receipt has no order (nothing is "off the order" then).
export function LineNote({ line, disabled, onChange, askReason = true }) {
  // 0 = untouched, 1 = opened with the button (focus the field), 2 = being edited (stay open even if emptied)
  const [asked, setAsked] = useState(0);
  const note = line.note || '';
  const offOrder = askReason && !line.order_item_id;
  // A bare reason (chosen once for the whole receipt) needs no open textarea on each row.
  const open = asked > 0 || (note !== '' && !reasonOnly(note));
  return <div className="rc-stack ra-line-note">
    {offOrder && <label>เหตุผลของนอกใบสั่ง<select disabled={disabled} value={reasons.includes(note) ? note : ''} onChange={event => onChange({ note: event.target.value })}><option value="">เลือกเหตุผล</option>{reasons.map(reason => <option key={reason}>{reason}</option>)}</select></label>}
    {open
      ? <label>หมายเหตุรายการ (ไม่เกิน 300 ตัวอักษร)<textarea autoFocus={asked === 1} maxLength={300} value={note} disabled={disabled} onChange={event => { setAsked(2); onChange({ note: event.target.value }); }} /></label>
      : <button type="button" className="ra-note-add" disabled={disabled} aria-label={`เพิ่มหมายเหตุ ${line.product_name || 'รายการ'}`} onClick={() => setAsked(1)}>+ หมายเหตุ</button>}
  </div>;
}

// Owner 2026-10-24 (ข้อ 3): one optional reason for every item delivered outside the order, asked once per receipt
// instead of a select on every row. A receipt with no order at all asks nothing (the shop was ordered by phone/at the counter).
export function OffOrderReason({ doc, onChange, disabled }) {
  const offLines = doc.lines.filter(line => !line.order_item_id);
  if (!onChange || !offLines.length || !doc.lines.some(line => line.order_item_id)) return null;
  const notes = [...new Set(offLines.map(line => line.note || ''))];
  const value = notes.length === 1 && reasons.includes(notes[0]) ? notes[0] : '';
  return <label className="ra-offorder-reason">ของนอกใบสั่ง {offLines.length} รายการ · เหตุผล (ไม่บังคับ)
    <select disabled={disabled} value={value} onChange={event => offLines.forEach(line => {
      if (!line.note || reasons.includes(line.note)) onChange(line.id, { note: event.target.value });
    })}><option value="">เลือกเหตุผล</option>{reasons.map(reason => <option key={reason}>{reason}</option>)}</select></label>;
}
