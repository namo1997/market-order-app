import { LineNote } from './LineNote';
import { useEffect, useState } from 'react';
import { PrimaryAction } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { ProductPicker } from './ProductPicker';
import { rowDecision, qtyText, billAlias, orderDifference, partialDeliveryText } from './review-a';
import { lineErrors } from './receiving-validation';
import { reviewWarnings } from './receiving-review';
import { warningText } from './receiving-utils';
import { ReceivingNumberField } from './ReceivingNumberField';
import { DepartmentAllocation } from './DepartmentAllocation';
import { countedBillTargets } from './counted-bill-match';

export function ReviewRows({ doc, disabled, onChange, onDecide, onBulk, onDelete, onMatchCounted }) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [jump, setJump] = useState(null);
  const [pendingMatch, setPendingMatch] = useState(null);
  const [returnLine, setReturnLine] = useState(null);
  const [returnStatus, setReturnStatus] = useState('waiting');
  const [returnError, setReturnError] = useState('');
  useEffect(() => { if (jump) document.getElementById(`review-row-${jump.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [jump]);
  const large = doc.lines.length >= 8;
  const pending = doc.lines.filter(line => !line.review_decision);
  const rows = doc.lines.filter(line => (!large || filter === 'all' || !line.review_decision) &&
    `${line.product_name || ''} ${line.bill_text || ''}`.toLocaleLowerCase('th').includes(query.trim().toLocaleLowerCase('th')));
  const next = () => {
    const target = pending[0];
    if (!target) return;
    setFilter('pending'); setQuery('');
    setJump({ id: target.id });
  };
  return <div className="rc-stack">
    <p role="status">ตัดสินใจแล้ว {doc.lines.length - pending.length}/{doc.lines.length} รายการ</p>
    {large && <div className="ra-filters">
      <button type="button" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>ต้องตัดสินใจ ({pending.length})</button>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ทั้งหมด</button>
      <label>ค้นหาสินค้า / ชื่อในบิล<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" disabled={!pending.length} onClick={next}>ตรวจเรื่องถัดไป</button>
    </div>}
    <button type="button" disabled={disabled || !doc.lines.some(line => !line.review_decision && rowDecision(line, doc).kind === 'accept')} className="sg-primary sg-press" onClick={onBulk}>ยืนยันทั้งหมดที่ตรง</button>
    {returnLine && <ReceivingDialog title="ยืนยันคืนร้าน" busy={disabled} onClose={() => setReturnLine(null)} actions={<PrimaryAction disabled={disabled} onClick={async () => { if (await onDecide(returnLine.id, 'not_received', returnStatus)) setReturnLine(null); else setReturnError('บันทึกการคืนไม่ได้ ข้อมูลยังอยู่ กรุณาตรวจการเชื่อมต่อและลองใหม่'); }}>ยืนยันไม่รับและคืนร้าน</PrimaryAction>}>
      <p className="receiving-bill-text">{returnLine.product_name} · คืน {qtyText(returnLine.counted_quantity ?? returnLine.quantity_received)} {returnLine.unit_text || 'หน่วย'}</p>
      <p>ไม่เพิ่มของรายการนี้เข้าคลัง หลังยืนยันใบรับ ระบบจะเปิดเรื่องคืนของให้ติดตาม</p>
      <label>ร้านมารับหรือยัง<select value={returnStatus} disabled={disabled} onChange={event => setReturnStatus(event.target.value)}><option value="waiting">ยังไม่มารับ</option><option value="collected">มารับแล้ว (แนบหลักฐานในเรื่องคืนของ)</option></select></label>
      {returnError && <p role="alert">{returnError}</p>}
      <button type="button" className="ra-secondary-action" disabled={disabled} onClick={() => setReturnLine(null)}>กลับไปตรวจรายการ</button>
    </ReceivingDialog>}
    {!rows.length && <p>ไม่มีรายการในตัวกรองนี้</p>}
    {rows.map(line => {
      const decision = rowDecision(line, doc);
      const alias = billAlias(line, doc);
      const countedTargets = onMatchCounted ? countedBillTargets(doc, line) : [];
      const errors = lineErrors(line, doc.kind);
      return <article id={`review-row-${line.id}`} className="ra-card" key={line.id} data-status={decision.kind}>
        <div className="ra-title"><h2 className="receiving-bill-text">{line.product_name || 'เลือกสินค้า'}</h2><span>{line.review_decision ? '✓ ตัดสินใจแล้ว' : countedTargets.length ? 'ยังไม่จับคู่' : decision.label}</span></div>
        <div className="ra-numbers">
          {[['นับได้', line.counted_quantity], ['บิล', line.quantity_billed], ['สั่ง', line.quantity_ordered]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{qtyText(value)}</strong><small>{line.unit_text || line.ordered_unit || 'หน่วย'}</small></div>)}
        </div>
        {partialDeliveryText(line) && <p className="ra-order-note" data-partial="true">{partialDeliveryText(line)}</p>}
        {!partialDeliveryText(line) && orderDifference(line) && <p className="ra-order-note">{orderDifference(line)} (ข้อมูลประกอบ)</p>}
        {line.counted_quantity != null && Number(line.quantity_received) !== Number(line.counted_quantity) && <p>แก้หลังเปิดบิล: รับ {qtyText(line.quantity_received)} {line.unit_text} (เก็บจำนวนนับเดิมไว้)</p>}
        {doc.scope === 'branch' && <DepartmentAllocation line={line} />}
        {reviewWarnings(doc).filter(warning => Number(warning.line_no) === Number(line.line_no)).map(warning => <p key={warning.code}>{warningText(warning)}</p>)}
        {alias && <><p className="ra-bill-text">ในบิลเขียน {alias} → {line.product_name || 'ยังไม่จับคู่'}</p>
        <label className="rc-check"><input type="checkbox" checked={!!line.remember_alias} disabled={disabled || !!line.review_decision || !line.product_id} onChange={event => onChange(line.id, { remember_alias: event.target.checked })} />จำชื่อย่อร้านนี้</label></>}
        {countedTargets.length > 0 && <div className="rc-stack" aria-label={`จับคู่ ${line.bill_text} กับสินค้าที่นับไว้`}>
          <p>แตะสินค้าที่นับไว้เพื่อจับคู่ “{line.bill_text}”</p>
          {countedTargets.map(target => <button type="button" className="rc-option-card" style={{ minHeight: 48 }} disabled={disabled} key={target.id} onClick={() => setPendingMatch({ billId: line.id, targetId: target.id })}>{line.bill_text} → {target.product_name} · นับได้ {qtyText(target.counted_quantity)} {target.unit_text}</button>)}
          {pendingMatch?.billId === line.id && (() => { const target = countedTargets.find(item => item.id === pendingMatch.targetId); return target && <div role="group" aria-label="ยืนยันการจับคู่" className="rc-stack">
            <p role="status">จับคู่ ‘{line.bill_text}’ กับ ‘{target.product_name}’ ใช่ไหม?</p>
            <button type="button" className="sg-primary sg-press" style={{ minHeight: 48 }} disabled={disabled} onClick={() => { setPendingMatch(null); onMatchCounted(line.id, target.id); }}>ยืนยัน</button>
            <button type="button" style={{ minHeight: 48 }} disabled={disabled} onClick={() => setPendingMatch(null)}>ยกเลิก</button>
          </div>; })()}
        </div>}
        {decision.kind === 'price_review' && <p>ราคาสั่ง {qtyText(line.ordered_price)} → บิล {qtyText(line.unit_price)} บาท · สร้างเรื่องตรวจราคาเมื่อลงรับ บัญชีต้องตรวจต่อ</p>}
        {decision.kind === 'missing_bill' && <p>รายการนี้ไม่มีในบิล เลือกรับแล้วให้บัญชีขอบิลจากร้าน หรือคืนร้าน</p>}
        {!line.review_decision && <>
          {line.counted_quantity == null && !countedTargets.length && <p>รายการเพิ่มหลังเปิดบิล ต้องกรอกจำนวนที่ตรวจจริง (ไม่มีของให้กรอก 0)</p>}
          {(decision.kind === 'wrong_product' || editing === line.id) && <ProductPicker id={`match-${line.id}`} line={line} disabled={disabled} expectedItems={doc.lines.filter(row => row.order_item_id && row.product_id).map(row => ({ order_item_id: row.order_item_id, product_id: row.product_id, product_name: row.product_name, unit_name: row.ordered_unit || row.unit_text, unit_id: row.unit_id }))} onChange={patch => onChange(line.id, { ...patch, remember_alias: false })} />}
          {editing === line.id && <div className="rc-stack">
            <ReceivingNumberField disabled={disabled} error={errors.quantity_received} label={`แก้จำนวนหลังเปิดบิล ${line.product_name}`} value={line.quantity_received ?? ''} onValueChange={value => onChange(line.id, { quantity_received: value, _countConfirmed: true })} />
            <ReceivingNumberField disabled={disabled} error={errors.quantity_billed} validationKey="quantity_billed" label={`จำนวนบิล ${line.product_name}`} value={line.quantity_billed ?? ''} onValueChange={value => onChange(line.id, { quantity_billed: value, _billEntered: true, amount: null })} />
            <ReceivingNumberField disabled={disabled} error={errors.unit_price} label={`ราคาบิล ${line.product_name}`} validationKey="unit_price" value={line.unit_price ?? ''} onValueChange={value => onChange(line.id, { unit_price: value, amount: null })} />
            <label>หน่วย<input disabled={disabled} value={line.unit_text || ''} onChange={event => onChange(line.id, { unit_text: event.target.value })} /></label>
          </div>}
          <div className="ra-row-actions"><button type="button" disabled={disabled || !line.product_id || decision.invalid || (line.counted_quantity == null && !line._countConfirmed)} onClick={() => onDecide(line.id, decision.kind)}>{decision.action}</button>
            {decision.kind === 'missing_bill' && <button type="button" disabled={disabled || !line.product_id} onClick={() => { setReturnLine(line); setReturnStatus('waiting'); setReturnError(''); }}>ไม่รับ · คืนร้าน {qtyText(line.counted_quantity ?? line.quantity_received)} {line.unit_text || 'หน่วย'}</button>}
            <button type="button" className="ra-edit-link" aria-label={`แก้ข้อมูล ${line.product_name}`} disabled={disabled} onClick={() => setEditing(editing === line.id ? null : line.id)}>{editing === line.id ? 'ปิดช่องแก้ไข' : 'แก้'}</button></div>
        </>}
        <LineNote line={line} disabled={disabled} onChange={patch => onChange(line.id, patch)} />
        {line.counted_quantity == null && onDelete && <button type="button" disabled={disabled} onClick={() => onDelete(line.id)}>ลบรายการเพิ่ม {line.product_name}</button>}
        {line.review_decision && <button type="button" disabled={disabled} onClick={() => onDecide(line.id, null)}>เลิกทำการตัดสินใจ</button>}
      </article>;
    })}
  </div>;
}
