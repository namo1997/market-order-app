import { reviewLedger, qtyText } from './review-a';
import { formatBaht } from './receiving-utils';
export function ReviewSummary({ doc, compact = false, expanded = false }) {
  if (compact) return <div className="ra-sign-summary"><p>รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ · {doc.lines.filter(line => line.review_decision !== 'accept').length} ข้อแตกต่าง</p><details><summary>รายละเอียดสรุป</summary><ReviewSummary doc={doc} expanded /></details></div>;
  let ledger;
  try { ledger = reviewLedger(doc); } catch { return <section aria-label="สรุปก่อนเซ็น"><h2>สรุปก่อนเซ็น</h2><p>รวมรายการสุทธิ — บาท</p><p role="alert">ตรวจตัวเลข จำนวน ราคา ส่วนลด และภาษี</p></section>; }
  const labels = { short: 'รับตามนับและแจ้งขาดเมื่อลงรับ', over: 'รับของเกิน', wrong_product: 'ยืนยันสินค้า/หน่วย', price_review: 'ส่งเรื่องตรวจราคาเมื่อลงรับ', missing_bill: 'ไม่มีในบิล · รับและให้บัญชีตามบิล', not_received: 'ไม่มีในบิล · ไม่รับ' };
  return <section className="rc-stack" aria-label="สรุปก่อนเซ็น">
    <h2>สรุปก่อนเซ็น</h2><p>รับ {doc.lines.filter(line => Number(line.quantity_received) > 0).length} จาก {doc.lines.length} รายการ</p>
    {doc.lines.filter(line => line.review_decision !== 'accept').map(line => <article className="ra-card" key={line.id}><strong>{line.product_name}</strong><p>{labels[line.review_decision] || 'ยังไม่ตัดสินใจ'} · รับ {qtyText(line.quantity_received)} {line.unit_text}</p></article>)}
    {doc.scope === 'branch' && doc.lines.map(line => <details key={line.id}><summary>{line.product_name} · แยกแผนก</summary>{line.departments?.map(part => <p key={part.order_item_id}>{part.department_name} · รับ {part.quantity_received} {line.unit_text}</p>)}</details>)}
    {ledger.missingPrice && <p role="status" className="rc-price-notice">ยังไม่มีราคา · บัญชีต้องตรวจราคา</p>}
    <dl className="ra-ledger">
      <div><dt>ยอดบิล</dt><dd>{formatBaht(ledger.bill)} บาท</dd></div>
      <div><dt>ปรับขาด/เกิน (มูลค่าสินค้า)</dt><dd>{ledger.missingPrice ? 'รอตรวจราคา' : `${ledger.adjustment > 0n ? '+' : ''}${formatBaht(ledger.adjustment)} บาท`}</dd>{ledger.adjustments.map(row => <p key={row.id}>{row.name} {row.amount > 0n ? '+' : ''}{formatBaht(row.amount)} บาท</p>)}</div>
      <div><dt>มูลค่าของที่รับ</dt><dd>{ledger.missingPrice ? 'รอตรวจราคา' : `${formatBaht(ledger.received)} บาท`}</dd></div>
      <div><dt>ส่วนลด / ภาษีตามบิล</dt><dd>{formatBaht(ledger.discount)} / {formatBaht(ledger.vat)} บาท</dd></div>
      <div><dt>รวมรายการ</dt><dd>{formatBaht(ledger.billedLines)} บาท</dd></div>
      {(ledger.discount !== 0n || ledger.vat !== 0n) && <div><dt>รวมรายการสุทธิ</dt><dd>{formatBaht(ledger.net)} บาท</dd></div>}
    </dl>
    <div className="ra-summary-details">{!expanded && <details><summary>รายละเอียดสรุป</summary>{ledger.discount === 0n && ledger.vat === 0n && <p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p>}<p>ส่วนลด {formatBaht(ledger.discount)} บาท</p><p>ภาษี {formatBaht(ledger.vat)} บาท</p></details>}{expanded && <p>รวมรายการสุทธิ {formatBaht(ledger.net)} บาท</p>}</div><p>มูลค่ารับใช้ราคาบิล ยังไม่ใช่ยอดอนุมัติชำระ บัญชีตรวจส่วนต่างและราคาต่อ</p>
  </section>;
}
