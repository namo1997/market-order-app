import { useState } from 'react';
import { Icon } from '../../design';
import { expectedQuantityStatus } from './receiving-status';
import { OPTIONAL_RECEIVING_NOTE, hasPendingQuantity, queueStatus, shopPreview, shopStatusLabel, shopTitle, sortShops } from './receiving-queue';
import { ReceivingIllustration } from './ReceivingIllustration';

export function ShopWorkspace({ groups, current, selectedKey, waiting, onChoose, onFollowup, busy, followupEnabled = true, referenceDate, noBillGroup, noBillDisabled = false, onNoBill, onScan, scanDisabled = false }) {
  const [expanded, setExpanded] = useState('');
  const [closedDetails, setClosedDetails] = useState('');
  const states = groups.filter(group => !group.receipt_summary).flatMap(group => group.items.filter(item => item.has_pending === undefined).map(expectedQuantityStatus));
  const short = groups.reduce((sum, group) => sum + (group.receipt_summary?.short || 0), 0) + states.filter(state => state.label.startsWith('ขาด')).length;
  const over = groups.reduce((sum, group) => sum + (group.receipt_summary?.over || 0), 0) + states.filter(state => state.label.startsWith('เกิน')).length;
  // Owner 2026-10-22 (mixed A/B): shop names and what is coming on each card, the scan button in the card,
  // and what every card shares (optional receiving, zero short/over) said once instead of on every card.
  const pendingShops = sortShops(groups.filter(group => group.items.some(hasPendingQuantity)), referenceDate);
  const allOptional = pendingShops.length > 0 && pendingShops.every(group => group.receiving_optional);
  return <section className="rc-shop-workspace rc-stack" aria-label="คิวรับสินค้าทุกร้าน">
    {waiting > 0 && <p className="rc-queue-instruction">วันนี้ {pendingShops.length} ร้าน · รอรับ {waiting} รายการ{allOptional ? ` · ${OPTIONAL_RECEIVING_NOTE}` : ''}</p>}
    {(short > 0 || over > 0) && <div className="rc-morning-metrics" role="status">
      {short > 0 && <div data-status="review"><span>ขาด<strong>{short} รายการ</strong></span></div>}
      {over > 0 && <div data-status="error"><span>เกิน<strong>{over} รายการ</strong></span></div>}
    </div>}
    <div className="rc-queue-grid">{pendingShops.map(group => {
      const chosen = current?.supplier_key === group.supplier_key;
      const showDetails = chosen && closedDetails !== group.supplier_key;
      const showAll = expanded === group.supplier_key;
      const status = queueStatus(group, referenceDate);
      const title = shopTitle(group);
      return <article className="rc-queue-shop" key={group.supplier_key} data-selected={selectedKey === group.supplier_key} data-due-status={status}>
        <div className="rc-queue-row">
          <button className="rc-queue-heading rc-text-action" type="button" aria-label={`เลือกร้าน ${group.supplier_name}`} aria-pressed={selectedKey === group.supplier_key} aria-expanded={showDetails}
            onClick={() => { setClosedDetails(showDetails ? group.supplier_key : ''); onChoose(group.supplier_key); }}>
            <span><strong>{title}</strong>
              {status !== 'due_today' && <span className="rc-queue-badge">{shopStatusLabel(group, referenceDate)}</span>}
              <small className="rc-queue-preview">{shopPreview(group) || `${group.items.filter(hasPendingQuantity).length} รายการ`}</small>
              {group.has_partial && <small className="rc-queue-group">รับแล้วบางส่วน · ค้าง {group.items.filter(hasPendingQuantity).length} รายการ</small>}
              {String(group.supplier_key).startsWith('pg:') && title !== group.supplier_name && <small className="rc-queue-group">กลุ่มสั่ง {group.supplier_name}</small>}
              {group.receiving_optional && !allOptional && <small className="rc-queue-optional">{OPTIONAL_RECEIVING_NOTE}</small>}
              {selectedKey === group.supplier_key && <span className="rc-queue-picked"><Icon name="check" size={18} />เลือกแล้ว</span>}</span>
          </button>
          {onScan && <button type="button" className="rc-queue-scan" disabled={scanDisabled} aria-label={`สแกนบิล ${group.supplier_name}`} onClick={() => onScan(group)}><Icon name="scan" size={26} /><span>สแกนบิล</span></button>}
        </div>
        <div className="rc-queue-actions">
          {onNoBill && <button type="button" className="rc-text-action rc-nobill-action" disabled={noBillDisabled} aria-label={`รับแบบไม่มีบิล ${group.supplier_name}`} onClick={() => onNoBill(group)}>ไม่มีบิล? รับโดยนับอย่างเดียว</button>}
          {!group.receiving_optional && <button type="button" className="rc-text-action" disabled={busy || !followupEnabled} onClick={() => onFollowup(group)} aria-label={`ตามของ ${group.supplier_name}`}>ตามของ</button>}
        </div>
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
