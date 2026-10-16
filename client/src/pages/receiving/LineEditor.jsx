import { useEffect, useState } from 'react';
import { productsAPI } from '../../api/products';
import { NumberField, EmptyState, PrimaryAction, Icon } from '../../design';
import { decimalString, formatBaht, lineAmount } from './receiving-utils';
import { quantityStatus } from './receiving-status';
import { lineErrors } from './receiving-validation';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { orderComparison, reviewCounters, pendingReviewIndices, decisionLabels, lineTitle } from './line-review-state';
import { warningText } from './receiving-utils';

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

export function LineEditor({ lines, expectedItems, kind, onSelect, readOnly, warnings = [], review, guidance, dispatch, onViewBill, onSelectionChange, chosen = [] }) {
  const [filter, setFilter] = useState('needs');
  const editing = review.editing;
  const counts = reviewCounters(lines, expectedItems, kind);
  const needs = new Set(pendingReviewIndices(lines));
  const chosenIndices = chosen.filter(index => lines[index]);
  const choose = index => {
    const next = chosenIndices.includes(index) ? chosenIndices.filter(value => value !== index) : [...chosenIndices, index];
    onSelectionChange(next); onSelect(index);
  };
  const clearChosen = () => { onSelectionChange([]); };
  const finish = () => { dispatch({ type: 'confirm' }); clearChosen(); };
  const edit = (index, mode) => { onSelect(index); dispatch({ type: 'edit', index, mode }); };
  const closeEdit = () => dispatch({ type: 'cancel' });
  const counters = <p className="rc-review-counts" role="status"><span>{counts.total ? `ตรวจแล้ว ${counts.reviewed}/${counts.total}` : 'ไม่มีข้อเสนอ AI ค้าง'}</span><span>ขาด {counts.short} · เกิน {counts.over}</span></p>;
  if (!lines.length) return <EmptyState title="ยังไม่มีรายการ" description="อ่านบิลหรือเพิ่มจากตัวเลือก" icon="list" />;
  return <section className="rc-review-table" aria-label="ตรวจรายการ">
    <div className="rc-review-toolbar">
      {counters}
      <div className="rc-review-filters" role="group" aria-label="กรองรายการ">
        <button type="button" className="rc-text-action" aria-pressed={filter === 'needs'} onClick={() => setFilter('needs')}>ค้างตรวจ {needs.size}</button>
        <button type="button" className="rc-text-action" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ทั้งหมด</button>
        <button type="button" className="rc-text-action" onClick={onViewBill}>ดูบิล</button>
      </div>
      {!!warnings.length && <p className="rc-muted">มีคำเตือน {new Set(warnings.filter(warning => warning.line_no).map(warning => Number(warning.line_no))).size} รายการ — แตะชื่อดูเหตุผล</p>}
      {review.message && <div className="rc-undo" role="status"><span>{review.message}</span>{!!review.history.length && <button type="button" className="rc-text-action" disabled={!!editing} onClick={() => { dispatch({ type: 'undo' }); clearChosen(); }}>ย้อนกลับ</button>}</div>}
      {review.error && !review.pending && !editing && <p role="alert">{review.error}</p>}
    </div>
    <div className="rc-compact-head" aria-hidden="true"><span /><span>สินค้า</span><span>สั่ง</span><span>รับจริง</span><span>สถานะ</span></div>
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
        return <li key={line.id || line._key || index} className="rc-compact-item" data-line-index={index}>
          <div className="rc-compact-row">
            {!readOnly ? <label className="rc-bulk-check"><input id={`line-${index}-review`} type="checkbox" checked={chosenIndices.includes(index)} onChange={() => choose(index)} aria-label={`เลือก ${title}`} /></label> : <span />}
            <button type="button" className="rc-line-name rc-text-action" onClick={() => edit(index, 'full')} disabled={readOnly} aria-label={`แก้ ${title}`}><strong>{title}</strong><small>{unit}{line._aiProposal ? ' AI เสนอ' : line._aiReviewed ? ' ตรวจแล้ว' : ''}{rowWarnings.length > 0 && <Icon name="warning" size={16} />}</small></button>
            <span className="rc-ordered" title={order ? `สั่งทั้งหมด ${order.ordered} รับแล้ว ${order.previous} คงเหลือ ${order.remaining}` : 'ไม่มีใบสั่ง'}>{order?.ordered ?? '—'}{order && Number(order.previous) > 0 && <small>เหลือ {order.remaining}</small>}</span>
            <label className="rc-inline-number"><span className="rc-sr-only">รับจริง {title}</span><input id={`line-${index}-inline`} type="text" inputMode="decimal" autoComplete="off" value={current.quantity_received ?? ''} disabled={readOnly || (!!editing && editing.index !== index)}
              aria-label={`รับจริง ${title}`} aria-describedby={`line-${index}-status`} aria-invalid={!!lineErrors(current, kind).quantity_received}
              onFocus={() => { if (!editing) edit(index, 'inline'); }}
              onChange={event => dispatch({ type: 'input', index, values: { quantity_received: event.target.value } })} /></label>
            <span id={`line-${index}-status`} className="rc-row-status" data-status={status.status}>{line._aiProposal && !inline && !readOnly ? <><span>รอตรวจ</span><button type="button" className="rc-text-action" aria-label={`ใช้ AI ${title}`} disabled={!!editing} onClick={() => dispatch({ type: 'apply', action: 'use', indices: [index] })}>ใช้ AI</button></> : status.label}</span>
          </div>
          {inline && <div className="rc-inline-edit"><span role="alert">{lineErrors(current, kind).quantity_received || review.error}</span><button type="button" className="rc-text-action" onClick={closeEdit}>ยกเลิก</button><button type="button" className="rc-text-action" onClick={() => dispatch({ type: 'save' })}>บันทึกรายการ</button></div>}

        </li>;
      })}
    </ol>
    {!needs.size && filter === 'needs' && <p className="rc-muted">ตรวจครบแล้ว ดูทุกรายการได้ที่ “ทั้งหมด”</p>}
    {editing?.mode === 'full' && <ReceivingDialog title={`แก้ ${lineTitle(editing.line, editing.index)}`} onClose={closeEdit}
      actions={<PrimaryAction onClick={() => dispatch({ type: 'save' })}>บันทึกรายการ</PrimaryAction>}>
      {guidance && <ReceivingIllustration state="review-lines" description={guidance} compact />}
      {counters}<LineFields line={editing.line} index={editing.index} kind={kind} onChange={values => dispatch({ type: 'change', values })} />
      <p>สั่งทั้งหมด {orderComparison(editing.line, expectedItems, lines)?.ordered ?? '—'} · รับก่อนหน้า {orderComparison(editing.line, expectedItems, lines)?.previous ?? '—'} · ครั้งนี้ {editing.line.quantity_received || '0'} {editing.line.unit_text}</p>
      <p>ยอดบรรทัด {(() => { try { return formatBaht(lineAmount(editing.line)); } catch { return '—'; } })()} บาท</p>
      {warnings.filter(warning => Number(warning.line_no) === Number(editing.line.line_no || editing.index + 1)).map((warning, i) => <p key={i}>{warningText(warning)}</p>)}
      {review.error && <p role="alert">{review.error}</p>}
      <button type="button" className="rc-text-action" onClick={onViewBill}>ดูบิล</button>
    </ReceivingDialog>}
    {review.pending && <ReceivingDialog title={`${decisionLabels[review.pending.action]} ${review.pending.rows.length} รายการ`} onClose={() => dispatch({ type: 'dismiss' })}
      actions={<PrimaryAction onClick={finish}>ยืนยันค่าที่เลือก</PrimaryAction>}>
      <p>เปลี่ยนจำนวนรับจริงในร่าง ยังไม่รับเข้าคลัง</p>
      <ul className="rc-review-lines">{review.pending.rows.map(row => <li key={row.index}><span>{row.title}</span><strong>{row.before} → {row.after} {row.unit}</strong></li>)}</ul>
      <p>กดย้อนกลับได้หลังทำรายการ</p>
    </ReceivingDialog>}
  </section>;
}
