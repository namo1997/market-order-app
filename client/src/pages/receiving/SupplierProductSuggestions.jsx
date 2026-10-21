import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

export const SUPPLIER_HISTORY_HELPER = 'ค้นหาหรือเลือกจากสินค้าที่ร้านนี้เคยส่ง';

// Identity-only history (id, name, unit): safe to show during a blind count.
export function useSupplierProducts(doc, user, online, enabled = true) {
  const key = doc.supplier_master_id ? `sm:${doc.supplier_master_id}` : doc.product_group_id ? `pg:${doc.product_group_id}` : '';
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  const active = Boolean(key && online && enabled);
  useEffect(() => {
    if (!active) return;
    let current = true; setItems([]); setStatus('loading');
    api.supplierProducts(key, { branch_id: doc.branch_id || user?.branch_id, department_id: doc.department_id || user?.department_id })
      .then(rows => { if (current) { setItems(rows); setStatus('ready'); } })
      .catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [key, active, doc.branch_id, doc.department_id, user?.branch_id, user?.department_id, retry]);
  return { available: Boolean(key && online), items, status, retry: () => setRetry(value => value + 1) };
}

// Rendered full-width inside the product search sheet while the query is empty.
// `source` lets the sheet share one fetch with its search-result badges.
export function SupplierProductSuggestions({ doc, user, disabled, online, onAdd, source }) {
  const own = useSupplierProducts(doc, user, online, !source);
  const { available, items, status, retry } = source || own;
  if (!available) return null;
  return <div className="rc-stack ra-history" aria-label="สินค้าแนะนำของร้าน">
    {status === 'loading' && <p role="status" className="rc-muted">กำลังโหลดสินค้าที่ร้านนี้เคยส่ง…</p>}
    {status === 'error' && <div role="status"><p>โหลดสินค้าที่เคยส่งไม่ได้ ยังค้นหาเองได้</p><button type="button" disabled={disabled} onClick={retry}>โหลดสินค้าที่เคยส่งอีกครั้ง</button></div>}
    <div className="rc-search-results">{items.map(product => <button type="button" className="rc-option-card rc-product-option" key={product.id} disabled={disabled}
      onClick={() => onAdd({ product_id: product.id, product_name: product.name, unit_id: product.unit_id, unit_text: product.unit_name })}>
      <span className="rc-product-identity"><span>{product.name}</span><small>{product.unit_name}</small></span>{doc.lines.some(line => Number(line.product_id) === Number(product.id)) && <small>มีในใบแล้ว · ไปช่องนับเดิม</small>}
    </button>)}</div>
  </div>;
}
