import { createPayload, groupIdentity, pendingOrderIds, pendingStorage as storage, selectedIdentity } from './start-receiving';
import { useReceivingDirty } from './use-receiving-dirty';
import { useReceivingBack } from './use-receiving-back';
import { useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { clearPending, ensurePending, errorText, pendingKey, readPending } from './receiving-utils';
import { PrimaryAction, Segmented, StatusPill, Toast } from '../../design';
import { ReceivingIllustration } from './ReceivingIllustration';
import { isPartialReceipt, thaiDate } from './receiving-status';
import { SupplierPicker } from './SupplierPicker';
import { ReceivingDialog } from './ReceivingDialog';

export function CreateDocument({ group, date, user, onClose, onCreated, onDirtyChange, onBackActionChange, existingDocument, online = true, scanFirst = false }) {
  const key = pendingKey(user);
  const [pending, setPending] = useState(() => readPending(key, storage));
  const current = useRef(pending);
  const [kind, setKind] = useState(pending?.kind || 'bill');
  const [name, setName] = useState(pending?.supplier_name_text || group?.supplier_name || '');
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [ids, setIds] = useState(pending?.order_item_ids || pendingOrderIds(group));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const initialIds = pendingOrderIds(group);
  const partialItems = (group?.items || []).filter(item => ids.includes(item.order_item_id) && isPartialReceipt(item));
  // Walk-in (no queue shop) opened for scan-first: the primary action starts scanning.
  const walkIn = scanFirst && !group && !pending && !existingDocument;
  const edited = kind !== 'bill' || name !== (group?.supplier_name || '') || ids.length !== initialIds.length || ids.some(id => !initialIds.includes(id));
  useReceivingDirty(!!(busy || pending || edited), onDirtyChange);
  useReceivingBack(onBackActionChange, onClose, busy);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || (!group && !pending && !existingDocument && !selectedSupplier)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (existingDocument && !current.current) { onCreated(await api.get(existingDocument.id)); return; }
      const identity = selectedSupplier && !selectedSupplier.isNew ? selectedIdentity(selectedSupplier) : groupIdentity(group);
      const result = ensurePending(key, createPayload({ kind, date, user, name, ids, identity }), current.current, storage);
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
  return <ReceivingDialog title={pending ? 'ใบรับที่ยังส่งไม่สำเร็จ' : 'รับสินค้า'} busy={busy} onClose={onClose}
    actions={<PrimaryAction type="submit" form="rc-create" className={pending || existingDocument ? "rc-resume-primary" : ""} icon={pending || existingDocument ? "back" : walkIn && kind === 'bill' ? "scan" : "plus"} busy={busy} disabled={!online || (!group && !pending && !existingDocument && !selectedSupplier)}>{busy ? 'กำลังเปิดใบรับ' : pending ? 'ทำต่อใบเดิม' : existingDocument ? `ทำต่อใบ #${existingDocument.id}` : walkIn ? kind === 'bill' ? 'สแกนบิล' : 'เริ่มนับของ' : 'สร้างใบรับ'}</PrimaryAction>}>
    <form id="rc-create" onSubmit={submit} className="rc-stack">
      {!online && <ReceivingIllustration state="offline" compact />}
      {existingDocument && !pending && <p>มีใบร่างของร้านนี้ในวันที่เลือกแล้ว · ทำต่อใบ #{existingDocument.id}</p>}
      {pending && <div><p>ใบเดิม: {pending.supplier_name_text || 'ไม่ระบุร้าน'} · ทำต่อใบเดิมจะใช้รายการเดิมและรหัสเดิม ป้องกันใบรับซ้ำ ({pending.order_item_ids?.length || 0} รายการ)</p>
        <button type="button" disabled={busy} onClick={() => { clearPending(key, storage); current.current = null; setPending(null); setKind('bill'); setName(group?.supplier_name || ''); setSelectedSupplier(null); setIds(initialIds); }}>เริ่มใหม่ (เลือกทุกรายการค้าง)</button>
        <p>หากคำขอเดิมถึงระบบแล้ว ใบเดิมยังอยู่ในรายการเอกสาร กรุณาตรวจใบเดิมก่อนเริ่มใหม่</p></div>}
      <fieldset disabled={busy || !!pending || !!existingDocument} className="rc-stack">
        <Segmented label="เอกสาร" value={kind} onChange={setKind} disabled={busy || !!pending}
          options={[{ value: 'bill', label: 'มีบิล' }, { value: 'manual_receipt', label: 'ไม่มีบิล' }]} />
        {group || pending || existingDocument ? <label>ผู้ส่งของ<input maxLength={255} value={name} onChange={event => setName(event.target.value)} /></label>
          : <SupplierPicker name={name} selected={selectedSupplier} onChange={(value, supplier) => { setName(value); setSelectedSupplier(supplier); }} user={user} disabled={busy || !online} />}
        <p className="rc-muted">{thaiDate(pending?.delivery_date || date)}</p>
        {group?.items?.length > 0 && <div className="rc-stack">
          {group.items.map((item) => <label className="rc-check" key={item.order_item_id}>
            <input type="checkbox" checked={(item.order_item_ids || [item.order_item_id]).every(id => ids.includes(id))} onChange={(event) => setIds((currentIds) => event.target.checked ? [...new Set([...currentIds, ...(item.order_item_ids || [item.order_item_id])])] : currentIds.filter((id) => !(item.order_item_ids || [item.order_item_id]).includes(id)))} />
            <span>{item.product_name}<small>{item.unit_name}</small></span>
          </label>)}
          {partialItems.length > 0 && <StatusPill status="review">{partialItems.length} รายการที่เลือกเคยรับบางส่วนแล้ว หลังสร้างใบรับ ให้ตรวจจำนวนรับจริงเทียบยอดที่ยังขาด</StatusPill>}
        </div>}
      </fieldset>
      {storageWarning && <Toast status="review">เก็บรหัสไม่ได้ เปิดหน้านี้ไว้จนส่งสำเร็จ</Toast>}
      {online && error && <ReceivingIllustration state="error" description={error} compact />}
    </form>
  </ReceivingDialog>;
}
