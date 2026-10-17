import { useEffect, useState } from 'react';
import { productsAPI } from '../../api/products';

export function ProductPicker({ line, onChange, id, error, expectedItems = [] }) {
  const orderedItems = expectedItems || [];
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
  const choose = (product, item) => {
    onChange({ product_id: product.id, product_name: product.name, order_item_id: item?.order_item_id || null,
      unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1,
      remember_alias: true, match: { source: 'manual', confidence: 1 } });
    setQuery(''); setResults([]);
  };
  return <div className="rc-stack">
    {!query.trim() && orderedItems.length > 0 && <div className="rc-search-results"><p>รายการที่สั่ง</p>{orderedItems.map(item =>
      <button type="button" className="rc-text-action" key={item.order_item_id} onClick={() => choose({ id: item.product_id, name: item.product_name, unit_name: item.unit_name, unit_id: item.unit_id }, item)}>{item.product_name}</button>)}</div>}
    <label htmlFor={id}>ค้นหาสินค้า<input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} type="search" value={query} placeholder={line.product_name || 'ชื่อสินค้า'} maxLength={100}
      onChange={(event) => { setQuery(event.target.value); setResults([]); setStatus(event.target.value.trim() ? 'กำลังค้นหา' : ''); }} /></label>
    {error && <p id={`${id}-error`} className="sg-field-hint" data-error="true">{error}</p>}
    {query.trim() && <div className="rc-search-results"><p role="status" className="rc-muted">{status}</p>
      {results.map((product) => <button type="button" className="rc-check rc-text-action" key={product.id} onClick={() => {
        choose(product);
      }}><span>{product.name}<small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></span></button>)}
    </div>}
  </div>;
}
