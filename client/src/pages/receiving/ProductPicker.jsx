import { useContext, useEffect, useState } from 'react';
import { ReceivingProductScope } from './ReceivingProductScope';
import { receivingDocumentsAPI } from '../../api/receiving-documents';

// variant="sheet": the focused add-product search. The input is pinned, results
// are a full-width vertical list, and `emptyState` (supplier history) fills the
// space while nothing is typed. Default variant is the inline row picker.
export function ProductPicker({ line, onChange, id, error, expectedItems = [], disabled = false, existingLines = [], onExisting, branchId, departmentId, variant = 'inline', helper = '', historyIds = [], emptyState = null }) {
  const scope = useContext(ReceivingProductScope);
  branchId ??= scope.branchId;
  departmentId ??= scope.departmentId;
  const orderedItems = expectedItems || [];
  const sheet = variant === 'sheet';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const items = await receivingDocumentsAPI.products({ q: query.trim(), branch_id: branchId, department_id: departmentId });
        if (!active) return;
        setResults(Array.isArray(items) ? items.slice(0, 20) : []);
        setStatus(items?.length ? '' : 'ไม่พบสินค้า');
      } catch { if (active) { setResults([]); setStatus('ค้นหาไม่ได้ ลองพิมพ์ใหม่'); } }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, branchId, departmentId]);
  // The sheet is a modal <dialog>: it only accepts focus once it is open, so wait one tick.
  useEffect(() => {
    if (!sheet) return;
    const timer = setTimeout(() => document.getElementById(id)?.focus?.({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [sheet, id]);
  const choose = (product, item) => {
    const existing = existingLines.find(row => Number(row.product_id) === Number(product.id));
    if (existing) { onExisting?.(existing); setQuery(''); setResults([]); return; }
    onChange({ product_id: product.id, product_name: product.name, order_item_id: item?.order_item_id || null,
      unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1,
      remember_alias: false, match: { source: 'manual', confidence: 1 } });
    setQuery(''); setResults([]);
  };
  const inDocument = product => existingLines.some(row => Number(row.product_id) === Number(product.id));
  const search = <label htmlFor={id}>ค้นหาสินค้า<input disabled={disabled} id={id} aria-invalid={error ? true : undefined} aria-describedby={sheet ? `${id}-help` : error ? `${id}-error` : undefined} type="search" value={query} placeholder={line.product_name || 'ชื่อ / รหัส / บาร์โค้ด / QR'} maxLength={100}
    {...(sheet ? { enterKeyHint: 'search', autoComplete: 'off' } : {})}
    onChange={(event) => { setQuery(event.target.value); setResults([]); setStatus(event.target.value.trim() ? 'กำลังค้นหา' : ''); }} /></label>;
  if (sheet) {
    const typed = query.trim();
    const known = new Set(historyIds.map(Number));
    // Supplier history first so the shop's usual goods are never buried by the 20-row cap.
    const rows = [...results].sort((a, b) => Number(known.has(Number(b.id))) - Number(known.has(Number(a.id))));
    return <div className="ra-search-panel ra-product-picker">
      <div className="ra-search-pinned">{search}<p id={`${id}-help`} className="ra-search-helper">{helper}</p></div>
      <div className="ra-search-scroll">
        {!typed ? emptyState : <>
          <p role="status" className="rc-muted ra-search-status">{status === 'ไม่พบสินค้า' ? `ไม่พบ “${typed}” · เพิ่มเป็นสินค้าใหม่ได้ที่หน้าร้านค้า` : status}</p>
          <ul className="ra-search-list" aria-label="ผลค้นหาสินค้า">{rows.map(product => {
            const present = inDocument(product);
            const history = known.has(Number(product.id));
            return <li key={product.id}><button type="button" className="rc-option-card rc-product-option ra-search-row" disabled={disabled} aria-describedby={`${id}-meta-${product.id}`}
              aria-label={present ? `${product.name} · มีในใบแล้ว · ไปช่องนับเดิม` : product.name} onClick={() => choose(product)}>
              <span className="rc-product-identity"><span className="ra-search-name">{product.name}</span><small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></span>
              <span id={`${id}-meta-${product.id}`} className="ra-search-meta">{history && <small className="ra-search-badge">เคยส่ง</small>}{present && <small className="ra-search-present">มีในใบแล้ว · ไปช่องนับเดิม</small>}</span>
            </button></li>;
          })}</ul></>}
      </div>
    </div>;
  }
  return <div className="rc-stack ra-product-picker">
    {line.match?.source === 'ai' && <p className="ra-provenance">ข้อเสนอจาก AI: {line.suggested_product_name || line.product_name || 'ยังไม่ระบุสินค้า'} · เลือกสินค้าด้านล่างเพื่อยืนยันด้วยตนเอง</p>}
    {line.product_name && <p>สินค้าที่เลือก: {line.product_name} · {line.match?.source === 'manual' ? 'คนเลือกแล้ว' : 'รอตรวจการจับคู่'}</p>}
    {!query.trim() && orderedItems.length > 0 && <div className="rc-search-results"><p>รายการที่สั่ง</p>{orderedItems.map(item =>
      <button type="button" className="rc-text-action" disabled={disabled} key={item.order_item_id} onClick={() => choose({ id: item.product_id, name: item.product_name, unit_name: item.unit_name, unit_id: item.unit_id }, item)}>{item.product_name}</button>)}</div>}
    {search}
    {error && <p id={`${id}-error`} className="sg-field-hint" data-error="true">{error}</p>}
    {query.trim() && <div className="rc-search-results"><p role="status" className="rc-muted">{status}</p>
      {results.map((product) => <button type="button" className="rc-check rc-text-action" disabled={disabled} key={product.id} aria-label={inDocument(product) ? `${product.name} · มีในใบแล้ว · ไปช่องนับเดิม` : product.name} onClick={() => {
        choose(product);
      }}><span>{product.name}<small>{inDocument(product) ? 'มีในใบแล้ว · ไปช่องนับเดิม' : product.unit_name || 'ไม่ระบุหน่วย'}</small></span></button>)}
    </div>}
  </div>;
}
