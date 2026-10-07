// ยกเลิกใบแทนด้วยคำสั่งชัดเจน เก็บเอกสารและเหตุผลไว้ในประวัติ ไม่แก้ยอดสลิป
function receiptSubstituteVoidCandidates(rows = []) {
  const seen = new Set();
  return rows.filter(row => {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) || row.generated_document_type !== 'receipt_substitute' || ['unsent','duplicate'].includes(row.status)) return false;
    seen.add(id); return true;
  });
}

class ReceiptSubstituteVoidDraft {
  constructor(row, request) { this.row = { ...row }; this.request = request; this.reason = ''; this.busy = false; this.error = ''; this.result = null; }
  async submit() {
    if (this.busy || this.result) return this.result;
    const reason = this.reason.trim();
    if (!reason) { this.error = 'ระบุเหตุผลการยกเลิกใบแทน'; return null; }
    this.busy = true; this.error = '';
    try {
      const response = await this.request(`/api/admin/items/${this.row.id}/receipt-substitute/void`, { method: 'POST', body: JSON.stringify({ reason, expected_updated_at: this.row.updated_at }) });
      if (!response?.success || !response.data?.voided) throw new Error('ยังไม่ยืนยันผลการยกเลิก กรุณาลองใหม่');
      this.result = response.data; return this.result;
    } catch (error) {
      const messages = { round_closed: 'รอบนี้ปิดแล้ว ยกเลิกใบแทนไม่ได้', revision_conflict: 'เอกสารนี้มีการแก้ไขใหม่ ปิดหน้าต่างแล้วเปิดใบแทนฉบับล่าสุด', reason_required: 'ระบุเหตุผลการยกเลิกใบแทน' };
      this.error = messages[error.details?.code] || error.message || 'ยกเลิกไม่สำเร็จ กรุณาลองใหม่'; return null;
    } finally { this.busy = false; }
  }
}

(() => {
  const panel = document.getElementById('reviewpanel');
  if (!panel) return;
  const style = document.createElement('style');
  style.textContent = '.receipt-substitute-void-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.receipt-substitute-void-actions .btn{font-size:12px;color:#825546;background:transparent}.receipt-substitute-void-dialog{width:min(480px,calc(100vw - 32px));padding:20px;border:1px solid var(--line,#ddd);border-radius:10px;color:var(--ink,#263238);background:#fff}.receipt-substitute-void-dialog::backdrop{background:#18212a66}.receipt-substitute-void-dialog h2{font-size:18px;margin:0 0 10px}.receipt-substitute-void-dialog p{font-size:13px;line-height:1.6}.receipt-substitute-void-dialog label{display:block;font-size:13px;font-weight:600}.receipt-substitute-void-dialog textarea{box-sizing:border-box;width:100%;min-height:90px;margin-top:7px;padding:10px;font:inherit;border:1px solid var(--line,#ccc);border-radius:5px}.receipt-substitute-void-dialog .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.receipt-substitute-void-dialog [role=alert]{color:#9c3c30}.receipt-substitute-void-dialog [hidden]{display:none}.receipt-substitute-void-dialog button:disabled{opacity:.55;cursor:default}';
  document.head.append(style);
  const node = (tag, text, cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
  const scope = () => JSON.stringify([S.view,S.start,S.end,S.source,S.bucket,S.selected]);
  const selectedReceipts = () => receiptSubstituteVoidCandidates(expenseProfileReviewDocuments(S,item,confirmedMatchForItem,matchBills,matchSlips));
  let dialog = null;

  function open(row, opener) {
    if (dialog?.open || S.dayLoading || S.dayLoadError) return;
    const current = selectedReceipts().find(entry => Number(entry.id) === Number(row.id));
    if (!current) return;
    const openedScope = scope(), draft = new ReceiptSubstituteVoidDraft(current, api);
    dialog?.remove(); dialog = document.createElement('dialog'); dialog.className = 'receipt-substitute-void-dialog'; dialog.setAttribute('aria-labelledby','receipt-substitute-void-title');
    const title = node('h2', `ยกเลิกใบแทน #${current.id}`); title.id = 'receipt-substitute-void-title';
    const consequence = node('p', 'เก็บใบแทนในประวัติ คืนสลิปไปรอตรวจ ไม่เปลี่ยนยอดโอน'); consequence.id = 'receipt-substitute-void-consequence';
    const label = node('label','เหตุผลการยกเลิกใบแทน'); label.htmlFor = 'receipt-substitute-void-reason';
    const reason = document.createElement('textarea'); reason.id = label.htmlFor; reason.maxLength = 1000; reason.setAttribute('aria-describedby',consequence.id);
    const error = node('p'); error.setAttribute('role','alert'); error.hidden = true;
    const actions = node('div','','actions'), cancel = node('button','กลับไปตรวจ','btn'), submit = node('button','ยืนยันยกเลิกใบแทน','btn'); cancel.type = submit.type = 'button'; submit.id = 'receipt-substitute-void-submit';
    const close = () => { if (draft.busy) return; dialog.close(); if (opener.isConnected) opener.focus(); };
    cancel.onclick = close; dialog.addEventListener('cancel',event => { event.preventDefault(); close(); });
    // ไม่ให้ Escape ไปเปิดคำสั่งของหน้าหลักขณะหน้าต่างนี้รับเหตุผล
    dialog.addEventListener('keydown',event => event.stopPropagation());
    reason.oninput = () => { draft.reason = reason.value; error.hidden = true; reason.removeAttribute('aria-invalid'); };
    submit.onclick = async () => {
      if (draft.busy || draft.result) return;
      if (scope() !== openedScope || S.dayLoading || S.dayLoadError) { error.textContent = 'เปลี่ยนรายการหรือรอบแล้ว กรุณาปิดแล้วเปิดใบแทนในรอบเดิม'; error.hidden = false; return; }
      draft.reason = reason.value;
      const saving = draft.submit(); submit.disabled = cancel.disabled = reason.disabled = draft.busy; submit.textContent = draft.busy ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกใบแทน';
      const result = await saving;
      if (!result) { submit.disabled = cancel.disabled = reason.disabled = false; submit.textContent = 'ยืนยันยกเลิกใบแทน'; error.textContent = draft.error; error.hidden = false; if (!draft.reason.trim()) { reason.setAttribute('aria-invalid','true'); reason.focus(); } return; }
      dialog.close(); toast('ยกเลิกใบแทนแล้ว · เก็บประวัติและคืนสลิปไปรอตรวจ');
      S.selected = null;
      try { await data(false); } catch (refreshError) { toast(`ยกเลิกสำเร็จ แต่โหลดรายการใหม่ไม่สำเร็จ: ${refreshError.message}`); }
    };
    actions.append(cancel,submit); dialog.append(title,consequence,label,reason,error,actions); document.body.append(dialog); dialog.showModal(); reason.focus();
  }

  function sync() {
    if (S.dayLoading || S.dayLoadError || !panel.querySelector('.reviewhead')) return;
    const receipts = selectedReceipts(), existing = panel.querySelector('.receipt-substitute-void-actions');
    const marker = receipts.map(row => `${row.id}:${row.updated_at || ''}`).join('|');
    if (existing?.dataset.receipts === marker) return;
    existing?.remove(); if (!receipts.length) return;
    const actions = node('div','','receipt-substitute-void-actions'); actions.dataset.receipts = marker;
    receipts.forEach(row => { const button = node('button',receipts.length === 1 ? 'ยกเลิกใบแทน' : `ยกเลิกใบแทน #${row.id}`,'btn'); button.type = 'button'; button.dataset.receiptId = String(row.id); button.onclick = () => open(row,button); actions.append(button); });
    const host = panel.querySelector('.itemdecision') || panel.querySelector('.reviewbody') || panel; host.append(actions);
  }
  new MutationObserver(sync).observe(panel,{childList:true,subtree:true}); sync();
})();
