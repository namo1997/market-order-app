import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { errorText, documentBody, canVoid, warningText, thaiUnit } from './receiving-utils';
import { ReceivingIllustration } from './ReceivingIllustration';
import { BillReadingProgress } from './BillReadingProgress';
import { ImagePages } from './ImagePages';
import { SignaturePad } from './SignaturePad';
import { ReceivingNumberField } from './ReceivingNumberField';
import { useSupplierProducts } from './SupplierProductSuggestions';
import { ProductSearchSheet } from './ProductSearchSheet';
import { ReceivingProductScope } from './ReceivingProductScope';
import { ReviewRows } from './ReviewRows';
import { ReviewSummary } from './ReviewSummary';
import { StatementNotice, isStatementDocument } from './StatementNotice';
import { headerErrors, normalizeLineEntry, numberError, focusField, focusCountField } from './receiving-validation';
import { flaggedCountLines, activeCountFlags } from './count-warning';
import { reviewWarnings } from './receiving-review';
import { validCount, billAlias, initialReviewStep, canBulkAccept, reviewMilestones } from './review-a';
import { receiptEvidence } from './receiving-status';
import { assignPageNumbers } from './image-utils';
import { matchBillToCount } from './counted-bill-match';
import { useReceivingDirty } from './use-receiving-dirty';
import { useReceivingBack } from './use-receiving-back';
import { ReceivingDialog } from './ReceivingDialog';
import { PrimaryAction, Toast } from '../../design';
import './review-a.css';

export function DocumentEditor({ initialDocument, user, onBack, onChanged, onDirtyChange, onBackActionChange, online = true, onNextShop, nextShopStatus = 'complete', onRefreshQueue, scanFirst = false }) {
  const layout = useRef(null);
  const [doc, setDoc] = useState(initialDocument);
  // Scan-first draft that already holds its bill pages goes straight to the (blind) count.
  const [step, setStep] = useState(() => scanFirst && initialDocument.status === 'draft' && initialDocument.kind === 'bill' && !initialDocument.counted_complete_at
    && initialDocument.images?.length ? 'count' : initialReviewStep(initialDocument));
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
  // Device test 072s: a locked count cannot be edited, so every count is read back once before it is locked.
  const [countReview, setCountReview] = useState(false);
  const [reloadAsk, setReloadAsk] = useState(false);
  const focusAfterSearch = useRef(null);
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
  const scanner = useRef(null);
  const scanStarted = useRef(false);
  // Owner 2026-10-21: read a scanned bill at once; the blind count gains product names only.
  const [earlyRead, setEarlyRead] = useState(initialDocument.early_read || null);
  const earlyReadKeys = useRef(new Set());
  const localSequence = useRef(-1);
  const savedDocument = useRef(initialDocument);
  const readingStartedAt = useRef(initialDocument.ocr?.status === 'pending' ? Date.now() : null);
  const flags = activeCountFlags(countFlags, counts);
  const draft = doc.status === 'draft';
  const success = doc.status === 'confirmed' && !showReceipt;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [step, doc.status, showReceipt]);
  useEffect(() => {
    const element = layout.current;
    if (!element?.querySelector) return;
    const footer = element.querySelector('.ra-footer');
    const viewport = window.visualViewport;
    const measure = () => {
      element.style.setProperty('--ra-footer-height', `${footer?.getBoundingClientRect().height || 0}px`);
      element.style.setProperty('--ra-keyboard-offset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
      // The product search sheet fills what is left above the on-screen keyboard.
      element.style.setProperty('--ra-visible-height', `${viewport?.height || window.innerHeight}px`);
      element.style.setProperty('--ra-visible-top', `${viewport?.offsetTop || 0}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (footer) observer?.observe(footer);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => { observer?.disconnect(); viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure); };
  }, [step, doc.status, showReceipt]);
  const manual = doc.kind === 'manual_receipt';
  const blind = draft && !doc.counted_complete_at;
  const supplierHistory = useSupplierProducts(doc, user, online, step === 'count' && blind && doc.scope !== 'branch' && !doc.lines.some(line => line.order_item_id));
  // Count-only layout: measure wrapped footer text and dock above the IME.
  // Other steps retain their existing layout and transition rules.
  useEffect(() => {
    if (step !== 'count' || !blind) return;
    const root = layout.current; // shared with the footer-height effect above: same root <section>
    const footer = root?.querySelector?.('.ra-footer');
    if (!footer) return;
    const viewport = window.visualViewport;
    let frame;
    const measure = () => {
      root.style.setProperty('--rc-count-bar-height', `${footer.getBoundingClientRect().height}px`);
      root.style.setProperty('--rc-count-keyboard-offset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
    };
    const fit = () => {
      measure();
      const input = document.activeElement;
      if (!input?.id?.startsWith('count-') || input.closest('dialog')) return;
      const row = input.closest('.ra-count-row');
      const rect = row?.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const top = (viewport?.offsetTop || 0) + 8;
      const bottom = Math.min(footer.getBoundingClientRect().top - 16, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight));
      const target = rect && rect.height <= bottom - top ? rect : field;
      if (target.bottom > bottom) window.scrollBy({ top: target.bottom - bottom, behavior: 'instant' });
      else if (target.top < top) window.scrollBy({ top: target.top - top, behavior: 'instant' });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(footer);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    // Closing the search sheet pops its history entry; the browser then restores the old scroll
    // (top of page) after the row was fitted, and an already-open keyboard sends no resize.
    window.addEventListener('popstate', schedule);
    root.addEventListener('focusin', schedule);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.removeEventListener('popstate', schedule); root.removeEventListener('focusin', schedule); };
  }, [step, blind]);
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
  // Back from the search sheet lands on the row that was just added (or already existed).
  useEffect(() => {
    if (adding || focusAfterSearch.current == null) return;
    const id = focusAfterSearch.current; focusAfterSearch.current = null;
    focusField(id);
  }, [adding, doc.lines.length]);
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
  // Merge an early-read (blind) document: server rows replace the receipt rows, typed counts stay by
  // row id, and a locally added product that the bill also lists moves its typed count to the bill row.
  const mergeEarlyRead = fresh => {
    if (!fresh?.lines) return;
    setDoc(current => {
      const moved = {};
      const local = current.lines.filter(line => line.id <= 0).filter(line => {
        const twin = fresh.lines.find(row => row.product_id && Number(row.product_id) === Number(line.product_id));
        if (twin) moved[twin.id] = line.id;
        return !twin;
      });
      if (Object.keys(moved).length) setCounts(counts => {
        const next = { ...counts };
        for (const [to, from] of Object.entries(moved)) { if (next[to] == null && next[from] != null) next[to] = next[from]; delete next[from]; }
        return next;
      });
      return { ...fresh, lines: [...fresh.lines, ...local] };
    });
    savedDocument.current = fresh;
    setEarlyRead(fresh.early_read || 'done');
  };
  const startEarlyRead = next => {
    if (!next?.images?.length || next.kind !== 'bill' || next.scope === 'branch' || next.counted_complete_at || next.status !== 'draft') return;
    const key = `${next.id}:${next.images.map(page => `${page.id}:${page.sha256 || ''}`).join(',')}`;
    if (earlyReadKeys.current.has(key)) return;
    earlyReadKeys.current.add(key); setEarlyRead('pending');
    api.ocr(next.id).then(mergeEarlyRead).catch(() => setEarlyRead('failed'));
  };
  const uploadBill = async () => {
    const hasNewImages = pending.length > 0;
    if (!blind && hasNewImages && dirty) await save(doc);
    const next = await upload();
    setStep(blind ? 'count' : 'compare');
    if (blind && hasNewImages) startEarlyRead(next);
    if (!blind && hasNewImages && next.images.length) await readSavedBill(next);
  };
  // Owner 2026-10-21 "เอาแบบอ่านเลย": a blind bill draft that already has saved pages but was never read
  // (pages sent before early read existed, or reopened) starts the early read as soon as it is open.
  useEffect(() => {
    if (!blind || manual || !online || earlyRead || pending.length || !doc.images.length) return;
    startEarlyRead(doc);
  }, [blind, manual, online, earlyRead, pending.length, doc.id, doc.images.length]);
  // A reopened receipt whose early read is still running: poll read-only until it settles.
  useEffect(() => {
    if (earlyRead !== 'pending' || !blind || earlyReadKeys.current.size) return;
    let alive = true; let timer;
    const poll = async () => {
      try { const next = await api.get(doc.id); if (!alive) return; if (next.early_read !== 'pending') { mergeEarlyRead(next); return; } }
      catch { /* read-only; the count stays usable */ }
      if (alive) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => { alive = false; clearTimeout(timer); };
  }, [earlyRead, blind, doc.id]);
  useEffect(() => {
    if (step !== 'images' || manual || blind || !draft || !online || disabled || dirty || !pending.length ||
      pending.some(page => page.quality?.warnings.length && !page.qualityAccepted)) return;
    const keys = pending.map(page => `${doc.id}:${page.key}`);
    if (keys.every(key => autoUpload.current.has(key))) return;
    keys.forEach(key => autoUpload.current.add(key));
    act(uploadBill);
  }, [step, doc.id, manual, blind, draft, online, disabled, dirty, pending]);
  // Scan-first: open the scanner once as soon as the bill step shows for a fresh draft, then
  // upload the scanned pages and move to the blind count. Cancelling leaves the choices below.
  const scanEmpty = scanFirst && draft && blind && !manual && !doc.images.length && !pending.length;
  useEffect(() => {
    if (!scanEmpty || scanStarted.current || step !== 'images' || !online || !scanner.current) return;
    scanStarted.current = true; scanner.current();
  });
  // Owner 2026-10-21 "ถ่ายแล้ววิเคราะห์เลย": any newly captured page on a blind bill draft (fresh or
  // reopened with earlier pages) uploads right away and starts the early read; counts stay blind.
  useEffect(() => {
    if (step !== 'images' || manual || !blind || !draft || !online || disabled || dirty || !pending.length ||
      pending.some(page => page.quality?.warnings.length && !page.qualityAccepted)) return;
    const keys = pending.map(page => `${doc.id}:${page.key}`);
    if (keys.every(key => autoUpload.current.has(key))) return;
    keys.forEach(key => autoUpload.current.add(key));
    act(uploadBill);
  }, [step, doc.id, manual, blind, draft, online, disabled, dirty, pending]);
  const switchToNoBill = () => act(async () => { adopt(await api.update(doc.id, { kind: 'manual_receipt' })); setStep('count'); });
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
  // In-app Thai dialog instead of the system confirm (its buttons read CANCEL / OK on Android).
  const reload = (force = false) => {
    if (unsaved && !force) { setReloadAsk(true); return; }
    setReloadAsk(false);
    return act(async () => {
      const next = await api.get(doc.id); adopt(next); uncertain.current = false; setRecovery('');
      setSignature(''); setCourierSignature(''); setDeleted([]); setPending([]); setCounts({});
      setStep(initialReviewStep(next));
    }, true);
  };
  const addCountProduct = product => {
    const existing = doc.lines.find(line => Number(line.product_id) === Number(product.product_id));
    if (existing) { focusAfterSearch.current = `count-${existing.id}`; setAdding(false); return; }
    const id = localSequence.current--;
    setDoc(current => ({ ...current, lines: [...current.lines, { product_id: product.product_id, product_name: product.product_name,
      unit_id: product.unit_id, unit_text: product.unit_text || '', unit_multiplier: 1, match: { source: 'manual', confidence: 1 },
      remember_alias: false, id, bill_text: '', line_no: current.lines.length + 1 }] }));
    setCounts(current => ({ ...current, [id]: '' })); focusAfterSearch.current = `count-${id}`; setAdding(false); setDirty(true);
  };
  const countBody = () => ({ client_uuid: doc.client_uuid, lines: doc.lines.map(line => ({
    ...(line.id > 0 ? { id: line.id } : { product_id: line.product_id, unit_text: line.unit_text }), counted_quantity: counts[line.id] })) });
  const persistCount = async () => {
    const next = await api.count(doc.id, countBody());
    adopt(next); setCounts({}); setCountWarnings(null); setCountReview(false); setCountFlags({}); setStep(manual ? 'summary' : 'compare');
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
  const actionReason = !online ? 'ออฟไลน์ · เชื่อมต่อก่อนบันทึกหรือยืนยัน' : recovery ? 'ยังไม่ทราบผล · ตรวจผลล่าสุดก่อนทำต่อ'
    : busy || processing ? 'กำลังบันทึก · รอผลจากระบบ' : readingActive ? 'กำลังอ่านบิล · รอผลก่อนทำต่อ'
    : pending.length ? 'มีรูปที่ยังไม่บันทึก · บันทึกรูปก่อนทำต่อ'
    : Object.values(headerErrors(doc)).some(Boolean) ? 'ข้อมูลหัวบิลไม่ถูกต้อง · เปิดข้อมูลหัวบิลเพื่อแก้ไข'
    : !doc.lines.length ? 'ยังไม่มีรายการรับสินค้า'
    : !blind && !manual && undecided ? `เหลือ ${undecided} รายการที่ต้องตัดสินใจ · กลับขั้นตรวจ`
    : dirty ? (step === 'sign' ? (doc.has_receiver_signature ? 'ชื่อผู้ส่งยังไม่บันทึก · กดบันทึกชื่อผู้ส่ง แล้วเซ็นผู้รับอีกครั้ง' : 'ชื่อผู้ส่งยังไม่บันทึก · กดบันทึกชื่อผู้ส่งก่อนเซ็น') : manual ? 'มีข้อมูลที่ยังไม่บันทึก · ระบบจะบันทึกก่อนไปเซ็น' : 'มีข้อมูลที่ยังไม่บันทึก')
    : ink || courierInk ? 'มีลายเซ็นที่ยังไม่บันทึก · บันทึกเซ็นหรือยกเลิกก่อนยืนยัน'
    : step === 'sign' && !doc.has_receiver_signature ? 'ยังไม่มีลายเซ็นผู้รับที่บันทึกแล้ว · แตะเพื่อเซ็น'
    : '';
  const evidence = receiptEvidence(doc);
  const nav = next => { if (['compare', 'summary'].includes(next) && blind || next === 'sign' && (blind || undecided || dirty || blocked)) return; setStep(next); };
  // count step points at its own progress text; other draft steps at the CTA reason (void sheet has neither)
  const describedBy = step === 'count' ? 'count-progress' : draft ? 'receiving-action-reason' : undefined;
  const primary = (label, fn, off = false) => <PrimaryAction disabled={disabled || off} aria-describedby={describedBy} busy={busy} onClick={() => act(fn)}>{label}</PrimaryAction>;
  const back = () => unsaved ? setLeave(true) : onBack();
  useReceivingBack(onBackActionChange, () => {
    // The shell has already asked before discarding local counts/images/ink.
    setDoc(savedDocument.current); setDirty(false); setPending([]); setCounts({}); setDeleted([]);
    setInk(false); setCourierInk(false); setAdding(false);
    if (!draft || step === 'images' || (manual && step !== 'sign')) { onBack(); return; }
    setStep(step === 'sign' ? 'summary' : step === 'summary' ? 'compare' : 'images');
  }, busy || processing || readingActive || !!recovery);
  return <ReceivingProductScope.Provider value={{ branchId: doc.branch_id, departmentId: doc.department_id }}><section ref={layout} className="ra-document rc-stack" aria-label={doc.scope === 'branch' ? 'ใบรับทั้งสาขา' : 'ใบรับสินค้า'} data-step={success ? 'success' : step}>
    <header className="ra-heading"><button type="button" disabled={disabled} onClick={back}>กลับคิว</button><div><span className="rc-brand">SOLAO</span><h1>{doc.supplier_name_text}</h1>{!doc.supplier_master_id && !doc.product_group_id && <p className="rc-muted">ร้านใหม่ รอบัญชีตรวจ</p>}<p>ใบรับ #{doc.id} · {doc.scope === 'branch' ? 'ทั้งสาขา · ' : ''}{draft ? 'ร่าง' : doc.status === 'confirmed' ? 'ยืนยันแล้ว' : 'ยกเลิกแล้ว'}</p></div></header>
    {draft && <nav className="ra-steps" data-manual={manual} aria-label="ขั้นตอนรับสินค้า">{reviewMilestones(step, !!doc.counted_complete_at).map(({ value, label, current }) => <button type="button" key={value} aria-current={current ? 'step' : undefined} disabled={disabled || (value === 'count' && !blind) || (['compare', 'summary'].includes(value) && blind) || (value === 'sign' && (blind || undecided > 0 || dirty || blocked || step !== 'summary'))} onClick={() => nav(value)}>{label}</button>)}</nav>}
    {draft && !manual && step === 'images' && !scanEmpty && <p className="ra-evidence-state">{doc.images.length ? 'แนบรูปแล้ว · เปิดรูปและอ่านบิลได้หลังนับครบ' : 'แนบรูปบิลก่อนนับได้ · ยังไม่เปิดจำนวนบิล'}</p>}
    {draft && !blind && !manual && doc.images.length > 0 && doc.ocr?.status !== 'done' && <p className="ra-evidence-state">แนบแล้ว · {readingActive ? 'กำลังอ่านบิล' : 'ยังไม่อ่านบิล'}</p>}
    {!blind && !success && <div role="status" className="rc-stack">{[...new Set(reviewWarnings(doc).filter(warning => ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SHIP_TO_MISMATCH'].includes(warning.code)).map(warning => warningText(warning.code === 'LINE_AMOUNT_MISMATCH' ? 'BILL_TOTAL_MISMATCH' : warning)))].map(message => <p key={message}>{message}</p>)}</div>}
    {!online && <Toast status="review">ออฟไลน์ เก็บข้อมูลที่กรอกไว้ก่อนเชื่อมต่อ</Toast>}
    {!manual && !blind && !success && draft && isStatementDocument(doc) && <StatementNotice disabled={disabled}
      onRetake={() => setStep('images')}
      onNoBill={() => act(async () => { await save({ ...doc, kind: 'manual_receipt', switchToManual: true }); setStep('summary'); })} />}
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
    {manual && !success && <p>{blind ? 'ใบรับไม่มีบิล' : doc.lines.some(line => line.order_item_id) ? 'ใบรับไม่มีบิล · นับของจริง แล้วตรวจสรุปเทียบใบสั่งก่อนเซ็นรับ' : 'ใบรับไม่มีบิล · นับของจริง แล้วตรวจสรุปก่อนเซ็นรับ'}</p>}
    {manual && !blind && !success && <details><summary>รูปของ (ไม่บังคับ)</summary><ImagePages doc={doc} blind={false} showHint={false} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera} /><button type="button" disabled={disabled || !draft} onClick={() => camera.current?.click()}>เพิ่มรูปของ</button>{pending.length > 0 && <button type="button" disabled={disabled} onClick={() => act(upload)}>บันทึกรูปของ</button>}</details>}
    {error && <Toast status={/ข้อมูลยังไม่ถูกต้อง|กรอก|ส่วนลด/.test(error) ? 'review' : 'error'}>{error}</Toast>}
    {busy && !readingActive && <p role="status">กำลังบันทึก…</p>}
    {readingActive && !readingHidden && <BillReadingProgress documentId={doc.id} page={doc.images[0]} startedAt={readingStartedAt.current} onCancel={() => setReadingHidden(true)} />}
    {readingActive && readingHidden && <p role="status">กำลังอ่านบิลต่อ… จำนวนที่นับยังอยู่</p>}
    {doc.ocr?.status === 'failed' && <p role="alert">อ่านบิลไม่สำเร็จ จำนวนที่นับยังอยู่ กรอกข้อมูลบิลเองหรืออ่านใหม่ได้</p>}
    {recovery && <div role="status"><p>ยังไม่ทราบผล{recovery === 'confirm' ? 'ยืนยันรับ' : recovery === 'upload' ? 'โหลดรูปที่บันทึก' : 'อ่านบิล'} ตรวจผลล่าสุดก่อนส่งอีกครั้ง</p><button type="button" disabled={busy || !online} onClick={() => reload()}>ตรวจผลล่าสุด</button></div>}
    {step === 'images' && !manual && <>
      <p>{scanEmpty ? 'ยังไม่มีรูปบิล · สแกนอีกครั้ง หรือรับแบบไม่มีบิล' : blind ? 'ถ่ายบิลไว้ก่อน ระบบเปิดรูปและอ่านบิลหลังยืนยันนับครบ' : 'นับครบแล้ว · เพิ่มรูปบิลเพื่อส่งและอ่านด้วย AI ทันที'}</p>
      {scanEmpty ? <div className="ra-scan-choices rc-stack" role="group" aria-label="เลือกวิธีรับของ">
        <button type="button" className="ra-capture-primary" disabled={disabled} onClick={() => scanner.current?.()}>สแกนบิลอีกครั้ง</button>
        <button type="button" className="ra-secondary-action" disabled={disabled} onClick={switchToNoBill}>รับแบบไม่มีบิล</button>
      </div> : <button type="button" className={!doc.images.length && !pending.length ? 'ra-capture-primary' : ''} disabled={disabled || !draft} onClick={() => camera.current?.click()}>ถ่าย / เพิ่มรูปบิล</button>}
      <ImagePages doc={doc} blind={blind} showBlindHint={false} pending={pending} setPending={setPending} busy={disabled} setProcessing={setProcessing} inputRef={camera} scanRef={scanner} />
      <footer className="ra-footer"><p id="receiving-action-reason">{actionReason || (blind ? 'แนบรูปแล้วไปนับของจริง โดยยังไม่เปิดบิล' : 'กลับไปตรวจรายการบิล')}</p>{primary(blind ? 'ไปนับของจริง' : 'กลับเทียบบิล', uploadBill)}</footer>
    </>}
    {reloadAsk && <ReceivingDialog title="โหลดเอกสารล่าสุด?" busy={busy} className="rc-back-dismiss" onClose={() => setReloadAsk(false)} actions={<><PrimaryAction disabled={busy} onClick={() => setReloadAsk(false)}>อยู่ต่อ</PrimaryAction><button type="button" className="ra-secondary-action" disabled={busy} onClick={() => reload(true)}>โหลดใหม่ ทิ้งที่ยังไม่บันทึก</button></>}>
      <p>ตัวเลขหรือรายการที่ยังไม่บันทึกจะหายไป</p>
    </ReceivingDialog>}
    {countReview && !countWarnings && <ReceivingDialog title="ทวนจำนวนก่อนยืนยัน" busy={busy} className="rc-count-review-sheet rc-back-dismiss" onClose={() => setCountReview(false)} actions={<><PrimaryAction icon="check" disabled={disabled} busy={busy} onClick={() => act(persistCount)}>ถูกต้อง ยืนยันการนับ</PrimaryAction><button type="button" className="ra-secondary-action" disabled={busy} onClick={() => setCountReview(false)}>กลับไปแก้</button></>}>
      <p>ยืนยันแล้วแก้จำนวนไม่ได้</p>
      <ul className="ra-count-review-list">{doc.lines.map(line => <li key={line.id}><span>{line.product_name}</span><strong>{counts[line.id] === '0' ? 'ไม่มา' : `${counts[line.id]} ${line.unit_text || 'หน่วย'}`}</strong></li>)}</ul>
    </ReceivingDialog>}
    {countWarnings && <ReceivingDialog title="ตรวจจำนวนนับอีกครั้ง" busy={busy} className="rc-count-warning-sheet rc-back-dismiss" onClose={reviewFlaggedCounts} actions={<><PrimaryAction icon="edit" disabled={busy} onClick={reviewFlaggedCounts}>แก้ไข</PrimaryAction><button type="button" className="ra-secondary-action" disabled={disabled} onClick={() => act(persistCount)}>ยืนยัน จำนวนนี้ถูกต้อง</button></>}>
      <p>จำนวนที่นับสูงผิดปกติ ตรวจอีกครั้งก่อนยืนยัน</p>
      <ul className="ra-count-warning-list">{flaggedCountLines(doc.lines, countWarnings).map(({ warning, line }, i) => <li key={i}><strong>{line?.product_name || 'สินค้า'}:</strong> จำนวน {warning.quantity} {warning.unit} ถูกต้องไหม?</li>)}</ul>
    </ReceivingDialog>}
    {step === 'count' && blind && <>
      <h2>นับของจริงก่อนเสมอ</h2>
      {!manual && doc.images.length > 0 && <p className="ra-evidence-state" role="status">{earlyRead === 'pending' ? 'กำลังอ่านรายการจากบิล… เพิ่มสินค้าเองได้ระหว่างรอ'
        : earlyRead === 'done' ? 'อ่านบิลแล้ว · ใส่ชื่อสินค้าให้ ช่องจำนวนว่างไว้ให้นับเอง'
        : earlyRead === 'failed' ? 'อ่านบิลไม่สำเร็จ · เพิ่มสินค้าเองได้ ระบบจะอ่านอีกครั้งหลังนับ'
        : `แนบบิล ${doc.images.length} หน้าแล้ว · จะอ่านหลังนับครบ`}</p>}
      {doc.lines.length > 0 && <p id="count-legend" className="ra-count-legend">ว่าง = ยังไม่นับ · กด ไม่มา = ไม่ได้ส่ง</p>}
      {doc.lines.map(line => <article className="ra-count-row" key={line.id}><strong className="ra-count-name">{line.product_name || line.bill_name || 'รายการจากบิล'}{!line.product_name && line.bill_name && <small className="ra-bill-name-tag">ชื่อในบิล</small>}</strong><ReceivingNumberField id={`count-${line.id}`} className={flags[line.id] ? 'ra-count-flagged' : ''} error={counts[line.id] ? numberError(counts[line.id], 'quantity_received') : undefined} hint={flags[line.id] ? 'ตรวจจำนวนอีกครั้ง' : counts[line.id] === '0' ? 'ไม่มีของจริง' : undefined} disabled={disabled} label={`นับได้ ${line.product_name || line.bill_name || 'รายการจากบิล'}`} unit={thaiUnit(line.unit_text) || 'หน่วย'} value={counts[line.id] ?? ''} onValueChange={value => setCounts(current => ({ ...current, [line.id]: value }))} /><button type="button" className="rc-count-zero" data-active={counts[line.id] === '0' ? 'true' : undefined} disabled={disabled} aria-label={`ไม่ได้ส่ง ${line.product_name || line.bill_name || 'รายการจากบิล'}`} onClick={() => setCounts(current => ({ ...current, [line.id]: '0' }))}>ไม่มา</button></article>)}
      {doc.scope !== 'branch' && <button type="button" disabled={disabled} onClick={() => setAdding(true)}>เพิ่มสินค้าที่มาส่ง</button>}
      {adding && <ProductSearchSheet id="blind-add-product" title="เพิ่มสินค้าที่มาส่ง" disabled={disabled} branchId={doc.branch_id} departmentId={doc.department_id} existingLines={doc.lines} history={supplierHistory}
        onClose={() => setAdding(false)} onAdd={addCountProduct} onExisting={line => { focusAfterSearch.current = `count-${line.id}`; setAdding(false); }} />}
      <footer className="ra-footer" hidden={adding} aria-describedby="count-progress"><p id="count-progress" role="status">{!doc.lines.length ? 'ยังไม่มีสินค้าให้นับ' : incomplete ? `เหลือ ${incomplete} รายการที่ต้องนับ` : 'นับครบทุกสินค้าแล้ว'}</p>
        {primary(manual ? 'ยืนยันการนับ' : 'ยืนยันการนับและเทียบบิล', async () => {
          const checked = await api.count(doc.id, { ...countBody(), check_only: true });
          if (checked.count_warnings?.length) { setCountWarnings(checked.count_warnings); return; }
          setCountReview(true);
        }, incomplete > 0 || !doc.lines.length || earlyRead === 'pending')}</footer>
    </>}
    {step === 'compare' && !manual && !blind && <>
      {draft && doc.scope !== 'branch' && <><button type="button" disabled={disabled} onClick={() => setAdding(true)}>เพิ่มรายการหลังเปิดบิล</button>{adding && <ProductSearchSheet id="review-add-product" title="เพิ่มรายการหลังเปิดบิล" branchId={doc.branch_id} departmentId={doc.department_id} existingLines={[]} onClose={() => setAdding(false)} onAdd={product => { setDoc(current => ({ ...current, has_receiver_signature: false, lines: [...current.lines, { ...product, id: localSequence.current--, line_no: current.lines.length + 1, quantity_received: '', counted_quantity: null, bill_text: '', quantity_billed: null, unit_price: null }] })); setDirty(true); setAdding(false); }} />}</>}
      <ReviewRows doc={doc} disabled={disabled || !draft} onChange={change} onMatchCounted={matchCounted} onDelete={id => { setDoc(current => ({ ...current, lines: current.lines.filter(line => line.id !== id) })); if (id > 0) setDeleted(current => [...current, id]); setDirty(true); }} onDecide={decide} onBulk={() => act(async () => save({ ...doc, lines: doc.lines.map(line => canBulkAccept(line, doc) ? { ...line, review_decision: 'accept' } : line) }))} />
      <footer className="ra-footer" hidden={adding}><p id="receiving-action-reason">{actionReason || (undecided ? `เหลือ ${undecided} รายการที่ต้องตัดสินใจ` : 'ตัดสินใจครบแล้ว')}</p>{primary('ดูสรุปก่อนเซ็น', async () => { if (dirty) await save(doc); setStep('summary'); }, undecided > 0 || blocked)}</footer>
    </>}
    {step === 'compare' && manual && !blind && <><h2>{doc.lines.some(line => line.order_item_id) ? 'ตรวจจากใบสั่ง' : 'ตรวจรายการ'}</h2><ReviewSummary doc={doc} onChange={draft ? change : undefined} disabled={disabled} /><footer className="ra-footer"><p id="receiving-action-reason">{actionReason || 'ตรวจรายการรับเทียบใบสั่ง แล้วดูสรุปก่อนเซ็น'}</p>{primary('ดูสรุปก่อนเซ็น', async () => { setStep('summary'); }, blocked)}</footer></>}
    {success && <div className="ra-success" aria-label="รับของสำเร็จ"><ReceivingIllustration state="received-success" eager description="" /><strong>เลขที่รับ #{doc.id}</strong><p className="ra-confirmed-state">ยืนยันรับแล้ว</p><p>{evidence.label}</p><p className="ra-accounting-next">{evidence.nextAction}</p>
      {nextShopStatus === 'loading' && <p role="status">กำลังโหลดคิวล่าสุด…</p>}
      {nextShopStatus === 'error' ? <button type="button" className="sg-primary sg-press" onClick={onRefreshQueue}>ลองโหลดคิวใหม่</button> : <button type="button" className="sg-primary sg-press" disabled={nextShopStatus === 'loading'} onClick={onNextShop || onBack}>{nextShopStatus === 'pending' ? 'ไปร้านถัดไป' : 'กลับหน้ารับสินค้า'}</button>}
      <button type="button" className="ra-secondary-action" onClick={() => setShowReceipt(true)}>ดูเอกสาร</button>
    </div>}
    {step === 'summary' && !blind && <><div className="ra-receipt-body" data-collapsed={success}>{!draft && !success && <ReceivingIllustration state={doc.status === 'confirmed' ? 'received-success' : 'error'} description={doc.status === 'confirmed' ? 'ระบบยืนยันใบรับแล้ว' : 'ใบรับถูกยกเลิกแล้ว'} />}<ReviewSummary doc={doc} onChange={draft ? change : undefined} disabled={disabled} /></div>
      {draft ? <footer className="ra-footer"><p id="receiving-action-reason">{actionReason || 'ตรวจสรุปแล้ว ไปเซ็นรับของได้'}</p>{summaryChanged && <p role="status">บันทึกลายเซ็นแล้ว · สรุปเปลี่ยน กรุณาตรวจอีกครั้ง</p>}{primary(summaryChanged ? 'รับทราบสรุปและกลับไปเซ็น' : 'ไปเซ็นรับของ', async () => { if (manual && (undecided || dirty)) await save({ ...doc, lines: doc.lines.map(line => ({ ...line, review_decision: line.review_decision || 'missing_bill' })) }); setSummaryChanged(false); setStep('sign'); }, (!manual && (undecided > 0 || dirty)) || blocked)}</footer>
        : <><div className="ra-receipt-body" data-collapsed={success}><SignaturePad label="ผู้รับสินค้า" documentId={doc.id} role="receiver" saved={doc.has_receiver_signature} inline readOnly /><SignaturePad label="ผู้ส่งของ" documentId={doc.id} role="courier" saved={doc.has_courier_signature} inline readOnly /></div>{!success && doc.status === 'confirmed' && nextShopStatus === 'loading' && <p role="status">กำลังโหลดคิวล่าสุด…</p>}{!success && (nextShopStatus === 'error' ? <button type="button" className="sg-primary sg-press" onClick={onRefreshQueue}>ลองโหลดคิวใหม่</button> : <button type="button" className="sg-primary sg-press" disabled={nextShopStatus === 'loading'} onClick={onNextShop || onBack}>{nextShopStatus === 'pending' ? 'ไปร้านถัดไป' : 'กลับหน้ารับสินค้า'}</button>)}</>}
    </>}
    {step === 'sign' && !blind && <>
      <ReviewSummary doc={doc} compact />
      {/* Courier first (optional): saving the name changes the document, which clears signatures on the server. */}
      <label>ชื่อผู้ส่งของ (ไม่บังคับ)<input value={doc.courier_name || ''} disabled={disabled} onChange={event => { setDoc({ ...doc, courier_name: event.target.value }); setDirty(true); }} /></label>
      {dirty && <button type="button" disabled={disabled} onClick={() => act(async () => save(doc))}>บันทึกชื่อผู้ส่ง</button>}
      {dirty && doc.has_receiver_signature && <p role="status" className="ra-sign-note">บันทึกชื่อแล้วต้องเซ็นผู้รับใหม่ เพราะเอกสารเปลี่ยน</p>}
      <SignaturePad optional label="ผู้ส่งของ (ไม่บังคับ)" documentId={doc.id} role="courier" saved={doc.has_courier_signature} savedImage={courierSignature} inline readOnly={!draft} busy={busy} disabled={disabled || dirty || undecided > 0 || blocked} onInkChange={setCourierInk} saveError={error}
        onSave={image => signatureSave('courier', image, doc.courier_name)} />
      <SignaturePad label={`ผู้รับ ${user.name}`} documentId={doc.id} role="receiver" saved={doc.has_receiver_signature} savedImage={signature} inline readOnly={!draft} busy={busy} disabled={disabled || dirty || undecided > 0 || blocked} onInkChange={setInk} saveError={error}
        onSave={image => signatureSave('receiver', image, user.name)} />
      <footer className="ra-footer"><p id="receiving-action-reason" role="status">{actionReason}</p><PrimaryAction aria-describedby="receiving-action-reason" disabled={disabled || !doc.has_receiver_signature || ink || courierInk || dirty || undecided > 0 || blocked} busy={busy} onClick={confirm}>ยืนยันรับสินค้า</PrimaryAction></footer>
    </>}
    {draft && !recovery && <details className="ra-more"><summary>เพิ่มเติม</summary><button type="button" disabled={disabled || ink || courierInk} onClick={() => reload()}>โหลดเอกสารล่าสุด</button></details>}
    {!draft && doc.status !== 'void' && !canVoid(doc, user) && <p>แก้ข้ามวันให้ฝ่ายบัญชีหรือแอดมิน</p>}
    {!draft && canVoid(doc, user) && <div className="rc-stack ra-receipt-body" data-collapsed={success}><label>เหตุผลยกเลิก<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>{primary('ยกเลิกใบรับ', async () => adopt(await api.void(doc.id, reason)), !reason.trim())}</div>}
    {leave && <ReceivingDialog title="มีข้อมูลที่ยังไม่ส่ง" onClose={() => setLeave(false)} actions={<button type="button" onClick={onBack}>ออกโดยไม่บันทึก</button>}><p>จำนวนและรูปที่ยังไม่ส่งจะหาย</p><button type="button" onClick={() => setLeave(false)}>ทำต่อใบเดิม</button></ReceivingDialog>}
  </section></ReceivingProductScope.Provider>;
}
