import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { errorText, documentBody, canVoid, warningText } from './receiving-utils';
import { ReceivingIllustration } from './ReceivingIllustration';
import { BillReadingProgress } from './BillReadingProgress';
import { ImagePages } from './ImagePages';
import { SignaturePad } from './SignaturePad';
import { ReceivingNumberField } from './ReceivingNumberField';
import { SupplierProductSuggestions } from './SupplierProductSuggestions';
import { ProductPicker } from './ProductPicker';
import { ReceivingProductScope } from './ReceivingProductScope';
import { ReviewRows } from './ReviewRows';
import { ReviewSummary } from './ReviewSummary';
import { headerErrors, normalizeLineEntry, focusField, focusCountField } from './receiving-validation';
import { flaggedCountLines, activeCountFlags } from './count-warning';
import { reviewWarnings } from './receiving-review';
import { rowDecision, validCount, billAlias, initialReviewStep } from './review-a';
import { assignPageNumbers } from './image-utils';
import { matchBillToCount } from './counted-bill-match';
import { useReceivingDirty } from './use-receiving-dirty';
import { useReceivingBack } from './use-receiving-back';
import { ReceivingDialog } from './ReceivingDialog';
import { PrimaryAction, Toast } from '../../design';
import './review-a.css';

export function DocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, onBackActionChange, online = true, onNextShop, nextShopStatus = 'complete', onRefreshQueue }) {
  const [doc, setDoc] = useState(initialDocument);
  const [step, setStep] = useState(initialReviewStep(initialDocument));
  const [countWarnings, setCountWarnings] = useState(null);
  const [countFlags, setCountFlags] = useState({});
  const focusFlagged = useRef(null);
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
  const autoUpload = useRef(new Set());
  const uncertain = useRef(false);
  const lock = useRef(false);
  const camera = useRef(null);
  const localSequence = useRef(-1);
  const savedDocument = useRef(initialDocument);
  const readingStartedAt = useRef(initialDocument.ocr?.status === 'pending' ? Date.now() : null);
  const flags = activeCountFlags(countFlags, counts);
  const draft = doc.status === 'draft';
  const success = doc.status === 'confirmed' && !showReceipt;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [step, doc.status, showReceipt]);
  const manual = doc.kind === 'manual_receipt';
  const blind = draft && !doc.counted_complete_at;
  const readingActive = reading || doc.ocr?.status === 'pending';
  const disabled = busy || processing || !online || !!recovery || doc.ocr?.status === 'pending';
  const unsaved = dirty || pending.length > 0 || ink || courierInk || Object.values(counts).some(value => value !== '');
  useReceivingDirty(!!(unsaved || busy || processing), onDirtyChange);
  // The sheet is modal, so the field can take focus only after it has closed.
  useEffect(() => {
    if (countWarnings || focusFlagged.current == null) return;
    const id = focusFlagged.current; focusFlagged.current = null;
    focusCountField(id);
  }, [countWarnings]);
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
    let next = doc;
    if (pages.length) {
      try { next = await api.get(doc.id); }
      catch (failure) { uncertain.current = true; setRecovery('upload'); throw failure; }
    }
    if (pages.length) adopt(next);
    return next;
  };
  const save = async value => {
    const normalized = { ...value, lines: value.lines.map(line => { const normalized = normalizeLineEntry(line); if (normalized.id <= 0) delete normalized.id; return normalized; }) };
    const errors = headerErrors(normalized);
    const bad = Object.keys(errors).find(key => errors[key]);
    if (bad) { focusField(`header-${bad}`); throw new Error(errors[bad]); }
    const body = documentBody(normalized, deleted);
    body.lines = body.lines.map((line, index) => ({ ...line, remember_alias: !!line.remember_alias && !!billAlias(value.lines[index], value), review_decision: value.lines[index].review_decision || null, return_status: value.lines[index].review_decision === 'not_received' ? value.lines[index].return_status || 'waiting' : null }));
    if (value.scope === 'branch') body.lines = body.lines.map(line => {
      const before = savedDocument.current.lines.find(row => row.id === line.id);
      return { id: line.id, note: line.note, review_decision: line.review_decision, return_status: line.return_status, remember_alias: line.remember_alias,
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
  const matchCounted = (billId, targetId) => {
    const next = matchBillToCount(doc, billId, targetId);
    if (!next) return;
    setDoc(next); setDirty(true);
    if (billId > 0) setDeleted(current => [...new Set([...current, billId])]);
  };
  const decide = (id, decision, returnStatus = 'waiting') => act(async () => {
    const next = { ...doc, lines: doc.lines.map(line => line.id === id ? { ...line, ...(decision === null && line.review_decision === 'not_received' ? { quantity_received: line.counted_quantity ?? line.quantity_received } : {}), ...(decision === 'not_received' ? { quantity_received: '0', remember_alias: false, return_status: returnStatus } : {}), review_decision: decision,
      ...(decision === 'not_delivered' ? { remember_alias: false } : {}),
      match: decision && line.match?.source === 'ai' ? { source: 'manual', confidence: 1 } : line.match } : line) };
    await save(next);
  });
  const readSavedBill = async next => {
    autoRead.current.add(`${next.id}:${next.images.map(page => `${page.id}:${page.sha256 || ''}`).join(',')}`);
    readingStartedAt.current = Date.now(); setReading(true); setReadingHidden(false);
    try { adopt(await api.ocr(next.id)); }
    catch (failure) { if (!failure.response || failure.response.status >= 500) { uncertain.current = true; setRecovery('ocr'); } throw failure; }
    finally { setReading(false); }
  };
  const readBill = () => act(async () => {
    if (pending.length || dirty || doc.ocr?.status === 'pending') return;
    await readSavedBill(doc);
  });
  const uploadBill = async () => {
    const hasNewImages = pending.length > 0;
    if (!blind && hasNewImages && dirty) await save(doc);
    const next = await upload();
    setStep(blind ? 'count' : 'compare');
    if (!blind && hasNewImages && next.images.length) await readSavedBill(next);
  };
  useEffect(() => {
    if (step !== 'images' || manual || blind || !draft || !online || disabled || dirty || !pending.length ||
      pending.some(page => page.quality?.warnings.length && !page.qualityAccepted)) return;
    const keys = pending.map(page => `${doc.id}:${page.key}`);
    if (keys.every(key => autoUpload.current.has(key))) return;
    keys.forEach(key => autoUpload.current.add(key));
    act(uploadBill);
  }, [step, doc.id, manual, blind, draft, online, disabled, dirty, pending]);
  // Reserve once per document + saved image set before starting the paid write.
  // Failures require the existing explicit retry/recovery action, never an effect loop.
  useEffect(() => {
    if (manual || step !== 'compare' || !draft || blind || !online || disabled || dirty || pending.length || !doc.images.length || !['none', undefined, null].includes(doc.ocr?.status)) return;
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
      setStep(initialReviewStep(next));
    }, true);
  };
  const addCountProduct = product => {
    const existing = doc.lines.find(line => Number(line.product_id) === Number(product.product_id));
    if (existing) { setAdding(false); focusField(`count-${existing.id}`); return; }
    const id = localSequence.current--;
    setDoc(current => ({ ...current, lines: [...current.lines, { product_id: product.product_id, product_name: product.product_name,
      unit_id: product.unit_id, unit_text: product.unit_text || '', unit_multiplier: 1, match: { source: 'manual', confidence: 1 },
      remember_alias: false, id, bill_text: '', line_no: current.lines.length + 1 }] }));
    setCounts(current => ({ ...current, [id]: '' })); setAdding(false); setDirty(true);
  };
  const countBody = () => ({ client_uuid: doc.client_uuid, lines: doc.lines.map(line => ({
    ...(line.id > 0 ? { id: line.id } : { product_id: line.product_id, unit_text: line.unit_text }), counted_quantity: counts[line.id] })) });
  const persistCount = async () => {
    const next = await api.count(doc.id, countBody());
    adopt(next); setCounts({}); setCountWarnings(null); setCountFlags({}); setStep(manual ? 'summary' : 'compare');
  };
  // Closing the sheet (x, Escape, outside tap, Android Back) means "edit", never save.
  const reviewFlaggedCounts = () => {
    const flagged = flaggedCountLines(doc.lines, countWarnings || []).flatMap(item => item.lines);
    setCountFlags(Object.fromEntries(flagged.map(line => [line.id, counts[line.id] ?? ''])));
    focusFlagged.current = flagged.length ? `count-${flagged[0].id}` : null;
    setCountWarnings(null);
  };
  const incomplete = doc.lines.filter(line => !validCount(counts[line.id])).length;
  const undecided = doc.lines.filter(line => !line.review_decision).length;
  const blocked = pending.length > 0 || processing || Object.values(headerErrors(doc)).some(Boolean) || !doc.lines.length;
  const nav = next => { if (['compare', 'summary'].includes(next) && blind || next === 'sign' && (blind || undecided || dirty || blocked)) return; setStep(next); };
  const primary = (label, fn, off = false) => <PrimaryAction disabled={disabled || off} busy={busy} onClick={() => act(fn)}>{label}</PrimaryAction>;
  const back = () => unsaved ? setLeave(true) : onBack();
  useReceivingBack(onBackActionChange, () => {
    // The shell has already asked before discarding local counts/images/ink.
    setDoc(savedDocument.current); setDirty(false); setPending([]); setCounts({}); setDeleted([]);
    setInk(false); setCourierInk(false); setAdding(false);
    if (!draft || step === 'images' || (manual && step !== 'sign')) { onBack(); return; }
    setStep(step === 'sign' ? 'summary' : step === 'summary' ? 'compare' : 'images');
  }, busy || processing || readingActive || !!recovery);
  return <ReceivingProductScope.Provider value={{ branchId: doc.branch_id, departmentId: doc.department_id }}><section className="ra-document rc-stack" aria-label={doc.scope === 'branch' ? 'ใบรับทั้งสาขา' : 'ใบรับสินค้า'} data-step={success ? 'success' : step}>
    <header className="ra-heading"><button type="button" disabled={disabled} onClick={back}>กลับคิว</button><div><span className="rc-brand">SOLAO</span><h1>{doc.supplier_name_text}</h1>{!doc.supplier_master_id && !doc.product_group_id && <p className="rc-muted">ร้านใหม่ รอบัญชีตรวจ</p>}<p>ใบรับ #{doc.id} · {doc.scope === 'branch' ? 'ทั้งสาขา · ' : ''}{draft ? 'ร่าง' : doc.status === 'confirmed' ? 'ยืนยันแล้ว' : 'ยกเลิกแล้ว'}</p></div></header>
    {draft && <nav className="ra-steps" data-manual={manual} aria-label="ขั้นตอนรับสินค้า">{(manual ? [['count', 'นับของ'], ['summary', 'สรุป'], ['sign', 'เซ็นรับ']] : [['images', 'บิล'], ['count', 'นับของ'], ['compare', 'เทียบบิล'], ['sign', 'เซ็นรับ']]).map(([value, label]) => <button type="button" key={value} aria-current={step === value ? 'step' : undefined} disabled={disabled || (value === 'count' && !blind) || (['compare', 'summary'].includes(value) && blind) || (value === 'sign' && (blind || undecided > 0 || dirty || blocked || step !== 'summary'))} onClick={() => nav(value)}>{label}</button>)}</nav>}
    {!blind && !success && <div role="status" className="rc-stack">{[...new Set(reviewWarnings(doc).filter(warning => ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SHIP_TO_MISMATCH'].includes(warning.code)).map(warning => warningText(warning.code === 'LINE_AMOUNT_MISMATCH' ? 'BILL_TOTAL_MISMATCH' : warning)))].map(message => <p key={message}>{message}</p>)}</div>}
    {!online && <Toast status="review">ออฟไลน์ เก็บข้อมูลที่กรอกไว้ก่อนเชื่อมต่อ</Toast>}
    {!manual && !blind && !success && <details className="ra-bill-tools" key={step} aria-label="ข้อสังเกตบิล"><summary>บิล / ข้อสังเกตบิล {reviewWarnings(doc).length} ข้อ</summary><div className="rc-stack">
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
    {manual && <p>{doc.lines.some(line => line.order_item_id) ? 'ใบรับไม่มีบิล · นับของจริง แล้วตรวจสรุปเทียบใบสั่งก่อนเซ็นรับ' : 'ใบรับไม่มีบิล · นับของจริง แล้วตรวจสรุปก่อนเซ็นรับ'}</p>}
    {manual && !blind && !success && <details><summary>รูปของ (ไม่บังคับ)</summary><ImagePages doc={doc} blind={false} showHint={false} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera} /><button type="button" disabled={disabled || !draft} onClick={() => camera.current?.click()}>เพิ่มรูปของ</button>{pending.length > 0 && <button type="button" disabled={disabled} onClick={() => act(upload)}>บันทึกรูปของ</button>}</details>}
    {error && <Toast status={/ข้อมูลยังไม่ถูกต้อง|กรอก|ส่วนลด/.test(error) ? 'review' : 'error'}>{error}</Toast>}
    {busy && !readingActive && <p role="status">กำลังบันทึก…</p>}
    {readingActive && !readingHidden && <BillReadingProgress documentId={doc.id} page={doc.images[0]} startedAt={readingStartedAt.current} onCancel={() => setReadingHidden(true)} />}
    {readingActive && readingHidden && <p role="status">กำลังอ่านบิลต่อ… จำนวนที่นับยังอยู่</p>}
    {doc.ocr?.status === 'failed' && <p role="alert">อ่านบิลไม่สำเร็จ จำนวนที่นับยังอยู่ กรอกข้อมูลบิลเองหรืออ่านใหม่ได้</p>}
    {recovery && <div role="status"><p>ยังไม่ทราบผล{recovery === 'confirm' ? 'ยืนยันรับ' : recovery === 'upload' ? 'โหลดรูปที่บันทึก' : 'อ่านบิล'} ตรวจผลล่าสุดก่อนส่งอีกครั้ง</p><button type="button" disabled={busy || !online} onClick={reload}>ตรวจผลล่าสุด</button></div>}
    {step === 'images' && !manual && <>
      <p>{blind ? 'ถ่ายบิลไว้ก่อน ระบบเปิดรูปและอ่านบิลหลังยืนยันนับครบ' : 'นับครบแล้ว · เพิ่มรูปบิลเพื่อส่งและอ่านด้วย AI ทันที'}</p>
      <button type="button" className={!doc.images.length && !pending.length ? 'ra-capture-primary' : ''} disabled={disabled || !draft} onClick={() => camera.current?.click()}>ถ่าย / เพิ่มรูปบิล</button>
      <ImagePages doc={doc} blind={blind} showBlindHint={false} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera} />
      <footer className="ra-footer">{primary(blind ? 'ไปนับของจริง' : 'กลับเทียบบิล', uploadBill)}</footer>
    </>}
    {countWarnings && <ReceivingDialog title="ตรวจจำนวนนับอีกครั้ง" busy={busy} className="rc-count-warning-sheet rc-back-dismiss" onClose={reviewFlaggedCounts} actions={<><PrimaryAction icon="edit" disabled={busy} onClick={reviewFlaggedCounts}>แก้ไข</PrimaryAction><button type="button" className="ra-secondary-action" disabled={disabled} onClick={() => act(persistCount)}>ยืนยัน จำนวนนี้ถูกต้อง</button></>}>
      <p>จำนวนที่นับสูงผิดปกติ ตรวจอีกครั้งก่อนยืนยัน</p>
      <ul className="ra-count-warning-list">{flaggedCountLines(doc.lines, countWarnings).map(({ warning, line }, i) => <li key={i}><strong>{line?.product_name || 'สินค้า'}:</strong> จำนวน {warning.quantity} {warning.unit} ถูกต้องไหม?</li>)}</ul>
    </ReceivingDialog>}
    {step === 'count' && blind && <>
      <div><h2>นับของจริงก่อนเสมอ</h2><p>ชั่งหรือนับทุกสินค้า ไม่พบของให้กรอก 0 อย่างตั้งใจ</p></div>
      {doc.lines.map(line => <article className="ra-count-row" key={line.id}><strong>{line.product_name}</strong><ReceivingNumberField id={`count-${line.id}`} className={flags[line.id] ? 'ra-count-flagged' : ''} hint={flags[line.id] ? 'ตรวจจำนวนอีกครั้ง' : undefined} disabled={disabled} label={`นับได้ ${line.product_name}`} unit={line.unit_text || 'หน่วย'} value={counts[line.id] ?? ''} onValueChange={value => setCounts(current => ({ ...current, [line.id]: value }))} /></article>)}
      {!doc.lines.length && <p>ยังไม่มีสินค้า · กด เพิ่มสินค้าที่มาส่ง</p>}
      {doc.scope !== 'branch' && <button type="button" disabled={disabled} onClick={() => setAdding(!adding)}>เพิ่มสินค้าที่มาส่ง</button>}
      {doc.scope !== 'branch' && !doc.lines.some(line => line.order_item_id) && <SupplierProductSuggestions doc={doc} user={user} disabled={disabled} online={online} onAdd={addCountProduct} />}
      {adding && <ProductPicker branchId={doc.branch_id} departmentId={doc.department_id} id="blind-add-product" line={{}} disabled={disabled} existingLines={doc.lines} onExisting={line => { setAdding(false); focusField(`count-${line.id}`); }} onChange={addCountProduct} />}
      <footer className="ra-footer"><p role="status">{!doc.lines.length ? 'ยังไม่มีสินค้าให้นับ' : incomplete ? `เหลือ ${incomplete} รายการที่ต้องนับ` : 'นับครบทุกสินค้าแล้ว'}</p>
        {primary(manual ? 'ยืนยันการนับ' : 'ยืนยันการนับและเทียบบิล', async () => {
          const checked = await api.count(doc.id, { ...countBody(), check_only: true });
          if (checked.count_warnings?.length) { setCountWarnings(checked.count_warnings); return; }
          await persistCount();
        }, incomplete > 0 || !doc.lines.length)}</footer>
    </>}
    {step === 'compare' && !manual && !blind && <>
      {draft && doc.scope !== 'branch' && <><button type="button" disabled={disabled} onClick={() => setAdding(!adding)}>เพิ่มรายการหลังเปิดบิล</button>{adding && <ProductPicker branchId={doc.branch_id} departmentId={doc.department_id} id="review-add-product" line={{}} onChange={product => { setDoc(current => ({ ...current, has_receiver_signature: false, lines: [...current.lines, { ...product, id: localSequence.current--, line_no: current.lines.length + 1, quantity_received: '', counted_quantity: null, bill_text: '', quantity_billed: null, unit_price: null }] })); setDirty(true); setAdding(false); }} />}</>}
      <ReviewRows doc={doc} disabled={disabled || !draft} onChange={change} onMatchCounted={matchCounted} onDelete={id => { setDoc(current => ({ ...current, lines: current.lines.filter(line => line.id !== id) })); if (id > 0) setDeleted(current => [...current, id]); setDirty(true); }} onDecide={decide} onBulk={() => act(async () => save({ ...doc, lines: doc.lines.map(line => !line.review_decision && rowDecision(line, doc).kind === 'accept' ? { ...line, review_decision: 'accept' } : line) }))} />
      <footer className="ra-footer"><p>{undecided ? `เหลือ ${undecided} รายการที่ต้องตัดสินใจ` : 'ตัดสินใจครบแล้ว'}</p>{primary('ดูสรุปก่อนเซ็น', async () => { if (dirty) await save(doc); setStep('summary'); }, undecided > 0 || blocked)}</footer>
    </>}
    {success && <div className="ra-success" aria-label="รับของสำเร็จ"><ReceivingIllustration state="received-success" eager /><strong>เลขที่รับ #{doc.id}</strong>
      {nextShopStatus === 'loading' && <p role="status">กำลังโหลดคิวล่าสุด…</p>}
      {nextShopStatus === 'error' ? <button type="button" className="sg-primary sg-press" onClick={onRefreshQueue}>ลองโหลดคิวใหม่</button> : <button type="button" className="sg-primary sg-press" disabled={nextShopStatus === 'loading'} onClick={onNextShop || onBack}>{nextShopStatus === 'pending' ? 'ไปร้านถัดไป' : 'กลับหน้ารับสินค้า'}</button>}
      <button type="button" className="ra-secondary-action" onClick={() => setShowReceipt(true)}>ดูเอกสาร</button>
    </div>}
    {step === 'summary' && !blind && <><div className="ra-receipt-body" data-collapsed={success}>{!draft && !success && <ReceivingIllustration state={doc.status === 'confirmed' ? 'received-success' : 'error'} description={doc.status === 'confirmed' ? 'ระบบยืนยันใบรับแล้ว' : 'ใบรับถูกยกเลิกแล้ว'} />}<ReviewSummary doc={doc} onChange={draft ? change : undefined} disabled={disabled} /></div>
      {draft ? <footer className="ra-footer">{summaryChanged && <p role="status">บันทึกลายเซ็นแล้ว · สรุปเปลี่ยน กรุณาตรวจอีกครั้ง</p>}{primary(summaryChanged ? 'รับทราบสรุปและกลับไปเซ็น' : 'ไปเซ็นรับของ', async () => { if (manual && (undecided || dirty)) await save({ ...doc, lines: doc.lines.map(line => ({ ...line, review_decision: line.review_decision || 'missing_bill' })) }); setSummaryChanged(false); setStep('sign'); }, (!manual && (undecided > 0 || dirty)) || blocked)}</footer>
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
    {!draft && doc.status !== 'void' && !canVoid(doc, user) && <p>แก้ข้ามวันให้ฝ่ายบัญชีหรือแอดมิน</p>}
    {!draft && canVoid(doc, user) && <div className="rc-stack ra-receipt-body" data-collapsed={success}><label>เหตุผลยกเลิก<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>{primary('ยกเลิกใบรับ', async () => adopt(await api.void(doc.id, reason)), !reason.trim())}</div>}
    {leave && <ReceivingDialog title="มีข้อมูลที่ยังไม่ส่ง" onClose={() => setLeave(false)} actions={<button type="button" onClick={onBack}>ออกโดยไม่บันทึก</button>}><p>จำนวนและรูปที่ยังไม่ส่งจะหาย</p><button type="button" onClick={() => setLeave(false)}>ทำต่อใบเดิม</button></ReceivingDialog>}
  </section></ReceivingProductScope.Provider>;
}
