import { LineNote, OffOrderReason } from './LineNote';
import { useEffect, useState } from 'react';
import { PrimaryAction } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { ProductPicker } from './ProductPicker';
import { rowDecision, qtyText, billAlias, orderDifference, partialDeliveryText, canBulkAccept, reviewBlocker, weightBillText, packText } from './review-a';
import { lineErrors } from './receiving-validation';
import { reviewWarnings } from './receiving-review';
import { warningText, thaiUnit } from './receiving-utils';
import { ReceivingNumberField } from './ReceivingNumberField';
import { DepartmentAllocation } from './DepartmentAllocation';
import { countedBillTargets } from './counted-bill-match';

// Real-bill test 2026-10-24: a bill line that is not matched yet has no product name; labels use the bill's wording.
const lineName = line => line.product_name || line.bill_text || line.bill_name || 'รายการจากบิล';

export function ReviewRows({ doc, disabled, onChange, onDecide, onBulk, onDelete, onMatchCounted }) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [jump, setJump] = useState(null);
  const [pendingMatch, setPendingMatch] = useState(null);
  const [returnLine, setReturnLine] = useState(null);
  const [returnStatus, setReturnStatus] = useState('waiting');
  const [returnError, setReturnError] = useState('');
  useEffect(() => {
    if (!jump) return;
    const row = document.getElementById(`review-row-${jump.id}`);
    const disclosure = row?.querySelector?.('details.ra-reviewed-row');
    if (disclosure) disclosure.open = true;
    row?.scrollIntoView({ behavior: 'instant', block: 'center' });
    const field = document.getElementById(`review-${jump.field}-${jump.id}`) || row;
    field?.focus?.({ preventScroll: true });
  }, [jump]);
  const large = doc.lines.length >= 8;
  const pending = doc.lines.filter(line => !line.review_decision);
  const rows = doc.lines.filter(line => (!large || filter === 'all' || !line.review_decision) &&
    `${line.product_name || ''} ${line.bill_text || ''}`.toLocaleLowerCase('th').includes(query.trim().toLocaleLowerCase('th')));
  const next = (target = pending[0]) => {
    if (!target) return;
    setFilter('pending'); setQuery('');
    const blocker = reviewBlocker(target, doc);
    if (blocker.field !== 'decision' && blocker.field !== 'product') setEditing(target.id);
    setJump({ id: target.id, field: blocker.field });
  };
  const bulk = doc.lines.filter(line => canBulkAccept(line, doc)).length;
  return <div className="rc-stack">
    {/* Owner 2026-10-22 redesign (mockup review-A): what still needs a decision comes first; decided rows fold into one group. */}
    <div className="ra-review-progress" aria-label="รายการที่ต้องตรวจ">
      <p role="status"><strong>{pending.length ? `ต้องตรวจอีก ${pending.length} รายการ` : 'ตรวจครบทุกรายการแล้ว'}</strong><span>ตัดสินใจแล้ว {doc.lines.length - pending.length}/{doc.lines.length} รายการ</span></p>
      {pending.length > 0 && <button type="button" className="ra-jump" disabled={disabled} onClick={() => next()}>ไปจุดแรกที่ต้องแก้</button>}
    </div>
    {large && <div className="ra-filters">
      <button type="button" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>ต้องตัดสินใจ ({pending.length})</button>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ทั้งหมด</button>
      <label>ค้นหาสินค้า / ชื่อในบิล<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" disabled={!pending.length} onClick={() => next()}>ตรวจเรื่องถัดไป</button>
    </div>}
    {/* 2026-10-24: with one matching row the green button repeated that card's own button; it now appears from two. */}
    {bulk > 1 && <button type="button" disabled={disabled} className="ra-bulk-accept" onClick={onBulk}>ยืนยันทั้งหมดที่ตรง</button>}
    {returnLine && <ReceivingDialog title="ยืนยันคืนร้าน" busy={disabled} onClose={() => setReturnLine(null)} actions={<PrimaryAction disabled={disabled} onClick={async () => { if (await onDecide(returnLine.id, 'not_received', returnStatus)) setReturnLine(null); else setReturnError('บันทึกการคืนไม่ได้ ข้อมูลยังอยู่ กรุณาตรวจการเชื่อมต่อและลองใหม่'); }}>ยืนยันไม่รับและคืนร้าน</PrimaryAction>}>
      <p className="receiving-bill-text">{returnLine.product_name} · คืน {qtyText(returnLine.counted_quantity ?? returnLine.quantity_received)} {returnLine.unit_text || 'หน่วย'}</p>
      <p>ไม่เพิ่มของรายการนี้เข้าคลัง หลังยืนยันใบรับ ระบบจะเปิดเรื่องคืนของให้ติดตาม</p>
      <label>ร้านมารับหรือยัง<select value={returnStatus} disabled={disabled} onChange={event => setReturnStatus(event.target.value)}><option value="waiting">ยังไม่มารับ</option><option value="collected">มารับแล้ว (แนบหลักฐานในเรื่องคืนของ)</option></select></label>
      {returnError && <p role="alert">{returnError}</p>}
      <button type="button" className="ra-secondary-action" disabled={disabled} onClick={() => setReturnLine(null)}>กลับไปตรวจรายการ</button>
    </ReceivingDialog>}
    {!rows.length && <p>ไม่มีรายการในตัวกรองนี้</p>}
    {(() => {
    const renderRow = line => {
      const decision = rowDecision(line, doc);
      const alias = billAlias(line, doc);
      const countedTargets = onMatchCounted ? countedBillTargets(doc, line) : [];
      const errors = lineErrors(line, doc.kind);
      const blocker = reviewBlocker(line, doc);
      const Surface = line.review_decision === 'accept' ? 'details' : 'div';
      const Title = line.review_decision === 'accept' ? 'summary' : 'div';
      // Real-bill test 2026-10-24 (owner: "ตรงนี้จัด ux ui ใหม่"): a bill line with no product yet shows its bill name,
      // the numbers, a search with the likely products under it, and nothing else — the state is said once (the pill).
      const unmatched = !line.product_id && !line.review_decision && !countedTargets.length;
      return <article id={`review-row-${line.id}`} className="ra-card" tabIndex={-1} key={line.id} data-status={decision.kind} data-unmatched={unmatched || undefined}>
        <Surface className="ra-reviewed-row"><Title className="ra-title"><h2 className="receiving-bill-text">{line.product_name || line.bill_text || 'เลือกสินค้า'}</h2>{/* Colour means something (owner rule): a row that matches the bill reads green before it is decided too. */}<span className="ra-pill" data-tone={line.review_decision ? 'done' : decision.kind === 'accept' ? 'ok' : 'review'}>{line.review_decision ? '✓ ตัดสินใจแล้ว' : countedTargets.length || unmatched ? 'ยังไม่จับคู่' : decision.label}</span></Title>
        <div className="ra-numbers">
          {[['นับได้', line.counted_quantity, line.unit_text], line.price_by_weight && (line.quantity_billed == null || line.quantity_billed === '') ? ['บิล (น้ำหนัก)', line.bill_weight, line.bill_weight_unit || 'กก.'] : ['บิล', line.quantity_billed, line._billUnit || line.unit_text], line.quantity_ordered != null && line.quantity_ordered !== '' ? ['สั่ง', line.quantity_ordered, line.ordered_unit] : null].filter(Boolean).map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{qtyText(value)}</strong><small>{value == null || value === '' ? '' : thaiUnit(unit) || unit || ''}</small></div>)}
        </div>
        {!line.review_decision && ['ai', 'alias'].includes(line.match?.source) && <p className="ra-provenance" data-source={line.match.source}>{line.match.source === 'ai' ? 'ข้อเสนอจาก AI · ต้องให้คนตรวจ' : 'จับคู่จากชื่อย่อร้าน · ต้องตรวจทีละรายการ'}</p>}
        {/* Waiting for the bill is said once by the row status and the panel above, not three times per row. */}
        {/* A matching row needs no "ต้องตรวจ" line: the pill says ตรง and the button says what happens. */}
        {!line.review_decision && !unmatched && !['waiting_bill', 'accept'].includes(decision.kind) && <p id={`review-blocker-${line.id}`} className="ra-row-blocker">ต้องตรวจ: {blocker.reason}</p>}
        {(line._billEntered || line.bill_entered_manually) && <p className="ra-provenance">จำนวนบิลกรอกหรือแก้โดยคน · คงจำนวนนับเดิม</p>}
        {!line.price_by_weight && packText(line) && <p className="ra-order-note" data-pack="true">{packText(line)}</p>}
        {line._billUnit && !line.review_decision && <p className="ra-order-note" data-unit="true">บิลคิดเป็น {thaiUnit(line._billUnit) || line._billUnit} แต่สินค้านี้นับเป็น {thaiUnit(line.unit_text) || line.unit_text || 'หน่วย'} · กด แก้ แล้วใส่จำนวนที่รับเป็น {thaiUnit(line.unit_text) || line.unit_text || 'หน่วย'}</p>}
        {line.review_decision === 'receive_unmatched' && <p className="ra-order-note" data-later="true">รับไปก่อน · รอบัญชีผูกสินค้า</p>}
        {line.price_by_weight && <p className="ra-order-note" data-weight="true">ร้านคิดเงินตามน้ำหนัก · {weightBillText(line)} · ไม่เทียบน้ำหนักกับจำนวนที่นับ</p>}
        {partialDeliveryText(line) && <p className="ra-order-note" data-partial="true">{partialDeliveryText(line)}</p>}
        {!partialDeliveryText(line) && orderDifference(line) && <p className="ra-order-note">{orderDifference(line)} (ข้อมูลประกอบ)</p>}
        {line.counted_quantity != null && Number(line.quantity_received) !== Number(line.counted_quantity) && <p>แก้หลังเปิดบิล: รับ {qtyText(line.quantity_received)} {line.unit_text} (เก็บจำนวนนับเดิมไว้)</p>}
        {doc.scope === 'branch' && <DepartmentAllocation line={line} />}
        {reviewWarnings(doc).filter(warning => Number(warning.line_no) === Number(line.line_no)).map(warning => <p key={warning.code}>{warningText(warning)}</p>)}
        {alias && !unmatched && line.review_decision !== 'receive_unmatched' && <><p className="ra-bill-text">ในบิลเขียน {alias} → {line.product_name || 'ยังไม่จับคู่'}</p>
        {/* Real-bill test 2026-10-24: an unregistered shop (ร้านใหม่ รอบัญชีตรวจ) has no alias key, so the server never learns; do not offer it. */}
        {(doc.supplier_master_id || doc.product_group_id) && <label className="rc-check"><input type="checkbox" checked={!!line.remember_alias} disabled={disabled || !!line.review_decision || !line.product_id} onChange={event => onChange(line.id, { remember_alias: event.target.checked })} />จำชื่อย่อร้านนี้</label>}</>}
        {countedTargets.length > 0 && <div className="rc-stack" aria-label={`จับคู่ ${line.bill_text} กับสินค้าที่นับไว้`}>
          <p>แตะสินค้าที่นับไว้เพื่อจับคู่ “{line.bill_text}”</p>
          {countedTargets.map(target => <button type="button" className="rc-option-card" style={{ minHeight: 48 }} disabled={disabled} key={target.id} onClick={() => setPendingMatch({ billId: line.id, targetId: target.id })}>{line.bill_text} → {target.product_name} · นับได้ {qtyText(target.counted_quantity)} {target.unit_text}</button>)}
          {pendingMatch?.billId === line.id && (() => { const target = countedTargets.find(item => item.id === pendingMatch.targetId); return target && <div role="group" aria-label="ยืนยันการจับคู่" className="rc-stack">
            <p role="status">จับคู่ ‘{line.bill_text}’ กับ ‘{target.product_name}’ ใช่ไหม?</p>
            <button type="button" className="sg-primary sg-press" style={{ minHeight: 48 }} disabled={disabled} onClick={() => { setPendingMatch(null); onMatchCounted(line.id, target.id); }}>ยืนยัน</button>
            <button type="button" style={{ minHeight: 48 }} disabled={disabled} onClick={() => setPendingMatch(null)}>ยกเลิก</button>
          </div>; })()}
        </div>}
        {decision.kind === 'price_review' && !line.price_by_weight && <p>ราคาสั่ง {qtyText(line.ordered_price)} → บิล {qtyText(line.unit_price)} บาท · สร้างเรื่องตรวจราคาเมื่อลงรับ บัญชีต้องตรวจต่อ</p>}
        {decision.kind === 'missing_bill' && <p>รายการนี้ไม่มีในบิล เลือกรับแล้วให้บัญชีขอบิลจากร้าน หรือคืนร้าน</p>}
        {!line.review_decision && <>
          {line.counted_quantity == null && !countedTargets.length && <p>รายการเพิ่มหลังเปิดบิล ต้องกรอกจำนวนที่ตรวจจริง (ไม่มีของให้กรอก 0)</p>}
          {(blocker.field === 'product' || decision.kind === 'wrong_product' || editing === line.id) && <ProductPicker id={`review-product-${line.id}`} line={line} disabled={disabled} suggestFrom={unmatched ? line.bill_text : ''} expectedItems={doc.lines.filter(row => row.order_item_id && row.product_id).map(row => ({ order_item_id: row.order_item_id, product_id: row.product_id, product_name: row.product_name, unit_name: row.ordered_unit || row.unit_text, unit_id: row.unit_id }))} onChange={patch => onChange(line.id, { ...patch, remember_alias: false })} />}
          {editing === line.id && <div className="rc-stack">
            <ReceivingNumberField id={`review-quantity_received-${line.id}`} disabled={disabled} error={errors.quantity_received} label={`แก้จำนวนหลังเปิดบิล ${lineName(line)}`} value={line.quantity_received ?? ''} onValueChange={value => onChange(line.id, { quantity_received: value, _countConfirmed: true })} />
            <ReceivingNumberField id={`review-quantity_billed-${line.id}`} disabled={disabled} error={errors.quantity_billed} validationKey="quantity_billed" label={`จำนวนบิล ${lineName(line)}`} value={line.quantity_billed ?? ''} onValueChange={value => onChange(line.id, { quantity_billed: value, _billEntered: true, amount: null })} />
            <ReceivingNumberField id={`review-unit_price-${line.id}`} disabled={disabled} error={errors.unit_price} label={`ราคาบิล ${lineName(line)}`} validationKey="unit_price" value={line.unit_price ?? ''} onValueChange={value => onChange(line.id, { unit_price: value, amount: null })} />
            <label>หน่วย<input id={`review-unit-${line.id}`} disabled={disabled} value={line.unit_text || ''} onChange={event => onChange(line.id, { unit_text: event.target.value })} /></label>
          </div>}
          <div className="ra-row-actions">{/* Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": not in the catalogue → receive it now, accounting links the product later. */}
            {unmatched && doc.scope !== 'branch' && Number(line.quantity_received) > 0 && <button type="button" className="ra-later-action" disabled={disabled || Object.entries(errors).some(([key, value]) => key !== 'product_id' && value)} onClick={() => onDecide(line.id, 'receive_unmatched')}>ไม่มีในระบบ · รับไปก่อน</button>}
            {decision.kind !== 'waiting_bill' && !unmatched && <button id={`review-decision-${line.id}`} aria-describedby={`review-blocker-${line.id}`} type="button" disabled={disabled || !line.product_id || decision.invalid || Object.values(errors).some(Boolean) || (line.counted_quantity == null && !line._countConfirmed)} onClick={() => onDecide(line.id, decision.kind)}>{decision.action}</button>}
            {decision.kind === 'missing_bill' && <button type="button" disabled={disabled || !line.product_id} onClick={() => { setReturnLine(line); setReturnStatus('waiting'); setReturnError(''); }}>ไม่รับ · คืนร้าน {qtyText(line.counted_quantity ?? line.quantity_received)} {line.unit_text || 'หน่วย'}</button>}
            <button type="button" className="ra-edit-link" aria-label={`แก้ข้อมูล ${lineName(line)}`} disabled={disabled} onClick={() => setEditing(editing === line.id ? null : line.id)}>{editing === line.id ? 'ปิดช่องแก้ไข' : 'แก้'}</button></div>
        </>}
        <LineNote line={line} askReason={false} disabled={disabled} onChange={patch => onChange(line.id, patch)} />
        {line.counted_quantity == null && onDelete && <button type="button" disabled={disabled} onClick={() => onDelete(line.id)}>ลบรายการเพิ่ม {line.product_name}</button>}
        {line.review_decision && <button type="button" disabled={disabled} onClick={() => onDecide(line.id, null)}>เลิกทำการตัดสินใจ</button>}
        </Surface>
      </article>;
    };
    const decidedRows = rows.filter(line => line.review_decision);
    return <>
      <OffOrderReason doc={doc} onChange={onChange} disabled={disabled} />
      {rows.filter(line => !line.review_decision).map(renderRow)}
      {decidedRows.length > 0 && <details className="ra-decided-group" open={!pending.length || undefined}><summary>ตัดสินใจแล้ว {decidedRows.length} รายการ</summary><div className="rc-stack">{decidedRows.map(renderRow)}</div></details>}
    </>;
    })()}
  </div>;
}
