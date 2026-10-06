import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Paperclip, Plus, RotateCcw, X } from 'lucide-react';
import { api } from './api.js';
import './receiptIssues.css';

// ต้องตรงกับ server/src/domain/receiptIssues.js
export const ISSUE_CATEGORIES = [
  ['GRAB_NOT_CANCELLED', 'ลืมยกเลิกออเดอร์ Grab ใน POS'],
  ['POS_BILL_ERROR', 'บิล POS ผิด/ซ้ำ/ไม่ได้ยกเลิก'],
  ['WRONG_CHANNEL', 'กดช่องทางชำระเงินผิด'],
  ['CASH_COUNT', 'เงินสดนับผิด/ทอนผิด'],
  ['DEPOSIT', 'มัดจำหรือจ่ายล่วงหน้า'],
  ['REFUND', 'คืนเงินลูกค้า'],
  ['OTHER', 'อื่นๆ']
];
const categoryLabel = (code) => ISSUE_CATEGORIES.find(([value]) => value === code)?.[1] || code;
const money = (value) => Math.abs(Number(value || 0)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value) => `${Number(value) < 0 ? 'ขาด' : Number(value) > 0 ? 'เกิน' : 'ครบ'} ${money(value)}`;
const emptyForm = { category: 'GRAB_NOT_CANCELLED', direction: 'SHORT', amount: '', payment_channel_id: '', note: '' };

export const issueTotals = (issues = [], variance = null) => {
  const active = issues.filter((issue) => issue.status !== 'VOID');
  const explained = Math.round(active.reduce((sum, issue) => sum + Number(issue.amount || 0), 0) * 100) / 100;
  return { explained, unexplained: variance === null || variance === undefined ? null : Math.round((Number(variance) - explained) * 100) / 100 };
};

export default function ReceiptIssues({ receipt, user, variance = null, onChanged }) {
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!receipt) return null;
  const issues = (receipt.issues || []).filter((issue) => issue.status !== 'VOID');
  const reviewer = ['admin', 'auditor'].includes(user?.role);
  const channels = (receipt.lines || []).filter((line) => Number(line.cashier_amount) || Number(line.expected_amount));
  const totals = issueTotals(issues, variance);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const run = async (action) => {
    setBusy(true); setError('');
    try { const next = await action(); if (next) await onChanged?.(next); return true; }
    catch (err) { if (err.code !== 'decision_cancelled') setError(err.message); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (await run(() => api.reportIssue(receipt.id, form, file))) { setForm(null); setFile(null); }
  };
  const changeStatus = (issue, status) => {
    const resolution = status === 'RESOLVED' ? window.prompt('บันทึกผลการตรวจ (ไม่บังคับ)', '') : status === 'VOID' ? (window.confirm('ยกเลิกรายการแจ้งปัญหานี้ใช่ไหม?') ? '' : null) : '';
    if (resolution === null) return;
    run(() => api.updateIssueStatus(issue.id, { status, resolution_note: resolution }));
  };
  const openFile = async (issue) => {
    try { const blob = await api.attachmentFile(issue.attachment_id, 'original'); window.open(URL.createObjectURL(blob), '_blank', 'noopener'); }
    catch (err) { setError(err.message); }
  };

  return (
    <section className="receipt-issues" aria-label="ปัญหาที่ทำให้เงินขาดหรือเกิน">
      <header>
        <div><AlertTriangle size={18} /><strong>ปัญหาที่ทำให้เงินขาด/เกิน</strong>{issues.length > 0 && <small>{issues.length} รายการ</small>}</div>
        {!form && <button type="button" className="receipt-issues-add" onClick={() => { setForm(emptyForm); setError(''); }}><Plus size={16} /> แจ้งปัญหา</button>}
      </header>
      {issues.length > 0 && variance !== null && (
        <div className="receipt-issues-totals">
          <span>ส่วนต่าง <b>{signed(variance)}</b></span>
          <span>อธิบายแล้ว <b>{signed(totals.explained)}</b></span>
          <span className={Math.abs(totals.unexplained) < 0.01 ? 'amount-ok' : 'amount-bad'}>ยังไม่ทราบสาเหตุ <b>{signed(totals.unexplained)}</b></span>
        </div>
      )}
      {form && (
        <div className="receipt-issues-form">
          <label>ประเภทปัญหา<select value={form.category} onChange={set('category')}>{ISSUE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <fieldset><legend>ผลต่อยอดเงิน</legend>
            <label><input type="radio" name="issue-direction" value="SHORT" checked={form.direction === 'SHORT'} onChange={set('direction')} /> ทำให้เงินขาด</label>
            <label><input type="radio" name="issue-direction" value="OVER" checked={form.direction === 'OVER'} onChange={set('direction')} /> ทำให้เงินเกิน</label>
          </fieldset>
          <label>จำนวนเงิน (บาท)<input inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="เช่น 412" /></label>
          <label>ช่องทาง (ถ้ามี)<select value={form.payment_channel_id} onChange={set('payment_channel_id')}><option value="">ไม่ระบุ</option>{channels.map((line) => <option key={line.id} value={line.payment_channel_id}>{line.channel_label}</option>)}</select></label>
          <label className="receipt-issues-note">หมายเหตุ<textarea rows={3} value={form.note} onChange={set('note')} placeholder="เช่น ลูกค้ายกเลิกออเดอร์ Grab #A-123 ร้านไม่ได้ทำอาหาร แต่ลืมยกเลิกบิลใน POS" /></label>
          <label className="receipt-issues-file"><Paperclip size={16} /> แนบหลักฐาน (รูป/PDF)<input type="file" accept="image/*,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />{file && <small>{file.name}</small>}</label>
          <div className="receipt-issues-actions">
            <button type="button" onClick={() => { setForm(null); setFile(null); }} disabled={busy}><X size={16} /> ยกเลิก</button>
            <button type="button" className="primary" onClick={save} disabled={busy || !form.amount || !form.note.trim()}>{busy ? 'กำลังบันทึก...' : 'บันทึกปัญหา'}</button>
          </div>
        </div>
      )}
      {error && <p className="receipt-issues-error" role="alert">{error}</p>}
      {issues.length > 0 && (
        <ul className="receipt-issues-list">
          {issues.map((issue) => (
            <li key={issue.id} className={issue.status === 'RESOLVED' ? 'resolved' : ''}>
              <div className="receipt-issues-row">
                <strong>{categoryLabel(issue.category)}</strong>
                <span className={Number(issue.amount) < 0 ? 'amount-bad' : 'amount-ok'}>{signed(issue.amount)}</span>
                <span className={`receipt-issues-status ${issue.status.toLowerCase()}`}>{issue.status === 'RESOLVED' ? 'ตรวจแล้ว' : 'รอตรวจ'}</span>
              </div>
              <p>{issue.note}</p>
              <small>{issue.channel_label ? `${issue.channel_label} · ` : ''}แจ้งโดย {issue.created_by_name || '—'}{issue.resolution_note ? ` · ผลตรวจ: ${issue.resolution_note}` : ''}</small>
              <div className="receipt-issues-actions">
                {issue.attachment_id && <button type="button" onClick={() => openFile(issue)}><FileText size={15} /> {issue.attachment_name || 'หลักฐาน'}</button>}
                {reviewer && issue.status === 'OPEN' && <button type="button" onClick={() => changeStatus(issue, 'RESOLVED')} disabled={busy}><CheckCircle2 size={15} /> ปิดเรื่อง</button>}
                {reviewer && issue.status === 'RESOLVED' && <button type="button" onClick={() => changeStatus(issue, 'OPEN')} disabled={busy}><RotateCcw size={15} /> เปิดใหม่</button>}
                {issue.status === 'OPEN' && (reviewer || Number(issue.created_by) === Number(user?.id)) && <button type="button" onClick={() => changeStatus(issue, 'VOID')} disabled={busy}><X size={15} /> ยกเลิกรายการ</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!issues.length && !form && <p className="receipt-issues-empty">ถ้าเงินขาด/เกินมีสาเหตุที่รู้ เช่น ลืมยกเลิกออเดอร์ Grab ให้กด "แจ้งปัญหา" พร้อมแนบหลักฐาน</p>}
    </section>
  );
}
