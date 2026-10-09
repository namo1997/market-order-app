import { validateExpensePairInput, readExpensePairContext } from './expense-pair-profile.js';
import { expenseClassificationSuggestions } from './expense-classification-suggestions.js';
import { ADDITIONAL_EXPENSE_SOURCES, additionalExpenseSuggestions, validateAdditionalExpenseSource, safeExpenseResponse } from './expense-profile-suggestions.js';
import { maskAccountNumber } from './payer-details.js';
import { extractRecipientDetails } from './recipient-details.js';
import { ASSIST_SOURCES, assistSuggestions, validateAssistedEntry } from './expense-profile-assist.js';
import { readInvoiceDetails, invoiceClassificationSuggestions } from './invoice-details.js';

export const EXPENSE_FIELD_LIMITS = Object.freeze({
  supplier_name: 300, recipient_name: 300, recipient_bank: 120, recipient_account_masked: 40,
  purpose: 1000, branch: 200, department: 200, transaction_type: 40,
  supplier_payee_relation: 40, notes: 2000, expense_category: 40, expense_period: 7,
  followup_owner: 200, classification_note: 1000
});
export const EXPENSE_TRANSACTION_TYPES = ['purchase', 'advance_payment', 'reimbursement', 'internal_transfer', 'loan', 'refund_adjustment', 'government_remittance', 'unknown'];
export const EXPENSE_CATEGORIES = ['ingredients', 'packaging', 'personnel', 'utilities', 'premises', 'marketing', 'fees', 'asset_review', 'non_expense', 'other', 'pending', 'mixed'];
// ความครบถ้วนเพื่อเตรียมค่าใช้จ่ายแยกจาก reviewed ซึ่งตรวจเฉพาะข้อมูลเอกสาร
export const expensePreparationReadiness = (fields = {}, profileStatus = 'draft') => {
  const value = key => typeof fields?.[key]?.value === 'string' ? fields[key].value.trim() : '';
  const type = value('transaction_type');
  if (['internal_transfer', 'loan', 'government_remittance'].includes(type)) return { status: 'not_applicable', fields_complete: false, missing_fields: [], reasons: ['transaction_not_expense'] };
  const missing_fields = ['expense_category', 'expense_period', 'branch', 'purpose'].filter(key => !value(key));
  const reasons = [];
  if (!EXPENSE_TRANSACTION_TYPES.includes(type) || type === 'unknown') { missing_fields.push('transaction_type'); reasons.push('transaction_unresolved'); }
  const category = value('expense_category');
  const categoryReasons = { non_expense: 'legacy_category', pending: 'classification_pending', mixed: 'mixed_requires_split', asset_review: 'asset_review_required' };
  if (categoryReasons[category]) reasons.push(categoryReasons[category]);
  else if (category && !EXPENSE_CATEGORIES.includes(category)) reasons.push('category_invalid');
  if (value('expense_period') && !/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(value('expense_period'))) { missing_fields.push('expense_period'); reasons.push('period_invalid'); }
  if (missing_fields.length) reasons.push('fields_missing');
  const fields_complete = !missing_fields.length && !reasons.length;
  if (profileStatus !== 'reviewed') reasons.push('not_reviewed');
  return { status: fields_complete && profileStatus === 'reviewed' ? 'ready' : 'not_ready', fields_complete, missing_fields, reasons };
};
// ข้อมูลเตรียมจัดหมวดเป็นคำยืนยันผู้ตรวจ ยังไม่มีแหล่ง OCR/ข้อเสนอสำหรับช่องเหล่านี้
const PREPARATION_FIELDS = new Set(['expense_category', 'expense_period', 'followup_owner', 'classification_note']);
export const EXPENSE_DRAFT_DEFAULT_REASON = 'บันทึกร่าง';
export const EXPENSE_PAYEE_RELATIONS = ['owner', 'authorized_payee', 'platform', 'advance_payer', 'unknown'];
const SOURCES = new Set(['manual', 'bill', 'slip', 'chat', ...ASSIST_SOURCES, ...ADDITIONAL_EXPENSE_SOURCES, 'classification']);
const BILL_CATEGORIES = new Set(['bill', 'bill_page', 'payment_voucher']);
const SLIP_CATEGORIES = new Set(['transfer', 'transfer_notice', 'incoming_transfer']);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const query = (database, sql, params = []) => {
  const statement = database.prepare(sql, params);
  try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
  finally { statement.free(); }
};
const dateSql = (alias) => `CASE WHEN ${alias}.event_timestamp_ms > 0 THEN date((${alias}.event_timestamp_ms / 1000) + 25200, 'unixepoch') ELSE substr(${alias}.created_at,1,10) END`;
const itemFor = (database, id) => query(database, `SELECT ci.*, ${dateSql('ci')} AS business_date FROM capture_items ci WHERE id=?`, [id])[0];
const emptyFields = () => Object.fromEntries(Object.keys(EXPENSE_FIELD_LIMITS).map((key) => [key, { value: null, source: 'manual', evidence: [] }]));
const reject = (code, field = null) => ({ error: code, field });

export const ensureExpenseProfileSchema = (database) => database.run(`
  CREATE TABLE IF NOT EXISTS capture_expense_profiles (
    item_id INTEGER PRIMARY KEY REFERENCES capture_items(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    status TEXT NOT NULL CHECK(status IN ('draft','reviewed')),
    fields_json TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS capture_expense_profile_revisions (
    item_id INTEGER NOT NULL REFERENCES capture_items(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    status TEXT NOT NULL CHECK(status IN ('draft','reviewed')),
    old_status TEXT NOT NULL, old_fields_json TEXT NOT NULL, new_fields_json TEXT NOT NULL,
    actor TEXT NOT NULL, reason TEXT NOT NULL, decision_id TEXT, evidence_snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(item_id, revision)
  );
  CREATE TRIGGER IF NOT EXISTS expense_profile_revision_no_update
    BEFORE UPDATE ON capture_expense_profile_revisions BEGIN SELECT RAISE(ABORT, 'expense revision is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS expense_profile_revision_no_delete
    BEFORE DELETE ON capture_expense_profile_revisions BEGIN SELECT RAISE(ABORT, 'expense revision is immutable'); END;
`);

const chatEvidence = (database, item, messageId) => query(database,
  `SELECT lm.line_message_id FROM line_messages lm WHERE lm.line_message_id=? AND lm.status='active'
   AND lm.message_type='text' AND lm.source_type=? AND lm.source_id=? AND (${dateSql('lm')})=? LIMIT 1`,
  [messageId, item.source_type, item.source_id, item.business_date])[0];

const suggestionsFor = (database, item, reasons = {}) => {
  const suggestions = {};
  if (['unsent', 'duplicate'].includes(item.status)) return suggestions;
  const analysis = parse(item.ai_result_json, {});
  const add = (key, value, source, evidence = [{ item_id: Number(item.id) }]) => {
    if (typeof value !== 'string' || !value.trim()) return;
    suggestions[key] = { value: value.trim().slice(0, EXPENSE_FIELD_LIMITS[key]), source, evidence };
  };
  if (BILL_CATEGORIES.has(item.category)) {
    const supplier = item.supplier_name || analysis.supplier_name || item.vendor_name;
    const original = item.supplier_name ? analysis.supplier_name : analysis.supplier_name || analysis.vendor_name;
    const sameName = (left, right) => typeof left === 'string' && typeof right === 'string'
      && Boolean(left.trim()) && left.trim() === right.trim();
    const generated = item.generated_document_type === 'batch_payment_line' ? parse(item.generated_document_json, {}) : {};
    // ค่าเดิมที่ถูกแก้ภายหลังและไม่ตรง AI/บรรทัดใบสรุป ไม่ยืนยันว่าอ่านจากภาพบิลหรือแชท
    const supplierSource = sameName(supplier, original) || sameName(supplier, generated.supplier_name) ? 'bill' : 'manual';
    add('supplier_name', supplier, supplierSource);
    const purpose = item.bill_purpose || analysis.bill_purpose;
    const context = item.context_message_id ? query(database, 'SELECT line_message_id FROM line_messages WHERE id=?', [item.context_message_id])[0] : null;
    if (context && chatEvidence(database, item, context.line_message_id)) {
      add('purpose', purpose, 'chat', [{ item_id: Number(item.id), message_id: context.line_message_id }]);
    } else add('purpose', purpose, 'manual');
  }
  if (SLIP_CATEGORIES.has(item.category)) {
    // สลิปเก่าอาจมีเฉพาะ OCR: อ่านฝั่ง TO เป็นข้อเสนอให้คนเลือกใช้ ไม่บันทึกกลับหรือใช้ FROM/vendor
    const rawText = typeof analysis.raw_text === 'string' && analysis.raw_text.trim() ? analysis.raw_text : item.ai_raw_text || '';
    const recipient = extractRecipientDetails({ ...analysis, raw_text: rawText });
    add('recipient_name', recipient.recipient_name, 'slip');
    add('recipient_bank', recipient.recipient_bank, 'slip');
    const masked = recipient.recipient_account_masked;
    if (masked) add('recipient_account_masked', `••••${masked.replace(/\D/g, '').slice(-4)}`, 'slip');
  }
  // ระยะ 2: เอกสารคู่/คู่ร้านกับผู้รับที่เคยตรวจแล้ว เติมเฉพาะช่องที่เอกสารนี้ยังไม่มีข้อเสนอ
  const enriched = { ...additionalExpenseSuggestions(database, item, suggestions, EXPENSE_FIELD_LIMITS), ...suggestions };
  const classification = expenseClassificationSuggestions({
    purpose: enriched.purpose?.source === 'ai_summary' ? '' : enriched.purpose?.value || '',
    // Raw OCR includes merchant headers; use selected purpose/explicit expense summary only.
    billDetail: '',
    aiSummary: item.ai_summary || '', isBill: BILL_CATEGORIES.has(item.category)
  });
  const products = invoiceClassificationSuggestions(readInvoiceDetails(database, item));
  // ไม่เสนอหมวดสินค้าสำหรับการโอนภายใน/คืนเงิน/นำส่ง/เงินกู้ที่มีหลักฐานชัดเจน
  const canUseProducts = !classification.transaction_type || classification.transaction_type.value === 'purchase';
  for (const [key, proposal] of Object.entries({ ...classification, ...(canUseProducts ? products : {}) })) {
    enriched[key] = { value: proposal.value, source: 'classification', evidence: enriched.purpose?.evidence?.length
      ? enriched.purpose.evidence : [{ item_id: Number(item.id) }] };
    reasons[key] = proposal.reason;
  }
  return { ...assistSuggestions(database, item, enriched), ...enriched };
};

// เก็บที่มาของเอกสารสร้างไว้ใน revision โดยไม่ส่ง JSON ดิบหรือเลขบัญชีเต็มออกจาก profile
const generatedEvidence = (database, item) => {
  if (!item.generated_document_type) return {};
  const document = parse(item.generated_document_json, {});
  const parentId = Number(item.generated_from_item_id);
  const sourceId = Number.isSafeInteger(parentId) && parentId > 0 ? parentId : null;
  const safeText = (value, limit) => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit).replace(/\d[\d\s-]{6,}\d/gu, (number) => maskAccountNumber(number) || '••••') : null;
  const account = maskAccountNumber(document.account_no || document.payee_account || document.recipient_account_masked);
  const generated = {
    line_no: Number.isSafeInteger(document.line_no) && document.line_no > 0 ? document.line_no : null,
    source_item_id: sourceId,
    supplier_name: safeText(document.supplier_name, 300), payee_name: safeText(document.payee_name, 300),
    bank_name: safeText(document.bank_name, 120),
    recipient_account_masked: account ? `••••${account.replace(/\D/g, '').slice(-4)}` : null,
    amount: typeof document.amount === 'number' && Number.isFinite(document.amount) ? document.amount : null,
    purpose: safeText(document.purpose || document.description, 1000), note: safeText(document.note, 2000)
  };
  const parent = sourceId ? itemFor(database, sourceId) : null;
  const sameScope = parent && parent.source_type === item.source_type && parent.source_id === item.source_id
    && parent.business_date === item.business_date;
  return { generated_document_type: safeText(item.generated_document_type, 80), generated_from_item_id: sourceId,
    generated_document: generated,
    generated_source: sameScope ? { item_id: sourceId, category: parent.category, status: parent.status,
      file_sha256: /^[a-f0-9]{64}$/iu.test(parent.file_sha256 || '') ? parent.file_sha256 : null } : null };
};

export const readExpenseProfile = (database, id, { pairMatchId = null } = {}) => {
  const item = itemFor(database, id);
  if (!item) return null;
  const saved = query(database, 'SELECT * FROM capture_expense_profiles WHERE item_id=?', [id])[0];
  const history = query(database, 'SELECT * FROM capture_expense_profile_revisions WHERE item_id=? ORDER BY revision DESC LIMIT 50', [id])
    .map((row) => ({ revision: row.revision, status: row.status, old_status: row.old_status,
      old_fields: parse(row.old_fields_json, {}), new_fields: parse(row.new_fields_json, {}),
      actor: row.actor, reason: row.reason, decision_id: row.decision_id,
      evidence_snapshot: parse(row.evidence_snapshot_json, {}), created_at: row.created_at }));
  const fields = saved ? parse(saved.fields_json, emptyFields()) : emptyFields();
  const suggestion_reasons = {};
  const suggestions = suggestionsFor(database, item, suggestion_reasons);
  const pairScope = pairMatchId == null ? null : readExpensePairContext(database, { matchId: pairMatchId, ownerId: Number(id) });
  if (pairScope && !pairScope.error) {
    const slip = itemFor(database, pairScope.item_ids[1]);
    const analysis = parse(slip.ai_result_json, {});
    const recipient = extractRecipientDetails({ ...analysis, raw_text: analysis.raw_text || slip.ai_raw_text || '' });
    for (const key of ['recipient_name','recipient_bank','recipient_account_masked']) {
      delete suggestions[key];
      if (recipient[key]) suggestions[key] = { value: key === 'recipient_account_masked' ? `••••${recipient[key].replace(/\D/g, '').slice(-4)}` : recipient[key], source: 'paired_ocr', evidence: [{ item_id: pairScope.item_ids[1] }] };
    }
  }
  return safeExpenseResponse({ item_id: Number(id), revision: saved?.revision || 0, status: saved?.status || 'draft',
    fields, preparation: expensePreparationReadiness(fields, saved?.status || 'draft'), suggestions, suggestion_reasons,
    invoice_details: readInvoiceDetails(database, item),
    reviewed_by: saved?.reviewed_by || null, reviewed_at: saved?.reviewed_at || null,
    updated_by: saved?.updated_by || null, updated_at: saved?.updated_at || null, history,
    ...(pairMatchId == null ? {} : { pair_scope: pairScope, legacy_slip_fields: pairScope?.item_ids ? parse(query(database,'SELECT fields_json FROM capture_expense_profiles WHERE item_id=?',[pairScope.item_ids[1]])[0]?.fields_json,{}) : {} }) });
};

const validateFields = (database, item, supplied, current, pairScope = null) => {
  if (!plain(supplied)) return reject('fields_invalid');
  const fields = { ...current };
  for (const [key, entry] of Object.entries({ ...current, ...supplied })) {
    if (!Object.hasOwn(EXPENSE_FIELD_LIMITS, key)) return reject('field_unknown', key);
    if (!plain(entry) || Object.keys(entry).some((name) => !['value', 'source', 'evidence'].includes(name))
      || !Object.hasOwn(entry, 'value') || !SOURCES.has(entry.source) || !Array.isArray(entry.evidence) || entry.evidence.length > 8) return reject('field_invalid', key);
    if (entry.value !== null && typeof entry.value !== 'string') return reject('value_invalid', key);
    if (typeof entry.value === 'string' && entry.value.length > EXPENSE_FIELD_LIMITS[key]) return reject('value_too_long', key);
    const value = entry.value === null ? null : entry.value.trim() || null;
    if (PREPARATION_FIELDS.has(key) && entry.source !== 'manual' && !(key === 'expense_category' && entry.source === 'classification')) return reject('source_invalid', key);
    if (value && key === 'expense_category' && !EXPENSE_CATEGORIES.includes(value)) return reject('expense_category_invalid', key);
    if (value && key === 'expense_period' && !/^(20[0-9]{2})-(0[1-9]|1[0-2])$/.test(value)) return reject('expense_period_invalid', key);
    if (value && key === 'transaction_type' && !EXPENSE_TRANSACTION_TYPES.includes(value)) return reject('transaction_type_invalid', key);
    if (value && key === 'supplier_payee_relation' && !EXPENSE_PAYEE_RELATIONS.includes(value)) return reject('supplier_payee_relation_invalid', key);
    if (value && key === 'recipient_account_masked'
      && (!/^[Xx*•＊●\d\s-]+$/u.test(value) || !/[Xx*•＊●]/u.test(value) || value.replace(/\D/g, '').length > 4)) return reject('account_must_be_masked', key);
    if (entry.source === 'classification') {
      if (!['transaction_type', 'expense_category'].includes(key)) return reject('source_invalid', key);
      const canonical = suggestionsFor(database, item)[key];
      const same = candidate => candidate && candidate.source === 'classification'
        && candidate.value === value && JSON.stringify(candidate.evidence) === JSON.stringify(entry.evidence);
      // A saved, unchanged adoption remains historical evidence when OCR is later corrected.
      if (!same(current[key]) && !same(canonical)) return reject('classification_suggestion_invalid', key);
    }
    if (ASSIST_SOURCES.includes(entry.source)) {
      const assisted = validateAssistedEntry(database, item, key, entry, value);
      if (assisted.error) return reject(assisted.error, key);
      fields[key] = assisted.field;
      continue;
    }
    if (ADDITIONAL_EXPENSE_SOURCES.includes(entry.source)) {
      const selectedPairEvidence = pairScope && entry.source === 'paired_ocr';
      const error = selectedPairEvidence
        ? (!['recipient_name','recipient_bank','recipient_account_masked'].includes(key) ? 'source_invalid'
          : entry.evidence.some(ref => !plain(ref) || Object.keys(ref).some(k => k !== 'item_id') || ref.item_id !== pairScope.item_ids[1]) ? 'evidence_item_invalid' : null)
        : validateAdditionalExpenseSource(database, item, key, entry);
      if (error) return reject(error, key);
      if (entry.source === 'paired_ocr') {
        if (value && !entry.evidence.length) return reject('evidence_required', key);
        fields[key] = { value, source: entry.source, evidence: entry.evidence };
        continue;
      }
    }
    const evidence = [];
    for (const ref of entry.evidence) {
      if (!plain(ref) || Object.keys(ref).some((name) => !['item_id', 'message_id'].includes(name))
        || !Number.isSafeInteger(ref.item_id) || ref.item_id !== Number(item.id)) return reject('evidence_item_invalid', key);
      const safe = { item_id: ref.item_id };
      if (Object.hasOwn(ref, 'message_id')) {
        if (typeof ref.message_id !== 'string' || !ref.message_id.trim() || ref.message_id.length > 200
          || !chatEvidence(database, item, ref.message_id)) return reject('evidence_message_invalid', key);
        safe.message_id = ref.message_id;
      }
      evidence.push(safe);
    }
    if (value && entry.source !== 'manual') {
      if (!evidence.length) return reject('evidence_required', key);
      if (entry.source === 'bill' && (!BILL_CATEGORIES.has(item.category) || key.startsWith('recipient_'))) return reject('source_invalid', key);
      if (entry.source === 'slip' && (!SLIP_CATEGORIES.has(item.category) || key === 'supplier_name')) return reject('source_invalid', key);
      if (entry.source === 'chat' && !evidence.some((ref) => ref.message_id)) return reject('chat_evidence_required', key);
    }
    fields[key] = { value, source: entry.source, evidence };
  }
  return { fields };
};

// เรียกใน transaction ของ db.js เท่านั้น: บันทึกเฉพาะ profile และประวัติ ไม่แก้ยอดหรือคู่เอกสาร
export const saveExpenseProfile = (database, { id, input, actor, decisionId = null }) => {
  const item = itemFor(database, id);
  if (!item) return reject('item_not_found');
  if (item.status === 'unsent' || item.status === 'duplicate') return reject('item_unavailable');
  if (!plain(input) || Object.keys(input).some((key) => !['expected_revision', 'status', 'fields', 'reason', 'decision_id', 'reason_code', 'reason_text', 'evidence_message_ids', 'pair_context', 'invoice_context'].includes(key))) return reject('request_invalid');
  const invoice = readInvoiceDetails(database, item);
  if (input.invoice_context !== undefined) {
    const context = input.invoice_context;
    if (!plain(context) || Object.keys(context).length !== 1 || typeof context.token !== 'string' || !/^[a-f0-9]{64}$/.test(context.token)) return reject('invoice_context_invalid');
    if (!invoice.applicable || context.token !== invoice.context_token) return reject('invoice_context_changed');
  }
  const pairScope = input.pair_context === undefined ? null : validateExpensePairInput(database, Number(id), input.pair_context);
  if (pairScope?.error) return pairScope;
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) return reject('revision_invalid');
  if (!['draft', 'reviewed'].includes(input.status)) return reject('status_invalid');
  // บันทึกการตรวจเป็นช่องเสริม; เก็บข้อความมาตรฐานตามสถานะเมื่อเว้นว่าง
  if (input.reason != null && typeof input.reason !== 'string') return reject('reason_required');
  if (typeof input.reason === 'string' && input.reason.length > 500) return reject('reason_required');
  const reason = input.reason?.trim() || (input.status === 'draft' ? EXPENSE_DRAFT_DEFAULT_REASON : 'บันทึกว่าตรวจแล้ว');
  if (!reason) return reject('reason_required');
  const saved = query(database, 'SELECT * FROM capture_expense_profiles WHERE item_id=?', [id])[0];
  const revision = Number(saved?.revision || 0);
  if (input.expected_revision !== revision) return { error: 'revision_conflict', current_revision: revision };
  const current = saved ? parse(saved.fields_json, emptyFields()) : emptyFields();
  const validated = validateFields(database, item, input.fields, current, pairScope);
  if (validated.error) return validated;
  const { fields } = validated;
  if (input.status === 'reviewed') {
    if (fields.expense_category?.value === 'non_expense') return reject('expense_category_legacy_review', ['internal_transfer', 'loan', 'government_remittance'].includes(fields.transaction_type.value) ? 'transaction_type' : 'expense_category');
    if (['internal_transfer','loan','government_remittance'].includes(fields.transaction_type.value) && fields.expense_category?.value) return reject('expense_category_not_applicable', 'transaction_type');
    if (['pending', 'mixed'].includes(fields.expense_category?.value)) return reject('classification_pending', 'expense_category');
    const transaction = fields.transaction_type.value;
    if (!transaction) return reject('review_transaction_type_required', 'transaction_type');
    if (transaction === 'purchase' && (!fields.supplier_name.value || !fields.purpose.value)) return reject('review_purchase_fields_required');
    if (transaction === 'government_remittance' && (!fields.purpose.value || !fields.recipient_name.value || !fields.branch.value)) return reject('review_remittance_fields_required');
    if (['internal_transfer', 'loan', 'government_remittance'].includes(transaction) && !fields.notes.value) return reject('review_exception_notes_required', 'notes');
    if (!['purchase', 'government_remittance'].includes(transaction) && (transaction === 'unknown' || !fields.supplier_name.value || !fields.purpose.value) && !fields.notes.value) return reject('review_exception_notes_required', 'notes');
    if (!['internal_transfer', 'loan', 'government_remittance'].includes(transaction) && fields.supplier_name.value && fields.recipient_name.value && fields.supplier_name.value !== fields.recipient_name.value
      && !fields.supplier_payee_relation.value) return reject('review_relation_required', 'supplier_payee_relation');
  }
  const next = revision + 1;
  const now = new Date().toISOString();
  const reviewed = input.status === 'reviewed';
  const messageIds = [...new Set(Object.values(fields).flatMap((field) => field.evidence.map((ref) => ref.message_id)).filter(Boolean))];
  const messages = messageIds.map((messageId) => query(database,
    `SELECT line_message_id,source_type,source_id,status,event_timestamp_ms,text FROM line_messages WHERE line_message_id=?`, [messageId])[0])
    .filter(Boolean).map((message) => ({ ...message,
      text: String(message.text || '').slice(0, 2000).replace(/\d[\d\s-]{6,}\d/gu, (number) => maskAccountNumber(number) || '••••') }));
  const evidenceSnapshot = { item: { item_id: Number(item.id), source_type: item.source_type, source_id: item.source_id,
    business_date: item.business_date, category: item.category, status: item.status, file_sha256: item.file_sha256 || null,
    ...generatedEvidence(database, item) },
    suggestions: pairScope ? readExpenseProfile(database, id, { pairMatchId: pairScope.match_id }).suggestions : suggestionsFor(database, item), messages,
    ...(invoice.applicable ? { invoice_details: invoice } : {}), ...(pairScope ? { pair_scope: pairScope } : {}) };
  database.run(`INSERT INTO capture_expense_profile_revisions
    (item_id,revision,status,old_status,old_fields_json,new_fields_json,actor,reason,decision_id,evidence_snapshot_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [id, next, input.status, saved?.status || 'draft', JSON.stringify(current), JSON.stringify(fields), actor, reason, decisionId, JSON.stringify(evidenceSnapshot), now]);
  database.run(`INSERT INTO capture_expense_profiles (item_id,revision,status,fields_json,reviewed_by,reviewed_at,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,
    fields_json=excluded.fields_json,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
  [id, next, input.status, JSON.stringify(fields), reviewed ? actor : null, reviewed ? now : null, actor, now]);
  return readExpenseProfile(database, id, { pairMatchId: pairScope?.match_id ?? null });
};
