import { useEffect, useRef, useState } from 'react';
import { useReceivingDirty } from './use-receiving-dirty';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { canVoid, documentBody, errorText, formatBaht, scaledInteger, warningText } from './receiving-utils';
import { LineEditor } from './LineEditor';
import { ImagePages } from './ImagePages';
import { SignaturePad } from './SignaturePad';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { needsBillCheck } from './receiving-illustration-state';
import { newReviewState, transitionReview, pendingReviewIndices, decisionLabels } from './line-review-state';
import { useReviewLayout } from './use-review-layout';
import { reviewSummary } from './receiving-review';
import { GlassBar, PrimaryAction, IconButton, Segmented, ListCard, StatusPill, NumberField, Toast } from '../../design';
import { moneyStatus, quantityStatus, thaiDate } from './receiving-status';
import { withSavingFeedback } from '../../design/motion-preference';
import { assignPageNumbers } from './image-utils';
import { firstDocumentError, focusField, headerMoneyFields, headerErrors } from './receiving-validation';
import { markOcrProposals, prepareOcrReview, retainAiReview } from './receiving-ai';

const statusText = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิกแล้ว' };

export function DocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, online = true }) {
  const [doc, setDoc] = useState(() => markOcrProposals(initialDocument));
  const [dirty, setDirty] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [pending, setPending] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState('');
  const [reading, setReading] = useState(false);
  const [imageNeedsReading, setImageNeedsReading] = useState(false);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState('');
  // Keep acknowledged submissions in memory only; reopened signatures load through the protected binary API.
  const [signatureImages, setSignatureImages] = useState({});
  const [notice, setNotice] = useState('');
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
  const [selected, setSelected] = useState(0);
  const [lineReview, setLineReview] = useState(newReviewState);
  const [chosenLines, setChosenLines] = useState([]);
  const layoutRoot = useReviewLayout(step, uncertain, chosenLines.length > 0);
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
  const draft = doc.status === 'draft';
  const disabled = !!busy || processing || uncertain;
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
    setLineReview(newReviewState()); setChosenLines([]); setDoc(markOcrProposals(next)); setDeleted([]); setDirty(false); setExpected(null); setExpectedRevision((value) => value + 1); onChanged(next);
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
    } finally { lock.current = false; setBusy(''); }
  };
  const save = async () => {
    if (lineReview.editing) throw new Error('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน');
    const invalid = firstDocumentError(doc);
    if (invalid) { showInvalid(invalid); throw new Error('ตรวจช่องที่ระบุ แล้วบันทึกอีกครั้ง'); }
    if (!dirty) return doc;
    const body = documentBody(doc, deleted);
    try {
      const next = retainAiReview(await api.update(doc.id, body), doc);
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
    setImageNeedsReading(true);
    setNotice('ส่งรูปครบแล้ว พร้อมอ่านบิล');
  }, false);

  const reload = () => run('กำลังตรวจผลล่าสุด…', async () => {
    adopt(await api.get(doc.id)); setSignatureImages({}); setUncertain(false); setModal('');
    setNotice('โหลดข้อมูลจากระบบแล้ว กรุณาตรวจรายการก่อนทำต่อ');
  }, false);
  const goToPendingReview = () => {
    const index = pendingReviewIndices(doc.lines)[0];
    if (index === undefined) return;
    setError(''); setStep('lines'); setSelected(index); setChosenLines([]); setModal('');
    setFocusTarget({ id: `line-${index}-review` });
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
      if (!next.has_receiver_signature) throw new Error('กรุณาบันทึกลายเซ็นผู้รับก่อนยืนยัน');
      if (!next.lines.some((line) => scaledInteger(line.quantity_received) > 0n)) throw new Error('ต้องมีอย่างน้อย 1 รายการที่รับจริงมากกว่า 0');
      if (next.kind === 'bill' && next.lines.some((line) => !line.product_id)) throw new Error('กรุณาเลือกสินค้าให้ครบทุกบรรทัด');
      setUnmatchedOk(false); setModal('confirm');
    });
  };
  const money = moneyStatus(doc.lines, doc.discount, doc.vat, doc.total, doc.subtotal);
  const sheetMoney = moneyStatus(doc.lines, sheetDraft.discount, sheetDraft.vat, sheetDraft.total, sheetDraft.subtotal);
  const sheetErrors = headerErrors({ ...doc, ...sheetDraft });
  const invalidTotal = money.status === 'error';
  // Drafts compare the remaining order. Terminal documents compare their own quantities to the full order.
  const comparison = draft ? expected : expected?.map((item) => ({ ...item, received_quantity: '0' }));
  const warnings = [...(doc.warnings || []), ...(doc.ocr?.warnings || [])].map(warning => typeof warning === 'string' ? { code: warning } : warning);
  // These server/OCR hints describe the last saved snapshot. Live values below
  // own their quantity/money/product states after an edit.
  const derivedCodes = ['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'QTY_SHORT', 'QTY_OVER', 'UNMATCHED_LINE'];
  const uniqueWarnings = warnings.filter((warning, index) => !derivedCodes.includes(warning.code)
    && warnings.findIndex((other) => other.code === warning.code && Number(other.line_no || 0) === Number(warning.line_no || 0)) === index);
  const unmatched = doc.lines.filter((line) => !line.product_id).length;
  const leave = () => {
    if (hasUnsaved) setModal('leave'); else onBack();
  };
  const readBill = () => run('กำลังอ่านบิล', async () => {
    const saved = await save();
    setReading(true);
    try {
      const response = await api.ocr(doc.id);
      const next = prepareOcrReview(saved, response, headerEdits.current);
      const check = needsBillCheck(next);
      setLineReview(newReviewState()); setChosenLines([]); setDoc(next); setDirty(true);
      setImageNeedsReading(false);
      setStep(check ? 'images' : 'lines'); setSelected(0);
      setNotice(check ? '' : 'ตรวจจำนวน แล้วใช้ AI หรือบันทึกค่าที่ตรวจแล้ว');
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
      adopt(retainAiReview(await api.get(doc.id), saved));
    });
    return acknowledged;
  };
  const back = <IconButton icon="back" label="กลับรายการ" disabled={!!busy || processing} onClick={leave} />;
  const more = <IconButton icon="list" label="รายละเอียด" disabled={disabled} onClick={() => { setAction('header'); setModal('more'); }} />;
  const bar = (primary) => <GlassBar>{back}{more}{primary}</GlassBar>;
  const selectedLine = doc.lines[selected];
  const lineStates = doc.lines.map((line) => quantityStatus(line, comparison, doc.lines, doc.kind));
  const invalidLines = lineStates.some((state) => state.status === 'error');
  const unreviewedCount = pendingReviewIndices(doc.lines).length;
  const invalidDocument = firstDocumentError(doc, { requireProducts: true });
  const needsReceivedQty = !invalidDocument && doc.lines.length > 0 && !doc.lines.some(line => scaledInteger(line.quantity_received) > 0n);
  const reviewLabel = unreviewedCount ? `ตรวจรายการก่อน (ค้าง ${unreviewedCount})`
    : pending.length ? `ส่งรูปก่อน (ค้าง ${pending.length})` : !doc.lines.length ? 'เพิ่มรายการ'
      : invalidDocument ? 'ตรวจข้อมูลก่อน' : needsReceivedQty ? 'ระบุจำนวนรับจริงก่อน' : 'ตรวจรับ';
  const dispatchReview = event => {
    const previous = reviewRef.current || { ...lineReview, lines: doc.lines };
    const next = transitionReview(previous, event, { expectedItems: comparison, kind: doc.kind, warnings: uniqueWarnings });
    reviewRef.current = next;
    setError(''); setGuidance(''); setLineReview(next);
    if (next.lines !== previous.lines) mutate({ lines: next.lines });
  };
  useEffect(() => { reviewRef.current = { ...lineReview, lines: doc.lines }; }, [lineReview, doc.lines]);
  const checks = reviewSummary(doc, lineStates, uniqueWarnings, money);
  const continueToSignature = () => {
    if (lineReview.editing) { setGuidance('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน'); return; }
    if (unreviewedCount) { goToPendingReview(); return; }
    const invalid = firstDocumentError(doc, { requireProducts: true });
    if (invalid) { setError(''); setGuidance('ตรวจช่องที่ระบุ แล้วทำรายการต่อ'); showInvalid(invalid); return; }
    if (!doc.lines.length) { addLine(); setGuidance('เพิ่มรายการก่อนเซ็นรับของ'); return; }
    setGuidance(''); setError('');
    setStep('sign'); window.scrollTo(0, 0);
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
    else if (action === 'save') return run('กำลังบันทึก', async () => { await withSavingFeedback(save); setModal(''); setNotice('บันทึกแล้ว'); });
  };
  const readingBill = reading || (doc.ocr?.status === 'pending' && !error);
  const billCheck = needsBillCheck(doc) && !imageNeedsReading && !pending.length;
  const hasOcrItems = doc.ocr?.status === 'done' && doc.lines.length > 0 && !imageNeedsReading;
  const imageAction = pending.length ? { icon: 'receipt', label: 'ส่งรูป', run: upload }
    : billCheck ? { icon: 'camera', label: 'ถ่ายบิล' }
      : hasOcrItems ? { icon: 'list', label: 'ตรวจรายการ', run: () => setStep('lines') }
        : !doc.images.length ? { icon: 'camera', label: 'ถ่ายบิล' }
          : { icon: 'scan', label: 'อ่านบิล', run: readBill };
  const reviewGuidance = guidance || (draft && step === 'sign' && unreviewedCount ? `ค้างตรวจ ${unreviewedCount} รายการ ตรวจรายการให้ครบก่อนเซ็นและตรวจรับ` : '');
  const stateHint = !online ? 'offline' : error ? 'error' : readingBill ? 'reading-bill' : doc.ocr?.status === 'failed' ? 'error' : billCheck && draft ? 'not-a-bill' : reviewGuidance ? 'review-lines' : doc.status === 'confirmed' && step === 'sign' ? 'received-success' : null;
  const feedback = error ? <ReceivingIllustration state="error" description={error} compact />
    : guidance ? <ReceivingIllustration state="review-lines" description={guidance} compact /> : null;
  return <div ref={layoutRoot} className="rc-stack rc-document">
    <header className="rc-heading rc-document-heading"><div><p className="rc-muted">#{doc.id} {statusText[doc.status]} {thaiDate(doc.delivery_date)} {draft && <span role="status">{dirty || pending.length ? 'ยังไม่บันทึก' : 'บันทึกแล้ว'}</span>}</p><h1>{doc.supplier_name_text || 'รับสินค้า'}</h1></div></header>
    <Segmented label="ขั้นตอนรับสินค้า" value={step} onChange={next => { if (lineReview.editing) { setGuidance('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน'); return; } setChosenLines([]); setGuidance(''); setStep(next); }} disabled={disabled}
      options={[{ value: 'images', label: 'บิล', icon: 'receipt' }, { value: 'lines', label: 'รายการ', icon: 'list' }, { value: 'sign', label: 'เซ็น', icon: 'signature' }]} />
    {busy && !readingBill && <p role="status" className="rc-muted">{busy}</p>}
    {draft && uniqueWarnings.some(warning => warning.code === 'DOC_KIND_UNCERTAIN') && <div><StatusPill status="review">ตรวจชนิดเอกสาร</StatusPill></div>}
    {notice && <Toast status={unreviewedCount ? 'review' : 'ok'}>{notice}</Toast>}
    {stateHint && <ReceivingIllustration state={stateHint} description={stateHint === 'error' && error ? error : stateHint === 'review-lines' ? reviewGuidance : undefined} compact={stateHint !== 'received-success'} />}
    {uncertain && <Toast status="review">ตรวจผลล่าสุดก่อนส่งซ้ำ ข้อมูลที่ยังไม่บันทึกจะถูกแทนที่</Toast>}
    <div className="rc-section-heading"><div className="rc-bill-amount"><span className="rc-muted">{money.billTotal != null ? 'ยอดตามบิล' : 'รวมรายการสุทธิ'}</span><strong className="rc-money">{invalidTotal ? 'ตรวจยอด' : `${formatBaht(money.billTotal ?? money.adjusted)} บาท`}</strong></div>
      <button type="button" className="rc-review-trigger" aria-haspopup="dialog" disabled={!!busy || processing} onClick={() => setModal('checks')}>
        <StatusPill status={invalidTotal || invalidLines ? 'error' : checks.dataHasIssues ? 'review' : 'ok'}>{checks.label}</StatusPill>
      </button></div>
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
        {!uncertain && (chosenLines.length && draft ? <GlassBar className="rc-bulk-bar" label="จัดการรายการที่เลือก">
          <span className="rc-muted">เลือก {chosenLines.length}</span>
          {Object.entries(decisionLabels).map(([action, label]) => <button key={action} type="button" className="rc-text-action" disabled={disabled || !!lineReview.editing} onClick={() => dispatchReview({ type: 'preview', action, indices: chosenLines })}>{label}</button>)}
        </GlassBar> : bar(<PrimaryAction disabled={disabled || !!lineReview.editing} onClick={draft ? continueToSignature : () => setStep('sign')}>{draft ? unreviewedCount ? `ตรวจรายการก่อน (ค้าง ${unreviewedCount})` : !doc.lines.length ? 'เพิ่มรายการ' : invalidDocument ? 'ตรวจข้อมูลก่อน' : 'ไปเซ็น' : 'ดูผู้รับ'}</PrimaryAction>))}

      </div>}
      <div hidden={step !== 'sign'}>{draft ? <div className="rc-stack"><p className="rc-muted">{doc.receiver_name || user.name}</p>
        <SignaturePad documentId={doc.id} role="receiver" onInkChange={setReceiverInk} showHint={!stateHint} label="ผู้รับ" saved={doc.has_receiver_signature} savedImage={signatureImages.receiver} disabled={disabled} busy={!!busy} onSave={(image) => saveSignature('receiver', image)}
          backAction={back} moreAction={more} onReview={review} showActions={!uncertain} reviewFirst={reviewLabel !== 'ตรวจรับ'} reviewLabel={reviewLabel} />
      </div> : <ListCard title={doc.receiver_name || user.name} subtitle={statusText[doc.status]}>
        <p>{doc.confirmed_at ? new Date(doc.confirmed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : thaiDate(doc.delivery_date)}</p>
        {doc.has_receiver_signature && <SignaturePad documentId={doc.id} role="receiver" label="ผู้รับ" saved readOnly inline showActions={false} disabled={disabled} />}
        {doc.has_courier_signature && <SignaturePad documentId={doc.id} role="courier" label={`ผู้ส่งของ${doc.courier_name ? ` ${doc.courier_name}` : ''}`} saved readOnly inline showActions={false} disabled={disabled} />}
        {bar(<PrimaryAction onClick={onBack}>กลับรายการ</PrimaryAction>)}
      </ListCard>}</div>
    </fieldset>
    {uncertain && <GlassBar>{back}<PrimaryAction icon="retry" busy={!!busy} onClick={reload}>ตรวจผลล่าสุด</PrimaryAction></GlassBar>}
    {modal === 'bill-view' && <ReceivingDialog title="รูปบิล" busy={!!busy} onClose={() => setModal('')}><ImagePages doc={{ ...doc, status: 'confirmed' }} pending={[]} busy showHint={false} /></ReceivingDialog>}
    {modal === 'checks' && <ReceivingDialog title={checks.label} busy={!!busy} onClose={() => setModal('')}>
      <div className="rc-stack">
        <div className="rc-totals"><p>ยอดตามบิล <strong>{money.billTotal == null ? '—' : formatBaht(money.billTotal)} บาท</strong></p><p>รวมรายการ <strong>{money.total == null ? '—' : formatBaht(money.total)} บาท</strong></p><p>รวมรายการสุทธิ <strong>{money.adjusted == null ? '—' : formatBaht(money.adjusted)} บาท</strong></p><p>{money.label}</p></div>
        {checks.documentReasons.length > 0 && <section className="rc-stack"><h3>ข้อมูลบิล</h3><ul className="rc-detail-list">{checks.documentReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
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
      <StatusPill status={money.status}>{money.label}</StatusPill>
      {expected === null && <p>ยังเทียบใบสั่งไม่ได้ โหลดเอกสารใหม่เพื่อลองอีกครั้ง</p>}
      <ul className="rc-detail-list">{lineStates.map((state, index) => state.status !== 'ok' && <li key={index}>{doc.lines[index].product_name || doc.lines[index].bill_text || `รายการ ${index + 1}`}: {state.label}</li>)}</ul>
      {uniqueWarnings.map((warning, index) => <p key={index}>{warning.line_no ? `รายการ ${warning.line_no}: ` : ''}{warningText(warning)}</p>)}
      </div>
    </ReceivingDialog>}
    {modal === 'header' && <ReceivingDialog title="ข้อมูลบิล" busy={!!busy} onClose={() => setModal('')}
      actions={<PrimaryAction disabled={disabled} onClick={() => { if (draft) { const invalid = headerMoneyFields.find(key => sheetErrors[key]); if (invalid) { setFocusTarget({ id: `header-${invalid}` }); return; } mutate(Object.fromEntries(['supplier_name_text', 'doc_ref', 'doc_date', ...headerMoneyFields].map(key => [key, sheetDraft[key]]))); } setModal(''); }}>{draft ? 'ใช้ข้อมูล' : 'ปิด'}</PrimaryAction>}>
      {feedback}
      <fieldset disabled={disabled || !draft} className="rc-stack">
        <label>ผู้ส่งของ<input maxLength={255} value={sheetDraft.supplier_name_text || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, supplier_name_text: event.target.value })} /></label>
        <label>เลขบิล<input maxLength={100} value={sheetDraft.doc_ref || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, doc_ref: event.target.value })} /></label>
        <label>วันที่บิล<input type="date" value={sheetDraft.doc_date || ''} onChange={(event) => setSheetDraft({ ...sheetDraft, doc_date: event.target.value })} /></label>
        {['subtotal', 'discount', 'vat', 'total'].map((key, index) => <NumberField key={key} id={`header-${key}`} error={draft ? sheetErrors[key] : undefined} label={['ก่อนหัก', 'ส่วนลด', 'ภาษี', 'ยอดบิล'][index]} unit="บาท" maxLength={18} value={sheetDraft[key] ?? ''} onValueChange={(value) => setSheetDraft({ ...sheetDraft, [key]: value })} />)}
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
      actions={uncertain ? <PrimaryAction icon="retry" busy={!!busy} onClick={reload}>ตรวจผลล่าสุด</PrimaryAction> : <PrimaryAction busy={!!busy} busyLabel="กำลังบันทึก…" disabled={disabled || (unmatched > 0 && !unmatchedOk)} onClick={() => run('กำลังบันทึก…', async () => {
        adopt(await withSavingFeedback(() => api.confirm(doc.id, unmatchedOk))); setModal(''); setNotice('ยืนยันแล้ว');
      })}>ยืนยัน</PrimaryAction>}>
      <div className="rc-stack"><span>{money.billTotal != null ? 'ยอดตามบิล' : 'รวมรายการสุทธิ'}</span><strong>{invalidTotal ? 'ตรวจยอด' : formatBaht(money.billTotal ?? money.adjusted)} บาท</strong>
        <ul className="rc-review-lines">{doc.lines.map((line, index) => <li key={line.id || index}><span>{line.product_name || line.bill_text || 'ไม่ผูกสินค้า'}</span><strong>{line.quantity_received} {line.unit_text}</strong></li>)}</ul>
        {checks.hasIssues && <StatusPill status="review">{checks.label}</StatusPill>}
        {lineStates.map((state, index) => state.status !== 'ok' && <p key={`line-${index}`}>{doc.lines[index].product_name || `รายการ ${index + 1}`}: {state.label}</p>)}
        <StatusPill status={money.status}>{money.label}</StatusPill>
        {uniqueWarnings.map((warning, index) => <p key={index}>{warningText(warning)}</p>)}
        {unmatched > 0 && <label className="rc-check"><input type="checkbox" checked={unmatchedOk} onChange={(event) => setUnmatchedOk(event.target.checked)} /><span>ยอมรับ {unmatched} รายการที่ไม่เพิ่มคลัง</span></label>}
        <p>ยืนยันแล้วเข้าคลัง และแก้รายการไม่ได้</p>{feedback}
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
