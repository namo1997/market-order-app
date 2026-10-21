import { useState } from 'react';
import { Icon } from '../../design';
import { expectedQuantityStatus } from './receiving-status';
import { OPTIONAL_RECEIVING_NOTE, hasPendingQuantity, queueStatus, shopStatusLabel, sortShops } from './receiving-queue';
import { ReceivingIllustration } from './ReceivingIllustration';

export function ShopWorkspace({ groups, current, selectedKey, waiting, onChoose, onFollowup, busy, followupEnabled = true, referenceDate, noBillGroup, noBillDisabled = false, onNoBill }) {
  const [expanded, setExpanded] = useState('');
  const [closedDetails, setClosedDetails] = useState('');
  const states = groups.filter(group => !group.receipt_summary).flatMap(group => group.items.filter(item => item.has_pending === undefined).map(expectedQuantityStatus));
  const short = groups.reduce((sum, group) => sum + (group.receipt_summary?.short || 0), 0) + states.filter(state => state.label.startsWith('ขาด')).length;
  const over = groups.reduce((sum, group) => sum + (group.receipt_summary?.over || 0), 0) + states.filter(state => state.label.startsWith('เกิน')).length;
  return <section className="rc-shop-workspace rc-stack" aria-label="คิวรับสินค้าทุกร้าน">
    {waiting > 0 && <p className="rc-queue-instruction">ของมาจากร้านไหน แตะเลือกร้านนั้น แล้วกด <strong className="rc-nowrap">สแกนบิล</strong></p>}
    {waiting > 0 && noBillGroup && onNoBill && <button type="button" className="rc-text-action rc-nobill-action" disabled={noBillDisabled} aria-label={`รับแบบไม่มีบิล ${noBillGroup.supplier_name}`} onClick={() => onNoBill(noBillGroup)}>ไม่มีบิล · {noBillGroup.supplier_name}</button>}
    <div className="rc-morning-metrics" role="status">
      <div><Icon name="box" /><span>รอรับ<strong>{waiting} รายการ</strong></span></div>
      <div data-status={short ? 'review' : undefined}><span>ขาด<strong>{short} รายการ</strong></span></div>
      <div data-status={over ? 'error' : undefined}><span>เกิน<strong>{over} รายการ</strong></span></div>
    </div>
    <div className="rc-queue-grid">{sortShops(groups.filter(group => group.items.some(hasPendingQuantity)), referenceDate).map(group => {
      const chosen = current?.supplier_key === group.supplier_key;
      const showDetails = chosen && closedDetails !== group.supplier_key;
      const showAll = expanded === group.supplier_key;
      return <article className="rc-queue-shop" key={group.supplier_key} data-selected={selectedKey === group.supplier_key} data-due-status={queueStatus(group, referenceDate)}>
        <button className="rc-queue-heading rc-text-action" type="button" aria-label={`เลือกร้าน ${group.supplier_name}`} aria-pressed={selectedKey === group.supplier_key} aria-expanded={showDetails}
          onClick={() => { setClosedDetails(showDetails ? group.supplier_key : ''); onChoose(group.supplier_key); }}>
          <span><strong>{group.supplier_name}</strong><small>{group.has_partial ? 'รับแล้วบางส่วน · ค้าง ' : ''}{group.items.filter(hasPendingQuantity).length} รายการ</small>{group.receiving_optional && <small className="rc-queue-optional">{OPTIONAL_RECEIVING_NOTE}</small>}</span>
          <span className="rc-queue-side"><span className="rc-queue-badge">{shopStatusLabel(group, referenceDate)}</span>{selectedKey === group.supplier_key && <span className="rc-queue-picked"><Icon name="check" size={20} />เลือกแล้ว</span>}</span>
        </button>
        {!group.receiving_optional && <div className="rc-queue-actions">
          <button type="button" className="rc-text-action" disabled={busy || !followupEnabled} onClick={() => onFollowup(group)} aria-label={`ตามของ ${group.supplier_name}`}>ตามของ</button>
        </div>}
        {showDetails && <div className="rc-current-shop">
          <div className="rc-shop-hero">
            <div><p className="rc-muted">ร้านที่กำลังรับ</p><h2>{group.supplier_name}</h2></div>
            <ReceivingIllustration state={group.items.some(hasPendingQuantity) ? 'welcome' : 'empty-today'} description="" />
          </div>
          <ul className="rc-item-list">{(showAll ? group.items : group.items.slice(0, 3)).map(item => {
            const state = item.has_pending !== undefined ? { status: 'waiting', label: 'รอนับของจริง' } : expectedQuantityStatus(item);
            return <li key={item.order_item_id}><div><strong>{item.product_name}</strong>{item.age_days > 0 && <small>ค้าง {item.age_days} วัน</small>}{item.departments && <details><summary>แยกแผนก</summary>{item.departments.map((part, i) => <p key={i}>{part.department_name || `แผนก #${part.department_id}`} · {item.unit_name}</p>)}</details>}</div><span className="rc-ledger-number" data-status={state.status}>{state.label}</span></li>;
          })}</ul>
          <button type="button" className="rc-text-action rc-shop-details" aria-label={showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${group.items.length} รายการ`}
            onClick={() => setExpanded(showAll ? '' : group.supplier_key)}>{showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${group.items.length} รายการ`}<span aria-hidden="true">›</span></button>
        </div>}
      </article>;
    })}</div>
  </section>;
}
