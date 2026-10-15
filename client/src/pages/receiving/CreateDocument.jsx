import { useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { clearPending, ensurePending, errorText, pendingKey, readPending } from './receiving-utils';
import { PrimaryAction, Segmented, StatusPill, Toast } from '../../design';
import { ReceivingIllustration } from './ReceivingIllustration';
import { thaiDate } from './receiving-status';
import { ReceivingDialog } from './ReceivingDialog';

// อ่าน localStorage ใน try/catch รวมถึง browser ที่ไม่ยอมให้เข้าถึง storage
const storage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
export function CreateDocument({ group, date, user, onClose, onCreated, online = true }) {
  const key = pendingKey(user);
  const [pending, setPending] = useState(() => readPending(key, storage));
  const current = useRef(pending);
  const [kind, setKind] = useState(pending?.kind || 'bill');
  const [name, setName] = useState(pending?.supplier_name_text || group?.supplier_name || '');
  const [ids, setIds] = useState(pending?.order_item_ids || (group?.items || []).filter((item) => !item.is_received).map((item) => item.order_item_id));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const supplier = group?.supplier_key?.split(':');
      const identity = supplier?.[0] === 'pg' ? { product_group_id: Number(supplier[1]) }
        : supplier?.[0] === 'sm' ? { supplier_master_id: Number(supplier[1]) } : {};
      const result = ensurePending(key, {
        delivery_date: date, kind, supplier_name_text: name.trim(), order_item_ids: ids, ...identity,
        ...(['admin', 'super_admin'].includes(user.role) ? { branch_id: Number(user.branch_id), department_id: Number(user.department_id) } : {}),
      }, current.current, storage);
      current.current = result.payload; setPending(result.payload);
      setStorageWarning(!result.persisted);
      const doc = await api.create(result.payload);
      // ล้างเมื่อ server ตอบสำเร็จเท่านั้น; คำขอซ้ำระหว่างรอใช้ ref เดิม
      clearPending(key, storage);
      onCreated(doc);
    } catch (failure) {
      setError(failure.response || failure.request ? errorText(failure) : 'สร้างเอกสารไม่ได้ เบราว์เซอร์ต้องรองรับ crypto.randomUUID และเปิดผ่าน HTTPS');
    } finally { lock.current = false; setBusy(false); }
  };
  return <ReceivingDialog title={pending ? 'คำขอค้าง' : 'รับสินค้า'} busy={busy} onClose={onClose}
    actions={<PrimaryAction type="submit" form="rc-create" icon="plus" busy={busy}>{busy ? 'กำลังสร้าง' : pending ? 'ส่งซ้ำ' : 'สร้างใบรับ'}</PrimaryAction>}>
    <form id="rc-create" onSubmit={submit} className="rc-stack">
      {!online && <ReceivingIllustration state="offline" compact />}
      {pending && <StatusPill status="review">ใช้คำขอเดิม</StatusPill>}
      <fieldset disabled={busy || !!pending} className="rc-stack">
        <Segmented label="เอกสาร" value={kind} onChange={setKind} disabled={busy || !!pending}
          options={[{ value: 'bill', label: 'มีบิล' }, { value: 'manual_receipt', label: 'ไม่มีบิล' }]} />
        <label>ผู้ส่งของ<input maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <p className="rc-muted">{thaiDate(pending?.delivery_date || date)}</p>
        {group?.items?.length > 0 && <div className="rc-stack">
          {group.items.map((item) => <label className="rc-check" key={item.order_item_id}>
            <input type="checkbox" checked={ids.includes(item.order_item_id)} onChange={(event) => setIds((currentIds) => event.target.checked ? [...currentIds, item.order_item_id] : currentIds.filter((id) => id !== item.order_item_id))} />
            <span>{item.product_name}<small>สั่ง {item.quantity_ordered} {item.unit_name} รับแล้ว {item.received_quantity || '0'}</small></span>
          </label>)}
          <StatusPill status="review">ตรวจยอดคงเหลือ</StatusPill>
        </div>}
      </fieldset>
      {storageWarning && <Toast status="review">เก็บรหัสไม่ได้ เปิดหน้านี้ไว้จนส่งสำเร็จ</Toast>}
      {online && error && <ReceivingIllustration state="error" description={error} compact />}
      <details><summary>วิธีใช้</summary><p>คำขอค้างจะใช้รหัสเดิม ป้องกันเอกสารซ้ำ เมื่อสร้างแล้วให้ตรวจจำนวนรับจริง โดยเฉพาะใบสั่งที่รับบางส่วนแล้ว ยังไม่เพิ่มคลังจนกว่าจะยืนยัน</p></details>
    </form>
  </ReceivingDialog>;
}
