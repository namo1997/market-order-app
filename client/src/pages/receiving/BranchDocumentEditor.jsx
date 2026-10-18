import { useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { canVoid, documentBody, errorText, formatBaht, sumLines } from './receiving-utils';
import { PrimaryAction, IconButton, Toast } from '../../design';
import { ReceivingNumberField } from './ReceivingNumberField';
import { SignaturePad } from './SignaturePad';
import { ImagePages } from './ImagePages';
import { assignPageNumbers } from './image-utils';
import { useReceivingDirty } from './use-receiving-dirty';

// Branch totals are allocated by the server for every OCR or manual update.
export function BranchDocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, online = true }) {
  const [doc, setDoc] = useState(initialDocument);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [ink, setInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [signature, setSignature] = useState('');
  const lock = useRef(false);
  const savedDocument = useRef(initialDocument);
  const draft = doc.status === 'draft';
  useReceivingDirty(dirty || busy || ink || pending.length > 0, onDirtyChange);
  const accept = next => { savedDocument.current = next; setDoc(next); setDirty(false); onChanged(next); };
  const act = async fn => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); return true; }
    catch (failure) { setError(failure.response || failure.request ? errorText(failure) : failure.message); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const save = async () => {
    const body = documentBody(doc);
    // Header/price-only saves must preserve the default remaining quantities per department.
    body.lines = body.lines.flatMap(line => {
      const saved = savedDocument.current.lines.find(part => part.id === line.id);
      const quantityChanged = Number(line.quantity_received) !== Number(saved.quantity_received);
      const priceChanged = String(line.unit_price ?? '') !== String(saved.unit_price ?? '');
      return quantityChanged || priceChanged ? [{ id: line.id, amount: line.amount,
        ...(quantityChanged ? { quantity_received: line.quantity_received } : {}),
        ...(priceChanged ? { unit_price: line.unit_price } : {}) }] : [];
    });
    let next = dirty ? await api.update(doc.id, body) : doc;
    const numbered = assignPageNumbers(next.images, pending);
    setPending(numbered);
    // Remove each acknowledged upload immediately so an interrupted retry reuses no old pages.
    for (const page of numbered) {
      await api.uploadImage(doc.id, page.pageNo, page.dataUrl);
      setPending(current => current.filter(item => item.key !== page.key));
    }
    if (numbered.length) next = await api.get(doc.id);
    accept(next);
    return next;
  };
  const changeLine = (id, key, value) => {
    setDoc(current => ({ ...current, lines: current.lines.map(line => line.id === id ? { ...line, [key]: value, amount: null } : line) }));
    setDirty(true);
  };
  const disabled = busy || processing || !online;
  return <section className="rc-stack" aria-label="ใบรับทั้งสาขา">
    <div className="rc-section-heading"><IconButton icon="back" label="กลับคิว" disabled={disabled || dirty || pending.length > 0 || ink} onClick={onBack} /><h1>{doc.supplier_name_text} · ทั้งสาขา</h1></div>
    <p>ใบรับ #{doc.id} · {doc.status === 'draft' ? 'ร่าง' : doc.status === 'confirmed' ? 'ยืนยันแล้ว' : 'ยกเลิกแล้ว'}</p>
    <p className="rc-muted">กรอกยอดรับรวม ระบบแบ่งตามสัดส่วนที่แต่ละแผนกสั่ง กดบันทึกเพื่อดูยอดแยกแผนกล่าสุด</p>
    {error && <Toast status="error">{error}</Toast>}{notice && <Toast>{notice}</Toast>}
    {doc.warnings?.length > 0 && <ul aria-label="ข้อควรตรวจหลังอ่านบิล">{doc.warnings.map((warning, index) => <li key={index}>{warning.message || warning.code}</li>)}</ul>}
    <fieldset disabled={disabled || !draft} className="rc-stack">
      {doc.lines.map(line => <article key={line.id} className="rc-stack rc-queue-shop">
        <h2>{line.product_name}</h2>
        {doc.ocr?.status === 'done' && <p>ข้อความในบิล: {line.bill_text || 'อ่านไม่ได้ กรุณาตรวจเอง'}</p>}
        {line.match?.source === 'ai' && <div><p>AI เสนอสินค้านี้ กรุณาตรวจข้อความและสินค้าให้ตรงกัน</p>
          <PrimaryAction disabled={disabled || dirty || pending.length > 0 || ink} onClick={() => act(async () => {
            accept(await api.update(doc.id, { lines: [{ id: line.id, match: { source: 'manual', confidence: 1 } }] }));
          })}>ยืนยันจับคู่ {line.product_name}</PrimaryAction></div>}
        <ReceivingNumberField label={`จำนวนรับรวม ${line.product_name}`} value={line.quantity_received} onValueChange={value => changeLine(line.id, 'quantity_received', value)} />
        <ReceivingNumberField label={`ราคาต่อหน่วย ${line.product_name}`} value={line.unit_price ?? ''} validationKey="unit_price" onValueChange={value => changeLine(line.id, 'unit_price', value)} />
        <details><summary>แยกแผนก · {dirty ? 'ยอดที่บันทึกแล้ว' : 'ยอดล่าสุด'}</summary>
          {line.departments?.map(part => <p key={part.order_item_id}>{part.department_name || `แผนก #${part.department_id}`} · สั่ง {part.quantity_ordered} · รับ {part.quantity_received} {line.unit_text}</p>)}
        </details>
      </article>)}
      <label>เลขที่บิล<input value={doc.doc_ref || ''} maxLength={100} onChange={event => { setDoc({ ...doc, doc_ref: event.target.value }); setDirty(true); }} /></label>
    </fieldset>
    <p>รวมรายการ {(() => { try { return formatBaht(sumLines(doc.lines)); } catch { return '—'; } })()} บาท</p>
    <details><summary>รูปบิล / ใบส่งของ</summary><ImagePages doc={doc} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} /></details>
    {draft && <PrimaryAction disabled={disabled || ink || doc.ocr?.status === 'pending' || !(doc.images?.length || pending.length)} onClick={() => act(async () => {
      const saved = await save();
      accept(await api.ocr(saved.id));
      setNotice('อ่านบิลแล้ว กรุณาตรวจยอดรับรวม ราคา และยอดแยกแผนกก่อนยืนยัน');
    })}>อ่านบิลด้วย AI</PrimaryAction>}
    {draft && <PrimaryAction disabled={disabled} onClick={() => act(async () => { await save(); setNotice('บันทึกยอดแยกแผนกแล้ว'); })}>บันทึกยอดรับรวม</PrimaryAction>}
      <SignaturePad label="ผู้รับสินค้า" documentId={doc.id} role="receiver" saved={doc.has_receiver_signature} savedImage={signature} disabled={disabled || dirty || pending.length > 0}
        inline readOnly={!draft} showActions={draft} onInkChange={setInk} onSave={image => act(async () => { const next = await api.signature(doc.id, 'receiver', image, user.name); setSignature(image); accept(next); })} />
    {draft && <PrimaryAction disabled={disabled || dirty || ink || pending.length > 0 || !doc.has_receiver_signature} onClick={() => act(async () => { accept(await api.confirm(doc.id)); setNotice('รับเข้าคลังครบทุกแผนกแล้ว'); })}>ยืนยันรับทั้งสาขา</PrimaryAction>}
    {canVoid(doc, user) && <details><summary>ยกเลิกใบรับทั้งสาขา</summary><label>เหตุผล<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
      <PrimaryAction disabled={disabled || dirty || pending.length > 0 || !reason.trim()} onClick={() => act(async () => { accept(await api.void(doc.id, reason)); setNotice('ยกเลิกใบรับและย้อนยอดทุกแผนกแล้ว'); })}>ยกเลิกใบรับ</PrimaryAction></details>}
    <IconButton icon="retry" label="โหลดเอกสารล่าสุด" disabled={disabled || dirty || pending.length > 0 || ink} onClick={() => act(async () => accept(await api.get(doc.id)))} />
  </section>;
}
