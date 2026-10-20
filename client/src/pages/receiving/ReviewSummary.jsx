import { ManualReceiptSummary } from './ManualReceiptSummary';
import { reviewLedger, qtyText, receiptDecisionText, signSummaryText } from './review-a';
import { formatBaht } from './receiving-utils';
import { DepartmentAllocation } from './DepartmentAllocation';
export function ReviewSummary({ doc, compact = false, expanded = false, onChange, disabled }) {
  if (compact) return <div className="ra-sign-summary"><p>{signSummaryText(doc)}</p><details><summary>รายละเอียดสรุป</summary><ReviewSummary doc={doc} expanded /></details></div>;
  if (doc.kind === 'manual_receipt') return <ManualReceiptSummary doc={doc} onChange={onChange} disabled={disabled} />;
  let ledger;
  try { ledger = reviewLedger(doc); } catch { return <section aria-label="สรุปก่อนเซ็น"><h2>สรุปก่อนเซ็น</h2>{doc.lines.filter(line => line.note).map(line => <p key={`note-${line.id}`}>{line.product_name} · {line.note}</p>)}<p>รวมรายการสุทธิ — บาท</p><p role="alert">ตรวจตัวเลข จำนวน ราคา ส่วนลด และภาษี</p></section>; }
  const receivedCount = doc.lines.filter(line => Number(line.quantity_received) > 0).length;
  const knownCount = receivedCount - ledger.pendingPrices.length;
  return <section className="rc-stack" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2>{doc.lines.filter(line => line.note).map(line => <p key={`note-${line.id}`}>{line.product_name} · {line.note}</p>)}<p>รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ</p>
    {ledger.missingPrice && <p role="status" className="rc-price-notice">ยังไม่มีราคา · บัญชีต้องตรวจราคา</p>}
    <dl className="ra-ledger" aria-label="ยอดบิล ปรับตามรับ และมูลค่าที่ทราบราคา">
      <div><dt>{ledger.hasBillTotal ? 'ยอดบิล' : 'ยอดบิลที่คำนวณได้'}</dt><dd>{formatBaht(ledger.bill)} บาท</dd></div>
      <div><dt>ปรับตามการตัดสินใจ</dt><dd>{ledger.decisionAdjustment > 0n ? '+' : ''}{formatBaht(ledger.decisionAdjustment)} บาท</dd>{ledger.adjustments.map(row => <p key={row.id}>{row.name} · {row.reason} {row.amount > 0n ? '+' : ''}{formatBaht(row.amount)} บาท</p>)}{ledger.reconciliation !== 0n && <p>ส่วนต่างยอดบิลกับรายการสุทธิ {ledger.reconciliation > 0n ? '+' : ''}{formatBaht(ledger.reconciliation)} บาท · ยอดบิลไม่ตรงกับรายการหลังส่วนลดและภาษี · ให้บัญชีตรวจ</p>}</div>
      <div className="ra-ledger-result"><dt>มูลค่าที่รับ (ส่วนที่ทราบราคา)</dt><dd>{receivedCount > 0 && knownCount === 0 ? 'ยังไม่ทราบ' : `${formatBaht(ledger.receivedNet)} บาท`}</dd>{ledger.missingPrice && <p>+ {ledger.pendingPrices.length} รายการรอราคา · ยังไม่ใช่มูลค่ารับทั้งหมด</p>}</div>
      {(ledger.discount !== 0n || ledger.vat !== 0n) && <div><dt>ส่วนลด / ภาษีตามบิล</dt><dd>{formatBaht(ledger.discount)} / {formatBaht(ledger.vat)} บาท</dd><p>รวมอยู่ในยอดบิลแล้ว</p></div>}
      {ledger.missingPrice && <div><dt>รายการรอราคา ({ledger.pendingPrices.length})</dt><dd>รอตรวจราคา</dd>{ledger.pendingPrices.map(row => <p key={row.id}>{row.name} · {qtyText(row.quantity)} {row.unit} · {row.outsideBill ? 'ไม่มีในบิล' : 'รอราคาจากบิล'}</p>)}</div>}
    </dl>
    <p className="ra-coverage">ทราบราคา {knownCount} จาก {receivedCount} รายการที่รับ · {ledger.missingPrice ? 'ยังไม่ทราบมูลค่ารับทั้งหมด' : 'คำนวณมูลค่ารับจากข้อมูลราคาที่มีแล้ว'}</p>
    <p className="ra-accounting-next">รอบัญชีตรวจราคาและยอดชำระ</p>
    <div className="ra-summary-details">{!expanded && <details><summary>รายละเอียดสรุป</summary><p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p><p>ส่วนลด {formatBaht(ledger.discount)} บาท</p><p>ภาษี {formatBaht(ledger.vat)} บาท</p></details>}{expanded && <p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p>}</div><p>มูลค่ารับใช้ราคาบิลและส่วนลด/ภาษีเดิม บัญชีตรวจราคาและยอดชำระต่อ</p>
    <details className="ra-line-details"><summary>ดูรายการรับและข้อแตกต่าง</summary><div className="rc-stack">    {doc.lines.filter(line => line.review_decision !== 'accept').map(line => <article className="ra-card" key={line.id}><strong className="receiving-bill-text">{line.product_name}</strong><p>{receiptDecisionText(line)}</p></article>)}
    {doc.scope === 'branch' && doc.lines.map(line => <DepartmentAllocation key={line.id} line={line} showProduct />)}
</div></details>
  </section>;
}
