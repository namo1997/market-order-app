import { useEffect, useRef, useState } from 'react';
import { useReceivingDirty } from './use-receiving-dirty';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { canVoid, documentBody, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { ocrReadSummary } from './review-card';
import { LineEditor } from './LineEditor';
import { ImagePages } from './ImagePages';
import { BillReadingProgress } from './BillReadingProgress';
import { SignaturePad } from './SignaturePad';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { needsBillCheck } from './receiving-illustration-state';
import { newReviewState, transitionReview, pendingReviewIndices, reviewCounters } from './line-review-state';
import { useReviewLayout } from './use-review-layout';
import { ReceivingNumberField as NumberField } from './ReceivingNumberField';
import { documentReviewSummary, reviewWarnings, reviewFingerprint, reviewChangeMessage, reviewAttention } from './receiving-review';
import { GlassBar, PrimaryAction, IconButton, Segmented, ListCard, StatusPill, Toast } from '../../design';
import { moneyStatus, thaiDate } from './receiving-status';
import { withSavingFeedback } from '../../design/motion-preference';
import { assignPageNumbers } from './image-utils';
import { firstDocumentError, focusField, headerMoneyFields, headerErrors, lineErrors } from './receiving-validation';
import { markOcrProposals, prepareOcrReview, retainAiReview } from './receiving-ai';

const statusText = { draft: 'ร่าง', confirmed: 'ยืนยันรับแล้ว', void: 'ยกเลิกแล้ว' };

export function DocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, onNextShop, nextShopStatus = 'complete', onRefreshQueue, online = true }) {
  const [doc, setDoc] = useState(() => markOcrProposals(initialDocument));
  const [dirty, setDirty] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [pending, setPending] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState('');
  const [reading, setReading] = useState(false);
  const [readingStartedAt, setReadingStartedAt] = useState(null);
  const [readingHidden, setReadingHidden] = useState(false);
  const pendingReadStart = useRef(Date.now());
  const [imageNeedsReading, setImageNeedsReading] = useState(false);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState('');
  // Keep acknowledged submissions in memory only; reopened signatures load through the protected binary API.
  const [signatureImages, setSignatureImages] = useState({});
  const [notice, setNotice] = useState('');
  const [summaryChange, setSummaryChange] = useState('');
  const [summaryContext, setSummaryContext] = useState('before-sign');
  const [uncertain, setUncertain] = useState(false);
  const [modal, setModal] = useState('');
  const [sheetDraft, setSheetDraft] = useState(initialDocument);
  const [reason, setReason] = useState('');
  const [unmatchedOk, setUnmatchedOk] = useState(false);
  const lock = useRef(false);
  const camera = useRef(null);
  const headerEdits = useRef(new Set());
  const focusedRequest = useRef(null);
  const [focusTarget, setFocusTarget] = useState(null);
  const [step, setStep] = useState('images');
  const [receiptDetails, setReceiptDetails] = useState(false);
  const [selected, setSelected] = useState(0);
  const [lineReview, setLineReview] = useState(newReviewState);
  const [chosenLines, setChosenLines] = useState([]);
  const layoutRoot = useReviewLayout(step, uncertain, chosenLines.length > 0, `${lineReview.editing?.index ?? ''}:${doc.status}:${receiptDetails}`);
  const reviewRef = useRef(null);
  const [action, setAction] = useState('header');
  const [expected, setExpected] = useState(null);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const scope = ['admin', 'super_admin'].includes(user.role) ? { branch_id: Number(doc.branch_id || user.branch_id), department_id: Number(doc.department_id || user.department_id) } : {};
    api.expected(doc.delivery_date, scope).then((groups) => {
      if (active) setExpected(groups.flatMap((group) => group.items));
    }).catch(() => { if (active) setExpected(null); });
    return () => { active = false; };
  }, [doc.delivery_date, doc.branch_id, doc.department_id, user.role, user.branch_id, user.department_id, expectedRevision]);
  useEffect(() => {
    if (reading || doc.ocr?.status !== 'pending') return;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const next = await api.get(doc.id);
        if (!active) return;
        if (next.ocr?.status !== 'pending') {
          setDoc(prepareOcrReview(doc, next, headerEdits.current)); setDirty(next.ocr?.status === 'done');
          setNotice(next.ocr?.status === 'done' ? 'อ่านบิลเสร็จแล้ว กรุณาตรวจรายการ' : 'อ่านบิลไม่สำเร็จ กรุณาตรวจผลล่าสุด');
          if (next.ocr?.status === 'done') setStep('lines');
          onChanged(next);
          return;
        }
      } catch { /* Keep pending state; never retry a paid OCR request. */ }
      if (active) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [doc, reading, onChanged]);
  const draft = doc.status === 'draft';
  const disabled = !!busy || processing || uncertain || doc.ocr?.status === 'pending';
  const [receiverInk, setReceiverInk] = useState(false);
  const [courierInk, setCourierInk] = useState(false);
  const sheetDirty = draft && (modal === 'header'
    ? ['supplier_name_text', 'doc_ref', 'doc_date', ...headerMoneyFields].some(key => (sheetDraft[key] ?? '') !== (doc[key] ?? ''))
    : modal === 'courier' && (sheetDraft.courier_name || '') !== (doc.courier_name || ''));
  const hasUnsaved = !!lineReview.editing || dirty || pending.length > 0 || receiverInk || courierInk || sheetDirty || (modal === 'void' && !!reason);
  useReceivingDirty(!!(hasUnsaved || busy || processing), onDirtyChange);

  useEffect(() => {
    if (focusTarget && !busy && focusedRequest.current !== focusTarget) { focusField(focusTarget.id); focusedRequest.current = focusTarget; }
  }, [focusTarget, busy]);
  const showInvalid = (invalid) => {
    if (invalid.index !== undefined) { setStep('lines'); setSelected(invalid.index); setModal(''); setLineReview(current => transitionReview({ ...current, lines: doc.lines }, { type: 'edit', index: invalid.index, mode: 'full' }, { kind: doc.kind })); }
    else { setSheetDraft({ ...doc }); setModal('header'); }
    setFocusTarget({ id: invalid.id });
  };
  const adopt = (next) => {
    setLineReview(newReviewState()); setChosenLines([]); setDoc(markOcrProposals(next)); setDeleted([]); setDirty(false);
    if (next.status !== doc.status || next.delivery_date !== doc.delivery_date || next.branch_id !== doc.branch_id || next.department_id !== doc.department_id) setExpectedRevision(value => value + 1);
    onChanged(next);
  };
  const mutate = (values) => { Object.keys(values).filter(key => key !== 'lines').forEach(key => headerEdits.current.add(key)); setDoc((current) => ({ ...current, ...values })); setDirty(true); setNotice(''); };
  const run = async (label, work, ambiguous = true) => {
    if (lock.current) return false;
    lock.current = true; setBusy(label); setError(''); setGuidance(''); setNotice('');
    try { await work(); return true; }
    catch (failure) {
      const message = failure.response || failure.request ? errorText(failure) : failure.message;
      if (failure.response?.status === 422 || (!failure.response && !failure.request)) setGuidance(message);
      else setError(message);
      if ((ambiguous && failure.request && !failure.response) || failure.response?.status === 409) setUncertain(true);
      return false;
    } finally { lock.current = false; setBusy(''); setReadingStartedAt(null); }
  };
  const save = async () => {
    if (lineReview.editing) throw new Error('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน');
    const invalid = firstDocumentError(doc);
    if (invalid) { showInvalid(invalid); throw new Error('ตรวจช่องที่ระบุ แล้วบันทึกอีกครั้ง'); }
    if (!dirty) return doc;
    const body = documentBody(doc, deleted);
    try {
      const next = retainAiReview(await api.update(doc.id, body), doc);
      adopt(next);
      if (summaryChanged(next)) setSummaryChange(reviewChangeMessage(checks, documentReviewSummary(next, comparison)));
      return next;
    } catch (failure) {
      if (failure.request && !failure.response) setUncertain(true);
      throw failure;
    }
  };
  const upload = (readAfter = false) => run('กำลังส่งรูป…', async () => {
    if (readAfter) { setReadingStartedAt(Date.now()); setReadingHidden(false); }
    const saved = await save();
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
    setImageNeedsReading(true);
    setNotice('ส่งรูปครบแล้ว พร้อมอ่านบิล');
    if (readAfter) {
      setReading(true);
      try {
        const next = prepareOcrReview(saved, await api.ocr(doc.id), headerEdits.current);
        const check = needsBillCheck(next);
        setLineReview(newReviewState()); setChosenLines([]); setDoc(next); setDirty(true); setImageNeedsReading(false);
        setStep(check ? 'images' : 'lines'); setSelected(0); setNotice(check ? 'อ่านบิลเสร็จแล้ว กรุณาตรวจภาพบิล' : 'อ่านบิลเสร็จแล้ว · ตรวจจำนวน แล้วใช้ AI หรือบันทึกค่าที่ตรวจแล้ว');
      } catch (failure) {
        if ((failure.request && !failure.response) || failure.response?.status === 409) setUncertain(true);
        throw failure;
      } finally { setReading(false); }
    }
  }, false);

  const reload = () => run('กำลังตรวจผลล่าสุด…', async () => {
    adopt(await api.get(doc.id)); setSignatureImages({}); setUncertain(false); setModal('');
    setNotice('โหลดข้อมูลจากระบบแล้ว กรุณาตรวจรายการก่อนทำต่อ');
  }, false);
  const goToPendingReview = () => {
    const index = pendingReviewIndices(doc.lines)[0];
    if (index === undefined) return;
    setError(''); setStep('lines'); setSelected(index); setChosenLines([]); setModal('');
    setFocusTarget({ id: `line-${index}-inline` });
    setGuidance('ตรวจข้อเสนอ AI กับบิล แล้วใช้ AI หรือบันทึกค่าที่ตรวจแล้ว');
  };
  const review = () => {
    if (pendingReviewIndices(doc.lines).length) { goToPendingReview(); return; }
    if (pending.length) { setError(''); setStep('images'); setGuidance('ส่งรูปที่ค้างให้ครบก่อนตรวจรับ'); return; }
    return run('กำลังบันทึกและตรวจรายการ…', async () => {
      const invalid = firstDocumentError(doc, { requireProducts: true });
      if (invalid) { showInvalid(invalid); throw new Error('ตรวจช่องที่ระบุ แล้วตรวจรับอีกครั้ง'); }
      if (!doc.lines.length) { addLine(); setGuidance('เพิ่มรายการและจำนวนรับจริงก่อน'); return; }
      if (!doc.lines.some(line => scaledInteger(line.quantity_received) > 0n)) {
        showInvalid({ index: 0, id: 'line-0-quantity_received' });
        setGuidance('ระบุจำนวนรับจริงอย่างน้อย 1 รายการมากกว่า 0'); return;
      }
      const next = await save();
      if (summaryChanged(next)) { showChangedSummary(next); return; }
      if (summaryChange) { setSummaryContext('before-sign'); setModal('checks'); return; }
      if (!next.has_receiver_signature) throw new Error('กรุณาบันทึกลายเซ็นผู้รับก่อนยืนยัน');
      if (!next.lines.some((line) => scaledInteger(line.quantity_received) > 0n)) throw new Error('ต้องมีอย่างน้อย 1 รายการที่รับจริงมากกว่า 0');
      if (next.kind === 'bill' && next.lines.some((line) => !line.product_id)) throw new Error('กรุณาเลือกสินค้าให้ครบทุกบรรทัด');
      setUnmatchedOk(false); setModal('confirm');
    });
  };
  const money = moneyStatus(doc.lines, doc.discount, doc.vat, doc.total, doc.subtotal);
  const moneyLabel = money.status === 'ok' ? 'ผลรวมตรงยอดบิล' : money.label;
  const compactTotals = money.total != null && money.total === money.adjusted
    && scaledInteger(doc.discount || '0') === 0n && scaledInteger(doc.vat || '0') === 0n;
  const sheetMoney = moneyStatus(doc.lines, sheetDraft.discount, sheetDraft.vat, sheetDraft.total, sheetDraft.subtotal);
  const sheetErrors = headerErrors({ ...doc, ...sheetDraft });
  const invalidTotal = money.status === 'error';
  // Drafts compare the remaining order. Terminal documents compare their own quantities to the full order.
  const comparison = draft ? expected : expected?.map((item) => ({ ...item, received_quantity: '0' }));
  const uniqueWarnings = reviewWarnings(doc);
  const unmatched = doc.lines.filter((line) => !line.product_id).length;
  const leave = () => {
    if (hasUnsaved) setModal('leave'); else onBack();
  };
  const readBill = () => run('กำลังอ่านบิล', async () => {
    setReadingStartedAt(Date.now()); setReadingHidden(false);
    const saved = await save();
    setReading(true);
    try {
      const response = await api.ocr(doc.id);
      const next = prepareOcrReview(saved, response, headerEdits.current);
      const check = needsBillCheck(next);
      setLineReview(newReviewState()); setChosenLines([]); setDoc(next); setDirty(true);
      setImageNeedsReading(false);
      setStep(check ? 'images' : 'lines'); setSelected(0);
      setNotice(check ? 'อ่านบิลเสร็จแล้ว กรุณาตรวจภาพบิล' : 'อ่านบิลเสร็จแล้ว · ตรวจจำนวน แล้วใช้ AI หรือบันทึกค่าที่ตรวจแล้ว');
    } finally { setReading(false); }
  });
  const saveSignature = async (role, image) => {
    let acknowledged = false;
    await run('กำลังบันทึก…', async () => {
      const saved = await save();
      await withSavingFeedback(() => api.signature(doc.id, role, image, role === 'courier' ? sheetDraft.courier_name : undefined));
      acknowledged = true;
      setSignatureImages(current => ({ ...current, [role]: image }));
      setDoc(current => ({ ...current, [`has_${role}_signature`]: true }));
      const next = retainAiReview(await api.get(doc.id), saved);
      adopt(next);
      if (summaryChanged(next)) showChangedSummary(next, 'after-sign');
    });
    return acknowledged;
  };
  const back = <IconButton icon="back" label="กลับรายการ" disabled={!!busy || processing} onClick={leave} />;
  const more = <IconButton icon="options" showLabel label="เพิ่มเติม" disabled={disabled} onClick={() => { setAction('header'); setModal('more'); }} />;
  const bar = (primary) => <GlassBar>{back}{more}{primary}</GlassBar>;
  const selectedLine = doc.lines[selected];
  const unreviewedCount = pendingReviewIndices(doc.lines).length;
  const invalidDocument = firstDocumentError(doc, { requireProducts: true });
  const needsReceivedQty = !invalidDocument && doc.lines.length > 0 && !doc.lines.some(line => scaledInteger(line.quantity_received) > 0n);
  const reviewLabel = unreviewedCount ? `ตรวจรายการก่อน (ค้าง ${unreviewedCount})`
    : pending.length ? `ส่งรูปก่อน (ค้าง ${pending.length})` : !doc.lines.length ? 'เพิ่มรายการ'
      : invalidDocument ? 'ตรวจข้อมูลก่อน' : needsReceivedQty ? 'ระบุจำนวนรับจริงก่อน' : 'ตรวจรับ';
  const dispatchReview = event => {
    const previous = reviewRef.current || { ...lineReview, lines: doc.lines };
    const next = transitionReview(previous, event.type === 'save-next' ? { type: 'save' } : event, { expectedItems: comparison, kind: doc.kind, warnings: uniqueWarnings });
    if (next.editing && (next.error || previous.editing?.index !== next.editing.index || event.type === 'edit')) {
      const invalid = Object.entries(lineErrors(next.editing.line, doc.kind)).find(([, value]) => value)?.[0];
      setFocusTarget({ id: next.editing.mode === 'full' ? `line-${next.editing.index}-${invalid || 'quantity_received'}` : `line-${next.editing.index}-inline` });
    }
    if (event.type === 'save-next' && !next.editing) {
      const after = pendingReviewIndices(next.lines);
      const index = after.find(index => index > previous.editing.index) ?? after[0];
      if (index !== undefined) { setSelected(index); setFocusTarget({ id: `line-${index}-inline` }); }
    }
    if (event.type === 'edit' || event.type === 'input') setChosenLines([]);
    reviewRef.current = next;
    setError(''); setGuidance(''); setLineReview(next);
    if (next.lines !== previous.lines) mutate({ lines: next.lines });
  };
  useEffect(() => { reviewRef.current = { ...lineReview, lines: doc.lines }; }, [lineReview, doc.lines]);
  const checks = documentReviewSummary(doc, comparison);
  const summaryChanged = next => reviewFingerprint(checks) !== reviewFingerprint(documentReviewSummary(next, comparison));
  const showChangedSummary = (next, context = 'before-sign') => {
    setSummaryContext(context); setSummaryChange(reviewChangeMessage(checks, documentReviewSummary(next, comparison))); setGuidance(''); setModal('checks');
  };
  const acknowledgeSummary = () => {
    setSummaryChange(''); setNotice(''); setGuidance(''); setModal('');
    if (summaryContext === 'before-sign') setStep('sign');
  };
  const continueToSignature = () => {
    if (lineReview.editing) { setGuidance('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน'); return; }
    if (unreviewedCount) { goToPendingReview(); return; }
    const invalid = firstDocumentError(doc, { requireProducts: true });
    if (invalid) { setError(''); setGuidance('ตรวจช่องที่ระบุ แล้วทำรายการต่อ'); showInvalid(invalid); return; }
    if (!doc.lines.length) { addLine(); setGuidance('เพิ่มรายการก่อนเซ็นรับของ'); return; }
    setGuidance(''); setError('');
    if (summaryChange) { setSummaryContext('before-sign'); setModal('checks'); return; }
    setNotice(''); setStep('sign'); window.scrollTo(0, 0);
  };
  const removeLine = () => {
    setLineReview(newReviewState()); setChosenLines([]);
    if (!selectedLine) return;
    if (selectedLine.id) setDeleted((current) => [...current, selectedLine.id]);
    mutate({ lines: doc.lines.filter((_, index) => index !== selected) }); setSelected(0); setModal('');
  };
  const addLine = () => {
    setLineReview({ ...newReviewState(), editing: { index: doc.lines.length, mode: 'full', line: { bill_text: '', quantity_billed: '', quantity_received: '0', unit_price: '', amount: '' } } });
    setChosenLines([]);
    mutate({ lines: [...doc.lines, { _key: crypto.randomUUID(), bill_text: '', quantity_billed: '', quantity_received: '0', unit_price: '', amount: '' }] });
    setSelected(doc.lines.length); setStep('lines'); setModal('');
  };
  const applyAction = () => {
    if (action === 'header' || action === 'courier' || action === 'void' || action === 'help') { setSheetDraft({ ...doc }); setModal(action); setReason(''); }
    else if (action === 'add') {
      addLine();
    } else if (action === 'delete') setModal('delete');
    else if (action === 'reload') setModal('reload');
    else if (action === 'camera') { setStep('images'); setModal(''); camera.current?.click(); }
    else if (action === 'retry-images') { setImageAttempt((value) => value + 1); setStep('images'); setModal(''); }
    else if (action === 'ocr') { setModal(''); return readBill(); }
    else if (action === 'save') return run('กำลังบันทึก', async () => {
      const saved = await withSavingFeedback(save); setModal('');
      setNotice(summaryChanged(saved) ? '' : 'บันทึกแล้ว');
    });
  };
  const readingBill = reading || (doc.ocr?.status === 'pending' && !error);
  const billCheck = needsBillCheck(doc) && !imageNeedsReading && !pending.length;
  const hasOcrItems = doc.ocr?.status === 'done' && doc.lines.length > 0 && !imageNeedsReading;
  const imageAction = pending.length ? { icon: 'receipt', label: 'ส่งอ่านบิล', run: () => upload(true) }
    : billCheck ? { icon: 'camera', label: 'ถ่ายบิล' }
      : hasOcrItems ? { icon: 'list', label: 'ตรวจรายการ', run: () => setStep('lines') }
        : !doc.images.length ? { icon: 'camera', label: 'ถ่ายบิล' }
          : { icon: 'scan', label: 'อ่านบิล', run: readBill };
  const reviewGuidance = guidance || (draft && step === 'sign' && unreviewedCount ? `ค้างตรวจ ${unreviewedCount} รายการ ตรวจรายการให้ครบก่อนเซ็นและตรวจรับ` : '');
  const changeStep = next => { if (lineReview.editing) { setGuidance('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน'); return; } setChosenLines([]); setGuidance(''); setNotice(''); if (summaryChange && next === 'sign') { setSummaryContext('before-sign'); setModal('checks'); return; } setStep(next); };
  const counters = reviewCounters(doc.lines, comparison, doc.kind);
  const stateHint = !online ? 'offline' : error ? 'error' : readingBill ? 'reading-bill' : doc.ocr?.status === 'failed' ? 'error' : billCheck && draft ? 'not-a-bill' : reviewGuidance ? 'review-lines' : doc.status === 'confirmed' && step === 'sign' ? 'received-success' : null;
  const feedback = error ? <ReceivingIllustration state="error" description={error} compact />
    : guidance ? <ReceivingIllustration state="review-lines" description={guidance} compact /> : null;
  if (doc.status === 'confirmed' && step === 'sign' && !receiptDetails) return <div ref={layoutRoot} className="rc-document rc-success rc-stack">
    <span className="rc-brand">SOLAO</span><ReceivingIllustration state="received-success" title="รับของเรียบร้อย" description={doc.supplier_name_text} eager />
    <ListCard title="ใบรับสินค้า"><dl className="rc-receipt"><div><dt>เลขที่รับ</dt><dd>{`#${doc.id}`}</dd></div><div><dt>วันที่รับ</dt><dd>{doc.confirmed_at ? new Date(doc.confirmed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : thaiDate(doc.delivery_date)}</dd></div><div><dt>ตรวจแล้ว</dt><dd>{doc.lines.length}/{doc.lines.length} รายการ</dd></div><div><dt>รวมรายการ</dt><dd>{formatBaht(money.billTotal ?? money.adjusted)} บาท</dd></div><div><dt>ผู้รับ</dt><dd>{doc.receiver_name || user.name}</dd></div></dl><PriceNotice checks={checks} received /></ListCard>
    <GlassBar className="rc-success-bar"><PrimaryAction disabled={nextShopStatus === 'loading'} onClick={nextShopStatus === 'error' ? onRefreshQueue : onNextShop || onBack}>
      {nextShopStatus === 'loading' ? 'กำลังโหลดคิว…' : nextShopStatus === 'error' ? 'ลองโหลดคิวใหม่' : nextShopStatus === 'pending' ? 'รับร้านถัดไป' : 'กลับหน้ารับสินค้า'}
    </PrimaryAction><button type="button" className="rc-text-action" onClick={() => setReceiptDetails(true)}>ดูเอกสาร</button></GlassBar>
  </div>;
  return <div ref={layoutRoot} className="rc-stack rc-document" data-step={step}>
    <header className="rc-document-header"><IconButton className="rc-text-action" icon="back" label="กลับรายการ" disabled={!!busy || processing} onClick={leave} /><div><h1>{step === 'images' ? 'ถ่ายบิล' : step === 'lines' ? 'ตรวจรายการ' : 'เซ็นรับ'}</h1><p className="rc-muted">{doc.supplier_name_text || 'รับสินค้า'} <small>#{doc.id} {draft && <span role="status">{dirty || pending.length || lineReview.editing ? 'มีการแก้ไขรอบันทึก' : 'บันทึกร่างแล้ว'}</span>}</small></p></div>{step === 'lines' ? <button type="button" className="rc-text-action" onClick={() => setModal('bill-view')}>ดูบิล</button> : <span className="rc-brand">SOLAO</span>}</header>
    {step !== 'lines' && <Segmented className="rc-steps" label="ขั้นตอนรับสินค้า" value={step} onChange={changeStep} disabled={disabled}
      options={[{ value: 'images', label: '1 บิล' }, { value: 'lines', label: '2 ตรวจ' }, { value: 'sign', label: '3 เซ็น' }]} />}
    {step === 'lines' && doc.ocr?.status === 'done' && <p className="rc-ocr-read-summary" role="status">{ocrReadSummary(doc)}</p>}
    {step === 'lines' && <div className="rc-sr-only"><Segmented label="ขั้นตอนรับสินค้า" value={step} onChange={changeStep} options={[{ value: 'images', label: 'บิล' }, { value: 'lines', label: 'ตรวจ' }, { value: 'sign', label: 'เซ็น' }]} /></div>}
    {busy && !readingBill && <p role="status" className="rc-muted">{busy}</p>}
    {step !== 'sign' && draft && uniqueWarnings.some(warning => warning.code === 'DOC_KIND_UNCERTAIN') && <div><StatusPill status="review">ตรวจชนิดเอกสาร</StatusPill></div>}
    {summaryChange && modal !== 'checks' && <Toast status="review">{summaryChange}</Toast>}
    {notice && <Toast status={unreviewedCount ? 'review' : 'ok'}>{notice}</Toast>}
    {(readingStartedAt !== null || readingBill) && !readingHidden && <BillReadingProgress documentId={doc.id} page={doc.images[0] || pending[0]} startedAt={readingStartedAt ?? pendingReadStart.current} preparing={!readingBill} onCancel={() => {
      setReadingHidden(true); setStep('images'); setNotice('กลับมาดูบิลแล้ว งานที่ส่งให้ AI ยังอ่านต่อ ผลจะแสดงเมื่อเสร็จ');
    }} />}
    {readingHidden && readingBill && <p role="status">AI ยังอ่านบิลอยู่ <button type="button" className="rc-text-action" onClick={() => setReadingHidden(false)}>ดูความคืบหน้า</button><button type="button" className="rc-text-action" onClick={() => setModal('bill-view')}>ดูบิล</button></p>}
    {stateHint && stateHint !== 'reading-bill' && readingStartedAt === null && <ReceivingIllustration state={stateHint} description={stateHint === 'error' && error ? error : stateHint === 'review-lines' ? reviewGuidance : undefined} compact={stateHint !== 'received-success'} />}
    {uncertain && <Toast status="review">ตรวจผลล่าสุดก่อนส่งซ้ำ ข้อมูลที่ยังไม่บันทึกจะถูกแทนที่</Toast>}
    <div hidden={step === 'sign'} className={`rc-section-heading rc-document-total ${step === 'lines' ? 'rc-document-total--review' : ''}`}><div className="rc-bill-amount"><span className="rc-muted">{money.billTotal != null ? 'ยอดตามบิล' : 'รวมรายการสุทธิ'}</span><strong className="rc-money">{invalidTotal ? 'ตรวจยอด' : `${formatBaht(money.billTotal ?? money.adjusted)} บาท`}</strong></div>
      <button type="button" className="rc-review-trigger" aria-label={checks.label} aria-haspopup="dialog" disabled={!!busy || processing} onClick={() => setModal('checks')}>ดูข้อเตือน</button></div>
    <fieldset disabled={disabled} className="rc-editor-fields">
      {/* Keep the file input mounted so the menu can open the camera from any step. */}
      <div hidden={step !== 'images'}>
        <ImagePages showHint={!stateHint} key={imageAttempt} doc={doc} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera}
          renderActions={({ choose }) => step === 'images' && !uncertain && bar(draft
            ? <PrimaryAction icon={imageAction.icon} busy={!!busy || processing} disabled={disabled || (doc.ocr?.status === 'pending' && !pending.length)}
              onClick={imageAction.run || choose}>
              {processing ? 'กำลังย่อรูป' : busy ? (busy.includes('อ่าน') ? 'กำลังอ่าน' : 'กำลังส่ง') : imageAction.label}
            </PrimaryAction>
            : <PrimaryAction onClick={() => setStep('lines')}>ดูรายการ</PrimaryAction>)} />
      </div>
      {step === 'lines' && <div className="rc-stack">
        <LineEditor lines={doc.lines} expectedItems={comparison} kind={doc.kind} onSelect={setSelected} readOnly={!draft}
          warnings={uniqueWarnings} chosen={chosenLines} review={lineReview} guidance={guidance} dispatch={dispatchReview} onSelectionChange={setChosenLines} onViewBill={() => setModal('bill-view')} />
        {!uncertain && (chosenLines.length && draft && !lineReview.editing ? <GlassBar className="rc-bulk-bar" label="จัดการรายการที่เลือก">
          <span className="rc-muted">เลือก {chosenLines.length} รายการ</span>
          <button type="button" className="rc-text-action" disabled={disabled || !!lineReview.editing} onClick={() => dispatchReview({ type: 'preview', action: 'ordered', indices: chosenLines })}>เท่าที่สั่ง</button>
          <button type="button" className="rc-text-action" disabled={disabled || !!lineReview.editing} onClick={() => dispatchReview({ type: 'preview', action: 'zero', indices: chosenLines })}>ยังไม่รับ</button>
          <PrimaryAction disabled={disabled || !!lineReview.editing || chosenLines.some(index => !doc.lines[index]._aiProposal || doc.lines[index].match?.source === 'manual')} onClick={() => dispatchReview({ type: 'preview', action: 'use', indices: chosenLines })}>ใช้ AI {chosenLines.length} รายการ</PrimaryAction>
        </GlassBar> : lineReview.editing ? lineReview.editing.mode === 'full' ? null : <GlassBar className="rc-edit-bar"><button type="button" className="rc-text-action" onClick={() => dispatchReview({ type: 'cancel' })}>ยกเลิกแก้</button><PrimaryAction disabled={disabled} onClick={() => dispatchReview({ type: 'save-next' })}>บันทึกและตรวจถัดไป</PrimaryAction></GlassBar> : bar(<PrimaryAction disabled={disabled} onClick={draft ? continueToSignature : () => setStep('sign')}>{draft ? unreviewedCount ? `ตรวจรายการก่อน (ค้าง ${unreviewedCount})` : !doc.lines.length ? 'เพิ่มรายการ' : invalidDocument ? 'ตรวจข้อมูลก่อน' : 'ไปเซ็น' : 'ดูผู้รับ'}</PrimaryAction>))}

      </div>}
      <div hidden={step !== 'sign'}>{draft ? <div className="rc-stack">
        <div className="rc-sign-summary"><span>{unreviewedCount ? `ตรวจแล้ว ${counters.reviewed}/${counters.total} รายการ` : `ตรวจครบ ${counters.total} รายการ`} / ยอดบิล {invalidTotal ? 'ตรวจยอด' : `${formatBaht(money.billTotal ?? money.adjusted)} บาท`}</span><button type="button" className="rc-review-trigger" aria-label={checks.label} onClick={() => setModal('checks')}>ดูข้อเตือน</button>{checks.pricing.missingCount > 0 && <small className="rc-price-pending">{checks.pricing.label}</small>}</div>
        <SignaturePad documentId={doc.id} role="receiver" onInkChange={setReceiverInk} showHint={!stateHint} label={`ผู้รับ ${doc.receiver_name || user.name}`} saved={doc.has_receiver_signature} savedImage={signatureImages.receiver} disabled={disabled} busy={!!busy} onSave={(image) => saveSignature('receiver', image)}
          backAction={back} moreAction={more} onReview={review} showActions={!uncertain} reviewFirst={reviewLabel !== 'ตรวจรับ'} reviewLabel={reviewLabel} />
        <section className="rc-courier-card rc-stack"><div className="rc-section-heading"><h2>ผู้ส่ง</h2><button type="button" className="rc-text-action" onClick={() => { setSheetDraft({ ...doc }); setModal('courier'); }}>{doc.has_courier_signature ? 'แก้ผู้ส่ง' : 'เซ็นผู้ส่ง'}</button></div><p>{doc.courier_name || 'ระบุชื่อผู้ส่ง'}</p>
        {doc.has_courier_signature && <SignaturePad documentId={doc.id} role="courier" label="ผู้ส่งของ" saved savedImage={signatureImages.courier} readOnly inline showHint={false} showActions={false} />}</section>
      </div> : <ListCard title={doc.receiver_name || user.name} subtitle={statusText[doc.status]}>
        <PriceNotice checks={checks} received={doc.status === 'confirmed'} />
        <p>ผู้ส่ง {doc.courier_name || 'ไม่ระบุชื่อผู้ส่ง'}</p><p>{doc.confirmed_at ? new Date(doc.confirmed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : thaiDate(doc.delivery_date)}</p>
        {doc.has_receiver_signature && <SignaturePad documentId={doc.id} role="receiver" label="ผู้รับ" saved readOnly inline showActions={false} disabled={disabled} />}
        {doc.has_courier_signature && <SignaturePad documentId={doc.id} role="courier" label={`ผู้ส่งของ${doc.courier_name ? ` ${doc.courier_name}` : ''}`} saved readOnly inline showActions={false} disabled={disabled} />}
        {bar(<PrimaryAction onClick={onBack}>กลับรายการ</PrimaryAction>)}
      </ListCard>}</div>
    </fieldset>
    {uncertain && <GlassBar>{back}<PrimaryAction icon="retry" busy={!!busy} onClick={reload}>ตรวจผลล่าสุด</PrimaryAction></GlassBar>}
    {modal === 'bill-view' && <ReceivingDialog title="รูปบิล" backDismiss onClose={() => setModal('')}><ImagePages doc={{ ...doc, status: 'confirmed' }} pending={pending} busy showHint={false} /></ReceivingDialog>}
    {modal === 'checks' && <ReceivingDialog title="ตรวจสรุป" busy={!!busy} onClose={() => setModal('')}
      actions={summaryChange && <PrimaryAction disabled={disabled} onClick={acknowledgeSummary}>{summaryContext === 'after-sign' ? 'รับทราบ' : 'ตรวจสรุปแล้ว ไปเซ็น'}</PrimaryAction>}>
      <div className="rc-stack">
        {summaryContext === 'after-sign' && summaryChange && <p role="status">บันทึกลายเซ็นแล้ว</p>}
        {reviewAttention(checks) && <p className="rc-muted">{reviewAttention(checks)}</p>}
        {summaryChange && <Toast status="review">{summaryChange}</Toast>}
        <div className="rc-totals"><p>ยอดตามบิล <strong>{money.billTotal == null ? '—' : formatBaht(money.billTotal)} บาท</strong></p><p>รวมรายการ <strong>{money.total == null ? '—' : formatBaht(money.total)} บาท</strong></p>
          {!compactTotals && <p>รวมรายการสุทธิ <strong>{money.adjusted == null ? '—' : formatBaht(money.adjusted)} บาท</strong></p>}<p>{moneyLabel}</p></div>
        <details><summary>รายละเอียดสรุป</summary><p>{checks.label}</p>
          {compactTotals && <p>รวมรายการสุทธิ <strong>{formatBaht(money.adjusted)} บาท</strong></p>}
          {money.total != null && <><p>ส่วนลด <strong>{formatBaht(scaledInteger(doc.discount || '0'))} บาท</strong></p><p>ภาษี <strong>{formatBaht(scaledInteger(doc.vat || '0'))} บาท</strong></p></>}
        </details>
        {guidance && <p role="status">{guidance}</p>}
        <PriceNotice checks={checks} />
        {checks.documentReasons.length > 0 && <section className="rc-stack"><h3>ข้อสังเกตบิล {checks.documentCount} ข้อ</h3><ul className="rc-detail-list">{checks.documentReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></section>}
        {checks.rows.length > 0 && <ol className="rc-check-list">{checks.rows.map(row => <li key={row.index}>
          <button type="button" className="rc-check-row" onClick={() => {
            setStep('lines'); setSelected(row.index); setModal(''); setLineReview(current => transitionReview({ ...current, lines: doc.lines }, { type: 'edit', index: row.index, mode: 'full' }, { kind: doc.kind })); setFocusTarget({ id: `line-${row.index}-quantity_received` });
          }}><strong>รายการ {row.lineNo}: {row.title}</strong><span>{row.reasons.join(' / ')}</span><span className="rc-muted">ไปตรวจรายการนี้</span></button>
        </li>)}</ol>}
        {!checks.hasIssues && <p>ไม่มีคำเตือนเพิ่มเติม ตรวจรายการกับของจริงก่อนยืนยัน</p>}
      </div>
    </ReceivingDialog>}
    {modal === 'more' && <ReceivingDialog title="รายละเอียด" busy={!!busy} onClose={() => setModal('')}
      actions={<PrimaryAction disabled={disabled} onClick={applyAction}>เลือก</PrimaryAction>}>
      <div className="rc-stack">{feedback}<label>ทำรายการ<select value={action} onChange={(event) => setAction(event.target.value)}>
        <option value="header">ข้อมูลบิล</option><option value="reload">โหลดล่าสุด</option><option value="help">วิธีใช้</option><option value="retry-images">โหลดรูปใหม่</option>
        {draft && <><option value="save">บันทึกร่าง</option><option value="camera" disabled={doc.images.length + pending.length >= 10}>เพิ่มรูป</option>
          <option value="ocr" disabled={!doc.images.length || !!pending.length || doc.ocr?.status === 'pending'}>อ่านบิล</option><option value="add" disabled={doc.lines.length >= 200}>เพิ่มรายการ</option>
          <option value="delete" disabled={!selectedLine}>ลบรายการที่เลือก</option><option value="courier">ผู้ส่งของ</option></>}
        {canVoid(doc, user) && <option value="void">ยกเลิกใบรับ</option>}
      </select></label>
      <StatusPill status={money.status}>{moneyLabel}</StatusPill>
      {expected === null && <p>ยังเทียบใบสั่งไม่ได้ โหลดเอกสารใหม่เพื่อลองอีกครั้ง</p>}
      <WarningDetails checks={checks} />
      </div>
    </ReceivingDialog>}
    {modal === 'header' && <ReceivingDialog title="ข้อมูลบิล" busy={!!busy} onClose={() => setModal('')}
      actions={<PrimaryAction disabled={disabled} onClick={() => { if (draft) { const invalid = headerMoneyFields.find(key => sheetErrors[key]); if (invalid) { setFocusTarget({ id: `header-${invalid}` }); return; } mutate(Object.fromEntries(['supplier_name_text', 'doc_ref', 'doc_date', ...headerMoneyFields].map(key => [key, sheetDraft[key]]))); } setModal(''); }}>{draft ? 'ใช้ข้อมูล' : 'ปิด'}</PrimaryAction>}>
      {feedback}
      <fieldset disabled={disabled || !draft} className="rc-stack">
        <label>ผู้ส่งของ<input maxLength={255} value={sheetDraft.supplier_name_text || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, supplier_name_text: event.target.value })} /></label>
        <label>เลขบิล<input maxLength={100} value={sheetDraft.doc_ref || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, doc_ref: event.target.value })} /></label>
        <label>วันที่บิล<input type="date" value={sheetDraft.doc_date || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, doc_date: event.target.value })} /></label>
        {['subtotal', 'discount', 'vat', 'total'].map((key, index) => <NumberField key={key} id={`header-${key}`} error={draft ? sheetErrors[key] : undefined} validationKey={key} label={['ก่อนหัก', 'ส่วนลด', 'ภาษี', 'ยอดบิล'][index]} unit="บาท" maxLength={18} value={sheetDraft[key] ?? ''} onValueChange={(value) => setSheetDraft({ ...sheetDraft, [key]: value })} />)}
      </fieldset>
      <div className="rc-totals"><p>รวมรายการ <strong>{money.total == null ? '—' : formatBaht(money.total)}</strong></p><p>ยอดสุทธิ <strong>{sheetMoney.adjusted == null ? '—' : formatBaht(sheetMoney.adjusted)}</strong></p></div>
    </ReceivingDialog>}
    {modal === 'courier' && <ReceivingDialog title="ผู้ส่งของ" busy={!!busy} onClose={() => setModal('')}>
      {feedback}
      <fieldset disabled={disabled} className="rc-stack"><label>ชื่อ<input maxLength={255} value={sheetDraft.courier_name || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, courier_name: event.target.value })} /></label>
        <SignaturePad documentId={doc.id} role="courier" onInkChange={setCourierInk} inline label="ผู้ส่งของ" saved={doc.has_courier_signature} savedImage={signatureImages.courier} disabled={disabled} busy={!!busy} onSave={(image) => saveSignature('courier', image)} />
      </fieldset>
    </ReceivingDialog>}
    {modal === 'help' && <ReceivingDialog title="วิธีใช้" onClose={() => setModal('')}>
      <div className="rc-stack"><p>ถ่ายบิล ส่งรูป แล้วอ่านบิล ตรวจสินค้า จำนวน ราคา และหน่วยตามของที่มาส่งจริง จากนั้นเซ็นและยืนยัน</p>
        <p>สีเขียวหมายถึงจำนวนตรงยอดคงเหลือในใบสั่งสำหรับร่าง ใบที่ยืนยันแล้วเทียบจำนวนในใบนี้กับยอดสั่งเต็ม สีอำพันให้ตรวจส่วนต่างหรือหน่วย สีแดงต้องแก้ข้อมูล การเลือกสินค้าใหม่จะยกเลิกการผูกใบสั่งเดิม</p>
        <p>“ใช้ข้อมูล” เปลี่ยนค่าในหน้านี้ เลือก “บันทึกร่าง” ในรายละเอียดเพื่อส่งข้อมูล การบันทึกเซ็นและตรวจรับจะบันทึกรายการด้วย</p>
        <p>รูปยังไม่ส่งจะอยู่ในหน้านี้เท่านั้น จัดลำดับได้ก่อนเริ่มส่ง หน้าที่ส่งแล้วจะใช้เลขเดิมเมื่อส่งซ้ำ ลายเซ็นใหม่แทนลายเซ็นเดิม</p>
        <p>ยืนยันแล้วจะแก้ไม่ได้ ยกเลิกได้ตามสิทธิ์และจะย้อนเฉพาะผลของเอกสารนี้</p></div>
    </ReceivingDialog>}
    {modal === 'confirm' && <ReceivingDialog title="ยืนยันรับ" busy={!!busy} onClose={() => setModal('')}
      actions={<><p className="rc-confirm-caution">ยืนยันแล้วเข้าคลัง แก้ไม่ได้</p>{uncertain ? <PrimaryAction icon="retry" busy={!!busy} onClick={reload}>ตรวจผลล่าสุด</PrimaryAction> : <PrimaryAction busy={!!busy} busyLabel="กำลังบันทึก…" disabled={disabled || (unmatched > 0 && !unmatchedOk)} onClick={() => run('กำลังบันทึก…', async () => {
        adopt(await withSavingFeedback(() => api.confirm(doc.id, unmatchedOk))); setModal(''); setNotice('ยืนยันแล้ว');
      })}>ยืนยัน</PrimaryAction>}</>}>
      <div className="rc-stack"><span>{money.billTotal != null ? 'ยอดตามบิล' : 'รวมรายการสุทธิ'}</span><strong>{invalidTotal ? 'ตรวจยอด' : formatBaht(money.billTotal ?? money.adjusted)} บาท</strong>
        <ul className="rc-review-lines">{doc.lines.map((line, index) => <li key={line.id || index}><span>{line.product_name || line.bill_text || 'ไม่ผูกสินค้า'}</span><strong>{line.quantity_received} {line.unit_text}</strong></li>)}</ul>
        <StatusPill status={money.status}>{moneyLabel}</StatusPill>
        <PriceNotice checks={checks} />
        <WarningDetails checks={checks} />
        {unmatched > 0 && <label className="rc-check"><input type="checkbox" checked={unmatchedOk} onChange={(event) => setUnmatchedOk(event.target.checked)} /><span>ยอมรับ {unmatched} รายการที่ไม่เพิ่มคลัง</span></label>}
        {feedback}
      </div>
    </ReceivingDialog>}
    {modal === 'void' && <ReceivingDialog title="ยกเลิกใบรับ" busy={!!busy} onClose={() => setModal('')}
      actions={uncertain ? <PrimaryAction icon="retry" busy={!!busy} onClick={reload}>ตรวจผลล่าสุด</PrimaryAction> : <PrimaryAction className="rc-destructive" busy={!!busy} busyLabel="กำลังบันทึก…" disabled={disabled || !reason.trim()} onClick={() => run('กำลังบันทึก…', async () => {
        adopt(await withSavingFeedback(() => api.void(doc.id, reason.trim()))); setPending([]); setModal(''); setNotice('ยกเลิกแล้ว');
      })}>ยกเลิกใบรับ</PrimaryAction>}>
      <div className="rc-stack"><p>ย้อนการรับของเฉพาะใบนี้</p><label>เหตุผล<textarea value={reason} maxLength={1000} disabled={disabled} onChange={(event) => setReason(event.target.value)} rows={3} /></label>
        {(dirty || pending.length > 0) && <StatusPill status="review">มีข้อมูลค้าง</StatusPill>}{feedback}
      </div>
    </ReceivingDialog>}
    {modal === 'reload' && <ReceivingDialog title="โหลดล่าสุด" busy={!!busy} onClose={() => setModal('')} actions={<PrimaryAction icon="retry" busy={!!busy} onClick={reload}>โหลดล่าสุด</PrimaryAction>}>
      <p>ใช้ข้อมูลจากระบบแทนข้อมูลที่ยังไม่บันทึก รูปที่รอส่งยังอยู่</p>
    </ReceivingDialog>}
    {modal === 'delete' && <ReceivingDialog title="ลบรายการ" onClose={() => setModal('')} actions={<PrimaryAction className="rc-destructive" onClick={removeLine}>ลบรายการ</PrimaryAction>}>
      <p>{selectedLine?.product_name || selectedLine?.bill_text || 'รายการใหม่'}</p>
    </ReceivingDialog>}
    {modal === 'leave' && <ReceivingDialog title="มีข้อมูลค้าง" onClose={() => setModal('')} actions={<PrimaryAction className="rc-destructive" onClick={onBack}>ทิ้งและกลับ</PrimaryAction>}>
      <p>ข้อมูลและรูปที่ยังไม่ส่งจะหาย</p>
    </ReceivingDialog>}
  </div>;
}

function WarningDetails({ checks }) {
  return <div className="rc-stack rc-warning-details">
    <p>ยังไม่ตรวจ {checks.unreviewedCount} รายการ</p>
    <p>ข้อเตือนสินค้า {checks.itemCount} รายการ</p>
    {checks.rows.length > 0 && <ul className="rc-detail-list">{checks.rows.map(row => <li key={row.index}><strong>{row.title}</strong>: {row.reasons.join(' / ')}</li>)}</ul>}
    <p>ข้อสังเกตบิล {checks.documentCount} ข้อ</p>
    {checks.documentReasons.length > 0 && <ul className="rc-detail-list">{checks.documentReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
  </div>;
}

function PriceNotice({ checks, received = false }) {
  return checks.pricing.missingCount > 0 && <div className="rc-price-notice"><StatusPill status="review">{checks.pricing.label}</StatusPill>{received && <p>รับของแล้ว รอราคา</p>}</div>;
}
