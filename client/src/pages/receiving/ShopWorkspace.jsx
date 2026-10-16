import { useState } from 'react';
import { Icon } from '../../design';
import { ReceivingIllustration } from './ReceivingIllustration';
import { expectedQuantityStatus } from './receiving-status';

export function ShopWorkspace({ groups, current, waiting, onChoose }) {
  const [expanded, setExpanded] = useState('');
  const states = groups.flatMap(group => group.items.map(expectedQuantityStatus));
  const short = states.filter(state => state.label.startsWith('ขาด')).length;
  const over = states.filter(state => state.label.startsWith('เกิน')).length;
  const queue = groups.filter(group => group.supplier_key !== current.supplier_key);
  const showAll = expanded === current.supplier_key;
  return <section className="rc-shop-workspace rc-stack" aria-label="รับสินค้าทีละร้าน">
    <div className="rc-morning-metrics" role="status">
      <div><Icon name="box" /><span>รอรับ<strong>{waiting} รายการ</strong></span></div>
      <div data-status="review"><span>ขาด<strong>{short} รายการ</strong></span></div>
      <div data-status="error"><span>เกิน<strong>{over} รายการ</strong></span></div>
    </div>
    <article className="rc-current-shop">
      <div className="rc-shop-hero"><div><p className="rc-muted">ร้านที่กำลังรับ</p><h2>{current.supplier_name}</h2><p>{current.items.length} รายการ</p></div><ReceivingIllustration state={current.items.some(item => !item.is_received) ? 'welcome' : 'empty-today'} description="" /></div>
      <ul className="rc-item-list">{(showAll ? current.items : current.items.slice(0, 3)).map(item => {
        const state = expectedQuantityStatus(item);
        return <li key={item.order_item_id}><strong>{item.product_name}</strong><span className="rc-ledger-number" data-status={state.status}>{state.label}</span></li>;
      })}</ul>
      <button type="button" className="rc-text-action rc-shop-details" aria-label={showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${current.items.length} รายการ`} onClick={() => setExpanded(showAll ? '' : current.supplier_key)}>{showAll ? 'ย่อรายการ' : `ดูรายการทั้งหมด ${current.items.length} รายการ`}<span aria-hidden="true">›</span></button>
    </article>
    {!!queue.length && <><h2>ร้านถัดไป</h2><div className="rc-shop-queue">{queue.map(group => <button type="button" className="rc-text-action rc-queue-card" key={group.supplier_key} onClick={() => onChoose(group.supplier_key)} aria-label={`เลือกร้าน ${group.supplier_name}`}><Icon name="supplier" /><span><strong>{group.supplier_name}</strong><small>{group.items.length} รายการ</small></span><span aria-hidden="true">›</span></button>)}</div></>}
  </section>;
}
