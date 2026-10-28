import { useEffect, useState } from 'react';
import { ReceivingNumberField } from './ReceivingNumberField';
import { thaiUnit } from './receiving-utils';
import { numberError, focusField } from './receiving-validation';
import { qtyText, signSummaryText, needsProductCheck, validCount } from './review-a';

// Owner 2026-10-28 "ตัวหนังสือมันเยอะเกิน หน้าที่ของพนักงานแค่รับสินค้าให้ตรงเท่านั้น": after the count staff see how
// many were received and only the rows they can act on — a count that differs from the bill, or a product the AI guessed.
export function ReceiveCheck({ doc, disabled, onRecount, onProduct }) {
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const name = line => line.product_name || line.bill_text || 'รายการจากบิล';
  const unit = line => thaiUnit(line.unit_text) || line.unit_text || '';
  const differs = doc.lines.filter(line => ['short', 'over'].includes(line.review_decision));
  const guessed = doc.lines.filter(needsProductCheck);
  const recount = async line => { if (validCount(value) && await onRecount(line.id, value)) setEditing(null); };
  // "นับใหม่" opens the keyboard on the field; its Enter key saves.
  useEffect(() => { if (editing != null) focusField(`recount-${editing}`); }, [editing]);
  return <section className="ra-check" aria-label="ตรวจก่อนเซ็น">
    <p className="ra-check-total">{signSummaryText(doc)}</p>
    {doc.kind === 'bill' && doc.lines.every(line => ['accept', 'price_review', 'over_order', 'not_delivered'].includes(line.review_decision)) && <p className="ra-check-ok" role="status">ตรงบิลทุกรายการ</p>}
    {guessed.length > 0 && <div className="ra-check-group"><h2>ใช่สินค้านี้ไหม</h2>{guessed.map(line => <article className="ra-check-row" key={line.id}>
      <p><strong>{line.product_name}</strong><span>บิลเขียน <span className="receiving-bill-text">{line.bill_text || '—'}</span></span></p>
      <div className="ra-check-actions">
        <button type="button" className="ra-secondary-action" disabled={disabled} aria-label={`ใช่ ${line.product_name}`} onClick={() => onProduct(line.id, true)}>ใช่</button>
        <button type="button" className="ra-secondary-action" disabled={disabled} aria-label={`ไม่ใช่ ${line.product_name}`} onClick={() => onProduct(line.id, false)}>ไม่ใช่</button>
      </div>
    </article>)}</div>}
    {differs.length > 0 && <div className="ra-check-group"><h2>ไม่ตรงบิล</h2>{differs.map(line => <article className="ra-check-row" key={line.id} data-editing={editing === line.id || undefined}>
      <p><strong>{name(line)}</strong><span>บิล {qtyText(line.quantity_billed)} · นับ {qtyText(line.quantity_received)} {unit(line)}</span></p>
      {editing === line.id ? <div className="ra-check-recount">
        <ReceivingNumberField id={`recount-${line.id}`} label={`นับใหม่ ${name(line)}`} unit={unit(line) || 'หน่วย'} value={value} disabled={disabled}
          error={value ? numberError(value, 'quantity_received') : undefined} onValueChange={setValue} enterKeyHint="done"
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); recount(line); } }} />
        <button type="button" className="ra-secondary-action" disabled={disabled || !validCount(value)} onClick={() => recount(line)}>บันทึก</button>
      </div> : <button type="button" className="ra-secondary-action" disabled={disabled} aria-label={`นับใหม่ ${name(line)}`} onClick={() => { setEditing(line.id); setValue(''); }}>นับใหม่</button>}
    </article>)}</div>}
  </section>;
}
