import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, History, Lock, Minus, Plus, Save, X } from 'lucide-react';
import { api } from './api.js';
import { postCloseAdjustmentPreview } from './postCloseAdjustmentAmounts.js';
import './postCloseAdjustments.css';

const money = (value) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value) => `${Number(value) > 0 ? '+' : ''}${money(value)}`;
const dateTime = (note) => note.created_at_epoch_ms
  ? new Date(Number(note.created_at_epoch_ms)).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
  : String(note.created_at || '').replace('T', ' ').slice(0, 19);

const varianceLabel = (value) => Number(value) === 0 ? 'ครบ 0.00' : `${Number(value) < 0 ? 'ขาด' : 'เกิน'} ${money(Math.abs(Number(value)))}`;

export const ClosedReceiptSummary = ({ receipt, print = false }) => {
  if (receipt.status !== 'CLOSED') return null;
  if (!print) return <section className="closed-receipt-bar" aria-label="ยอดยืนยันหลังปิดเอกสาร">
    <div className="closed-receipt-state"><Lock size={17} /><strong>ปิดเอกสารแล้ว</strong>{receipt.post_close_adjustment_count > 0 && <small>ปรับยอดแล้ว {receipt.post_close_adjustment_count} ครั้ง</small>}</div>
    {receipt.post_close_adjustment_count > 0 && <div className="closed-receipt-change"><span>ผลต่างตอนปิด <b>{signed(receipt.original_confirmed_variance_total)}</b></span><span>ปรับหลังปิด <b>{signed(receipt.post_close_adjustment_total)}</b></span></div>}
    <div className="closed-receipt-result"><span>ผลต่างยืนยันล่าสุด</span><strong className={Number(receipt.confirmed_variance_total) === 0 ? 'amount-ok' : 'amount-bad'}>{varianceLabel(receipt.confirmed_variance_total)}</strong></div>
  </section>;
  return <section className="closed-receipt-summary" aria-label="ยอดยืนยันหลังปิดเอกสาร">
    <strong><Lock size={16} /> ปิดเอกสารแล้ว{receipt.post_close_adjustment_count ? ` / ปรับปรุง ${receipt.post_close_adjustment_count} ครั้ง` : ''}</strong>
    <dl>
      <div><dt>ยอดกระทบตอนปิด</dt><dd>{money(receipt.original_confirmed_reconciled_total ?? receipt.confirmed_reconciled_total)}</dd></div>
      <div><dt>ปรับปรุงหลังปิดสะสม</dt><dd>{signed(receipt.post_close_adjustment_total)}</dd></div>
      <div><dt>ยอดกระทบหลังปรับปรุง</dt><dd>{money(receipt.confirmed_reconciled_total)}</dd></div>
      <div><dt>ผลต่างยืนยันล่าสุด</dt><dd>{signed(receipt.confirmed_variance_total)}</dd></div>
    </dl>
  </section>;
};

export const PostCloseAdjustmentHistory = ({ receipt }) => {
  const notes = receipt.post_close_adjustments || [];
  if (!notes.length) return null;
  return <details className="post-close-history" aria-label="ประวัติปรับปรุงหลังปิด">
    <summary><History size={18} /><strong>ประวัติปรับยอด</strong><span>{notes.length} รายการ</span><ChevronDown size={17} /></summary>
    {notes.map((note) => <article key={note.id}>
      <header><strong>#{note.revision} {note.channel_label}</strong><b>{signed(note.amount)}</b></header>
      <p>{note.reason}</p>
      <small>{note.actor_name} / {dateTime(note)} / ผลต่าง {signed(note.variance_total_before)} → {signed(note.variance_total_after)}</small>
    </article>)}
  </details>;
};

export const PostCloseAdjustmentEditor = ({ receipt: currentReceipt, line, onClose, onChanged }) => {
  const receipt = useRef(currentReceipt).current;
  const [direction, setDirection] = useState(1);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const submitLock = useRef(false);
  const alive = useRef(true);
  const amountRef = useRef(null);
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement;
    amountRef.current?.focus();
    return () => { alive.current = false; previousFocus?.focus(); };
  }, []);
  const preview = postCloseAdjustmentPreview({ receipt, line, amount, direction });
  const { delta } = preview;
  const save = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    if (!preview.valid || !reason.trim()) { setError('กรอกจำนวนเงินและเหตุผลก่อนบันทึก'); return; }
    const data = { receipt_line_id: line.id, amount: delta.toFixed(2), reason: reason.trim(), expected_revision: receipt.post_close_adjustment_count || 0 };
    const fingerprint = JSON.stringify(data);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    submitLock.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await api.postCloseAdjustment(receipt.id, { ...data, request_id: request.current.id });
      if (!alive.current) return;
      await onChanged(next, { channelLabel: line.channel_label, delta });
      if (alive.current) onClose();
    } catch (err) { if (alive.current) setError(err.message); }
    finally { submitLock.current = false; if (alive.current) setBusy(false); }
  };
  const formattedAmount = amount ? amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
  return <form className="post-close-editor" aria-label={`ปรับยอด ${line.channel_label}`} onSubmit={save}>
      <header><div><h4>ปรับยอด {line.channel_label}</h4><small>{receipt.branch_name} / {receipt.receipt_date} / หลังปิดเอกสาร</small></div></header>
      <div className="post-close-fields">
        <fieldset disabled={busy}><legend>รายการปรับปรุง</legend><div className="post-close-direction">
          <label className={direction === 1 ? 'is-selected' : ''}><input type="radio" name="direction" checked={direction === 1} onChange={() => setDirection(1)} /><Plus size={16} /> เพิ่มยอด</label>
          <label className={direction === -1 ? 'is-selected' : ''}><input type="radio" name="direction" checked={direction === -1} onChange={() => setDirection(-1)} /><Minus size={16} /> ลดยอด</label>
        </div></fieldset>
        <label>จำนวนเงินที่{direction === 1 ? 'เพิ่ม' : 'ลด'}ครั้งนี้<input ref={amountRef} aria-label="จำนวนเงินปรับปรุงหลังปิด" disabled={busy} inputMode="decimal" value={formattedAmount} required
          onChange={(event) => { const value = event.target.value.replaceAll(',', ''); if (/^\d{0,12}(\.\d{0,2})?$/.test(value)) setAmount(value); }} /></label>
        <label className="post-close-reason">เหตุผล<textarea aria-label="เหตุผลปรับปรุงหลังปิด" disabled={busy} value={reason} required maxLength={1000} rows={2} onChange={(event) => setReason(event.target.value)} /></label>
      </div>
      {preview.valid && <div className="post-close-inline-preview" aria-label="ตัวอย่างยอดหลังปรับ">
        <div><span>ยอดปรับปรุงช่องทางนี้</span><strong>{signed(preview.currentAdjustment)} <em>{delta < 0 ? '-' : '+'} {money(Math.abs(delta))}</em> = {signed(preview.nextAdjustment)}</strong></div>
        <div><span>ผลต่างทั้งวัน</span><strong>{varianceLabel(preview.currentVariance)} <ArrowRight size={17} /> <b className={preview.nextVariance === 0 ? 'amount-ok' : 'amount-bad'}>{varianceLabel(preview.nextVariance)}</b></strong></div>
      </div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <footer><small><Lock size={14} /> ยอดแคชเชียร์และหลักฐานธนาคารคงเดิม</small><button type="button" disabled={busy} onClick={onClose}><X size={16} /> ยกเลิก</button><button type="submit" disabled={busy || !preview.valid || !reason.trim()}><Save size={17} /> {busy ? 'กำลังบันทึก' : 'บันทึกปรับยอด'}</button></footer>
    </form>;
};

export const PostCloseAdjustmentPrintPages = ({ receipt }) => (receipt.post_close_adjustments || []).map((note) => <section className="post-close-print-page" key={note.id}>
  <header><strong>บริษัท โซลาว จำกัด</strong><h1>ใบปรับปรุงยอดหลังปิดเอกสาร</h1></header>
  <p>เอกสารรับเงิน #{receipt.id} / ใบปรับปรุง #{note.id} / ครั้งที่ {note.revision}</p>
  <p>{receipt.branch_name} / วันที่ขาย {receipt.receipt_date}</p>
  <h2>{note.channel_label}</h2>
  <dl className="post-close-preview">
    <div><dt>ยอดกระทบก่อนปรับปรุง</dt><dd>{money(note.reconciled_total_before)}</dd></div>
    <div><dt>เพิ่ม / ลดครั้งนี้</dt><dd>{signed(note.amount)}</dd></div>
    <div><dt>ยอดกระทบหลังปรับปรุง</dt><dd>{money(note.reconciled_total_after)}</dd></div>
    <div><dt>ผลต่างก่อนปรับปรุง</dt><dd>{signed(note.variance_total_before)}</dd></div>
    <div><dt>ผลต่างหลังปรับปรุง</dt><dd>{signed(note.variance_total_after)}</dd></div>
  </dl>
  <h2>เหตุผล</h2><p className="post-close-print-reason">{note.reason}</p>
  <footer><p>ผู้ยืนยัน {note.actor_name} / {dateTime(note)}</p><p>ใบปรับปรุงเพิ่มเติมจากเอกสารปิดเดิม ไม่แก้ยอดแคชเชียร์หรือหลักฐานธนาคารต้นฉบับ</p></footer>
</section>);
