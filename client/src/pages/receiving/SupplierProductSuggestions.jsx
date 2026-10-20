import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

export function SupplierProductSuggestions({ doc, user, disabled, online, onAdd }) {
  const key = doc.supplier_master_id ? `sm:${doc.supplier_master_id}` : doc.product_group_id ? `pg:${doc.product_group_id}` : '';
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key || !online) return;
    let active = true; setItems([]); setStatus('loading');
    api.supplierProducts(key, { branch_id: doc.branch_id || user.branch_id, department_id: doc.department_id || user.department_id })
      .then(rows => { if (active) { setItems(rows); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [key, online, doc.branch_id, doc.department_id, user.branch_id, user.department_id, retry]);
  if (!key || !online) return null;
  return <div className="rc-stack" aria-label="สินค้าแนะนำของร้าน">
    <p className="rc-muted">สินค้าที่ร้านนี้เคยส่ง / ชื่อย่อที่ยืนยันแล้ว · แตะเพิ่มแล้วนับเอง</p>
    {status === 'loading' && <p role="status">กำลังโหลดสินค้าแนะนำ…</p>}
    {status === 'error' && <div role="status"><p>โหลดสินค้าแนะนำไม่ได้ ยังค้นหาเพิ่มสินค้าเองได้</p><button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>โหลดสินค้าแนะนำอีกครั้ง</button></div>}
    {status === 'ready' && !items.length && <p className="rc-muted">ยังไม่มีประวัติสินค้า · ค้นหาเพิ่มสินค้าได้</p>}
    <div className="rc-search-results">{items.map(product => <button type="button" className="rc-check rc-text-action" key={product.id} disabled={disabled}
      onClick={() => onAdd({ product_id: product.id, product_name: product.name, unit_id: product.unit_id, unit_text: product.unit_name })}>
      <span>{product.name}<small>{doc.lines.some(line => Number(line.product_id) === Number(product.id)) ? 'มีในใบแล้ว · ไปช่องนับเดิม' : product.unit_name}</small></span>
    </button>)}</div>
  </div>;
}
