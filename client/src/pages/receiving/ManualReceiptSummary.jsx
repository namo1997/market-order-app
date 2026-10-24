import { LineNote } from './LineNote';
import { qtyText, receiptDecisionText, lineDiffersFromOrder, partialDelivery, partialDeliveryText } from './review-a';
import { DepartmentAllocation } from './DepartmentAllocation';

export function ManualReceiptSummary({ doc, onChange, disabled }) {
  // Review 2026-10-24: a shop with no order at all (ice, walk-in) is not "off the order"; say it once and skip the per-line reason.
  const noOrder = doc.lines.length > 0 && doc.lines.every(line => line.quantity_ordered == null || line.quantity_ordered === '');
  return <section className="rc-stack ra-summary ra-manual-summary" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2>{doc.lines.filter(line => line.note).map(line => <p key={`note-${line.id}`}>{line.product_name} · {line.note}</p>)}
    {/* Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": a no-bill receipt has no money to show; one line replaces the unknown ledger. */}
    <p className="ra-nobill-line">ยังไม่มีราคา · รอบัญชีขอบิล</p>
    <p className="ra-receipt-headline">รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ<small>{noOrder ? 'ไม่มีใบสั่ง · รับหน้าร้าน' : doc.lines.some(lineDiffersFromOrder) ? `ไม่ตรงใบสั่ง ${doc.lines.filter(lineDiffersFromOrder).length} รายการ` : 'ตรงตามใบสั่งทุกรายการ'}</small></p>
    {doc.lines.map(line => <article className="ra-card" data-match={noOrder || !lineDiffersFromOrder(line) ? 'matched' : undefined} key={line.id}>
      <strong>{line.product_name}</strong>
      <p>นับได้ {qtyText(line.counted_quantity)} {line.unit_text} · รับ {qtyText(line.quantity_received)} {line.unit_text}</p>
      {partialDelivery(line)
        ? <p data-partial="true">{partialDeliveryText(line)}</p>
        : line.quantity_ordered == null ? null : <p>สั่ง {qtyText(line.quantity_ordered)} {line.ordered_unit || line.unit_text}</p>}
      {/* Device test 2026-10-21: "สั่ง — หลอด" plus a second line said the same thing; one plain line is enough. */}
      {!noOrder && <p>{line.quantity_ordered == null ? 'ไม่ได้อยู่ในใบสั่ง'
        : partialDelivery(line) ? (partialDelivery(line).outstanding === 0n ? 'ตรงตามยอดค้างรับ' : 'จำนวนรับต่างจากยอดค้างรับ')
        : Number(line.quantity_received) === Number(line.quantity_ordered) ? 'ตรงตามใบสั่ง' : 'จำนวนรับต่างจากใบสั่ง'}</p>}
      {line.review_decision && line.review_decision !== 'missing_bill' && <p>{receiptDecisionText(line)}</p>}
      <LineNote line={line} askReason={!noOrder} disabled={disabled || !onChange} onChange={patch => onChange?.(line.id, patch)} />
      {doc.scope === 'branch' && <DepartmentAllocation line={line} />}
    </article>)}
  </section>;
}
