import { useState } from 'react';
import { Icon } from '../../design';
import { expectedQuantityStatus } from './receiving-status';
import { OPTIONAL_RECEIVING_NOTE, hasPendingQuantity, queueStatus, shopStatusLabel, shortShopName, sortShops } from './receiving-queue';

const PREVIEW_ITEMS = 3;
// Owner 2026-11-27 "ขอจัดใหม่หน่อย ui": one line per shop (pick mark, short name, status chip,
// count); the chosen shop opens its items in place and carries its own secondary actions.
// No instruction sentence, no repeated per-card notes, no duplicate shop title/illustration.
export function ShopWorkspace({ groups, current, selectedKey, waiting, onChoose, onFollowup, busy, followupEnabled = true, referenceDate, noBillDisabled = false, onNoBill }) {
  const [expanded, setExpanded] = useState('');
  const [closedDetails, setClosedDetails] = useState('');
  const states = groups.filter(group => !group.receipt_summary).flatMap(group => group.items.filter(item => item.has_pending === undefined).map(expectedQuantityStatus));
  const short = groups.reduce((sum, group) => sum + (group.receipt_summary?.short || 0), 0) + states.filter(state => state.label.startsWith('ขาด')).length;
  const over = groups.reduce((sum, group) => sum + (group.receipt_summary?.over || 0), 0) + states.filter(state => state.label.startsWith('เกิน')).length;
  const shops = sortShops(groups.filter(group => group.items.some(hasPendingQuantity)), referenceDate);
  return <section className="rc-shop-workspace rc-stack" aria-label="คิวรับสินค้าทุกร้าน">
    <div className="rc-morning-metrics" role="status">
      <div><Icon name="box" /><span>รอรับ<strong>{waiting} รายการ</strong></span></div>
      <div data-status={short ? 'review' : undefined}><span>ขาด<strong>{short} รายการ</strong></span></div>
      <div data-status={over ? 'error' : undefined}><span>เกิน<strong>{over} รายการ</strong></span></div>
    </div>
    {shops.some(group => group.receiving_optional) && <p className="rc-queue-optional">{OPTIONAL_RECEIVING_NOTE}</p>}
    <div className="rc-queue-grid">{shops.map(group => {
      const picked = selectedKey === group.supplier_key;
      const showDetails = current?.supplier_key === group.supplier_key && closedDetails !== group.supplier_key;
      const showAll = expanded === group.supplier_key;
      const pending = group.items.filter(hasPendingQuantity);
      return <article className="rc-queue-shop" key={group.supplier_key} data-selected={picked} data-open={showDetails} data-due-status={queueStatus(group, referenceDate)}>
        <button className="rc-queue-heading rc-text-action" type="button" aria-label={`เลือกร้าน ${group.supplier_name}`} aria-pressed={picked} aria-expanded={showDetails}
          onClick={() => { setClosedDetails(showDetails ? group.supplier_key : ''); onChoose(group.supplier_key); }}>
          <span className="rc-queue-pick" data-picked={picked} aria-hidden="true">{picked && <Icon name="check" size={16} />}</span>
          <span className="rc-queue-title"><strong className="rc-queue-name">{shortShopName(group.supplier_name)}</strong>
            <span className="rc-queue-meta"><span className="rc-queue-badge">{shopStatusLabel(group, referenceDate)}</span>
              <span className="rc-queue-count">{group.has_partial && <small>ค้าง</small>}<strong>{pending.length}</strong><small>รายการ</small></span></span></span>
        </button>
        {showDetails && <div className="rc-current-shop">
          <ul className="rc-item-list">{(showAll ? group.items : group.items.slice(0, PREVIEW_ITEMS)).map(item => {
            const state = item.has_pending !== undefined ? null : expectedQuantityStatus(item);
            return <li key={item.order_item_id}><div><strong>{item.product_name}</strong>{item.departments && <details><summary>แยกแผนก</summary>{item.departments.map((part, i) => <p key={i}>{part.department_name || `แผนก #${part.department_id}`} · {item.unit_name}</p>)}</details>}</div>
              {item.age_days > 0 && <small className="rc-item-age" data-old={item.age_days > 7 || undefined}>ค้าง {item.age_days} วัน</small>}
              {state && <span className="rc-ledger-number" data-status={state.status}>{state.label}</span>}</li>;
          })}</ul>
          {group.items.length > PREVIEW_ITEMS && <button type="button" className="rc-text-action rc-shop-details" aria-label={showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${group.items.length} รายการ`}
            onClick={() => setExpanded(showAll ? '' : group.supplier_key)}>{showAll ? 'ย่อรายการ' : `ดูทั้งหมด ${group.items.length} รายการ`}<span aria-hidden="true">›</span></button>}
        </div>}
        {((picked && onNoBill) || !group.receiving_optional) && <div className="rc-queue-actions">
          {picked && onNoBill && <button type="button" className="rc-text-action rc-nobill-action" disabled={noBillDisabled} aria-label={`รับแบบไม่มีบิล ${group.supplier_name}`} onClick={() => onNoBill(group)}>ไม่มีบิล</button>}
          {!group.receiving_optional && <button type="button" className="rc-text-action" disabled={busy || !followupEnabled} onClick={() => onFollowup(group)} aria-label={`ตามของ ${group.supplier_name}`}>ตามของ</button>}
        </div>}
      </article>;
    })}</div>
  </section>;
}
