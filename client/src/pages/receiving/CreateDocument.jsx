import { useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { clearPending, ensurePending, errorText, pendingKey, readPending } from './receiving-utils';
import { ReceivingDialog } from './ReceivingDialog';

// อ่าน localStorage ใน try/catch รวมถึง browser ที่ไม่ยอมให้เข้าถึง storage
const storage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
export function CreateDocument({ group, date, user, onClose, onCreated }) {
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
  return <ReceivingDialog title={pending ? 'ส่งคำขอเดิมอีกครั้ง' : 'เริ่มรับสินค้า'} busy={busy} onClose={onClose}>
    <form onSubmit={submit}>
      {pending && <p className="rc-info">มีคำขอสร้างเอกสารค้างวันที่ {pending.delivery_date} ระบบจะใช้รหัสเดิมเพื่อตรวจผลและป้องกันเอกสารซ้ำ</p>}
      <fieldset disabled={busy || !!pending}>
        <label>รูปแบบเอกสาร<select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="bill">มีบิลจากผู้ส่งของ</option><option value="manual_receipt">ใบรับของ / ไม่มีบิล</option>
        </select></label>
        <label>ชื่อผู้ส่งของ / ซัพพลายเออร์<input maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น ตลาดสด / ชื่อร้าน" /></label>
        <p className="rc-muted">วันที่รับ {pending?.delivery_date || date} · {user.branch} / {user.department}</p>
        {group?.items?.length > 0 && <div className="rc-expected-select"><h3>รายการที่คาดว่าจะมาส่ง</h3>
          {group.items.map((item) => <label className="rc-check" key={item.order_item_id}>
            <input type="checkbox" checked={ids.includes(item.order_item_id)} onChange={(event) => setIds((currentIds) => event.target.checked ? [...currentIds, item.order_item_id] : currentIds.filter((id) => id !== item.order_item_id))} />
            <span>{item.product_name}<small>สั่ง {item.quantity_ordered} {item.unit_name} · รับแล้ว {item.received_quantity || '0'}</small></span>
          </label>)}
          <p className="rc-warning">ตรวจจำนวนคงเหลือเอง เอกสารใหม่อาจเติมจำนวนเต็มที่สั่งไว้</p>
        </div>}
      </fieldset>
      {storageWarning && <p className="rc-warning">เบราว์เซอร์ไม่ยอมให้เก็บรหัสไว้ ห้ามปิดหน้านี้จนกว่าจะส่งสำเร็จ</p>}
      {error && <p className="rc-error" role="alert">{error}</p>}
      <button type="submit" className="rc-primary rc-wide" disabled={busy}>{busy ? 'กำลังสร้างเอกสาร…' : pending ? 'ตรวจผล / ลองส่งคำขอเดิม' : 'สร้างเอกสารรับสินค้า →'}</button>
      <p className="rc-muted">หากเน็ตหลุด กดส่งอีกครั้งด้วยรหัสเดิมได้ ยังไม่บันทึกสินค้าเข้าคลังจนกว่าจะยืนยัน</p>
    </form>
  </ReceivingDialog>;
}
