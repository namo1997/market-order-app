import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

export const SUPPLIER_HISTORY_HELPER = 'แตะสินค้าที่มาส่ง หรือพิมพ์ค้นหา';

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
  // A disabled fetch is also unavailable: the sheet must not show an endless "loading" line (device test 2026-10-24).
  return { available: active, items, status, retry: () => setRetry(value => value + 1) };
}

// Rendered full-width inside the product search sheet while the query is empty.
// `source` lets the sheet share one fetch with its search-result badges.
export function SupplierProductSuggestions({ doc, user, disabled, online, onAdd, source, addedIds = [], onRemove }) {
  const own = useSupplierProducts(doc, user, online, !source);
  const { available, items, status, retry } = source || own;
  const added = new Set(addedIds.map(Number));
  if (!available) return null;
  return <div className="rc-stack ra-history" aria-label="สินค้าแนะนำของร้าน">
    {status === 'loading' && <p role="status" className="rc-muted">กำลังโหลดสินค้าของร้านนี้…</p>}
    {status === 'ready' && !items.length && <p role="status" className="rc-muted">ร้านนี้ยังไม่มีประวัติ · พิมพ์ชื่อสินค้าเพื่อค้นหา</p>}
    {status === 'error' && <div role="status"><p>โหลดสินค้าที่เคยส่งไม่ได้ ยังค้นหาเองได้</p><button type="button" disabled={disabled} onClick={retry}>โหลดสินค้าที่เคยส่งอีกครั้ง</button></div>}
    {/* Owner 2026-10-24 (ข้อ 1): the shop's goods are a checklist — tap each item that came; tap again to take it out. */}
    <div className="rc-search-results">{items.map(product => { const justAdded = added.has(Number(product.id)); return <button type="button" className="rc-option-card rc-product-option" key={product.id} disabled={disabled}
      aria-pressed={onRemove ? justAdded : undefined} data-added={justAdded || undefined}
      onClick={() => justAdded && onRemove ? onRemove(Number(product.id)) : onAdd({ product_id: product.id, product_name: product.name, unit_id: product.unit_id, unit_text: product.unit_name })}>
      <span className="rc-product-identity"><span>{product.name}</span><small>{product.unit_name}</small></span>{justAdded ? <small className="ra-search-added">✓ เพิ่มแล้ว</small> : doc.lines.some(line => Number(line.product_id) === Number(product.id)) && <small>มีในใบแล้ว · ไปช่องนับเดิม</small>}
    </button>; })}</div>
  </div>;
}
