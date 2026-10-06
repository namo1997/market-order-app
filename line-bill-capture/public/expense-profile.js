// Desktop brief: evidence stays visible beside the form; header and save controls stay fixed.
function expenseProfileValidation(record, status) {
  const value = key => record.fields[key]?.value?.trim() || '';
  const account = value('recipient_account_masked');
  if (account && (!/^[Xx*•＊●\d\s-]+$/u.test(account) || !/[Xx*•＊●]/u.test(account) || (account.match(/\d/g) || []).length > 4)) return { field: 'recipient_account_masked', message: 'ปิดบังเลขบัญชีด้วย x หรือ * และแสดงตัวเลขไม่เกิน 4 หลัก' };
  if (status === 'reviewed') {
    if (!value('transaction_type')) return { field: 'transaction_type', message: 'เลือกประเภทรายการก่อนบันทึกว่าตรวจแล้ว' };
    if (value('transaction_type') === 'purchase') {
      if (!value('purpose')) return { field: 'purpose', message: 'ระบุรายการซื้อหรือวัตถุประสงค์จากหลักฐาน' };
      if (!value('supplier_name')) return { field: 'supplier_name', message: 'ระบุร้านหรือซัพพลายเออร์ของรายการซื้อ' };
    } else if ((value('transaction_type') === 'unknown' || !value('supplier_name') || !value('purpose')) && !value('notes')) return { field: 'notes', message: 'อธิบายในหมายเหตุว่าเป็นรายการอะไร หรือเหตุใดข้อมูลยังไม่ครบ' };
    if (value('supplier_name') && value('recipient_name') && value('supplier_name') !== value('recipient_name') && !value('supplier_payee_relation')) return { field: 'supplier_payee_relation', message: 'ชื่อร้านกับผู้รับเงินต่างกัน เลือกความสัมพันธ์จากหลักฐาน หรือเลือกยังไม่ทราบ' };
  }
  if (!record.reason.trim()) return { field: 'reason', message: 'ระบุเหตุผลการบันทึกก่อน' };
  return null;
}
function expenseProfileHistoryChanges(history) {
  const keys = new Set([...Object.keys(history.old_fields || {}), ...Object.keys(history.new_fields || {})]);
  return [...keys].filter(key => JSON.stringify(history.old_fields?.[key] ?? null) !== JSON.stringify(history.new_fields?.[key] ?? null)).map(key => ({ key, before: history.old_fields?.[key], after: history.new_fields?.[key] }));
}
function expenseProfileGeneratedDocument(row) {
  if (!['batch_payment_line', 'receipt_substitute'].includes(row.generated_document_type)) return null;
  let data;
  try { data = typeof row.generated_document_json === 'string' ? JSON.parse(row.generated_document_json) : row.generated_document_json; } catch { data = null; }
  const valid = Boolean(data && typeof data === 'object' && !Array.isArray(data));
  data = valid ? data : {};
  const text = value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  const account = value => {
    const digits = (text(value) || '').replace(/\D/g, '');
    return digits ? `••••${digits.slice(-4)}` : null;
  };
  const parent = Number(row.generated_from_item_id ?? data.source_item_id);
  const sourceItemId = Number.isSafeInteger(parent) && parent > 0 && parent !== Number(row.id) ? parent : null;
  const batch = row.generated_document_type === 'batch_payment_line';
  return {
    valid,
    title: batch ? 'รายการจากใบสรุปรอบจ่าย' : 'ใบแทนใบเสร็จรับเงิน',
    notice: batch ? 'ชื่อร้านและชื่อบัญชีเป็นข้อมูลคนละบทบาทตามใบสรุป ยังไม่ยืนยันว่าผู้มีชื่อบัญชีคือผู้รับเงินจริง หรือรายการนี้จ่ายแล้ว' : 'ข้อมูลตามใบแทนที่สร้างไว้ ใช้ตรวจประกอบหลักฐาน ยังไม่ใช่ใบเสร็จจากร้านหรือการยืนยันผู้รับเงินจริง',
    sourceItemId,
    facts: batch ? [
      ['แถวในใบสรุป', text(data.line_no)], ['ชื่อร้านตามใบสรุป', text(data.supplier_name)],
      ['ชื่อบัญชีตามใบสรุป', text(data.payee_name)], ['ธนาคารตามใบสรุป', text(data.bank_name)],
      ['เลขบัญชีตามใบสรุป (ปิดบัง)', account(data.account_no)], ['หมายเหตุตามใบสรุป', text(data.note)]
    ] : [
      ['เลขที่ใบแทน', text(data.document_no)], ['วันที่ใบแทน', text(data.document_date)],
      ['ผู้จ่ายตามใบแทน', text(data.payer_name)], ['ชื่อผู้รับที่ระบุในใบแทน', text(data.payee_name)],
      ['บัญชีที่ระบุในใบแทน (ปิดบัง)', account(data.payee_account)], ['รายละเอียดตามใบแทน', text(data.description)]
    ]
  };
}
function expenseProfileDocumentAmount(document) {
  const value = ['bill', 'bill_page', 'payment_voucher'].includes(document.category) || ['batch_payment_line', 'receipt_substitute'].includes(document.generated_document_type) ? document.bill_total_value ?? document.bill_total_text
    : ['transfer', 'incoming_transfer', 'transfer_notice'].includes(document.category) ? document.slip_amount_value ?? document.slip_amount_text : null;
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) return null;
  return Number(value);
}
function expenseProfileHistoryEvidence(history, revision, side) {
  return side === 'after' ? [revision] : history.filter(prior => Number(prior.revision) < Number(revision.revision)).sort((a, b) => Number(b.revision) - Number(a.revision));
}
function expenseProfileReviewDocuments(state, getItem, getConfirmedMatch, getBills, getSlips) {
  const selected = state.bucket === 'review' ? null : getItem(state.selected);
  const match = state.bucket === 'review' ? (state.matches || []).find(entry => Number(entry.id) === Number(state.selected))
    : state.bucket === 'done' ? getConfirmedMatch(state.selected) || (selected?.active_transaction?.status === 'confirmed' ? selected.active_transaction : null) : null;
  const rows = match ? [...getBills(match), ...getSlips(match)] : state.bucket === 'review' ? [] : [selected];
  if (!match && state.bucket === 'done' && selected?.matched_item_id) rows.push(getItem(selected.matched_item_id));
  const unique = new Map();
  rows.filter(Boolean).forEach(entry => { const id = Number(entry.id); if (Number.isSafeInteger(id) && id > 0 && !unique.has(id)) unique.set(id, entry); });
  return [...unique.values()];
}
function expenseProfileSourceHref(parent, destination, targetBill, getDate, pathname) {
  if (!parent || !destination?.bucket || !Number.isSafeInteger(Number(destination.itemId)) || !Number(destination.itemId)) return null;
  const target = targetBill || parent, date = destination.transactionDate || getDate(target), source = destination.transactionSource || target.source_id || parent.source_id;
  if (!date || !source) return null;
  const params = new URLSearchParams({ view: 'day', date, group: source, bucket: destination.bucket, item: String(destination.itemId) });
  return `${pathname}?${params}`;
}
async function expenseProfileOpenOriginalChat(row, state, getDate, loadDay) {
  const date = getDate(row), source = row.source_id;
  if (!date || !source) throw new Error('ไม่ทราบวันหรือกลุ่มต้นทางของเอกสารนี้ กรุณาตรวจรายการต้นทาง');
  if (state.view !== 'day' || state.start !== date || state.source !== source) {
    const loaded = await loadDay(date, source); if (loaded === false) return false;
  }
  return state.view === 'day' && state.start === date && state.source === source && !state.dayLoading && !state.dayLoadError;
}
function expenseProfileResolveSourceParent(id, getItem, cache) {
  return getItem(id) || cache.get(id) || null;
}
async function expenseProfilePrepareSourceParent(id, getItem, cache, pending, request) {
  const current = getItem(id);
  cache.delete(id);
  if (current) return current;
  if (pending.has(id)) return pending.get(id);
  const loading = request(`/api/admin/items/${id}/context?limit=1`).then(response => {
    const parent = response.data?.item || null; if (parent) cache.set(id, parent); return parent;
  }).catch(() => null).finally(() => pending.delete(id));
  pending.set(id, loading); return loading;
}
// ร่างแยกตามรูป: polling และการเปลี่ยนวันไม่เขียนทับสิ่งที่กำลังกรอก
class ExpenseProfileDrafts {
  constructor(request) { this.request = request; this.records = new Map(); this.active = null; }
  record(id) {
    if (!this.records.has(id)) this.records.set(id, { id, revision: 0, fields: {}, suggestions: {}, history: [], status: 'draft', dirty: false, loaded: false, busy: false, generation: 0, edit: 0, reason: '', error: '', errorField: '', feedback: '', operation: '' });
    return this.records.get(id);
  }
  activate(id) { this.active = id; return this.record(id); }
  set(id, key, value, suggestion) {
    const r = this.record(id);
    r.fields[key] = suggestion ? structuredClone(suggestion) : { value: String(value).trim() || null, source: 'manual', evidence: [] };
    r.dirty = true; r.edit++; r.feedback = ''; r.error = ''; r.errorField = '';
  }
  async load(id, replace = false) {
    const r = this.record(id);
    if (r.busy || (r.loaded && !replace)) return r;
    const generation = ++r.generation, edit = r.edit; r.busy = true; r.operation = 'load'; r.error = ''; r.errorField = ''; r.feedback = '';
    try {
      const response = await this.request(`/api/admin/items/${id}/expense-profile`);
      if (generation === r.generation && edit === r.edit) {
        Object.assign(r, structuredClone(response.data), { loaded: true, dirty: false, reason: '' });
      }
    } catch (error) { r.error = error.message; }
    finally { if (generation === r.generation) { r.busy = false; r.operation = ''; } }
    return r;
  }
  async save(id, status) {
    const r = this.record(id);
    if (r.busy || !r.loaded) return r;
    const invalid = expenseProfileValidation(r, status);
    if (invalid) { r.error = invalid.message; r.errorField = invalid.field; r.feedback = ''; return r; }
    r.busy = true; r.operation = 'save'; r.error = ''; r.errorField = ''; r.feedback = ''; const edit = r.edit;
    try {
      const response = await this.request(`/api/admin/items/${id}/expense-profile`, { method: 'PUT', body: JSON.stringify({ expected_revision: r.revision, status, fields: r.fields, reason: r.reason.trim() }) });
      if (edit === r.edit) Object.assign(r, structuredClone(response.data), { loaded: true, dirty: false, reason: '' });
      else r.revision = response.data.revision;
      r.feedback = (status === 'reviewed' ? 'บันทึกว่าตรวจข้อมูลแล้ว' : 'บันทึกร่างแล้ว') + (r.dirty ? ' · ยังมีร่างใหม่ที่ไม่บันทึก' : '');
    } catch (error) {
      r.error = error.details?.code === 'revision_conflict' ? 'มีผู้บันทึกข้อมูลใหม่แล้ว ร่างของคุณยังอยู่ กรุณาเทียบข้อมูลก่อนโหลดฉบับล่าสุด' : error.message;
      r.errorField = error.details?.field || '';
      const errors = { reason_required: 'ระบุเหตุผลการบันทึกก่อน', value_too_long: 'ข้อมูลยาวเกินกำหนด กรุณาย่อข้อความ', account_must_be_masked: 'ปิดบังเลขบัญชีและแสดงตัวเลขไม่เกิน 4 หลัก', source_invalid: 'ที่มาของข้อมูลไม่ตรงกับเอกสารนี้ ตรวจหลักฐานหรือแก้ค่าเองก่อนบันทึก', evidence_required: 'ข้อมูลจากเอกสารต้องมีหลักฐานอ้างอิง ตรวจข้อเสนอหรือแก้ค่าเอง', evidence_message_invalid: 'ข้อความหลักฐานนี้ใช้อ้างอิงไม่ได้แล้ว ตรวจแชทของวันและกลุ่มนี้อีกครั้ง', evidence_item_invalid: 'หลักฐานอ้างถึงเอกสารอื่น ตรวจข้อมูลของรูปนี้ก่อน', chat_evidence_required: 'ข้อมูลจากแชทต้องอ้างอิงข้อความหลักฐาน', review_transaction_type_required: 'เลือกประเภทรายการก่อนบันทึกว่าตรวจแล้ว', review_relation_required: 'เลือกความสัมพันธ์ของร้านกับผู้รับเงินจริง', review_exception_notes_required: 'อธิบายข้อมูลที่ยังไม่ครบในหมายเหตุ', item_unavailable: 'เอกสารนี้ถูกยกเลิกหรือเป็นเอกสารซ้ำ ร่างยังอยู่และยังบันทึกไม่ได้' };
      if (errors[error.details?.code]) r.error = errors[error.details.code];
      if (error.details?.code === 'reason_required') r.errorField = 'reason';
    } finally { r.busy = false; r.operation = ''; }
    return r;
  }
}


// ไม่แสดงข้อความอื่นนอกหลักฐานที่ฟิลด์นี้อ้างถึง
function expenseProfileEvidenceMessages(entry, currentItem, history = [], chatMessages = []) {
  const ids = new Set((entry?.evidence || []).filter(ref => Number(ref.item_id) === Number(currentItem.id)).map(ref => ref.message_id).filter(Boolean));
  const snapshots = history.flatMap(h => h.evidence_snapshot?.messages || []).map(message => ({ ...message, snapshot: true }));
  const seen = new Set();
  return [...snapshots, ...chatMessages].filter(message => {
    const id = message.line_message_id;
    if (!ids.has(id) || seen.has(id) || (message.source_id && message.source_id !== currentItem.source_id) || typeof message.text !== 'string') return false;
    seen.add(id); return true;
  });
}

(() => {
  const panel = document.getElementById('reviewpanel');
  if (!panel) return;
  const store = new ExpenseProfileDrafts(api);
  const fields = {
    purpose: 'รายการซื้อ / วัตถุประสงค์', transaction_type: 'ประเภทรายการ', supplier_name: 'ร้าน / ซัพพลายเออร์',
    supplier_payee_relation: 'ความสัมพันธ์ร้านกับผู้รับเงิน', recipient_name: 'ผู้รับเงินจริง', recipient_bank: 'ธนาคารผู้รับ',
    recipient_account_masked: 'บัญชีผู้รับ (ปิดบังเลข)', branch: 'สาขา', department: 'หน่วยงาน', notes: 'หมายเหตุ / เหตุผลที่ข้อมูลยังไม่ครบ'
  };
  const choices = {
    transaction_type: [['purchase','ซื้อสินค้า / บริการ'],['advance_payment','จ่ายล่วงหน้า'],['reimbursement','คืนเงินสำรองจ่าย'],['internal_transfer','โอนระหว่างบัญชี'],['loan','เงินกู้ / คืนเงินกู้'],['refund_adjustment','คืนเงิน / ปรับปรุง'],['unknown','ยังไม่ทราบประเภท']],
    supplier_payee_relation: [['owner','เจ้าของร้าน'],['authorized_payee','ผู้รับเงินที่ร้านมอบหมาย'],['platform','แพลตฟอร์ม'],['advance_payer','ผู้สำรองจ่าย'],['unknown','ยังไม่ทราบความสัมพันธ์']]
  };
  const sources = { manual: 'กรอกเอง', bill: 'บิล', slip: 'สลิป', chat: 'แชท' };
  const scope = () => JSON.stringify([S.view, S.start, S.end, S.source]);
  let openedScope = '', row = null, opener = null;
  const sourceParents = new Map(), sourceLoads = new Map(), chooserValues = new Map();
  const prepareSourceParent = id => expenseProfilePrepareSourceParent(id, item, sourceParents, sourceLoads, api);
  const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const dialog = document.createElement('dialog'); dialog.className = 'expense-profile-dialog'; dialog.setAttribute('aria-labelledby', 'expense-profile-title');
  document.body.append(dialog);
  function close() { dialog.close(); store.active = null; if (opener?.isConnected) opener.focus(); }
  async function openOriginalChat() {
    if (scope() !== openedScope || S.dayLoading || S.dayLoadError) return;
    const observed = { ...row }; close();
    try {
      if (!await expenseProfileOpenOriginalChat(observed, S, dateOf, openDay)) return;
      const host = document.getElementById('chatlist'); host?.scrollIntoView({ block: 'nearest' });
      if (host) { host.tabIndex = -1; host.focus(); }
    } catch (error) { toast(error.message); }
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  // ให้ Escape และ Tab ของ dialog นี้ทำงานก่อน key handler ของหน้าเดิม
  window.addEventListener('keydown', event => {
    if (!dialog.open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      const visible = controls.filter(control => control.getClientRects().length);
      const first = visible[0], last = visible.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      event.stopImmediatePropagation();
    }
  }, true);
  function evidenceDisclosure(entry, record, historical = false) {
    if (!entry?.evidence?.length) return null;
    const details = node('details', '', 'expense-profile-evidence');
    details.append(node('summary', 'หลักฐานของข้อมูลนี้'));
    const currentRefs = entry.evidence.filter(ref => Number(ref.item_id) === Number(row.id));
    if (currentRefs.length && row.storage_relative_path) {
      const link = node('a', 'เปิดรูปเอกสารนี้'); link.href = `/api/admin/items/${row.id}/image`; link.target = '_blank'; link.rel = 'noreferrer'; details.append(link);
    }
    const live = !historical && scope() === openedScope ? S.chatState?.messages || [] : [];
    const messages = expenseProfileEvidenceMessages(entry, row, record.history, live);
    messages.forEach(message => {
      details.append(node('small', message.snapshot ? 'ข้อความหลักฐาน ณ วันที่บันทึก' : 'ข้อความหลักฐานจากแชทที่เปิดอยู่'));
      details.append(node('blockquote', message.text));
    });
    if (currentRefs.some(ref => ref.message_id) && !messages.length) {
      details.append(node('p', 'ข้อความหลักฐานยังไม่อยู่ในข้อมูลที่เปิด ตรวจข้อความใกล้รูปนี้ในแชทของวันและกลุ่มเดิมก่อนยืนยัน'));
      if (scope() === openedScope) {
        const chat = node('button', 'กลับไปดูแชทของรายการนี้', 'btn'); chat.type = 'button';
        chat.onclick = openOriginalChat;
        details.append(chat);
      }
    }
    if (!row.storage_relative_path && !messages.length && !currentRefs.some(ref => ref.message_id)) {
      const generated = expenseProfileGeneratedDocument(row);
      if (generated && !historical) {
        const show = node('button', 'ดูเอกสารที่สร้างไว้ทางซ้าย', 'btn'); show.type = 'button';
        show.onclick = () => { const paper = dialog.querySelector('.expense-profile-generated-document'); if (paper) { paper.tabIndex = -1; paper.scrollIntoView({ block: 'nearest' }); paper.focus(); } };
        details.append(show);
      } else details.append(node('p', generated && historical ? 'ฉบับนี้ไม่มีไฟล์ภาพเก็บไว้ เอกสารฝั่งซ้ายเป็นข้อมูลปัจจุบันของรายการ' : 'ไม่มีไฟล์ภาพให้เปิด ตรวจหลักฐานประกอบในหน้ารายการ'));
    }
    return details;
  }
  function generatedDocumentPreview(generated) {
    const paper = node('section', '', 'expense-profile-generated-document');
    paper.append(node('h3', generated.title), node('p', generated.notice, 'expense-profile-generated-notice'));
    if (!generated.valid) paper.append(node('p', 'อ่านข้อมูลของเอกสารที่สร้างไว้ไม่ได้ เปิดรายการต้นทางเพื่อตรวจหลักฐาน', 'expense-profile-error'));
    const facts = node('dl');
    generated.facts.forEach(([label, value]) => { facts.append(node('dt', label), node('dd', value || 'ยังไม่ทราบ')); });
    paper.append(facts);
    if (generated.sourceItemId) {
      const parent = expenseProfileResolveSourceParent(generated.sourceItemId, item, sourceParents);
      const destination = parent ? processLocation(parent) : null;
      const href = expenseProfileSourceHref(parent, destination, destination?.billId ? item(destination.billId) : null, dateOf, location.pathname);
      const link = node(href ? 'a' : 'button', `เปิดรายการต้นทาง #${generated.sourceItemId}`, href ? 'expense-profile-generated-source' : 'btn expense-profile-generated-source');
      if (href) link.href = href; else link.type = 'button';
      link.onclick = event => {
        if (href && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
        event.preventDefault(); const id = generated.sourceItemId; close();
        jumpToProcess(id).catch(error => toast(error.message));
      };
      paper.append(link);
      if (parent?.storage_relative_path) {
        const imageLink = node('a', 'เปิดรูปหลักฐานต้นทาง'); imageLink.href = `/api/admin/items/${generated.sourceItemId}/image`; imageLink.target = '_blank'; imageLink.rel = 'noreferrer'; paper.append(imageLink);
      }
    } else paper.append(node('p', 'ไม่พบรหัสรายการต้นทางในข้อมูลที่เก็บไว้', 'expense-profile-note'));
    return paper;
  }
  function render() {
    if (!dialog.open || !row || store.active !== row.id) return;
    const focusId = dialog.contains(document.activeElement) ? document.activeElement.id : '';
    const oldFormScroll = dialog.querySelector('.expense-profile-form')?.scrollTop || 0;
    const r = store.record(row.id), stale = scope() !== openedScope || S.dayLoading || S.dayLoadError;
    dialog.replaceChildren(); dialog.setAttribute('aria-busy', String(r.busy));
    const header = node('header', '', 'expense-profile-head');
    const titleBlock = node('div'); const title = node('h2', 'ข้อมูลสำหรับค่าใช้จ่าย'); title.id = 'expense-profile-title';
    titleBlock.append(title, node('p', `รูป #${row.id} · ${row.category === 'bill' ? 'บิล' : row.category === 'transfer' ? 'สลิปโอน' : 'เอกสาร'} · ${row.source_id ? group(row.source_id) : 'ไม่ทราบกลุ่ม'}`, 'expense-profile-subtitle'));
    const dismiss = node('button', 'ปิด · เก็บร่างไว้', 'btn'); dismiss.id = 'expense-profile-close'; dismiss.type = 'button'; dismiss.onclick = close;
    header.append(titleBlock, dismiss); dialog.append(header);
    const workspace = node('div', '', 'expense-profile-workspace');
    const evidence = node('aside', '', 'expense-profile-document'); evidence.setAttribute('aria-label', 'หลักฐานต้นฉบับ');
    const generated = expenseProfileGeneratedDocument(row);
    evidence.append(node('h3', generated ? 'เอกสารที่สร้างไว้' : 'หลักฐานต้นฉบับ'));
    if (row.storage_relative_path) {
      const link = node('a', '', 'expense-profile-image-link'); link.href = `/api/admin/items/${row.id}/image`; link.target = '_blank'; link.rel = 'noreferrer'; link.setAttribute('aria-label', `เปิดรูป #${row.id} ขนาดเต็ม`);
      const image = document.createElement('img'); image.src = link.href; image.alt = `หลักฐานรูป #${row.id}`;
      image.onerror = () => { image.hidden = true; link.textContent = 'โหลดภาพไม่ได้ · เปิดหลักฐานเพื่อตรวจอีกครั้ง'; };
      link.append(image); evidence.append(link, node('small', 'คลิกรูปเพื่อเปิดขนาดเต็ม'));
    } else if (generated) evidence.append(generatedDocumentPreview(generated));
    else evidence.append(node('div', 'รูปนี้ไม่มีไฟล์ภาพให้เปิด ตรวจเอกสารหรือข้อความประกอบในหน้ารายการ', 'expense-profile-no-image'));
    const documentAmount = expenseProfileDocumentAmount(row);
    const amountBlock = node('div', '', 'expense-profile-document-amount'); amountBlock.append(node('span', generated ? 'ยอดที่เก็บไว้ของเอกสารนี้' : 'ยอดในเอกสารต้นฉบับ'), node('strong', documentAmount === null ? 'ยังไม่ทราบ' : money(documentAmount))); evidence.append(amountBlock);
    const facts = node('dl', '', 'expense-profile-document-facts');
    for (const [label, value] of [['ชื่อบนเอกสาร', row.supplier_name || row.vendor_name], ['ผู้ส่งใน LINE', row.sender_display_name], ['วันที่เอกสาร', row.bill_date || row.slip_date]]) { facts.append(node('dt', label), node('dd', value || 'ยังไม่ทราบ')); }
    evidence.append(facts, node('p', 'ข้อมูลจากรูปและแชทเป็นข้อเสนอ กรุณาเทียบหลักฐานก่อนนำมาใช้ในร่าง', 'expense-profile-note'));
    const chat = node('button', 'กลับไปดูแชทของรายการนี้', 'btn'); chat.type = 'button'; chat.disabled = Boolean(stale);
    chat.onclick = openOriginalChat; evidence.append(chat);
    const form = document.createElement('form'); form.className = 'expense-profile-form'; form.onsubmit = event => event.preventDefault();
    form.append(node('p', 'เก็บข้อเท็จจริงเพื่อเตรียมค่าใช้จ่าย การตรวจข้อมูลนี้ยังไม่ใช่การอนุมัติจ่าย ลงบัญชี หรือส่งเข้าระบบค่าใช้จ่าย', 'expense-profile-note'));
    const state = node('p', '', 'expense-profile-state'); state.id = 'expense-profile-state'; state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite'); form.append(state);
    const updateState = () => {
      state.textContent = r.busy ? (r.operation === 'save' ? 'กำลังบันทึกข้อมูล…' : 'กำลังโหลดข้อมูล…') : r.feedback ? `${r.feedback} · ฉบับ ${r.revision}` : `${r.status === 'reviewed' ? 'ฉบับบันทึกล่าสุดตรวจแล้ว' : 'ฉบับบันทึกล่าสุดเป็นร่าง'} · ฉบับ ${r.revision}${r.dirty ? ' · มีร่างที่ยังไม่บันทึก' : ''}`;
      state.classList.toggle('dirty', r.dirty); state.classList.toggle('saved', Boolean(r.feedback));
      if (!r.error) { dialog.querySelectorAll('.expense-profile-global-error,.expense-profile-field-error').forEach(error => error.remove()); dialog.querySelectorAll('[aria-invalid]').forEach(input => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }); }
      const footerState = document.getElementById('expense-profile-footer-state'); if (footerState) footerState.textContent = r.busy ? 'กำลังบันทึก…' : r.dirty ? 'มีร่างที่ยังไม่บันทึก' : r.feedback || 'ข้อมูลตรงกับฉบับบันทึกล่าสุด';
    };
    if (!r.loaded) {
      state.textContent = r.error || 'กำลังโหลดข้อมูล…';
      if (r.error) { state.classList.add('expense-profile-error'); const retry = node('button', 'ลองโหลดข้อมูลอีกครั้ง', 'btn'); retry.type = 'button'; retry.onclick = async () => { const id = row.id, generated = expenseProfileGeneratedDocument(row);
    const sourceLoading = generated?.sourceItemId ? prepareSourceParent(generated.sourceItemId) : Promise.resolve();
    const loading = store.load(id); render(); await Promise.all([loading, sourceLoading]); if (store.active === id) render(); }; form.append(retry); }
      workspace.append(evidence, form); dialog.append(workspace); dismiss.focus(); return;
    }
    if (stale) form.append(node('p', 'เปลี่ยนวันหรือกลุ่มแล้ว ร่างยังอยู่ กลับมาเปิดรายการนี้ในรอบเดิมก่อนบันทึก', 'expense-profile-error'));
    for (const [heading, keys] of [['ซื้ออะไร', ['purpose', 'transaction_type']], ['ซื้อจากใคร', ['supplier_name', 'supplier_payee_relation']], ['เงินจ่ายให้ใคร', ['recipient_name', 'recipient_bank', 'recipient_account_masked']], ['ใช้ที่ไหน', ['branch', 'department', 'notes']]]) {
      const section = node('fieldset'); section.append(node('legend', heading));
      const grid = node('div', '', 'expense-profile-fields');
      keys.forEach(key => {
        const box = node('div', '', `expense-profile-field${['purpose', 'notes', 'recipient_name'].includes(key) ? ' wide' : ''}`);
        const label = node('label', fields[key]); label.htmlFor = `expense-profile-${key}`;
        const input = document.createElement(choices[key] ? 'select' : ['purpose', 'notes'].includes(key) ? 'textarea' : 'input'); input.id = label.htmlFor;
        if (choices[key]) { const empty = node('option', 'ยังไม่มีข้อมูล'); empty.value = ''; input.append(empty); choices[key].forEach(([value, text]) => { const option = node('option', text); option.value = value; input.append(option); }); }
        input.value = r.fields[key]?.value ?? ''; input.disabled = r.busy; input.maxLength = ({ supplier_name: 300, recipient_name: 300, recipient_bank: 120, recipient_account_masked: 40, purpose: 1000, branch: 200, department: 200, notes: 2000 })[key] || 40;
        input.placeholder = key === 'recipient_account_masked' ? 'เช่น xxx-x-x1234-x' : 'ยังไม่มีข้อมูล';
        const metadata = node('small', `ที่มาของข้อมูล: ${r.fields[key]?.value == null ? 'ยังไม่ทราบ' : sources[r.fields[key]?.source] || 'ยังไม่ทราบที่มา'}`);
        const savedEvidence = evidenceDisclosure(r.fields[key], r);
        input.oninput = () => { store.set(row.id, key, input.value); metadata.textContent = 'ร่างที่แก้เอง · ยังไม่บันทึก'; savedEvidence?.remove(); input.removeAttribute('aria-invalid'); document.getElementById(`expense-profile-error-${key}`)?.remove(); updateState(); };
        box.append(label, input, metadata); if (savedEvidence) box.append(savedEvidence);
        if (r.errorField === key) { input.setAttribute('aria-invalid', 'true'); const error = node('span', r.error, 'expense-profile-field-error'); error.id = `expense-profile-error-${key}`; input.setAttribute('aria-describedby', error.id); box.append(error); }
        const proposal = r.suggestions[key];
        if (proposal?.value != null) {
          const suggestion = node('div', '', 'expense-profile-suggestion'); suggestion.append(node('span', `ข้อเสนอจาก ${proposal.source === 'manual' ? 'ข้อมูลเดิม (ไม่ทราบที่มา)' : sources[proposal.source] || 'เอกสาร'}: ${proposal.value}`), node('small', 'ยังไม่ยืนยัน · ไม่แทนข้อมูลของคุณอัตโนมัติ'));
          const apply = node('button', 'ใช้ข้อเสนอนี้ในร่าง', 'btn'); apply.type = 'button'; apply.disabled = r.busy;
          apply.onclick = () => { store.set(row.id, key, proposal.value, proposal); render(); document.getElementById(input.id)?.focus(); };
          suggestion.append(apply); const proposedEvidence = evidenceDisclosure(proposal, r); if (proposedEvidence) suggestion.append(proposedEvidence); box.append(suggestion);
        }
        grid.append(box);
      }); section.append(grid); form.append(section);
    }
    if (r.history.length) {
      const history = node('details', '', 'expense-profile-history'); history.append(node('summary', `ประวัติการบันทึก ${r.history.length} ครั้ง`));
      r.history.forEach(h => {
        const revision = node('details', '', 'expense-profile-revision'); revision.append(node('summary', `ฉบับ ${h.revision} · ${h.actor || 'ไม่ทราบผู้บันทึก'} · ${h.created_at || ''}`));
        revision.append(node('p', `เหตุผล: ${h.reason || 'ไม่ระบุ'} · สถานะ ${h.old_status === 'reviewed' ? 'ตรวจแล้ว' : 'ร่าง'} → ${h.status === 'reviewed' ? 'ตรวจแล้ว' : 'ร่าง'}`));
        const table = node('table'); const head = node('tr'); ['ข้อมูล', 'ก่อนแก้', 'หลังแก้'].forEach(text => head.append(node('th', text))); const thead = node('thead'); thead.append(head); table.append(thead); const body = node('tbody');
        expenseProfileHistoryChanges(h).forEach(change => {
          const tr = node('tr'); tr.append(node('th', fields[change.key] || change.key));
          [change.before, change.after].forEach((entry, index) => { const td = node('td'); const label = choices[change.key]?.find(([value]) => value === entry?.value)?.[1]; td.append(node('div', label || entry?.value || 'ยังไม่ทราบ'), node('small', sources[entry?.source] || 'ไม่ทราบที่มา')); const proofHistory = expenseProfileHistoryEvidence(r.history, h, index === 1 ? 'after' : 'before'); const proof = evidenceDisclosure(entry, { history: proofHistory }, true); if (proof) td.append(proof); tr.append(td); }); body.append(tr);
        }); table.append(body); if (!body.children.length) revision.append(node('p', 'ค่าข้อมูลไม่เปลี่ยน · บันทึกสถานะหรือเหตุผล')); else revision.append(table); history.append(revision);
      }); form.append(history);
    }
    workspace.append(evidence, form); dialog.append(workspace);
    const footer = node('footer', '', 'expense-profile-footer');
    const reasonBox = node('div', '', 'expense-profile-reason'); const reasonLabel = node('label', 'เหตุผลการบันทึก'); reasonLabel.htmlFor = 'expense-profile-reason'; const reason = document.createElement('textarea'); reason.id = reasonLabel.htmlFor; reason.maxLength = 500; reason.value = r.reason; reason.disabled = r.busy; reason.placeholder = 'เช่น ตรวจร้านและรายการจากบิลแล้ว';
    reason.oninput = () => { r.reason = reason.value; r.dirty = true; r.edit++; r.feedback = ''; if (r.errorField === 'reason') { r.error = ''; r.errorField = ''; reason.removeAttribute('aria-invalid'); document.getElementById('expense-profile-error-reason')?.remove(); } updateState(); }; reasonBox.append(reasonLabel, reason);
    if (r.errorField === 'reason') { reason.setAttribute('aria-invalid', 'true'); const reasonError = node('span', r.error, 'expense-profile-field-error'); reasonError.id = 'expense-profile-error-reason'; reason.setAttribute('aria-describedby', reasonError.id); reasonBox.append(reasonError); }
    const actionBox = node('div', '', 'expense-profile-action-box'); const footerState = node('p', '', 'expense-profile-footer-state'); footerState.id = 'expense-profile-footer-state'; actionBox.append(footerState);
    const actions = node('div', '', 'expense-profile-actions');
    for (const [status, text] of [['draft', 'บันทึกร่าง'], ['reviewed', 'บันทึกว่าตรวจข้อมูลแล้ว']]) {
      const button = node('button', text, status === 'reviewed' ? 'btn primary' : 'btn'); button.type = 'button'; button.id = `expense-profile-save-${status}`; button.disabled = r.busy || Boolean(stale);
      button.onclick = async () => {
        const id = row.id; if (scope() !== openedScope || S.dayLoading || S.dayLoadError) { render(); return; }
        const saving = store.save(id, status); render(); await saving;
        if (store.active === id) { render(); if (r.errorField) document.getElementById(`expense-profile-${r.errorField}`)?.focus(); else document.getElementById(`expense-profile-save-${status}`)?.focus(); }
      }; actions.append(button);
    }
    const reload = node('button', 'โหลดฉบับล่าสุด', 'btn expense-profile-reload'); reload.type = 'button'; reload.id = 'expense-profile-reload'; reload.disabled = r.busy;
    reload.onclick = async () => { const id = row.id; if (r.dirty && !window.confirm('โหลดฉบับล่าสุดจะแทนร่างที่กรอกไว้ของรูปนี้ ต้องการโหลดหรือไม่?')) return; const loading = store.load(id, true); render(); await loading; if (store.active === id) render(); }; actions.append(reload); actionBox.append(actions);
    if (r.error) { const error = node('p', r.error, 'expense-profile-error expense-profile-global-error'); error.setAttribute('role', 'alert'); actionBox.append(error); }
    footer.append(reasonBox, actionBox); dialog.append(footer); updateState(); form.scrollTop = oldFormScroll;
    const restoreFocus = document.getElementById(focusId);
    (restoreFocus && !restoreFocus.disabled ? restoreFocus : dismiss).focus({ preventScroll: true });
  }
  async function open(observedRow, button) {
    row = { ...observedRow }; opener = button; openedScope = scope(); store.activate(row.id);
    if (!dialog.open) dialog.showModal();
    const id = row.id, generated = expenseProfileGeneratedDocument(row);
    const sourceLoading = generated?.sourceItemId ? prepareSourceParent(generated.sourceItemId) : Promise.resolve();
    const loading = store.load(id); render(); await Promise.all([loading, sourceLoading]); if (store.active === id) render();
  }
  function sync() {
    if (!panel.querySelector('.reviewhead') || S.dayLoading || S.dayLoadError) return;
    const rows = expenseProfileReviewDocuments(S, item, confirmedMatchForItem, matchBills, matchSlips);
    if (!rows.length || panel.querySelector('.expense-profile-entry')) return;
    const entry = node('div', '', 'expense-profile-entry');
    const documentLabel = observedRow => {
      const kind = observedRow.generated_document_type === 'receipt_substitute' ? 'ใบแทน' : observedRow.generated_document_type === 'batch_payment_line' ? 'รายการใบสรุป' : ['bill', 'bill_page', 'payment_voucher'].includes(observedRow.category) ? 'บิล' : ['transfer', 'transfer_notice', 'incoming_transfer'].includes(observedRow.category) ? 'สลิป' : 'เอกสาร';
      return `${kind} #${observedRow.id}`;
    };
    if (rows.length <= 2) {
      rows.forEach(observedRow => {
        const button = node('button', `ข้อมูลสำหรับค่าใช้จ่าย · ${documentLabel(observedRow)}`, 'btn'); button.type = 'button';
        button.onclick = () => open(observedRow, button); entry.append(button);
      });
    } else {
      const label = node('label', `เลือกเอกสารที่จะบันทึกข้อมูล · ${rows.length} เอกสาร`); label.htmlFor = 'expense-profile-document-choice';
      const select = document.createElement('select'); select.id = label.htmlFor;
      rows.forEach(observedRow => { const value = expenseProfileDocumentAmount(observedRow); const option = node('option', `${documentLabel(observedRow)} · ${value === null ? 'ยังไม่ทราบยอด' : money(value) + ' บาท'}`); option.value = String(observedRow.id); select.append(option); });
      const key = JSON.stringify([S.view, S.start, S.end, S.source, S.bucket, S.selected]);
      const cached = chooserValues.get(key), initial = rows.some(doc => Number(doc.id) === Number(cached)) ? cached : rows.some(doc => Number(doc.id) === Number(S.selected)) && S.bucket !== 'review' ? S.selected : rows[0].id;
      select.value = String(initial); chooserValues.set(key, select.value); select.onchange = () => chooserValues.set(key, select.value);
      const button = node('button', 'ข้อมูลสำหรับค่าใช้จ่าย', 'btn'); button.type = 'button';
      button.onclick = () => { const observed = rows.find(doc => Number(doc.id) === Number(select.value)); if (observed) open(observed, button); };
      const controls = node('div', '', 'expense-profile-chooser-controls'); controls.append(select, button); entry.append(label, controls);
    }
    panel.append(entry);
  }
  new MutationObserver(sync).observe(panel, { childList: true, subtree: true }); sync();
})();
