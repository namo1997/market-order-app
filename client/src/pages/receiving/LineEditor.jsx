import { useEffect, useState } from 'react';
import { productsAPI } from '../../api/products';
import { ListCard, NumberField, StatusPill, EmptyState } from '../../design';
import { decimalString, formatBaht, lineAmount } from './receiving-utils';
import { quantityStatus } from './receiving-status';
import { lineErrors } from './receiving-validation';
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
      {results.map((product) => <label className="rc-check" key={product.id}><input type="radio" name={`product-${line.id || line._key}`} checked={false} onChange={() => {
        onChange({ product_id: product.id, product_name: product.name, order_item_id: null,
          unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1,
          match: { source: 'manual', confidence: 1 } });
        setQuery(''); setResults([]);
      }} /><span>{product.name}<small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></span></label>)}
    </div>}
  </div>;
}

export function LineEditor({ lines, expectedItems, kind, selected, onSelect, onChange, readOnly, onAiDecision, warnings = [] }) {
  if (!lines.length) return <EmptyState title="ยังไม่มีรายการ" description="อ่านบิลหรือเพิ่มจากตัวเลือก" icon="list" />;
  return <div className="rc-stack">{lines.map((line, index) => {
    let amount = '—';
    try { amount = formatBaht(lineAmount(line)); } catch { /* สถานะตัวเลขแสดงที่ pill */ }
    const errors = lineErrors(line, kind);
    const state = quantityStatus(line, expectedItems, lines, kind);
    const patch = (values) => onChange(index, values);
    const numeric = (key, label, unit) => <NumberField id={`line-${index}-${key}`} error={readOnly ? undefined : errors[key]} label={label} unit={unit} value={line[key] ?? ''} maxLength={18} onValueChange={(value) => {
      const changes = { [key]: value };
      if (key === 'quantity_billed' || key === 'unit_price') {
        try { changes.amount = decimalString(lineAmount({ ...line, ...changes, amount: null })); }
        catch { changes.amount = ''; }
      }
      patch(changes);
    }} />;
    return <ListCard key={line.id || line._key || index} title={<label className="rc-choice"><input type="radio" name="line" checked={selected === index} onChange={() => onSelect(index)} />{line.product_name || line.bill_text || 'รายการใหม่'}</label>}
      subtitle={line._aiProposal ? 'ตรวจจากบิลก่อนใช้' : undefined} trailing={<StatusPill status={line._aiProposal ? 'review' : state.status}>{line._aiProposal ? 'AI เสนอ' : state.label}</StatusPill>}>
      <div className="rc-line-ledger"><span>รับจริง</span><strong>{line.quantity_received || '0'} {line.unit_text}</strong><span>ยอดบรรทัด</span><strong>{amount} บาท</strong></div>
      {state.status !== 'ok' && <p className="rc-line-warning">{state.label}</p>}
      {warnings.filter(warning => warning.line_no === (line.line_no || index + 1) || (!warning.line_no && line._aiProposal)).map((warning, i) => <p className="rc-line-warning" key={i}>{warningText(warning)}</p>)}
      {line._aiProposal && !readOnly && selected === index && <fieldset className="rc-ai-actions"><legend>ตรวจข้อเสนอ AI</legend>
        {['use', 'edit', 'skip'].map((decision, i) => <label key={decision} className="rc-check"><input type="radio" name={`ai-${line.id || index}`} value={decision} checked={false} onChange={() => onAiDecision(index, decision)} /><span>{['ใช้', 'แก้', 'ข้าม'][i]}</span></label>)}
      </fieldset>}
      {selected === index ? <fieldset disabled={readOnly} className="rc-stack">
        <label>ชื่อในบิล<input value={line.bill_text || ''} maxLength={500} onChange={(event) => patch({ bill_text: event.target.value })} /></label>
        {!readOnly && <ProductPicker line={line} onChange={patch} id={`line-${index}-product_id`} error={errors.product_id} />}
        <label>หน่วย<input value={line.unit_text || ''} maxLength={100} onChange={(event) => patch({ unit_text: event.target.value, unit_id: null })} /></label>
        {numeric('quantity_received', 'รับจริง', line.unit_text || 'หน่วย')}
        <details><summary>ราคาและบิล</summary><div className="rc-stack">
          {numeric('quantity_billed', 'จำนวนในบิล')}{numeric('unit_price', 'ราคาต่อหน่วย', 'บาท')}{numeric('amount', 'ยอดในบิล', 'บาท')}
        </div></details>
      </fieldset> : null}
    </ListCard>;
  })}</div>;
}
