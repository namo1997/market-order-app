import { LineNote } from './LineNote';
import { qtyText, receiptDecisionText, lineDiffersFromOrder, partialDelivery, partialDeliveryText } from './review-a';
import { DepartmentAllocation } from './DepartmentAllocation';

export function ManualReceiptSummary({ doc, onChange, disabled }) {
  return <section className="rc-stack ra-summary ra-manual-summary" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2>{doc.lines.filter(line => line.note).map(line => <p key={`note-${line.id}`}>{line.product_name} · {line.note}</p>)}
    <p className="ra-nobill-line">ไม่มีบิล · บัญชีขอบิลและตรวจราคา</p>
    <p className="ra-receipt-headline">รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ<small>{doc.lines.some(lineDiffersFromOrder) ? `ไม่ตรงใบสั่ง ${doc.lines.filter(lineDiffersFromOrder).length} รายการ` : 'ตรงตามใบสั่งทุกรายการ'}</small></p>
    <details className="ra-nobill-details"><summary>รายละเอียดมูลค่า</summary>
      <dl className="ra-ledger" aria-label="มูลค่าใบรับไม่มีบิล">
        <div><dt>ยอดบิล</dt><dd>ยังไม่ทราบ</dd></div>
        <div><dt>ปรับตามการรับ</dt><dd>ยังคำนวณไม่ได้</dd><p>ยังไม่มีบิลอ้างอิง</p></div>
        <div className="ra-ledger-result"><dt>มูลค่าที่รับ (ส่วนที่ทราบราคา)</dt><dd>ยังไม่ทราบ</dd><p>รอบัญชีตรวจราคาและยอดชำระ</p></div>
      </dl>
      <p className="ra-coverage">ใบรับไม่มีบิลยังไม่รับรองมูลค่ารับ · ต้องขอบิล 1 ใบ</p>
    </details>
    {doc.lines.map(line => <article className="ra-card" data-match={lineDiffersFromOrder(line) ? undefined : 'matched'} key={line.id}>
      <strong>{line.product_name}</strong>
      <p>นับได้ {qtyText(line.counted_quantity)} {line.unit_text} · รับ {qtyText(line.quantity_received)} {line.unit_text}</p>
      {partialDelivery(line)
        ? <p data-partial="true">{partialDeliveryText(line)}</p>
        : line.quantity_ordered == null ? null : <p>สั่ง {qtyText(line.quantity_ordered)} {line.ordered_unit || line.unit_text}</p>}
      {/* Device test 2026-10-21: "สั่ง — หลอด" plus a second line said the same thing; one plain line is enough. */}
      <p>{line.quantity_ordered == null ? 'ไม่ได้อยู่ในใบสั่ง'
        : partialDelivery(line) ? (partialDelivery(line).outstanding === 0n ? 'ตรงตามยอดค้างรับ' : 'จำนวนรับต่างจากยอดค้างรับ')
        : Number(line.quantity_received) === Number(line.quantity_ordered) ? 'ตรงตามใบสั่ง' : 'จำนวนรับต่างจากใบสั่ง'}</p>
      {line.review_decision && line.review_decision !== 'missing_bill' && <p>{receiptDecisionText(line)}</p>}
      <LineNote line={line} disabled={disabled || !onChange} onChange={patch => onChange?.(line.id, patch)} />
      {doc.scope === 'branch' && <DepartmentAllocation line={line} />}
    </article>)}
  </section>;
}
