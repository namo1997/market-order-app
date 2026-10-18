import { useState } from 'react';
import { Icon } from '../../design';
import { expectedQuantityStatus } from './receiving-status';
import { hasPendingQuantity, shopStatusLabel, sortShops } from './receiving-queue';
import { ReceivingIllustration } from './ReceivingIllustration';

export function ShopWorkspace({ groups, current, waiting, onChoose, onReceive, onFollowup, busy, followupEnabled = true }) {
  const [expanded, setExpanded] = useState('');
  const states = groups.flatMap(group => group.items.map(expectedQuantityStatus));
  const short = states.filter(state => state.label.startsWith('ขาด')).length;
  const over = states.filter(state => state.label.startsWith('เกิน')).length;
  return <section className="rc-shop-workspace rc-stack" aria-label="คิวรับสินค้าทุกร้าน">
    <div className="rc-morning-metrics" role="status">
      <div><Icon name="box" /><span>รอรับ<strong>{waiting} รายการ</strong></span></div>
      <div data-status={short ? 'review' : undefined}><span>ขาด<strong>{short} รายการ</strong></span></div>
      <div data-status={over ? 'error' : undefined}><span>เกิน<strong>{over} รายการ</strong></span></div>
    </div>
    <div className="rc-queue-grid">{sortShops(groups.filter(group => group.items.some(hasPendingQuantity))).map(group => {
      const chosen = current?.supplier_key === group.supplier_key;
      const showAll = expanded === group.supplier_key;
      return <article className="rc-queue-shop" key={group.supplier_key} data-due-status={group.status}>
        <button className="rc-queue-heading rc-text-action" type="button" aria-label={`เลือกร้าน ${group.supplier_name}`} aria-expanded={chosen}
          onClick={() => onChoose(chosen ? '' : group.supplier_key)}>
          <span><strong>{group.supplier_name}</strong><small>{group.items.filter(hasPendingQuantity).length} รายการ</small></span>
          <span className="rc-queue-badge">{shopStatusLabel(group)}</span>
        </button>
        <div className="rc-queue-actions">
          <button type="button" className="rc-queue-receive rc-text-action" onClick={() => onReceive(group)} aria-label={`รับร้านนี้ ${group.supplier_name}`}>รับร้านนี้</button>
          <button type="button" className="rc-text-action" disabled={busy || !followupEnabled} onClick={() => onFollowup(group)} aria-label={`ตามของ ${group.supplier_name}`}>ตามของ</button>
        </div>
        {chosen && <div className="rc-current-shop">
          <div className="rc-shop-hero">
            <div><p className="rc-muted">ร้านที่กำลังรับ</p><h2>{group.supplier_name}</h2></div>
            <ReceivingIllustration state={group.items.some(hasPendingQuantity) ? 'welcome' : 'empty-today'} description="" />
          </div>
          <ul className="rc-item-list">{(showAll ? group.items : group.items.slice(0, 3)).map(item => {
            const state = expectedQuantityStatus(item);
            return <li key={item.order_item_id}><div><strong>{item.product_name}</strong>{item.departments && <details><summary>แยกแผนก</summary>{item.departments.map((part, i) => <p key={i}>{part.department_name || `แผนก #${part.department_id}`} · สั่ง {part.quantity_ordered} รับแล้ว {part.received_quantity || '0'} {item.unit_name}</p>)}</details>}</div><span className="rc-ledger-number" data-status={state.status}>{state.label}</span></li>;
          })}</ul>
          <button type="button" className="rc-text-action rc-shop-details" aria-label={showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${group.items.length} รายการ`}
            onClick={() => setExpanded(showAll ? '' : group.supplier_key)}>{showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${group.items.length} รายการ`}<span aria-hidden="true">›</span></button>
        </div>}
      </article>;
    })}</div>
  </section>;
}
