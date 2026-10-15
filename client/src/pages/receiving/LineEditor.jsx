import { useEffect, useState } from 'react';
import { productsAPI } from '../../api/products';
import { decimalString, formatBaht, lineAmount, warningText } from './receiving-utils';

function ProductPicker({ line, onChange }) {
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
        setStatus(items?.length ? 'เลือกสินค้าจากผลค้นหา' : 'ไม่พบสินค้า ลองค้นด้วยคำอื่น');
      } catch {
        if (active) { setResults([]); setStatus('ค้นหาไม่ได้ ตรวจอินเทอร์เน็ตแล้วพิมพ์ใหม่'); }
      }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className="rc-product-picker">
    <p className={line.product_id ? 'rc-matched' : 'rc-warning'}>{line.product_name || 'ยังไม่ได้เลือกสินค้า'}</p>
    {line.order_item_id && <span className="rc-muted">ผูกใบสั่งรายการ #{line.order_item_id}</span>}
    <label>ค้นหาสินค้า
      <input type="search" value={query} placeholder="พิมพ์ชื่อสินค้า…" maxLength={100}
        onChange={(event) => { setQuery(event.target.value); setResults([]); setStatus('กำลังค้นหา…'); }} />
    </label>
    {query.trim() && <div className="rc-search-results"><p role="status" className="rc-muted">{status}</p>
      {results.map((product) => <button key={product.id} type="button" onClick={() => {
        onChange({ product_id: product.id, product_name: product.name, order_item_id: null,
          unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1,
          match: { source: 'manual', confidence: 1 } });
        setQuery(''); setResults([]);
      }}>{product.name}<small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></button>)}
      <p className="rc-muted">เปลี่ยนสินค้าจะยกเลิกการผูกใบสั่งเดิม เพื่อป้องกันรับผิดรายการ</p>
    </div>}
  </div>;
}

export function LineEditor({ lines, warnings = [], onChange, onDelete, readOnly }) {
  return <div className="rc-lines">{lines.map((line, index) => {
    let amount = '—';
    try { amount = formatBaht(lineAmount(line)); } catch { /* แสดงปัญหาตอนบันทึก */ }
    const patch = (values) => onChange(index, values);
    const numeric = (key, label) => <label>{label}<input inputMode="decimal" value={line[key] ?? ''}
      placeholder="0.00" maxLength={18} onChange={(event) => {
        const changes = { [key]: event.target.value };
        // ยอดจาก OCR เก็บไว้จนคนแก้จำนวนในบิลหรือราคาเอง
        if (key === 'quantity_billed' || key === 'unit_price') {
          try { changes.amount = decimalString(lineAmount({ ...line, ...changes, amount: null })); }
          catch { changes.amount = ''; }
        }
        patch(changes);
      }} /></label>;
    return <article key={line.id || line._key} className="rc-line-card">
      <div className="rc-section-heading"><h3><span className="rc-line-number">{index + 1}</span>{line.product_name || line.bill_text || 'รายการใหม่'}</h3>
        {!readOnly && <button type="button" className="rc-text-danger" onClick={() => onDelete(index)}>ลบรายการ</button>}</div>
      <fieldset disabled={readOnly}>
        <label>ชื่อในบิล<input value={line.bill_text || ''} maxLength={500} onChange={(event) => patch({ bill_text: event.target.value })} /></label>
        {readOnly ? <p>{line.product_name || 'รายการไม่ผูกสินค้า'}</p> : <ProductPicker line={line} onChange={patch} />}
        <div className="rc-line-grid">
          <label>หน่วย<input value={line.unit_text || ''} maxLength={100} onChange={(event) => patch({ unit_text: event.target.value, unit_id: null })} /></label>
          {numeric('quantity_billed', 'จำนวนในบิล')}
          {numeric('quantity_received', 'จำนวนรับจริง')}
          {numeric('unit_price', 'ราคา / หน่วย (บาท)')}
          {numeric('amount', 'ยอดในบิล (บาท)')}
          <div className="rc-line-total"><span>ยอดรายการ</span><strong>{amount}</strong></div>
        </div>
        {!readOnly && <p className="rc-muted">กรอกหน่วยและจำนวนให้ตรงกับสินค้าที่เลือก หากใช้หน่วยบรรจุให้ตรวจการแปลงหน่วยก่อนยืนยัน</p>}
      </fieldset>
      {warnings.filter((warning) => Number(warning.line_no) === index + 1).map((warning, i) => <p key={i} className="rc-warning">{warningText(warning)}</p>)}
    </article>;
  })}</div>;
}
