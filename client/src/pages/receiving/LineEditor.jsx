import { useState } from 'react';
import { ProductPicker } from './ProductPicker';
import { matchLabel, billAmountLabel } from './review-card';
import { EmptyState, PrimaryAction, Icon } from '../../design';
import { decimalString, formatBaht, lineAmount } from './receiving-utils';
import { quantityStatus, hasLinePrice } from './receiving-status';
import { lineErrors, normalizeNumberEntry, focusField } from './receiving-validation';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { orderComparison, reviewCounters, pendingReviewIndices, decisionLabels, lineTitle, batchSelectable } from './line-review-state';
import { ReceivingNumberField as NumberField } from './ReceivingNumberField';
import { decimalEntryMessage, rejectDecimalEntry } from './decimal-entry';
import { warningText } from './receiving-utils';

const displayLineAmount = line => { if (!hasLinePrice(line)) return '—'; try { return formatBaht(lineAmount(line)); } catch { return '—'; } };


function LineFields({ line, index, kind, onChange, expectedItems, lines }) {
  const errors = lineErrors(line, kind);
  const normalized = { ...line, quantity_received: normalizeNumberEntry(line.quantity_received) };
  const status = quantityStatus(normalized, expectedItems, lines.map((row, i) => i === index ? normalized : row), kind);
  const numeric = (key, label, unit) => <NumberField id={`line-${index}-${key}`} error={errors[key]} validationKey={key} label={label} unit={unit} value={line[key] ?? ''} maxLength={18} onValueChange={value => {
    const changes = { [key]: value };
    if (key === 'quantity_billed' || key === 'unit_price') {
      try { changes.amount = decimalString(lineAmount({ ...line, ...changes, amount: null })); }
      catch { changes.amount = ''; }
    }
    onChange(changes);
  }} />;
  return <div className="rc-stack">
    <label>ชื่อในบิล<input value={line.bill_text || ''} maxLength={500} onChange={event => onChange({ bill_text: event.target.value })} /></label>
    <ProductPicker line={line} onChange={onChange} expectedItems={expectedItems} id={`line-${index}-product_id`} error={errors.product_id} />
    {line.product_id && line.bill_text && <label className="rc-check"><input type="checkbox" checked={line.remember_alias !== false} onChange={event => onChange({ remember_alias: event.target.checked })} />จำ ‘{line.bill_text}’ = {line.product_name} สำหรับร้านนี้</label>}
    <label>หน่วย<input value={line.unit_text || ''} maxLength={100} onChange={event => onChange({ unit_text: event.target.value, unit_id: null })} /></label>
    {numeric('quantity_received', 'รับจริง', line.unit_text || 'หน่วย')}
    <span className="rc-row-status" role="status" data-status={errors.quantity_received ? 'error' : status.status}>{errors.quantity_received || status.label}</span>
    <details><summary>ราคาและบิล</summary><div className="rc-stack">
      {numeric('quantity_billed', 'จำนวนในบิล')}{numeric('unit_price', 'ราคาต่อหน่วย', 'บาท')}{numeric('amount', 'ยอดในบิล', 'บาท')}
    </div></details>
  </div>;
}

export function LineEditor({ lines, expectedItems, kind, onSelect, readOnly, warnings = [], review, guidance, dispatch, onViewBill, onSelectionChange, chosen = [] }) {
  const [productIndex, setProductIndex] = useState(null);
  const [productChoice, setProductChoice] = useState(null);
  const [filter, setFilter] = useState('needs');
  const [details, setDetails] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [entryError, setEntryError] = useState(null);
  const [focusedNumber, setFocusedNumber] = useState(null);
  const editing = review.editing;
  const counts = reviewCounters(lines, expectedItems, kind);
  const needs = new Set(pendingReviewIndices(lines));
  const chosenIndices = chosen.filter(index => lines[index]);
  const choose = index => {
    if (!batchSelectable(lines[index], index, lines, expectedItems, kind, warnings)) return;
    const next = chosenIndices.includes(index) ? chosenIndices.filter(value => value !== index) : [...chosenIndices, index];
    onSelectionChange(next); onSelect(index);
  };
  const displayed = lines.flatMap((line, index) => readOnly || filter === 'all' || needs.has(index) ? [index] : []);
  const eligible = displayed.filter(index => batchSelectable(lines[index], index, lines, expectedItems, kind, warnings));
  const selectAll = () => onSelectionChange(eligible);
  const clearChosen = () => { onSelectionChange([]); };
  const finish = () => { dispatch({ type: 'confirm' }); clearChosen(); };
  const edit = (index, mode) => { onSelect(index); dispatch({ type: 'edit', index, mode }); };
  const closeEdit = () => dispatch({ type: 'cancel' });
  const counters = <div className="rc-review-counts" role="status"><strong>{needs.size ? `ตรวจแล้ว ${counts.reviewed}/${counts.total}` : `ตรวจครบ ${counts.total} รายการ`}</strong><span className="rc-discrepancies"><span data-status={counts.short ? 'review' : undefined}>ขาด {counts.short} รายการ</span><span data-status={counts.over ? 'error' : undefined}>เกิน {counts.over} รายการ</span></span><progress max={counts.total || 1} value={counts.reviewed} aria-label="ความคืบหน้าการตรวจ" /></div>;
  const risky = review.pending?.rows.some(row => row.reasons.length || row.manual || row.discrepancy);

  if (!lines.length) return <EmptyState title="ยังไม่มีรายการ" description="อ่านบิลหรือเพิ่มจากตัวเลือก" icon="list" />;
  return <section className="rc-review-table" aria-label="ตรวจรายการ">
    <div className="rc-review-toolbar">
      {counters}
      {needs.size > 0 && review.message && <div className="rc-undo"><span role="status">{review.message}</span><button type="button" className="rc-text-action" onClick={() => dispatch({ type: 'clear-message' })}>ปิดข้อความ</button></div>}
      <div className="rc-review-filters" role="group" aria-label="กรองรายการ">
        <button type="button" className="rc-text-action" aria-label="ทั้งหมด" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); clearChosen(); }}>ทั้งหมด <strong>{lines.length}</strong></button>
        <button type="button" className="rc-text-action" aria-pressed={filter === 'needs'} onClick={() => { setFilter('needs'); clearChosen(); }}>ยังไม่ตรวจ <strong>{needs.size}</strong></button>
      </div>
      {!!review.history.length && <div className="rc-review-history"><button type="button" className="rc-text-action" disabled={!!editing} title={editing ? 'บันทึกหรือยกเลิกค่าที่กำลังแก้ก่อนเลิกทำ' : undefined} onClick={() => { dispatch({ type: 'undo' }); clearChosen(); }}>เลิกทำรายการล่าสุด</button>{editing && <span className="rc-muted">บันทึกหรือยกเลิกค่าที่กำลังแก้ก่อนเลิกทำ</span>}</div>}
    </div>
    {!readOnly && eligible.length > 0 && <div className="rc-selection-tools"><button type="button" className="rc-text-action" aria-expanded={bulk} onClick={() => { setBulk(!bulk); clearChosen(); }}>เลือกหลายรายการ</button>
      {bulk && <><button type="button" className="rc-text-action" aria-pressed={chosenIndices.length ? eligible.every(index => chosenIndices.includes(index)) ? true : 'mixed' : false} disabled={!!editing} onClick={selectAll}>เลือกทั้งหมดที่แสดง</button><button type="button" className="rc-text-action" disabled={!chosenIndices.length} onClick={clearChosen}>ล้างที่เลือก</button><span role="status" className="rc-selection-count">เลือก {chosenIndices.length}/{eligible.length} รายการที่เลือกได้</span></>}
    </div>}
    {bulk && editing && <p className="rc-muted" role="status">บันทึกหรือยกเลิกค่าที่กำลังแก้ก่อนเลือกหลายรายการ</p>}
    {review.error && !review.pending && <p role="alert">{review.error}</p>}
    {!readOnly && filter === 'needs' && !needs.size && !editing ? <div className="rc-review-complete"><p>ตรวจครบแล้ว</p><button type="button" className="rc-text-action" onClick={() => { setFilter('all'); clearChosen(); }}>ดูทั้งหมด {lines.length} รายการ</button></div> : <>

    <ol className="rc-compact-list rc-review-cards">
      {lines.map((line, index) => {
        if (!readOnly && filter === 'needs' && !needs.has(index) && editing?.index !== index) return null;
        const billRead = line.bill_read || line;
        const current = editing?.index === index ? editing.line : line;
        const validated = focusedNumber === index ? { ...current, quantity_received: normalizeNumberEntry(current.quantity_received) } : current;
        const quantityError = lineErrors(validated, kind).quantity_received;
        const status = quantityStatus(validated, expectedItems, lines.map((row, i) => i === index ? validated : row), kind);
        const order = orderComparison(current, expectedItems, lines);
        const unit = ({ 'กิโลกรัม': 'กก.', 'กรัม': 'ก.' })[line.unit_text] || line.unit_text || 'หน่วย';
        const title = lineTitle(current, index);
        const rowWarnings = warnings.filter(warning => Number(warning.line_no) === Number(line.line_no || index + 1));
        const inline = editing?.index === index && editing.mode !== 'full';
        const unbilledOrder = Boolean(line.order_item_id && line.quantity_billed == null && line.unit_price == null && line.amount == null && !line.bill_read);
        return <li key={line.id || line._key || index} className="rc-compact-item" data-line-index={index} data-reviewed={!line._aiProposal} data-bulk={bulk}>
          <div className="rc-product-layer"><span>สินค้า</span>
            <div className="rc-product-cell">{bulk && !readOnly && <label className="rc-bulk-check"><input id={`line-${index}-review`} type="checkbox" checked={chosenIndices.includes(index)} disabled={!!editing || !batchSelectable(line, index, lines, expectedItems, kind, warnings)} onChange={() => choose(index)} aria-label={`เลือก ${title}`} aria-describedby={`line-${index}-status`} /></label>}
            <button type="button" className="rc-line-name rc-text-action" onClick={() => edit(index, 'full')} disabled={readOnly} aria-label={`แก้ ${title}`}><strong>{title}</strong><small>{!line._aiProposal && line._aiReviewed ? ' ตรวจแล้ว' : ''}{rowWarnings.length > 0 && <Icon name="warning" size={16} />}</small></button></div>
            {!readOnly && <button type="button" className="rc-text-action" aria-label={`เปลี่ยนสินค้า ${title}`} onClick={() => {
              const next = dispatch({ type: 'prepare-row', index });
              if (next?.error) return;
              onSelect(index); setProductIndex(index); setProductChoice(null);
            }}>เปลี่ยนสินค้า</button>}
          </div>
          <div className="rc-receipt-numbers"><span className="rc-ordered" title={order ? `สั่งทั้งหมด ${order.ordered} รับแล้ว ${order.previous} คงเหลือ ${order.remaining}` : 'ไม่มีใบสั่ง'}>สั่ง {order?.ordered ?? '—'} {unit}{order && Number(order.previous) > 0 && <small>เหลือ {order.remaining}</small>}</span>
            <div className="rc-actual-group"><label className="rc-inline-number"><span>รับจริง<span className="rc-sr-only"> {title}</span></span><input id={`line-${index}-inline`} type="text" inputMode="decimal" autoComplete="off" value={current.quantity_received ?? ''} disabled={readOnly}
              aria-label={`รับจริง ${title}`} aria-describedby={`line-${index}-status`} aria-invalid={entryError === index || !!quantityError}
              onBlur={() => { setFocusedNumber(null); const value = normalizeNumberEntry(current.quantity_received); if (editing?.index === index && value !== current.quantity_received) dispatch({ type: 'input', index, values: { quantity_received: value } }); }}
              onFocus={() => {
                setFocusedNumber(index);
                if (editing && editing.index !== index) dispatch({ type: 'edit', index, mode: 'inline' });
                if (typeof document !== 'undefined' && document.activeElement?.id === `line-${index}-inline`) {
                  focusField(`line-${index}-inline`, document);
                }
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); dispatch({ type: 'save-next' }); }
                else if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'cancel' }); }
              }}
              onChange={event => {
                if (rejectDecimalEntry(event, String(current.quantity_received ?? ''))) { setEntryError(index); return; }
                setEntryError(null); dispatch({ type: 'input', index, values: { quantity_received: event.target.value } });
              }} /><small>{unit}</small></label>
            <span id={`line-${index}-status`} className="rc-row-status" role="status" data-status={quantityError || entryError === index ? 'error' : status.status}>
              {entryError === index ? decimalEntryMessage : quantityError || (status.label === 'ตรวจหน่วย' ? 'หน่วยไม่ตรง' : status.label)}
              {rowWarnings.length > 0 && <span>{rowWarnings.some(warning => warning.code === 'LOW_CONFIDENCE') ? ' · อ่านไม่ชัด' : ' · ตรวจจากบิลก่อนใช้'}</span>}
            </span>
            {inline && review.error && <span role="alert" data-status="error">{review.error}</span>}
            {current._aiProposal && <div className="rc-ai-suggestion"><span>AI: {current._aiProposal.quantity_received ?? '—'} {unit}</span>{!readOnly && <button type="button" className="rc-text-action" onClick={() => dispatch(editing?.index === index ? { type: 'use-edit-proposal' } : { type: 'apply', action: 'use', indices: [index] })}>ใช้ค่า</button>}</div>}
            </div>
          </div>
          <button type="button" className="rc-line-amount rc-text-action" aria-label={`ราคาและบิล ${title}`} onClick={() => setDetails(index)}><span className="rc-amount-origin">{billAmountLabel(current)}</span><strong>{displayLineAmount(current)} บาท</strong>{!hasLinePrice(current) && <small>ยังไม่มีราคา</small>}</button>
          <details className="rc-line-details"><summary>รายละเอียด</summary>
          <div className="rc-bill-raw"><div><span>ในบิลเขียน</span><strong>{(!unbilledOrder && line.bill_text) || (unbilledOrder ? 'ไม่พบในบิล' : 'อ่านชื่อไม่ออก')}</strong></div><button type="button" className="rc-text-action" onClick={onViewBill} aria-label={`ดูรูปบิล รายการ ${index + 1}`}><Icon name="receipt" />ดูรูปบิล</button></div>
            <span className="rc-match-source" data-status={line.match?.source === 'ai' || (!line.product_id && line.suggested_product_name) ? 'review' : undefined}>{matchLabel(line)}</span>
            {!line.product_id && line.suggested_product_name && <p>AI เสนอ {line.suggested_product_name}</p>}
            {line.match?.source === 'ai' && line.suggestion_reason && <p className="rc-muted">{line.suggestion_reason}</p>}
            <div className="rc-bill-numbers"><span>{line.bill_read ? 'ตัวเลขในบิล' : 'ตัวเลขที่บันทึก'}</span><strong>{billRead.quantity_billed ?? '—'} × {billRead.unit_price ?? '—'} = {billRead.amount ?? '—'} บาท</strong></div>
            {rowWarnings.some(warning => warning.code === 'PRICE_CHANGE') && <p className="rc-price-difference">ราคาต่างจากเดิม</p>}
            <button type="button" className="rc-text-action" aria-label={`ตรวจ ${title}`} onClick={() => setDetails(index)}>ตรวจ ›</button>
          </details>
        </li>;
      })}
    </ol></>}
    {productIndex !== null && <ReceivingDialog title="เลือกสินค้า" onClose={() => { setProductIndex(null); setProductChoice(null); }}
      actions={productChoice && <PrimaryAction onClick={() => {
        dispatch({ type: 'select-product', index: productIndex, values: productChoice });
        setProductIndex(null); setProductChoice(null);
      }}>ใช้สินค้านี้</PrimaryAction>}>
      <p>ในบิลเขียน “{(editing?.index === productIndex ? editing.line : lines[productIndex]).bill_text || 'อ่านชื่อไม่ออก'}”</p>
      {!productChoice ? <ProductPicker line={lines[productIndex]} id="review-product-search" expectedItems={expectedItems} onChange={setProductChoice} /> : <div className="rc-stack">
        <strong>{productChoice.product_name}</strong>
        {(editing?.index === productIndex ? editing.line : lines[productIndex]).bill_text && <label className="rc-check"><input type="checkbox" checked={productChoice.remember_alias} onChange={event => setProductChoice({ ...productChoice, remember_alias: event.target.checked })} />จำ ‘{(editing?.index === productIndex ? editing.line : lines[productIndex]).bill_text}’ = {productChoice.product_name} สำหรับร้านนี้</label>}
        <p className="rc-muted">จะจำเมื่อยืนยันรับสินค้า</p><button type="button" className="rc-text-action" onClick={() => setProductChoice(null)}>เลือกใหม่</button>
      </div>}
    </ReceivingDialog>}
    {editing?.mode === 'full' && <ReceivingDialog title={`แก้ ${lineTitle(editing.line, editing.index)}`} onClose={closeEdit}
      actions={<PrimaryAction onClick={() => dispatch({ type: 'save-next' })}>บันทึกและถัดไป</PrimaryAction>}>
      {guidance && <ReceivingIllustration state="review-lines" description={guidance} compact />}
      {counters}<LineFields line={editing.line} index={editing.index} kind={kind} lines={lines} expectedItems={expectedItems} onChange={values => dispatch({ type: 'change', values })} />
      <p>สั่งทั้งหมด {orderComparison(editing.line, expectedItems, lines)?.ordered ?? '—'} · รับก่อนหน้า {orderComparison(editing.line, expectedItems, lines)?.previous ?? '—'} · ครั้งนี้ {editing.line.quantity_received || '0'} {editing.line.unit_text}</p>
      <p>ยอดในบิล {displayLineAmount(editing.line)} บาท</p>
      {warnings.filter(warning => Number(warning.line_no) === Number(editing.line.line_no || editing.index + 1)).map((warning, i) => <p key={i}>{warningText(warning)}</p>)}
      {review.error && <p role="alert">{review.error}</p>}
      {lines[editing.index]._aiProposal && !Object.values(lineErrors(lines[editing.index], kind)).some(Boolean) && orderComparison(lines[editing.index], expectedItems, lines)?.safe && <button type="button" className="rc-text-action" disabled={Object.keys(editing.line).some(key => editing.line[key] !== lines[editing.index][key])} onClick={() => { dispatch({ type: 'cancel' }); dispatch({ type: 'apply', action: 'use', indices: [editing.index] }); }}>ใช้ AI รายการนี้</button>}
      <button type="button" className="rc-text-action" onClick={closeEdit}>ยกเลิกแก้</button><button type="button" className="rc-text-action" onClick={onViewBill}>ดูบิล</button>
    </ReceivingDialog>}
    {details !== null && <ReceivingDialog title={`เหตุที่ต้องตรวจ ${lineTitle(lines[details], details)}`} onClose={() => setDetails(null)}>
      <p>จำนวนในบิล {lines[details].quantity_billed ?? '—'} {lines[details].unit_text} · ราคาต่อหน่วย {lines[details].unit_price ?? '—'} บาท</p>
      <p>{quantityStatus(lines[details], expectedItems, lines, kind).label}</p>
      {warnings.filter(warning => Number(warning.line_no) === Number(lines[details].line_no || details + 1)).map((warning, i) => <p key={i}>{warningText(warning)}</p>)}
      <p>ผลอ่านบิลเป็นข้อเสนอ ตรวจเทียบกับของจริงก่อนใช้</p>
      {!readOnly && <button type="button" className="rc-text-action" onClick={() => { dispatch({ type: 'preview', action: 'zero', indices: [details] }); setDetails(null); }}>ยังไม่รับรายการนี้</button>}
      {!readOnly && <button type="button" className="rc-text-action" onClick={() => { edit(details, 'full'); setDetails(null); }}>แก้รายการ</button>}
      {!readOnly && lines[details]._aiProposal && !Object.values(lineErrors(lines[details], kind)).some(Boolean) && orderComparison(lines[details], expectedItems, lines)?.safe && <button type="button" className="rc-text-action" onClick={() => { dispatch({ type: 'apply', action: 'use', indices: [details] }); setDetails(null); }}>ใช้ AI รายการนี้</button>}
    </ReceivingDialog>}
    {review.pending && <ReceivingDialog title={`${decisionLabels[review.pending.action]} ${review.pending.rows.length} รายการ`} onClose={() => { setAcknowledged(false); dispatch({ type: 'dismiss' }); }}
      actions={<PrimaryAction disabled={risky && !acknowledged} onClick={() => { finish(); setAcknowledged(false); }}>ใช้ค่ากับ {review.pending.rows.length} รายการ</PrimaryAction>}>
      <p>{review.pending.action === 'zero' ? 'รับ 0 ในรอบนี้ ของที่เหลือยังรอรับ' : 'เปลี่ยนจำนวนรับจริงในร่าง ยังไม่รับเข้าคลัง'}</p>
      <ul className="rc-review-lines">{review.pending.rows.map(row => <li key={row.index}><span>{row.title}</span><strong>{row.before} → {row.after} {row.unit}</strong>{row.order && <small>สั่ง {row.order.ordered} รับแล้ว {row.order.previous} ค้าง {row.order.remaining} {row.unit}</small>}{row.manual && <small>แทนค่าที่คนแก้</small>}{row.discrepancy && <small>รับทราบส่วนต่างจากยอดค้าง</small>}{row.reasons.map((reason, i) => <small key={i}>{warningText(reason)}</small>)}</li>)}</ul>
      <p>กดเลิกทำได้หลังทำรายการ</p>{risky && <label className="rc-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />รับทราบส่วนต่าง คำเตือน และค่าที่จะทับแล้ว</label>}
    </ReceivingDialog>}
  </section>;
}
