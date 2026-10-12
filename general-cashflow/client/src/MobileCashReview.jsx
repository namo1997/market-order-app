import { useEffect, useState } from 'react';
import { Check, FileText, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { overviewDate, overviewMoney as money, overviewWeekday } from './receiptsOverviewState.js';
import { buildLineEvidenceReconciliation, roundCurrency } from './reconciliationSummary.js';
import { isManualReviewAwaitingEvidence } from './evidenceReviewStatus.js';
import { requestText } from './actionDialog.jsx';
import { ISSUE_CATEGORIES } from './ReceiptIssues.jsx';
import './mobileCashReview.css';

// Phone admin review: cash is the only thing counted here; other channels are read-only context.
const parseMoney = (value) => {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) && number >= 0 ? roundCurrency(number) : null;
};
const sum = (rows, pick) => roundCurrency(rows.reduce((total, row) => total + Number(pick(row) || 0), 0));
const lineReviewed = (line) => !isManualReviewAwaitingEvidence(line)
  && (Number(line.manual_checked_without_reference) === 1 || ['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(line.settlement_status));
const lineHasData = (line) => [line.cashier_amount, line.statement_amount, line.expected_gross_amount, line.expected_net_amount]
  .some((value) => Math.abs(Number(value || 0)) >= 0.01);
const lineNeedsReason = (line) => {
  const result = buildLineEvidenceReconciliation(line);
  return (result.hasVariance || Math.abs(Number(line.reconciliation_adjustment_amount || 0)) >= 0.01)
    && !String(line.variance_reason || '').trim();
};
const differenceText = (value) => Math.abs(value) < 0.01 ? 'ตรง' : `${value > 0 ? 'เกิน' : 'ขาด'} ${money(Math.abs(value))}`;

function CashPhoto({ attachment, onOpen }) {
  const [url, setUrl] = useState('');
  const isImage = String(attachment.mime_type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(attachment.original_name || '');
  useEffect(() => {
    if (!isImage) return undefined;
    const controller = new AbortController();
    let objectUrl = '';
    api.attachmentFile(attachment.id, 'original', { signal: controller.signal })
      .then((file) => { objectUrl = URL.createObjectURL(file.blob); setUrl(objectUrl); })
      .catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, isImage]);
  return <button type="button" className="mcr-photo" aria-label={`เปิดเอกสาร ${attachment.original_name || ''}`} onClick={() => onOpen(attachment)}>
    {url ? <img src={url} alt="" /> : <FileText size={26} />}
  </button>;
}

export default function MobileCashReview({ receiptId, onOpenEvidence }) {
  const [receipt, setReceipt] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [counted, setCounted] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      const next = await api.receipt(receiptId);
      setReceipt(next);
      setEditing(false);
      setCounted('');
    } catch (err) {
      if (!err.authExpired) setLoadError(err.message);
    }
  };
  useEffect(() => { setReceipt(null); load(); }, [receiptId]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (loadError) return <section className="mcr"><div className="mcr-error" role="alert">{loadError}<button type="button" onClick={load}>ลองอีกครั้ง</button></div></section>;
  if (!receipt) return <section className="mcr"><p className="mcr-loading" role="status"><RefreshCw size={18} className="spin" /> กำลังโหลด…</p></section>;

  const lines = receipt.lines || [];
  const cash = lines.find((line) => line.channel_code === 'CASH');
  const others = lines.filter((line) => line.channel_code !== 'CASH' && lineHasData(line));
  const closed = receipt.status === 'CLOSED';
  const submitted = !['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status);
  const dayChecked = ['CHECKED_OK', 'CHECKED_VARIANCE', 'CLOSED'].includes(receipt.status);

  const miscTotal = sum(receipt.misc_items || [], (item) => item.amount);
  const depositIn = sum((receipt.reservation_deposits_received || []).filter((item) => item.status !== 'VOID'), (item) => item.amount);
  const depositUsed = sum(receipt.reservation_deposits_applied || [], (item) => item.amount);
  const cashierCash = roundCurrency(cash?.cashier_amount || 0);
  const cashierOther = sum(lines.filter((line) => line.channel_code !== 'CASH'), (line) => line.cashier_amount);
  const cashierTotal = roundCurrency(cashierCash + cashierOther + miscTotal);
  const expectedTotal = roundCurrency(Number(receipt.gross_sales_expected || 0) + Number(receipt.morning_change_amount || 0) + depositIn - depositUsed);
  const cashierDifference = roundCurrency(cashierTotal - expectedTotal);

  const cashChecked = cash ? lineReviewed(cash) || (dayChecked && Number(cash.statement_amount || 0) > 0) : false;
  const cashCounted = roundCurrency(cash?.statement_amount || 0);
  const showInput = cash && submitted && !closed && (!cashChecked || editing);
  const countedValue = parseMoney(counted);
  const countedDifference = countedValue === null ? null : roundCurrency(countedValue - cashierCash);

  const run = async (action, success) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      await load();
      if (success) setMessage(success);
    } catch (err) {
      if (!err.authExpired && err.code !== 'decision_cancelled') setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmCash = async () => {
    if (!cash || countedValue === null || countedValue <= 0) return;
    let reason = String(cash.variance_reason || '');
    if (Math.abs(countedDifference) >= 0.01) {
      const note = await requestText(`เงินสดนับได้ ${differenceText(countedDifference)} บาท จากที่แคชเชียร์ส่ง ระบุเหตุผล`, reason);
      if (note === null) return;
      if (!note.trim()) { setError('กรุณาระบุเหตุผลที่ยอดนับไม่ตรง'); return; }
      reason = note.trim();
    }
    run(() => api.manualCheckWithoutReference(cash.id, true, { statement_amount: countedValue, variance_reason: reason }), 'บันทึกยอดเงินสดแล้ว');
  };

  const checkDay = async () => {
    const draft = lines.map((line) => ({ ...line }));
    for (const line of draft.filter(lineNeedsReason)) {
      const note = await requestText(`${line.channel_label} ยังมีส่วนต่าง ระบุเหตุผล`);
      if (note === null) return;
      if (!note.trim()) { setError(`กรุณาระบุเหตุผลของ ${line.channel_label}`); return; }
      line.variance_reason = note.trim();
      line.exception_category = line.exception_category || 'OTHER';
    }
    run(() => api.checkReceipt(receipt.id, {
      lines: draft.map((line) => ({
        id: line.id,
        payment_channel_id: line.payment_channel_id,
        statement_amount: line.statement_amount,
        reconciliation_adjustment_amount: line.reconciliation_adjustment_amount,
        variance_reason: line.variance_reason,
        exception_category: line.exception_category
      }))
    }), 'ยืนยันตรวจทั้งวันแล้ว');
  };

  const closeDay = () => run(async () => {
    try {
      await api.closeReceipt(receipt.id, { note: 'Closed from phone' });
    } catch (err) {
      if (err.details?.code !== 'missing_evidence') throw err;
      const list = err.details.lines.map((line) => `• ${line.channel_label}: ${line.state}`).join('\n');
      const reason = await requestText(`ยังไม่มีหลักฐานเงินเข้า\n${list}\n\nระบุเหตุผลเพื่อปิดเอกสารต่อ`);
      if (!reason?.trim()) throw new Error('ยังไม่ได้ปิดเอกสาร: ต้องระบุเหตุผล');
      await api.closeReceipt(receipt.id, { note: 'Closed from phone', missing_evidence_reason: reason.trim() });
    }
  }, 'ปิดเอกสารแล้ว');

  const sendBack = async () => {
    const note = await requestText('เหตุผลที่ส่งกลับให้แคชเชียร์แก้ไข');
    if (note === null) return;
    if (!note.trim()) { setError('กรุณาระบุเหตุผลที่ส่งกลับแก้ไข'); return; }
    run(() => api.requestCorrection(receipt.id, { note: note.trim() }), 'ส่งกลับแก้ไขแล้ว');
  };

  const cashPhotos = (receipt.attachments || []).filter((file) => file.attachment_type === 'cash_slip');
  const otherDocs = (receipt.attachments || []).filter((file) => file.attachment_type === 'cashier_summary');
  const openIssues = (receipt.issues || []).filter((issue) => issue.status !== 'VOID');

  const step = !submitted ? 'รอแคชเชียร์ส่งยอด'
    : closed ? 'ปิดเอกสารแล้ว'
    : !cashChecked ? 'นับเงินสด แล้วกดยืนยัน'
    : dayChecked ? 'ตรวจครบแล้ว ปิดเอกสารได้'
    : 'เงินสดเรียบร้อย ยืนยันทั้งวันได้';

  return <section className="mcr" aria-busy={busy}>
    <header className="mcr-day">
      <div><strong>{receipt.branch_name}</strong><span>{overviewWeekday(String(receipt.receipt_date).slice(0, 10))} {overviewDate(receipt.receipt_date)}</span></div>
      <em className={`mcr-status is-${closed ? 'done' : dayChecked ? 'checked' : 'todo'}`}>{receipt.status_label}</em>
    </header>

    <section className="mcr-card mcr-summary" aria-label="สรุปยอดแคชเชียร์">
      <div className="mcr-row"><span>ผลต่างแคชเชียร์</span><strong className={Math.abs(cashierDifference) < 0.01 ? 'is-ok' : 'is-off'}>{cashierDifference > 0 ? '+' : ''}{money(cashierDifference)}</strong></div>
      <p>แคชเชียร์กรอก {money(cashierTotal)} · ต้องได้ {money(expectedTotal)}</p>
      <dl>
        <div><dt>เงินสด</dt><dd>{money(cashierCash)}</dd></div>
        <div><dt>ไม่ใช่เงินสด</dt><dd>{money(cashierOther)}</dd></div>
        <div><dt>เงินทอนเช้า</dt><dd>{money(receipt.morning_change_amount)}</dd></div>
        {Math.abs(miscTotal) >= 0.01 && <div><dt>รายการอื่นๆ</dt><dd>+{money(miscTotal)}</dd></div>}
        {(depositIn > 0 || depositUsed > 0) && <div><dt>มัดจำ รับ/ใช้</dt><dd>{money(depositIn)} / {money(depositUsed)}</dd></div>}
      </dl>
    </section>

    {cash && <section className="mcr-card mcr-cash" aria-label="เงินสด">
      <div className="mcr-row"><h2>เงินสด</h2>{cashChecked && !editing && <em className="mcr-status is-done"><Check size={14} strokeWidth={3} /> นับแล้ว</em>}</div>
      <div className="mcr-amounts">
        <div><span>แคชเชียร์ส่ง</span><strong>{money(cashierCash)}</strong></div>
        {cashChecked && !editing && <div><span>นับได้</span><strong>{money(cashCounted)}</strong><small className={Math.abs(cashCounted - cashierCash) < 0.01 ? 'is-ok' : 'is-off'}>{differenceText(roundCurrency(cashCounted - cashierCash))}</small></div>}
      </div>
      {showInput && <label className="mcr-input">
        <span>ยอดที่นับได้ (บาท)</span>
        <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={counted} disabled={busy} onChange={(event) => setCounted(event.target.value.replace(/[^\d.,]/g, ''))} />
        {countedDifference !== null && <small className={Math.abs(countedDifference) < 0.01 ? 'is-ok' : 'is-off'}>{Math.abs(countedDifference) < 0.01 ? 'ตรงกับแคชเชียร์' : `${differenceText(countedDifference)} จากแคชเชียร์`}</small>}
      </label>}
      {showInput && <button type="button" className="mcr-primary" disabled={busy || countedValue === null || countedValue <= 0} onClick={confirmCash}>{busy ? 'กำลังบันทึก…' : countedValue === null ? 'กรอกยอดที่นับได้' : 'ยืนยันยอดเงินสด'}</button>}
      {cashChecked && !editing && !closed && <button type="button" className="mcr-link" onClick={() => { setEditing(true); setCounted(String(cashCounted)); }}>แก้ยอดนับ</button>}
      {editing && <button type="button" className="mcr-link" onClick={() => { setEditing(false); setCounted(''); }}>ยกเลิกแก้ไข</button>}
      {cashPhotos.length > 0 && <div className="mcr-photos">{cashPhotos.map((file) => <CashPhoto key={file.id} attachment={file} onOpen={onOpenEvidence} />)}</div>}
    </section>}

    {others.length > 0 && <section className="mcr-card mcr-others" aria-label="ช่องทางอื่น">
      <h2>ช่องทางอื่น</h2>
      {others.map((line) => {
        const done = lineReviewed(line) || dayChecked;
        return <div className="mcr-line" key={line.id}>
          <span>{line.channel_label}</span>
          <strong>{money(line.cashier_amount)}</strong>
          <em className={done ? 'is-ok' : 'is-wait'}>{lineReviewed(line) ? 'ตรวจแล้ว' : dayChecked ? 'มีเหตุผลแล้ว' : 'รอหลักฐาน'}</em>
        </div>;
      })}
      {otherDocs.length > 0 && <p className="mcr-docs">{otherDocs.map((file, index) => <button type="button" key={file.id} onClick={() => onOpenEvidence(file)}>ใบสรุปแคชเชียร์{otherDocs.length > 1 ? ` ${index + 1}` : ''}</button>)}</p>}
    </section>}

    {openIssues.length > 0 && <section className="mcr-card mcr-others" aria-label="ปัญหาเงินขาดเกิน">
      <h2>ปัญหาที่แจ้งไว้</h2>
      {openIssues.map((issue) => <div className="mcr-line" key={issue.id}>
        <span>{ISSUE_CATEGORIES.find(([code]) => code === issue.category)?.[1] || issue.category}{issue.note ? ` · ${issue.note}` : ''}</span>
        <strong>{differenceText(Number(issue.amount || 0))}</strong>
        <em className={issue.status === 'RESOLVED' ? 'is-ok' : 'is-wait'}>{issue.status === 'RESOLVED' ? 'ตรวจแล้ว' : 'รอตรวจ'}</em>
      </div>)}
    </section>}

    <footer className="mcr-actions">
      <p>{step}</p>
      {error && <div className="mcr-error" role="alert">{error}</div>}
      {message && <div className="mcr-ok" role="status">{message}</div>}
      {submitted && !closed && <div className="mcr-buttons">
        {receipt.status === 'SUBMITTED' && <button type="button" className={cashChecked ? 'mcr-primary' : 'mcr-secondary'} disabled={busy} onClick={checkDay}>ยืนยันตรวจทั้งวัน</button>}
        {dayChecked && <button type="button" className="mcr-primary" disabled={busy} onClick={closeDay}>ปิดเอกสาร</button>}
        <button type="button" className="mcr-secondary is-warn" disabled={busy} onClick={sendBack}>ส่งกลับแก้ไข</button>
      </div>}
    </footer>
  </section>;
}
