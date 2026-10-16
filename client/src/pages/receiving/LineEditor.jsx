import { useEffect, useState } from 'react';
import { productsAPI } from '../../api/products';
import { EmptyState, PrimaryAction, Icon } from '../../design';
import { decimalString, formatBaht, lineAmount } from './receiving-utils';
import { quantityStatus, hasLinePrice } from './receiving-status';
import { lineErrors } from './receiving-validation';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { orderComparison, reviewCounters, pendingReviewIndices, decisionLabels, lineTitle, batchSelectable } from './line-review-state';
import { ReceivingNumberField as NumberField } from './ReceivingNumberField';
import { decimalEntryMessage, rejectDecimalEntry } from './decimal-entry';
import { warningText } from './receiving-utils';

const displayLineAmount = line => { if (!hasLinePrice(line)) return '—'; try { return formatBaht(lineAmount(line)); } catch { return '—'; } };

function ProductPicker({ line, onChange, id, error }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await productsAPI.getProducts({ search: query.trim() });
        if (!active) return;
        const items = Array.isArray(response.data) ? response.data : response.data?.products;
        setResults(Array.isArray(items) ? items.slice(0, 20) : []);
        setStatus(items?.length ? '' : 'ไม่พบสินค้า');
      } catch { if (active) { setResults([]); setStatus('ค้นหาไม่ได้ ลองพิมพ์ใหม่'); } }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className="rc-stack">
    <label htmlFor={id}>ค้นหาสินค้า<input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} type="search" value={query} placeholder={line.product_name || 'ชื่อสินค้า'} maxLength={100}
      onChange={(event) => { setQuery(event.target.value); setResults([]); setStatus('กำลังค้นหา'); }} /></label>
    {error && <p id={`${id}-error`} className="sg-field-hint" data-error="true">{error}</p>}
    {query.trim() && <div className="rc-search-results"><p role="status" className="rc-muted">{status}</p>
      {results.map((product) => <button type="button" className="rc-check rc-text-action" key={product.id} onClick={() => {
        onChange({ product_id: product.id, product_name: product.name, order_item_id: null,
          unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1,
          match: { source: 'manual', confidence: 1 } });
        setQuery(''); setResults([]);
      }}><span>{product.name}<small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></span></button>)}
    </div>}
  </div>;
}

function LineFields({ line, index, kind, onChange }) {
  const errors = lineErrors(line, kind);
  const numeric = (key, label, unit) => <NumberField id={`line-${index}-${key}`} error={errors[key]} label={label} unit={unit} value={line[key] ?? ''} maxLength={18} onValueChange={value => {
    const changes = { [key]: value };
    if (key === 'quantity_billed' || key === 'unit_price') {
      try { changes.amount = decimalString(lineAmount({ ...line, ...changes, amount: null })); }
      catch { changes.amount = ''; }
    }
    onChange(changes);
  }} />;
  return <div className="rc-stack">
    <label>ชื่อในบิล<input value={line.bill_text || ''} maxLength={500} onChange={event => onChange({ bill_text: event.target.value })} /></label>
    <ProductPicker line={line} onChange={onChange} id={`line-${index}-product_id`} error={errors.product_id} />
    <label>หน่วย<input value={line.unit_text || ''} maxLength={100} onChange={event => onChange({ unit_text: event.target.value, unit_id: null })} /></label>
    {numeric('quantity_received', 'รับจริง', line.unit_text || 'หน่วย')}
    <details><summary>ราคาและบิล</summary><div className="rc-stack">
      {numeric('quantity_billed', 'จำนวนในบิล')}{numeric('unit_price', 'ราคาต่อหน่วย', 'บาท')}{numeric('amount', 'ยอดในบิล', 'บาท')}
    </div></details>
  </div>;
}

export function LineEditor({ lines, expectedItems, kind, onSelect, readOnly, warnings = [], checks, review, guidance, dispatch, onViewBill, onSelectionChange, chosen = [] }) {
  const [filter, setFilter] = useState('needs');
  const [details, setDetails] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [entryError, setEntryError] = useState(null);
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
      <div className="rc-review-filters" role="group" aria-label="กรองรายการ">
        <button type="button" className="rc-text-action" aria-label="ทั้งหมด" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); clearChosen(); }}>ทั้งหมด <strong>{lines.length}</strong></button>
        <button type="button" className="rc-text-action" aria-pressed={filter === 'needs'} onClick={() => { setFilter('needs'); clearChosen(); }}>ยังไม่ตรวจ <strong>{needs.size}</strong></button>
      </div>
    </div>
    {!readOnly && eligible.length > 0 && <div className="rc-selection-tools"><button type="button" className="rc-text-action" aria-expanded={bulk} onClick={() => { setBulk(!bulk); clearChosen(); }}>เลือกหลายรายการ</button>
      {bulk && <><button type="button" className="rc-text-action" aria-pressed={chosenIndices.length ? eligible.every(index => chosenIndices.includes(index)) ? true : 'mixed' : false} disabled={!!editing} onClick={selectAll}>เลือกทั้งหมดที่แสดง</button><button type="button" className="rc-text-action" disabled={!chosenIndices.length} onClick={clearChosen}>ล้างที่เลือก</button><span role="status" className="rc-selection-count">เลือก {chosenIndices.length}/{eligible.length} รายการที่เลือกได้</span></>}
    </div>}
    {checks?.hasIssues && <p className="rc-muted">{checks.label}</p>}
    {needs.size > 0 && review.message && <div className="rc-undo"><span role="status">{review.message}</span><button type="button" className="rc-text-action" onClick={() => dispatch({ type: 'clear-message' })}>ปิดข้อความ</button></div>}
    {!!review.history.length && <div className="rc-review-history"><button type="button" className="rc-text-action" disabled={!!editing} onClick={() => { dispatch({ type: 'undo' }); clearChosen(); }}>เลิกทำรายการล่าสุด</button></div>}
    {review.error && !review.pending && <p role="alert">{review.error}</p>}
    <div className="rc-compact-head" aria-hidden="true"><span>สินค้า</span><span>สั่ง</span><span>รับจริง</span><span>ยอดในบิล</span></div>
    <ol className="rc-compact-list">
      {lines.map((line, index) => {
        if (!readOnly && filter === 'needs' && !needs.has(index) && editing?.index !== index) return null;
        const current = editing?.index === index ? editing.line : line;
        const status = quantityStatus(current, expectedItems, lines.map((row, i) => i === index ? current : row), kind);
        const order = orderComparison(line, expectedItems, lines);
        const unit = ({ 'กิโลกรัม': 'กก.', 'กรัม': 'ก.' })[line.unit_text] || line.unit_text || 'หน่วย';
        const title = lineTitle(line, index);
        const rowWarnings = warnings.filter(warning => Number(warning.line_no) === Number(line.line_no || index + 1));
        const inline = editing?.index === index && editing.mode !== 'full';
        return <li key={line.id || line._key || index} className="rc-compact-item" data-line-index={index} data-reviewed={!line._aiProposal} data-bulk={bulk}>
          <div className="rc-compact-row">
            <div className="rc-product-cell">{!readOnly ? <label className="rc-bulk-check"><input id={`line-${index}-review`} type="checkbox" checked={chosenIndices.includes(index)} disabled={!!editing || !batchSelectable(line, index, lines, expectedItems, kind, warnings)} onChange={() => choose(index)} aria-label={`เลือก ${title}`} aria-describedby={!batchSelectable(line, index, lines, expectedItems, kind, warnings) ? `line-${index}-status` : undefined} /></label> : <span />}
            <button type="button" className="rc-line-name rc-text-action" onClick={() => edit(index, 'full')} disabled={readOnly} aria-label={`แก้ ${title}`}><strong>{title}</strong><small>{line._aiProposal ? ' AI เสนอ' : line._aiReviewed ? ' ตรวจแล้ว' : ''}{rowWarnings.length > 0 && <Icon name="warning" size={16} />}</small></button></div>
            <span className="rc-ordered" title={order ? `สั่งทั้งหมด ${order.ordered} รับแล้ว ${order.previous} คงเหลือ ${order.remaining}` : 'ไม่มีใบสั่ง'}>{order?.ordered ?? '—'}{order && Number(order.previous) > 0 && <small>เหลือ {order.remaining}</small>}</span>
            <label className="rc-inline-number"><span className="rc-sr-only">รับจริง {title}</span><input id={`line-${index}-inline`} type="text" inputMode="decimal" autoComplete="off" value={current.quantity_received ?? ''} disabled={readOnly}
              aria-label={`รับจริง ${title}`} aria-describedby={`line-${index}-status`} aria-invalid={entryError === index || !!lineErrors(current, kind).quantity_received}
              onFocus={() => { if (editing && editing.index !== index) dispatch({ type: 'edit', index, mode: 'inline' }); }}
              onChange={event => {
                if (rejectDecimalEntry(event, String(current.quantity_received ?? ''))) { setEntryError(index); return; }
                setEntryError(null); dispatch({ type: 'input', index, values: { quantity_received: event.target.value } });
              }} /><small>{unit}</small></label>
            <button type="button" className="rc-line-amount rc-text-action" aria-label={`ราคาและบิล ${title}`} onClick={() => setDetails(index)}>{displayLineAmount(current)}{!hasLinePrice(current) && <small>ยังไม่มีราคา</small>}</button>
          </div>
          <div className={status.status !== 'ok' || rowWarnings.length ? 'rc-ledger-detail' : 'rc-sr-only'}><span id={`line-${index}-status`} className="rc-row-status" data-status={line._aiProposal ? 'review' : status.status}>{status.label === 'ตรวจหน่วย' ? 'หน่วยไม่ตรง' : status.status !== 'ok' ? status.label : line._aiProposal ? 'รอตรวจ' : status.label}{rowWarnings.length > 0 && <span>{rowWarnings.some(warning => warning.code === 'LOW_CONFIDENCE') ? 'อ่านไม่ชัด' : 'ตรวจจากบิลก่อนใช้'}</span>}</span>{(status.status !== 'ok' || rowWarnings.length > 0) && <button type="button" className="rc-text-action" aria-label={`ตรวจ ${title}`} onClick={() => setDetails(index)}>ตรวจ ›</button>}</div>

          {line._aiProposal && <div className="rc-ai-suggestion"><span>AI: {line._aiProposal.quantity_received ?? '—'} {unit}</span>{!readOnly && <button type="button" className="rc-text-action" onClick={() => dispatch({ type: 'apply', action: 'use', indices: [index] })}>ใช้ค่า</button>}</div>}
          {entryError === index && <p role="alert" data-status="error">{decimalEntryMessage}</p>}
          {inline && lineErrors(current, kind).quantity_received && <div className="rc-inline-edit"><span role="alert">{lineErrors(current, kind).quantity_received}</span></div>}

        </li>;
      })}
    </ol>
    {editing?.mode === 'full' && <ReceivingDialog title={`แก้ ${lineTitle(editing.line, editing.index)}`} onClose={closeEdit}
      actions={<PrimaryAction onClick={() => dispatch({ type: 'save-next' })}>บันทึกและตรวจถัดไป</PrimaryAction>}>
      {guidance && <ReceivingIllustration state="review-lines" description={guidance} compact />}
      {counters}<LineFields line={editing.line} index={editing.index} kind={kind} onChange={values => dispatch({ type: 'change', values })} />
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
