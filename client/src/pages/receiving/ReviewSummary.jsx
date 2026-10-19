import { reviewLedger, qtyText, receiptDecisionText } from './review-a';
import { formatBaht } from './receiving-utils';
import { DepartmentAllocation } from './DepartmentAllocation';
export function ReviewSummary({ doc, compact = false, expanded = false }) {
  if (compact) return <div className="ra-sign-summary"><p>รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ · {doc.lines.filter(line => line.review_decision !== 'accept').length} ข้อแตกต่าง</p><details><summary>รายละเอียดสรุป</summary><ReviewSummary doc={doc} expanded /></details></div>;
  let ledger;
  try { ledger = reviewLedger(doc); } catch { return <section aria-label="สรุปก่อนเซ็น"><h2>สรุปก่อนเซ็น</h2><p>รวมรายการสุทธิ — บาท</p><p role="alert">ตรวจตัวเลข จำนวน ราคา ส่วนลด และภาษี</p></section>; }
  return <section className="rc-stack" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2><p>รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ</p>
    {doc.lines.filter(line => line.review_decision !== 'accept').map(line => <article className="ra-card" key={line.id}><strong className="receiving-bill-text">{line.product_name}</strong><p>{receiptDecisionText(line)}</p></article>)}
    {doc.scope === 'branch' && doc.lines.map(line => <DepartmentAllocation key={line.id} line={line} showProduct />)}
    {ledger.missingPrice && <p role="status" className="rc-price-notice">ยังไม่มีราคา · บัญชีต้องตรวจราคา</p>}
    <dl className="ra-ledger">
      <div><dt>{ledger.hasBillTotal ? 'ยอดบิล' : 'ยอดบิลที่คำนวณได้'}</dt><dd>{formatBaht(ledger.bill)} บาท</dd></div>
      <div><dt>ปรับตามการตัดสินใจ</dt><dd>{ledger.decisionAdjustment > 0n ? '+' : ''}{formatBaht(ledger.decisionAdjustment)} บาท</dd>{ledger.adjustments.map(row => <p key={row.id}>{row.name} · {row.reason} {row.amount > 0n ? '+' : ''}{formatBaht(row.amount)} บาท</p>)}</div>
      {ledger.reconciliation !== 0n && <div><dt>ส่วนต่างยอดบิลกับรายการสุทธิ</dt><dd>{ledger.reconciliation > 0n ? '+' : ''}{formatBaht(ledger.reconciliation)} บาท</dd><p>ยอดบิลไม่ตรงกับรายการหลังส่วนลดและภาษี · ให้บัญชีตรวจ</p></div>}
      {ledger.missingPrice && <div><dt>รายการรอราคา ({ledger.pendingPrices.length})</dt><dd>รอตรวจราคา</dd>{ledger.pendingPrices.map(row => <p key={row.id}>{row.name} · {qtyText(row.quantity)} {row.unit} · {row.outsideBill ? 'ไม่มีในบิล' : 'รอราคาจากบิล'}</p>)}</div>}
      <div><dt>มูลค่าที่รับ (ส่วนที่ทราบราคา)</dt><dd>{formatBaht(ledger.receivedNet)} บาท</dd>{ledger.missingPrice && <p>+ {ledger.pendingPrices.length} รายการรอราคา · ยังไม่ใช่มูลค่ารับทั้งหมด</p>}</div>
      {(ledger.discount !== 0n || ledger.vat !== 0n) && <div><dt>ส่วนลด / ภาษีตามบิล</dt><dd>{formatBaht(ledger.discount)} / {formatBaht(ledger.vat)} บาท</dd><p>รวมอยู่ในยอดบิลแล้ว</p></div>}
    </dl>
    <div className="ra-summary-details">{!expanded && <details><summary>รายละเอียดสรุป</summary><p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p><p>ส่วนลด {formatBaht(ledger.discount)} บาท</p><p>ภาษี {formatBaht(ledger.vat)} บาท</p></details>}{expanded && <p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p>}</div><p>มูลค่ารับใช้ราคาบิลและส่วนลด/ภาษีเดิม บัญชีตรวจราคาและยอดชำระต่อ</p>
  </section>;
}
