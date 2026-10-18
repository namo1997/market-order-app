import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { errorText, documentBody, canVoid, warningText } from './receiving-utils';
import { ReceivingIllustration } from './ReceivingIllustration';
import { BillReadingProgress } from './BillReadingProgress';
import { ImagePages } from './ImagePages';
import { SignaturePad } from './SignaturePad';
import { ReceivingNumberField } from './ReceivingNumberField';
import { ProductPicker } from './ProductPicker';
import { ReviewRows } from './ReviewRows';
import { ReviewSummary } from './ReviewSummary';
import { headerErrors, normalizeLineEntry, focusField } from './receiving-validation';
import { reviewWarnings } from './receiving-review';
import { rowDecision, validCount, billAlias } from './review-a';
import { assignPageNumbers } from './image-utils';
import { useReceivingDirty } from './use-receiving-dirty';
import { ReceivingDialog } from './ReceivingDialog';
import { PrimaryAction, Toast } from '../../design';
import './review-a.css';

export function DocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, online = true, onNextShop, nextShopStatus = 'complete', onRefreshQueue }) {
  const [doc, setDoc] = useState(initialDocument);
  const [step, setStep] = useState(initialDocument.status !== 'draft' ? 'summary' : initialDocument.counted_complete_at ? 'compare' : 'images');
  const [counts, setCounts] = useState(() => Object.fromEntries(initialDocument.lines.map(line => [line.id, ''])));
  const [pending, setPending] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ink, setInk] = useState(false);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState(false);
  const [reason, setReason] = useState('');
  const [signature, setSignature] = useState('');
  const [reading, setReading] = useState(false);
  const [readingHidden, setReadingHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [courierSignature, setCourierSignature] = useState('');
  const [courierInk, setCourierInk] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [summaryChanged, setSummaryChanged] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const autoRead = useRef(new Set());
  const uncertain = useRef(false);
  const lock = useRef(false);
  const camera = useRef(null);
  const localSequence = useRef(-1);
  const savedDocument = useRef(initialDocument);
  const readingStartedAt = useRef(initialDocument.ocr?.status === 'pending' ? Date.now() : null);
  const draft = doc.status === 'draft';
  const success = doc.status === 'confirmed' && !showReceipt;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [step, doc.status, showReceipt]);
  const blind = draft && !doc.counted_complete_at;
  const readingActive = reading || doc.ocr?.status === 'pending';
  const disabled = busy || processing || !online || !!recovery || doc.ocr?.status === 'pending';
  const unsaved = dirty || pending.length > 0 || ink || courierInk || Object.values(counts).some(value => value !== '');
  useReceivingDirty(!!(unsaved || busy || processing), onDirtyChange);
  const adopt = next => { savedDocument.current = next; setDoc(next); setDirty(false); onChanged?.(next); };
  const act = async (fn, readOnly = false) => {
    if (uncertain.current && !readOnly) return false;
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); return true; }
    catch (failure) { setError(failure.response || failure.request ? errorText(failure) : failure.message); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const upload = async () => {
    const pages = assignPageNumbers(doc.images, pending); setPending(pages);
    for (const page of pages) {
      await api.uploadImage(doc.id, page.pageNo, page.dataUrl);
      setPending(current => current.filter(item => item.key !== page.key));
    }
    if (pages.length) adopt(await api.get(doc.id));
  };
  const save = async value => {
    const normalized = { ...value, lines: value.lines.map(line => { const normalized = normalizeLineEntry(line); if (normalized.id <= 0) delete normalized.id; return normalized; }) };
    const errors = headerErrors(normalized);
    const bad = Object.keys(errors).find(key => errors[key]);
    if (bad) { focusField(`header-${bad}`); throw new Error(errors[bad]); }
    const body = documentBody(normalized, deleted);
    body.lines = body.lines.map((line, index) => ({ ...line, remember_alias: !!line.remember_alias && !!billAlias(value.lines[index], value), review_decision: value.lines[index].review_decision || null }));
    if (value.scope === 'branch') body.lines = body.lines.map(line => {
      const before = savedDocument.current.lines.find(row => row.id === line.id);
      return { id: line.id, review_decision: line.review_decision, remember_alias: line.remember_alias,
        ...(line.match?.source === 'manual' && before.match?.source === 'ai' ? { match: line.match } : {}),
        ...(Number(line.quantity_received) !== Number(before.quantity_received) ? { quantity_received: line.quantity_received } : {}),
        ...(String(line.unit_price ?? '') !== String(before.unit_price ?? '') ? { unit_price: line.unit_price, amount: line.amount } : {}),
        ...(String(line.quantity_billed ?? '') !== String(before.quantity_billed ?? '') ? { quantity_billed: line.quantity_billed, amount: line.amount } : {}) };
    });
    const next = await api.update(doc.id, body); adopt(next); setDeleted([]); return next;
  };
  const change = (id, patch) => {
    setDoc(current => ({ ...current, has_receiver_signature: false,
      lines: current.lines.map(line => line.id === id ? { ...line, ...patch, review_decision: null } : line) })); setDirty(true);
  };
  const decide = (id, decision) => act(async () => {
    const next = { ...doc, lines: doc.lines.map(line => line.id === id ? { ...line, ...(decision === 'not_received' ? { quantity_received: '0', remember_alias: false } : {}), review_decision: decision,
      match: decision && line.match?.source === 'ai' ? { source: 'manual', confidence: 1 } : line.match } : line) };
    await save(next);
  });
  const readBill = () => act(async () => {
    if (pending.length || dirty || doc.ocr?.status === 'pending') return;
    readingStartedAt.current = Date.now(); setReading(true); setReadingHidden(false);
    try { adopt(await api.ocr(doc.id)); }
    catch (failure) { if (!failure.response || failure.response.status >= 500) { uncertain.current = true; setRecovery('ocr'); } throw failure; }
    finally { setReading(false); }
  });
  // Reserve once per document + saved image set before starting the paid write.
  // Failures require the existing explicit retry/recovery action, never an effect loop.
  useEffect(() => {
    if (step !== 'compare' || !draft || blind || !online || disabled || dirty || pending.length || !doc.images.length || !['none', undefined, null].includes(doc.ocr?.status)) return;
    const key = `${doc.id}:${doc.images.map(page => `${page.id}:${page.sha256 || ''}`).join(',')}`;
    if (autoRead.current.has(key)) return;
    autoRead.current.add(key); readBill();
  }, [step, doc, disabled, online, dirty, pending.length]);
  useEffect(() => {
    if (doc.ocr?.status !== 'pending' || reading) return;
    let alive = true; let timer;
    const poll = async () => {
      try { const next = await api.get(doc.id); if (!alive) return; if (next.ocr?.status !== 'pending') { adopt(next); return; } }
      catch { /* Read-only polling never retries OCR. */ }
      if (alive) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => { alive = false; clearTimeout(timer); };
  }, [doc.id, doc.ocr?.status, reading]);
  const signatureSave = (role, image, name) => act(async () => {
    await api.signature(doc.id, role, image, name);
    if (role === 'receiver') setSignature(image); else setCourierSignature(image);
    setDoc(current => ({ ...current, [`has_${role}_signature`]: true }));
    try {
      const next = await api.get(doc.id);
      const signatureSummary = value => JSON.stringify([value.lines, value.warnings, value.ocr?.warnings, value.total, value.discount, value.vat]);
      if (signatureSummary(next) !== signatureSummary(doc)) { setSummaryChanged(true); setStep('summary'); }
      adopt(next);
    } catch (failure) { setError(errorText(failure)); } // The signature write was acknowledged; keep its proof and clear ink.
  });
  const confirm = () => act(async () => {
    try { const next = await api.confirm(doc.id); adopt(next); if (next.status === 'confirmed') setStep('summary'); }
    catch (failure) { if (!failure.response || failure.response.status >= 500) { uncertain.current = true; setRecovery('confirm'); } throw failure; }
  });
  const reload = () => {
    if (unsaved && !window.confirm('โหลดเอกสารล่าสุด? ข้อมูลที่ยังไม่บันทึกจะถูกแทนที่')) return;
    return act(async () => {
      const next = await api.get(doc.id); adopt(next); uncertain.current = false; setRecovery('');
      setSignature(''); setCourierSignature(''); setDeleted([]); setPending([]); setCounts({});
      if (next.status !== 'draft') setStep('summary');
      else if (next.counted_complete_at) setStep('compare');
    }, true);
  };
  const incomplete = doc.lines.filter(line => !validCount(counts[line.id])).length;
  const undecided = doc.lines.filter(line => !line.review_decision).length;
  const blocked = pending.length > 0 || processing || Object.values(headerErrors(doc)).some(Boolean) || !doc.lines.length;
  const nav = next => { if (next === 'compare' && blind || next === 'sign' && (blind || undecided || dirty || blocked)) return; setStep(next); };
  const primary = (label, fn, off = false) => <PrimaryAction disabled={disabled || off} busy={busy} onClick={() => act(fn)}>{label}</PrimaryAction>;
  const back = () => unsaved ? setLeave(true) : onBack();
  return <section className="ra-document rc-stack" aria-label={doc.scope === 'branch' ? 'ใบรับทั้งสาขา' : 'ใบรับสินค้า'} data-step={success ? 'success' : step}>
    <header className="ra-heading"><button type="button" disabled={disabled} onClick={back}>กลับคิว</button><div><span className="rc-brand">SOLAO</span><h1>{doc.supplier_name_text}</h1><p>ใบรับ #{doc.id} · {doc.scope === 'branch' ? 'ทั้งสาขา · ' : ''}{draft ? 'ร่าง' : doc.status === 'confirmed' ? 'ยืนยันแล้ว' : 'ยกเลิกแล้ว'}</p></div></header>
    {draft && <nav className="ra-steps" aria-label="ขั้นตอนรับสินค้า">{[['images', 'บิล'], ['count', 'นับของ'], ['compare', 'เทียบบิล'], ['sign', 'เซ็นรับ']].map(([value, label]) => <button type="button" key={value} aria-current={step === value ? 'step' : undefined} disabled={disabled || (value === 'count' && !blind) || (value === 'compare' && blind) || (value === 'sign' && (blind || undecided > 0 || dirty || blocked || step !== 'summary'))} onClick={() => nav(value)}>{label}</button>)}</nav>}
    {!online && <Toast status="review">ออฟไลน์ เก็บข้อมูลที่กรอกไว้ก่อนเชื่อมต่อ</Toast>}
    {!blind && !success && <details className="ra-bill-tools" key={step} aria-label="ข้อสังเกตบิล"><summary>บิล / ข้อสังเกตบิล {reviewWarnings(doc).length} ข้อ</summary><div className="rc-stack">
      {[...new Set(reviewWarnings(doc).map(warningText))].map(message => <p key={message}>{message}</p>)}
      <p>นับของครบแล้ว · เก็บจำนวนนับเดิมเป็นหลักฐาน การแก้จากนี้ระบุว่าแก้หลังเปิดบิล</p>
      {draft && <button type="button" disabled={disabled || dirty || !!pending.length || !doc.images.length} onClick={readBill}>อ่านบิลด้วย AI (คงจำนวนนับ)</button>}
      <button type="button" disabled={disabled} onClick={() => setStep('images')}>ดู / เพิ่มรูปบิล</button>
      {draft && <details><summary>ข้อมูลหัวบิล</summary><div className="rc-stack">
        <label>เลขที่บิล<input disabled={disabled} value={doc.doc_ref || ''} maxLength={100} onChange={event => { setDoc({ ...doc, doc_ref: event.target.value }); setDirty(true); }} /></label>
        <label>วันที่ในบิล<input disabled={disabled} type="date" value={doc.doc_date || ''} onChange={event => { setDoc({ ...doc, doc_date: event.target.value }); setDirty(true); }} /></label>
        {['subtotal', 'discount', 'vat', 'total'].map((key, index) => <ReceivingNumberField key={key} disabled={disabled} id={`header-${key}`} validationKey={key} error={headerErrors(doc)[key]} label={['ยอดก่อนปรับ', 'ส่วนลด', 'ภาษี', 'ยอดบิล'][index]} value={doc[key] ?? ''} onValueChange={value => { setDoc({ ...doc, [key]: value }); setDirty(true); }} />)}
        <button type="button" disabled={disabled || !dirty} onClick={() => act(async () => save(doc))}>บันทึกหัวบิล</button>
      </div></details>}
    </div></details>}
    {error && <Toast status={/ข้อมูลยังไม่ถูกต้อง|กรอก|ส่วนลด/.test(error) ? 'review' : 'error'}>{error}</Toast>}
    {busy && !readingActive && <p role="status">กำลังบันทึก…</p>}
    {readingActive && !readingHidden && <BillReadingProgress documentId={doc.id} page={doc.images[0]} startedAt={readingStartedAt.current} onCancel={() => setReadingHidden(true)} />}
    {readingActive && readingHidden && <p role="status">กำลังอ่านบิลต่อ… จำนวนที่นับยังอยู่</p>}
    {doc.ocr?.status === 'failed' && <p role="alert">อ่านบิลไม่สำเร็จ จำนวนที่นับยังอยู่ กรอกข้อมูลบิลเองหรืออ่านใหม่ได้</p>}
    {recovery && <div role="status"><p>ยังไม่ทราบผล{recovery === 'confirm' ? 'ยืนยันรับ' : 'อ่านบิล'} ตรวจผลล่าสุดก่อนส่งอีกครั้ง</p><button type="button" disabled={busy || !online} onClick={reload}>ตรวจผลล่าสุด</button></div>}
    {step === 'images' && <>
      <p>ถ่ายบิลไว้ก่อน ระบบเปิดรูปและอ่านบิลหลังยืนยันนับครบ</p>
      <button type="button" className={!doc.images.length && !pending.length ? 'ra-capture-primary' : ''} disabled={disabled || !draft} onClick={() => camera.current?.click()}>ถ่าย / เพิ่มรูปบิล</button>
      <ImagePages doc={doc} blind={blind} showBlindHint={false} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera} />
      <footer className="ra-footer">{primary(blind ? 'ไปนับของจริง' : 'กลับเทียบบิล', async () => { await upload(); setStep(blind ? 'count' : 'compare'); })}</footer>
    </>}
    {step === 'count' && blind && <>
      <div><h2>นับของจริงก่อนเสมอ</h2><p>ชั่งหรือนับทุกสินค้า ไม่พบของให้กรอก 0 อย่างตั้งใจ</p></div>
      {doc.lines.map(line => <article className="ra-count-row" key={line.id}><strong>{line.product_name}</strong><ReceivingNumberField label={`นับได้ ${line.product_name}`} unit={line.unit_text || 'หน่วย'} value={counts[line.id] ?? ''} onValueChange={value => setCounts(current => ({ ...current, [line.id]: value }))} /></article>)}
      {!doc.lines.length && <p>ใบนี้ไม่มีรายการ กรุณากลับคิวแล้วเลือกใบสั่งที่ต้องรับ</p>}
      {doc.scope !== 'branch' && <button type="button" disabled={disabled} onClick={() => setAdding(!adding)}>เพิ่มสินค้าที่มาส่ง</button>}
      {adding && <ProductPicker id="blind-add-product" line={{}} onChange={product => {
        const id = localSequence.current--; setDoc(current => ({ ...current, lines: [...current.lines, { ...product, id, bill_text: '', line_no: current.lines.length + 1 }] }));
        setCounts(current => ({ ...current, [id]: '' })); setAdding(false); setDirty(true);
      }} />}
      <footer className="ra-footer"><p role="status">{incomplete ? `เหลือ ${incomplete} รายการที่ต้องนับ` : 'นับครบทุกสินค้าแล้ว'}</p>
        {primary('ยืนยันการนับและเทียบบิล', async () => {
          const next = await api.count(doc.id, { client_uuid: doc.client_uuid, lines: doc.lines.map(line => ({ ...(line.id > 0 ? { id: line.id } : { product_id: line.product_id, unit_text: line.unit_text }), counted_quantity: counts[line.id] })) });
          adopt(next); setCounts({}); setStep('compare');
        }, incomplete > 0 || !doc.lines.length)}</footer>
    </>}
    {step === 'compare' && !blind && <>
      {draft && doc.scope !== 'branch' && <><button type="button" disabled={disabled} onClick={() => setAdding(!adding)}>เพิ่มรายการหลังเปิดบิล</button>{adding && <ProductPicker id="review-add-product" line={{}} onChange={product => { setDoc(current => ({ ...current, has_receiver_signature: false, lines: [...current.lines, { ...product, id: localSequence.current--, line_no: current.lines.length + 1, quantity_received: '', counted_quantity: null, bill_text: '', quantity_billed: null, unit_price: null }] })); setDirty(true); setAdding(false); }} />}</>}
      <ReviewRows doc={doc} disabled={disabled || !draft} onChange={change} onDelete={id => { setDoc(current => ({ ...current, lines: current.lines.filter(line => line.id !== id) })); if (id > 0) setDeleted(current => [...current, id]); setDirty(true); }} onDecide={decide} onBulk={() => act(async () => save({ ...doc, lines: doc.lines.map(line => !line.review_decision && rowDecision(line, doc).kind === 'accept' ? { ...line, review_decision: 'accept' } : line) }))} />
      <footer className="ra-footer"><p>{undecided ? `เหลือ ${undecided} รายการที่ต้องตัดสินใจ` : 'ตัดสินใจครบแล้ว'}</p>{primary('ดูสรุปก่อนเซ็น', async () => { if (dirty) await save(doc); setStep('summary'); }, undecided > 0 || blocked)}</footer>
    </>}
    {success && <div className="ra-success" aria-label="รับของสำเร็จ"><ReceivingIllustration state="received-success" eager /><strong>เลขที่รับ #{doc.id}</strong>
      {nextShopStatus === 'loading' && <p role="status">กำลังโหลดคิวล่าสุด…</p>}
      {nextShopStatus === 'error' ? <button type="button" className="sg-primary sg-press" onClick={onRefreshQueue}>ลองโหลดคิวใหม่</button> : <button type="button" className="sg-primary sg-press" disabled={nextShopStatus === 'loading'} onClick={onNextShop || onBack}>{nextShopStatus === 'pending' ? 'ไปร้านถัดไป' : 'กลับหน้ารับสินค้า'}</button>}
      <button type="button" className="ra-secondary-action" onClick={() => setShowReceipt(true)}>ดูเอกสาร</button>
    </div>}
    {step === 'summary' && !blind && <><div className="ra-receipt-body" data-collapsed={success}>{!draft && !success && <ReceivingIllustration state={doc.status === 'confirmed' ? 'received-success' : 'error'} description={doc.status === 'confirmed' ? 'ระบบยืนยันใบรับแล้ว' : 'ใบรับถูกยกเลิกแล้ว'} />}<ReviewSummary doc={doc} /></div>
      {draft ? <footer className="ra-footer">{summaryChanged && <p role="status">บันทึกลายเซ็นแล้ว · สรุปเปลี่ยน กรุณาตรวจอีกครั้ง</p>}{primary(summaryChanged ? 'รับทราบสรุปและกลับไปเซ็น' : 'ไปเซ็นรับของ', async () => { setSummaryChanged(false); setStep('sign'); }, undecided > 0 || dirty || blocked)}</footer>
        : <><div className="ra-receipt-body" data-collapsed={success}><SignaturePad label="ผู้รับสินค้า" documentId={doc.id} role="receiver" saved={doc.has_receiver_signature} inline readOnly /><SignaturePad label="ผู้ส่งของ" documentId={doc.id} role="courier" saved={doc.has_courier_signature} inline readOnly /></div>{!success && doc.status === 'confirmed' && nextShopStatus === 'loading' && <p role="status">กำลังโหลดคิวล่าสุด…</p>}{!success && (nextShopStatus === 'error' ? <button type="button" className="sg-primary sg-press" onClick={onRefreshQueue}>ลองโหลดคิวใหม่</button> : <button type="button" className="sg-primary sg-press" disabled={nextShopStatus === 'loading'} onClick={onNextShop || onBack}>{nextShopStatus === 'pending' ? 'ไปร้านถัดไป' : 'กลับหน้ารับสินค้า'}</button>)}</>}
    </>}
    {step === 'sign' && !blind && <>
      <ReviewSummary doc={doc} compact />
      <SignaturePad label={`ผู้รับ ${user.name}`} documentId={doc.id} role="receiver" saved={doc.has_receiver_signature} savedImage={signature} inline readOnly={!draft} disabled={disabled || dirty || undecided > 0 || blocked} onInkChange={setInk}
        onSave={image => signatureSave('receiver', image, user.name)} />
      <label>ชื่อผู้ส่งของ<input value={doc.courier_name || ''} disabled={disabled} onChange={event => { setDoc({ ...doc, courier_name: event.target.value }); setDirty(true); }} /></label>
      {dirty && <button type="button" disabled={disabled} onClick={() => act(async () => save(doc))}>บันทึกชื่อผู้ส่ง</button>}
      <SignaturePad label="ผู้ส่งของ (ไม่บังคับ)" documentId={doc.id} role="courier" saved={doc.has_courier_signature} savedImage={courierSignature} inline readOnly={!draft} disabled={disabled || dirty || undecided > 0 || blocked} onInkChange={setCourierInk}
        onSave={image => signatureSave('courier', image, doc.courier_name)} />
      <footer className="ra-footer"><PrimaryAction disabled={disabled || !doc.has_receiver_signature || ink || courierInk || dirty || undecided > 0 || blocked} busy={busy} onClick={confirm}>ยืนยันรับสินค้า</PrimaryAction></footer>
    </>}
    {draft && !recovery && <details className="ra-more"><summary>เพิ่มเติม</summary><button type="button" disabled={disabled || ink || courierInk} onClick={reload}>{blind ? 'ตรวจผลการนับล่าสุด' : 'โหลดเอกสารล่าสุด'}</button></details>}
    {!draft && canVoid(doc, user) && <div className="rc-stack ra-receipt-body" data-collapsed={success}><label>เหตุผลยกเลิก<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>{primary('ยกเลิกใบรับ', async () => adopt(await api.void(doc.id, reason)), !reason.trim())}</div>}
    {leave && <ReceivingDialog title="มีข้อมูลที่ยังไม่ส่ง" onClose={() => setLeave(false)} actions={<button type="button" onClick={onBack}>ออกโดยไม่บันทึก</button>}><p>จำนวนและรูปที่ยังไม่ส่งจะหาย</p><button type="button" onClick={() => setLeave(false)}>ทำต่อใบเดิม</button></ReceivingDialog>}
  </section>;
}
