import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { canVoid, documentBody, errorText, formatBaht, scaledInteger, sumLines, warningText } from './receiving-utils';
import { LineEditor } from './LineEditor';
import { ImagePages } from './ImagePages';
import { SignaturePad } from './SignaturePad';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIcon } from './ReceivingIcon';
import { assignPageNumbers } from './image-utils';

const statusText = { draft: 'ร่าง · ยังไม่เข้าคลัง', confirmed: 'ยืนยันรับแล้ว', void: 'ยกเลิกแล้ว' };

export function DocumentEditor({ initialDocument, user, onBack, onChanged }) {
  const [doc, setDoc] = useState(initialDocument);
  const [dirty, setDirty] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [pending, setPending] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [modal, setModal] = useState('');
  const [reason, setReason] = useState('');
  const [unmatchedOk, setUnmatchedOk] = useState(false);
  const lock = useRef(false);
  const draft = doc.status === 'draft';
  const disabled = !!busy || processing || uncertain;
  useEffect(() => {
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    if (dirty || pending.length) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending.length]);

  const adopt = (next) => {
    setDoc(next); setDeleted([]); setDirty(false); onChanged(next);
  };
  const mutate = (values) => { setDoc((current) => ({ ...current, ...values })); setDirty(true); setNotice(''); };
  const run = async (label, work, ambiguous = true) => {
    if (lock.current) return false;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await work(); return true; }
    catch (failure) {
      setError(failure.response || failure.request ? errorText(failure) : failure.message);
      if ((ambiguous && failure.request && !failure.response) || failure.response?.status === 409) setUncertain(true);
      return false;
    } finally { lock.current = false; setBusy(''); }
  };
  const save = async () => {
    if (!dirty) return doc;
    const body = documentBody(doc, deleted);
    try {
      const next = await api.update(doc.id, body);
      adopt(next); return next;
    } catch (failure) {
      if (failure.request && !failure.response) setUncertain(true);
      throw failure;
    }
  };
  const upload = () => run('กำลังส่งรูป…', async () => {
    await save();
    const pages = assignPageNumbers(doc.images, pending);
    // ตรึงเลขทุกหน้าก่อนเริ่ม request รวมหน้าที่ยังไม่ส่งเมื่อเน็ตหลุดกลางชุด
    setPending(pages);
    for (const page of pages) {
      const assigned = page.pageNo;
      setPending((current) => current.map((item) => item.key === page.key ? { ...item, pageNo: assigned, state: 'sending' } : item));
      try {
        const response = await api.uploadImage(doc.id, assigned, page.dataUrl);
        setDoc((current) => ({ ...current, images: [...current.images.filter((item) => item.page_no !== assigned), {
          id: response.image_id, page_no: assigned, mime: 'image/jpeg',
        }] }));
        setPending((current) => current.filter((item) => item.key !== page.key));
      } catch (failure) {
        setPending((current) => current.map((item) => item.key === page.key ? { ...item, state: 'failed' } : item));
        throw failure;
      }
    }
    setNotice('ส่งรูปครบแล้ว พร้อมอ่านบิล');
  }, false);

  const reload = () => run('กำลังตรวจผลล่าสุด…', async () => {
    adopt(await api.get(doc.id)); setUncertain(false); setModal('');
    setNotice('โหลดข้อมูลจากระบบแล้ว กรุณาตรวจรายการก่อนทำต่อ');
  }, false);
  const review = () => run('กำลังบันทึกและตรวจรายการ…', async () => {
    const next = await save();
    if (!next.has_receiver_signature) throw new Error('กรุณาบันทึกลายเซ็นผู้รับก่อนยืนยัน');
    if (!next.lines.some((line) => scaledInteger(line.quantity_received) > 0n)) throw new Error('ต้องมีอย่างน้อย 1 รายการที่รับจริงมากกว่า 0');
    if (next.kind === 'bill' && next.lines.some((line) => !line.product_id)) throw new Error('กรุณาเลือกสินค้าให้ครบทุกบรรทัด');
    setUnmatchedOk(false); setModal('confirm');
  });
  let total = 0n;
  let invalidTotal = false;
  let billTotal = null;
  let adjusted = 0n;
  try {
    total = sumLines(doc.lines);
    billTotal = doc.total == null || doc.total === '' ? null : scaledInteger(doc.total);
    adjusted = total - scaledInteger(doc.discount || '0') + scaledInteger(doc.vat || '0');
  } catch { invalidTotal = true; }
  const warnings = [...(doc.warnings || []), ...(doc.ocr?.warnings || []).map((code) => ({ code }))];
  const uniqueWarnings = warnings.filter((warning, index) => warnings.findIndex((other) => other.code === warning.code && other.line_no === warning.line_no) === index);
  const unmatched = doc.lines.filter((line) => !line.product_id).length;
  const leave = () => {
    if (dirty || pending.length) setModal('leave'); else onBack();
  };
  return <>
    <div className="rc-document-heading">
      <button type="button" disabled={!!busy || processing} onClick={leave}>← รายการรับสินค้า</button>
      <span className={`rc-status ${doc.status}`}>{statusText[doc.status]}</span>
      <h1>{doc.supplier_name_text || 'เอกสารรับสินค้า'} <small>#{doc.id}</small></h1>
      <p className="rc-muted">{doc.kind === 'bill' ? 'บิลจากผู้ส่งของ' : 'ใบรับของ · กรอกเอง'} · {doc.delivery_date} · {doc.receiver_name}</p>
    </div>
    <div aria-live="polite">{busy && <p className="rc-info" role="status">{busy} กรุณารอ อย่าปิดหน้านี้</p>}
      {notice && <p className="rc-success" role="status">{notice}</p>}</div>
    {error && <p className="rc-error" role="alert">{error}</p>}
    {uncertain && <div className="rc-error"><strong>ตรวจผลล่าสุดก่อนส่งซ้ำ</strong>
      <p>ระบบอาจรับคำขอแล้ว การโหลดจะใช้ข้อมูลที่บันทึกบนระบบแทนข้อมูลที่แก้ค้างในหน้านี้ รูปที่รอส่งยังอยู่</p>
      <button type="button" disabled={!!busy} onClick={reload}>โหลดผลล่าสุดจากระบบ</button></div>}
    {!draft && <section className="rc-result rc-panel"><ReceivingIcon name={doc.status === 'confirmed' ? 'success' : 'box'} large />
      <h2>{doc.status === 'confirmed' ? 'รับสินค้าเรียบร้อยแล้ว' : 'ยกเลิกเอกสารแล้ว'}</h2>
      <p>{doc.status === 'confirmed' ? 'ระบบบันทึกการรับสินค้าและคลังแล้ว' : 'ดูข้อมูลและหลักฐานของเอกสารนี้ได้'}</p>
      {doc.confirmed_at && <p className="rc-muted">ยืนยันเมื่อ {new Date(doc.confirmed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p>}
    </section>}
    <fieldset className="rc-editor-fields" disabled={disabled}>
      <section className="rc-panel">
        <div className="rc-section-heading"><h2>ข้อมูลบิล</h2><span className="rc-eyebrow">01 / ตรวจข้อมูล</span></div>
        <fieldset disabled={!draft} className="rc-form-grid">
          <label className="rc-span">ชื่อผู้ส่งของ / ซัพพลายเออร์<input maxLength={255} value={doc.supplier_name_text || ''} onChange={(event) => mutate({ supplier_name_text: event.target.value })} /></label>
          <label>เลขที่บิล<input maxLength={100} value={doc.doc_ref || ''} onChange={(event) => mutate({ doc_ref: event.target.value })} /></label>
          <label>วันที่ในบิล<input type="date" value={doc.doc_date || ''} onChange={(event) => mutate({ doc_date: event.target.value })} /></label>
          {['subtotal', 'discount', 'vat', 'total'].map((key, index) => <label key={key}>{['ยอดก่อนส่วนลด / ภาษี', 'ส่วนลด', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมตามบิล'][index]} (บาท)
            <input inputMode="decimal" maxLength={18} value={doc[key] ?? ''} onChange={(event) => mutate({ [key]: event.target.value })} /></label>)}
        </fieldset>
      </section>
      <ImagePages doc={doc} pending={pending} setPending={setPending} busy={disabled} onUpload={upload} setProcessing={setProcessing} />
      {draft && <section className="rc-ocr-panel rc-panel">
        <div><h2>ให้ระบบช่วยอ่านบิล</h2><p>อ่านรูปที่ส่งแล้ว แล้วตรวจทุกบรรทัดก่อนยืนยัน</p>
          <p className="rc-muted">สถานะ: {({ none: 'ยังไม่ได้อ่าน', pending: 'กำลังอ่าน / รอตรวจผล', done: 'อ่านแล้ว', failed: 'อ่านไม่สำเร็จ' })[doc.ocr?.status] || 'ยังไม่ได้อ่าน'}</p></div>
        <button type="button" className="rc-primary" disabled={!doc.images.length || !!pending.length} onClick={() => run('กำลังอ่านบิล อาจใช้เวลาประมาณ 1 นาที…', async () => {
          await save(); adopt(await api.ocr(doc.id)); setNotice('อ่านบิลแล้ว กรุณาตรวจจำนวน ราคา และการจับคู่สินค้า');
        })}><ReceivingIcon name="camera" />อ่านบิล</button>
        {pending.length > 0 && <p className="rc-warning">ส่งรูปที่ค้างให้ครบก่อนอ่านบิล</p>}
      </section>}
      <section className="rc-panel rc-lines-panel">
        <div className="rc-section-heading"><h2>ตรวจรายการ <span className="rc-count">{doc.lines.length}</span></h2><span className="rc-eyebrow">02 / จำนวนรับจริง</span></div>
        {draft && <p className="rc-muted">จำนวนเริ่มต้นอาจเท่ากับยอดสั่งทั้งหมด กรุณาแก้ “จำนวนรับจริง” ตามของที่มาส่งในครั้งนี้ โดยเฉพาะใบสั่งที่เคยรับบางส่วนแล้ว</p>}
        {uniqueWarnings.length > 0 && <div className="rc-warning-list" role="status">{uniqueWarnings.map((warning, index) => <p key={index}>⚠ {warning.line_no ? `รายการ ${warning.line_no}: ` : ''}{warningText(warning)}</p>)}</div>}
        <LineEditor lines={doc.lines} warnings={warnings} readOnly={!draft} onChange={(index, values) => mutate({ lines: doc.lines.map((line, i) => i === index ? { ...line, ...values } : line) })}
          onDelete={(index) => { if (doc.lines[index].id) setDeleted((current) => [...current, doc.lines[index].id]); mutate({ lines: doc.lines.filter((_, i) => i !== index) }); }} />
        {!doc.lines.length && <p className="rc-muted">อ่านบิลหรือเพิ่มรายการเพื่อเริ่มตรวจรับ</p>}
        {draft && <button type="button" className="rc-secondary rc-wide" disabled={doc.lines.length >= 200} onClick={() => mutate({ lines: [...doc.lines, {
          _key: crypto.randomUUID(), bill_text: '', quantity_billed: '', quantity_received: '0', unit_price: '', amount: '',
        }] })}>＋ เพิ่มรายการเอง</button>}
        <div className="rc-totals"><p><span>รวมยอดรายการในบิล</span><strong>{invalidTotal ? 'ตรวจตัวเลข' : formatBaht(total)} บาท</strong></p>
          <p><span>หลังหักส่วนลด + ภาษี</span><strong>{invalidTotal ? '—' : formatBaht(adjusted)} บาท</strong></p>
          <p><span>ยอดรวมตามบิล</span><strong>{billTotal === null ? 'ยังไม่ระบุ' : `${formatBaht(billTotal)} บาท`}</strong></p>
          {billTotal !== null && !invalidTotal && billTotal !== adjusted && <p className="rc-warning">ยอดต่างกัน {formatBaht(billTotal - adjusted)} บาท กรุณาเทียบต้นฉบับ</p>}
        </div>
      </section>
      {draft && <section className="rc-panel">
        <div className="rc-section-heading"><h2>ลงชื่อรับสินค้า</h2><span className="rc-eyebrow">03 / ยืนยันตัวตน</span></div>
        <p className="rc-muted">ผู้รับ: {doc.receiver_name || user.name} · ลายเซ็นจะถูกแนบกับเอกสารนี้</p>
        <SignaturePad label="ลายเซ็นผู้รับ (จำเป็น)" saved={doc.has_receiver_signature} onSave={(image) => run('กำลังบันทึกลายเซ็น…', async () => {
          await save(); await api.signature(doc.id, 'receiver', image); adopt(await api.get(doc.id));
        })} />
        <details className="rc-courier"><summary>เพิ่มผู้ส่งของและลายเซ็น (ถ้ามี)</summary>
          <label>ชื่อผู้ส่งของ<input maxLength={255} value={doc.courier_name || ''} onChange={(event) => mutate({ courier_name: event.target.value })} /></label>
          <SignaturePad label="ลายเซ็นผู้ส่งของ" saved={doc.has_courier_signature} onSave={(image) => run('กำลังบันทึกลายเซ็น…', async () => {
            await save(); await api.signature(doc.id, 'courier', image, doc.courier_name); adopt(await api.get(doc.id));
          })} />
        </details>
      </section>}
    </fieldset>
    {canVoid(doc, user) && <div className="rc-void"><button className="rc-text-danger" type="button" disabled={disabled} onClick={() => { setReason(''); setModal('void'); }}>ยกเลิกเอกสารนี้</button>
      <p className="rc-muted">เจ้าของเอกสารยกเลิกได้ภายในวันเดียวกันตามเวลาไทย ผู้ดูแลยกเลิกได้ตามสิทธิ์</p></div>}
    <div className="rc-bottom-bar">
      <div><span>{draft ? (dirty ? 'มีข้อมูลยังไม่บันทึก' : 'บันทึกแล้ว') : statusText[doc.status]}</span><strong>{invalidTotal ? 'ตรวจยอดเงิน' : `${formatBaht(billTotal ?? adjusted)} บาท`}</strong></div>
      {draft ? <><button type="button" disabled={disabled} onClick={() => run('กำลังบันทึกร่าง…', async () => { await save(); setNotice('บันทึกร่างแล้ว'); })}>บันทึกร่าง</button>
        <button type="button" className="rc-primary" disabled={disabled || !!pending.length || invalidTotal} onClick={review}>ตรวจและยืนยัน →</button></>
        : <button type="button" className="rc-primary" onClick={onBack} disabled={!!busy}>กลับรายการวันนี้</button>}
    </div>
    {modal === 'confirm' && <ReceivingDialog title="ตรวจสรุปก่อนยืนยัน" busy={!!busy} onClose={() => setModal('')}>
      <p><strong>{doc.supplier_name_text || 'ไม่ระบุผู้ส่งของ'}</strong> · เอกสาร #{doc.id}</p>
      <p>วันที่รับ {doc.delivery_date} · {doc.lines.length} รายการ · {formatBaht(billTotal ?? adjusted)} บาท</p>
      <ul className="rc-review-lines">{doc.lines.map((line, index) => <li key={line.id || index}><span>{line.product_name || line.bill_text || 'ไม่ผูกสินค้า'}</span><strong>รับ {line.quantity_received} {line.unit_text}</strong></li>)}</ul>
      {uniqueWarnings.length > 0 && <div className="rc-warning-list">{uniqueWarnings.map((warning, index) => <p key={index}>{warningText(warning)}</p>)}</div>}
      {unmatched > 0 && <label className="rc-check"><input type="checkbox" checked={unmatchedOk} onChange={(event) => setUnmatchedOk(event.target.checked)} />ยอมรับ {unmatched} รายการที่ไม่ผูกสินค้าในใบรับของ รายการเหล่านี้จะไม่เพิ่มคลังสินค้า</label>}
      <p>ยืนยันแล้วจะบันทึกรับของเข้าคลัง และแก้รายการไม่ได้ กรุณาตรวจจำนวนที่รับจริงให้ครบ</p>
      {error && <p className="rc-error" role="alert">{error}</p>}
      <button type="button" className="rc-primary rc-wide" disabled={disabled || (unmatched > 0 && !unmatchedOk)} onClick={() => run('กำลังยืนยันรับสินค้า…', async () => {
        adopt(await api.confirm(doc.id, unmatchedOk)); setModal(''); setNotice('ยืนยันรับสินค้าเรียบร้อย');
      })}>{busy || 'ยืนยันรับสินค้า'}</button>
      {uncertain && <button type="button" className="rc-wide" disabled={!!busy} onClick={reload}>ตรวจผลล่าสุดก่อนส่งซ้ำ</button>}
    </ReceivingDialog>}
    {modal === 'void' && <ReceivingDialog title="ยกเลิกเอกสารรับสินค้า" busy={!!busy} onClose={() => setModal('')}>
      <p>เอกสาร #{doc.id} · {doc.supplier_name_text} ระบบจะย้อนผลรับของที่เอกสารนี้บันทึกไว้</p>
      <label>เหตุผลที่ยกเลิก (จำเป็น)<textarea value={reason} maxLength={1000} disabled={disabled} onChange={(event) => setReason(event.target.value)} rows={3} /></label>
      {(dirty || pending.length > 0) && <p className="rc-warning">ข้อมูลและรูปที่ยังไม่ส่งจะไม่ถูกบันทึก</p>}
      {error && <p className="rc-error" role="alert">{error}</p>}
      <button type="button" className="rc-danger rc-wide" disabled={disabled || !reason.trim()} onClick={() => run('กำลังยกเลิกเอกสาร…', async () => {
        adopt(await api.void(doc.id, reason.trim())); setPending([]); setModal(''); setNotice('ยกเลิกเอกสารแล้ว');
      })}>{busy || 'ยืนยันยกเลิกเอกสาร'}</button>
      {uncertain && <button type="button" disabled={!!busy} onClick={reload}>ตรวจผลล่าสุดก่อนส่งซ้ำ</button>}
    </ReceivingDialog>}
    {modal === 'leave' && <ReceivingDialog title="มีข้อมูลที่ยังไม่ส่ง" busy={false} onClose={() => setModal('')}>
      <p>การกลับรายการจะทิ้งข้อมูลที่ยังไม่บันทึกและรูปที่รอส่งในหน้านี้ ต้องการกลับหรือไม่</p>
      <button type="button" className="rc-danger rc-wide" onClick={onBack}>ทิ้งข้อมูลค้างและกลับรายการ</button>
    </ReceivingDialog>}
  </>;
}
