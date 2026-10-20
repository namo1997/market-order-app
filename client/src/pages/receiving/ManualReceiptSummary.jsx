import { LineNote } from './LineNote';
import { qtyText, receiptDecisionText } from './review-a';
import { DepartmentAllocation } from './DepartmentAllocation';

export function ManualReceiptSummary({ doc, onChange, disabled }) {
  return <section className="rc-stack" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2>{doc.lines.filter(line => line.note).map(line => <p key={`note-${line.id}`}>{line.product_name} · {line.note}</p>)}
    <p>ใบรับไม่มีบิล · บัญชีต้องขอบิลและตรวจราคาต่อ</p>
    {doc.lines.map(line => <article className="ra-card" key={line.id}>
      <strong>{line.product_name}</strong>
      <p>นับได้ {qtyText(line.counted_quantity)} {line.unit_text} · รับ {qtyText(line.quantity_received)} {line.unit_text}</p>
      <p>สั่ง {qtyText(line.quantity_ordered)} {line.ordered_unit || line.unit_text}</p>
      <p>{line.quantity_ordered == null ? 'ไม่มีจำนวนใบสั่งอ้างอิง'
        : Number(line.quantity_received) === Number(line.quantity_ordered) ? 'ตรงตามใบสั่ง' : 'จำนวนรับต่างจากใบสั่ง'}</p>
      {line.review_decision && line.review_decision !== 'missing_bill' && <p>{receiptDecisionText(line)}</p>}
      <LineNote line={line} disabled={disabled || !onChange} onChange={patch => onChange?.(line.id, patch)} />
      {doc.scope === 'branch' && <DepartmentAllocation line={line} />}
    </article>)}
    <p>ยังไม่ทราบมูลค่ารับทั้งหมด · รอบัญชีตรวจราคา</p>
  </section>;
}
