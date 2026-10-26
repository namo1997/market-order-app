import { normalizeReceivingUnit } from './receiving-status';
import { packTotal, perUnitPrice, printedPackSize } from './count-unit';
import { useContext, useEffect, useState } from 'react';
import { ReceivingProductScope } from './ReceivingProductScope';
import { receivingDocumentsAPI } from '../../api/receiving-documents';

// variant="sheet": the focused add-product search. The input is pinned, results
// are a full-width vertical list, and `emptyState` (supplier history) fills the
// space while nothing is typed. Default variant is the inline row picker.
export function ProductPicker({ line, onChange, id, error, expectedItems = [], disabled = false, existingLines = [], onExisting, branchId, departmentId, variant = 'inline', helper = '', historyIds = [], emptyState = null, addedIds = [], onRemove, suggestFrom = '' }) {
  const scope = useContext(ReceivingProductScope);
  branchId ??= scope.branchId;
  departmentId ??= scope.departmentId;
  const orderedItems = expectedItems || [];
  const sheet = variant === 'sheet';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  // Real-bill test 2026-10-24 (owner: "ตรงนี้จัด ux ui ใหม่"): an unmatched bill line searches its own bill
  // text once, so the likely products are already listed under the field before anyone types.
  const [suggested, setSuggested] = useState([]);
  const seed = String(suggestFrom || '').trim().slice(0, 100);
  useEffect(() => {
    if (!seed) { setSuggested([]); return; }
    let active = true;
    receivingDocumentsAPI.products({ q: seed, branch_id: branchId, department_id: departmentId })
      .then(items => { if (active) setSuggested(Array.isArray(items) ? items.slice(0, 5) : []); })
      .catch(() => { if (active) setSuggested([]); });
    return () => { active = false; };
  }, [seed, branchId, departmentId]);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const items = await receivingDocumentsAPI.products({ q: query.trim(), branch_id: branchId, department_id: departmentId });
        if (!active) return;
        setResults(Array.isArray(items) ? items.slice(0, 20) : []);
        setStatus(items?.length ? '' : 'ไม่พบสินค้า');
      } catch { if (active) { setResults([]); setStatus('ค้นหาไม่สำเร็จ · ลองอีกครั้ง'); } }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, branchId, departmentId]);
  // The sheet is a modal <dialog>: it only accepts focus once it is open, so wait one tick.
  useEffect(() => {
    if (!sheet) return;
    const timer = setTimeout(() => document.getElementById(id)?.focus?.({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [sheet, id]);
  // Owner 2026-10-24 (ข้อ 1): the add sheet stays open for the next item; keep the keyboard on the search box.
  const refocus = () => { if (sheet) setTimeout(() => document.getElementById(id)?.focus?.({ preventScroll: true }), 0); };
  const added = new Set(addedIds.map(Number));
  const choose = (product, item) => {
    if (sheet && onRemove && added.has(Number(product.id))) { onRemove(Number(product.id)); setQuery(''); setResults([]); refocus(); return; }
    const existing = existingLines.find(row => Number(row.product_id) === Number(product.id));
    if (existing) { onExisting?.(existing); setQuery(''); setResults([]); return; }
    // UX test 2026-10-23: the bill said 8.3 กก. and picking ใบกระเพรา (มัด) relabelled the bill as 8.3 มัด. Keep the
    // bill's unit beside the product unit so the row asks to check the unit instead of reporting a shortage.
    const billUnit = line?._billUnit || line?.unit_text || '';
    const billHasQuantity = line?.quantity_billed != null && line.quantity_billed !== '';
    const unitDiffers = billHasQuantity && billUnit && normalizeReceivingUnit(billUnit) !== normalizeReceivingUnit(product.unit_name || '');
    // Owner 2026-10-26: a bill row printing "1x24" sold in ลัง, counted in ลัง before it had a product, becomes the
    // product's unit (4 ลัง → 96 กระป๋อง) instead of asking to check the unit; the server restates the count.
    const pack = unitDiffers && !line?.product_id && line?.counted_quantity != null ? printedPackSize(line?.bill_text) : null;
    onChange({ product_id: product.id, product_name: product.name, order_item_id: item?.order_item_id || null,
      unit_text: product.unit_name || '', unit_id: product.unit_id || null, unit_multiplier: 1, _billUnit: unitDiffers && !pack ? billUnit : null,
      ...(pack ? { quantity_billed: packTotal(line.quantity_billed, pack), quantity_received: packTotal(line.quantity_received ?? line.counted_quantity, pack),
        counted_quantity: packTotal(line.counted_quantity, pack), unit_price: perUnitPrice(line.unit_price, pack),
        count_unit: { unit: billUnit, size: pack }, _packFromBill: true } : {}),
      remember_alias: false, match: { source: 'manual', confidence: 1 } });
    setQuery(''); setResults([]); refocus();
  };
  const inDocument = product => existingLines.some(row => Number(row.product_id) === Number(product.id));
  const search = <label htmlFor={id}>ค้นหาสินค้า<input disabled={disabled} id={id} aria-invalid={error ? true : undefined} aria-describedby={sheet ? `${id}-help` : error ? `${id}-error` : undefined} type="search" value={query} onFocus={sheet ? undefined : event => event.target.closest?.('article')?.scrollIntoView?.({ block: 'start', behavior: 'instant' })} placeholder={line.product_name || 'ชื่อ / รหัส / บาร์โค้ด / QR'} maxLength={100}
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
            const justAdded = added.has(Number(product.id));
            const present = !justAdded && inDocument(product);
            const history = known.has(Number(product.id));
            return <li key={product.id}><button type="button" className="rc-option-card rc-product-option ra-search-row" disabled={disabled} aria-describedby={`${id}-meta-${product.id}`}
              aria-label={justAdded ? `${product.name} · เพิ่มแล้ว · แตะเพื่อเอาออก` : present ? `${product.name} · มีในใบแล้ว · ไปช่องนับเดิม` : product.name} aria-pressed={onRemove ? justAdded : undefined} data-added={justAdded || undefined} onClick={() => choose(product)}>
              <span className="rc-product-identity"><span className="ra-search-name">{product.name}</span><small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></span>
              <span id={`${id}-meta-${product.id}`} className="ra-search-meta">{justAdded ? <small className="ra-search-added">✓ เพิ่มแล้ว</small> : <>{history && <small className="ra-search-badge">ของร้านนี้</small>}{present && <small className="ra-search-present">มีในใบแล้ว · ไปช่องนับเดิม</small>}</>}</span>
            </button></li>;
          })}</ul></>}
      </div>
    </div>;
  }
  // Ordered items first, then products that the bill text contains; one full-width list, tap = choose.
  const ordered = query.trim() ? [] : orderedItems.map(item => ({ key: `order-${item.order_item_id}`, item,
    product: { id: item.product_id, name: item.product_name, unit_name: item.unit_name, unit_id: item.unit_id } }));
  const orderedIds = new Set(ordered.map(row => Number(row.product.id)));
  const picks = query.trim()
    ? results.map(product => ({ key: `found-${product.id}`, product }))
    : [...ordered, ...suggested.filter(product => !orderedIds.has(Number(product.id))).map(product => ({ key: `seed-${product.id}`, product }))];
  return <div className="rc-stack ra-product-picker" data-inline="true">
    {line.match?.source === 'ai' && <p className="ra-provenance">ข้อเสนอจาก AI: {line.suggested_product_name || line.product_name || 'ยังไม่ระบุสินค้า'} · เลือกสินค้าด้านล่างเพื่อยืนยันด้วยตนเอง</p>}
    {line.product_name && <p>สินค้าที่เลือก: {line.product_name} · {line.match?.source === 'manual' ? 'คนเลือกแล้ว' : 'รอตรวจการจับคู่'}</p>}
    {search}
    {error && <p id={`${id}-error`} className="sg-field-hint" data-error="true">{error}</p>}
    {query.trim() && status && <p role="status" className="rc-muted">{status}</p>}
    {picks.length > 0 && <ul className="ra-pick-list" aria-label={query.trim() ? 'ผลค้นหาสินค้า' : 'สินค้าที่น่าจะใช่'}>{picks.map(({ key, product, item }) => {
      const present = !item && inDocument(product);
      return <li key={key}><button type="button" className="rc-option-card ra-pick-row" disabled={disabled}
        aria-label={present ? `${product.name} · มีในใบแล้ว · ไปช่องนับเดิม` : product.name} onClick={() => choose(product, item)}>
        <span className="ra-pick-name">{product.name}</span>
        <small className="ra-pick-meta">{item ? 'ที่สั่ง' : present ? 'มีในใบแล้ว' : product.unit_name || 'ไม่ระบุหน่วย'}</small>
      </button></li>;
    })}</ul>}
  </div>;
}
