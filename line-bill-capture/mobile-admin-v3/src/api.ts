export type Row = Record<string, any>;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const normalizeMutationPath = (path: string) => path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');

const actionKeyFor = (path: string, method: string) => {
  const route = normalizeMutationPath(path).replace('/api/admin', '');
  const verb = method.toLowerCase();
  const known: Record<string, string> = {
    'post:/ai/run': 'ai.queue.run', 'post:/ai/rematch': 'ai.matches.rebuild',
    'post:/ai/requeue': 'ai.items.requeue', 'post:/ai/reset-all': 'ai.analysis.reset',
    'post:/ai/pause': 'ai.queue.pause', 'post:/days/close': 'day.close',
    'post:/days/reopen': 'day.reopen', 'post:/senders/refresh': 'senders.refresh',
    'post:/items/deduplicate': 'documents.deduplicate',
    'post:/items/:id/request-transfer': 'line.transfer_request.send',
    'put:/items/:id/category': 'document.category.change',
    'post:/items/:id/category-learning/review': 'document.category_learning.review',
    'patch:/items/:id': 'document.metadata.update',
    'post:/items/:id/cash-payment': 'cash_payment.confirm',
    'patch:/items/:id/cash-payment': 'cash_payment.update',
    'post:/items/:id/cash-payment/void': 'cash_payment.void',
    'post:/items/:id/repair-match-state': 'document.match_state.repair',
    'post:/items/:id/resolve-flag': 'document.amount_flag.resolve',
    'post:/reimbursements/:id/review': 'reimbursement.review',
    'post:/receipt-substitutes': 'receipt_substitute.create',
    'post:/matches': 'match.review', 'post:/matches/:id/learning-feedback': 'match.learning_feedback', 'post:/match-groups': 'match_group.review',
    'post:/items/:id/split-batch-payment': 'batch_payment.split'
  };
  return known[`${verb}:${route}`] || `bill_capture.${verb}.${route.replace(/^\//, '').replaceAll('/', '.')}`;
};

const reasonChoices = (actionKey: string, body: Record<string, any> = {}) => {
  if (actionKey === 'match.review') {
    return String(body.status || 'pending') === 'confirmed'
      ? [['amounts_reconciled', 'ยอดบิลและยอดสลิปตรงกัน'], ['recipient_verified', 'ร้านหรือผู้รับเงินสัมพันธ์กัน'], ['reference_verified', 'เลขอ้างอิงหรือรายการตรงกัน'], ['chat_context', 'บริบทแชทยืนยันว่าเป็นรายการเดียวกัน'], ['manual_review', 'ตรวจภาพบิลและสลิปแล้ว'], ['other', 'เหตุผลอื่น']]
      : [['amount_mismatch', 'ยอดไม่ตรงกัน'], ['different_vendor', 'คนละร้านหรือคนละผู้รับ'], ['slip_for_other_bill', 'สลิปจ่ายบิลใบอื่น'], ['bill_not_paid', 'บิลยังไม่ได้จ่าย'], ['incoming_transfer', 'เป็นเงินโอนเข้า'], ['different_group', 'คนละกลุ่มหรือคนละสาขา'], ['other', 'เหตุผลอื่น']];
  }
  return /send|close|confirm|void|delete/.test(actionKey)
    ? [['evidence_verified', 'ตรวจหลักฐานครบแล้ว'], ['amounts_reconciled', 'ยอดตรงกันแล้ว'], ['supervisor_instruction', 'ทำตามผู้อนุมัติ'], ['other', 'เหตุผลอื่น']]
    : /amount|category/.test(actionKey)
      ? [['source_document', 'ยึดข้อมูลในเอกสาร'], ['chat_context', 'ยึดบริบทในแชท'], ['manual_review', 'ตรวจภาพเองแล้ว'], ['other', 'เหตุผลอื่น']]
      : [['evidence_verified', 'ข้อมูลตรงหลักฐาน'], ['workflow_correction', 'แก้ขั้นตอนให้ถูก'], ['manual_review', 'ตรวจด้วยตนเองแล้ว'], ['other', 'เหตุผลอื่น']];
};

const evidenceItemIds = (path: string, body: unknown) => {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const ids = new Set<number>();
  const routeId = Number(path.match(/\/items\/(\d+)/)?.[1] || 0); if (routeId) ids.add(routeId);
  ['bill_item_id', 'slip_item_id', 'preview_item_id', 'image_item_id'].forEach((key) => { const id = Number(payload[key] || 0); if (id) ids.add(id); });
  ['bill_item_ids', 'slip_item_ids'].forEach((key) => (Array.isArray(payload[key]) ? payload[key] : []).forEach((value: unknown) => { const id = Number(value || 0); if (id) ids.add(id); }));
  return [...ids].slice(0, 8);
};

const decisionEvidence = async (path: string, body: unknown) => {
  const targets = new Set(evidenceItemIds(path, body));
  const contexts = await Promise.all([...targets].map((id) => rawRequest<Row>(`/api/admin/items/${id}/context?window_ms=21600000&limit=80`).catch(() => ({ messages: [] }))));
  const unique = new Map<number, Row>();
  contexts.flatMap((context) => context?.messages || []).forEach((row) => {
    const id = Number(row.id || 0);
    if (id && row.status !== 'unsent' && (row.message_type === 'text' || Number(row.capture_item_id || 0))) unique.set(id, row);
  });
  return [...unique.values()].sort((a, b) => {
    const rank = (row: Row) => targets.has(Number(row.capture_item_id || 0)) ? 0 : row.message_type === 'text' ? 1 : 2;
    return rank(a) - rank(b) || Number(a.event_timestamp_ms || 0) - Number(b.event_timestamp_ms || 0);
  }).slice(0, 16);
};

const evidenceSnapshot = (rows: Row[]) => rows.map((row) => ({ id: Number(row.id), message_type: row.message_type, capture_item_id: Number(row.capture_item_id || 0) || null, sender_display_name: row.sender_display_name || null, text: String(row.text || '').slice(0, 500), event_timestamp_ms: Number(row.event_timestamp_ms || 0) || null, source_id: row.source_id || null }));

const documentSnapshot = (row: Row) => ({ id: Number(row.id), category: row.category, status: row.status, match_status: row.match_status, vendor_name: row.vendor_name || null, bill_purpose: row.bill_purpose || null, bill_total_value: row.bill_total_value ?? null, announced_amount: row.announced_amount ?? null, slip_amount_value: row.slip_amount_value ?? null, amount_review_flag: Number(row.amount_review_flag || 0), sender_display_name: row.sender_display_name || null, event_timestamp_ms: Number(row.event_timestamp_ms || 0) || null, source_id: row.source_id || null, ai_summary: String(row.ai_summary || '').slice(0, 1000), doc_ref: row.doc_ref || null, payment_role: row.payment_role || null });
const decisionDocuments = async (path: string, body: unknown) => Promise.all(evidenceItemIds(path, body).map((id) => rawRequest<Row>(`/api/admin/items/${id}/context?limit=1`).then((context) => context?.item || null).catch(() => null))).then((rows) => rows.filter((row): row is Row => Boolean(row)).map(documentSnapshot));
const waitShadowRun = async (runId: string): Promise<Row> => { for (let attempt = 0; attempt < 40; attempt += 1) { const run: Row = await rawRequest<Row>(`/api/admin/agents/runs/${runId}`).catch((error) => ({ status: 'failed', error_message: error.message })); if (['completed', 'failed', 'skipped'].includes(String(run?.status || ''))) return run; await new Promise((resolve) => setTimeout(resolve, 500)); } return { status: 'failed', error_message: 'AI ใช้เวลานานเกินไป กรุณาให้เหตุผลจากหลักฐานที่ตรวจเอง' } as Row; };

const askReason = (actionKey: string, body: Record<string, any> = {}, evidence: Row[] = [], shadowRunId = '') => new Promise<{ reason_code: string; reason_text: string; evidence_message_ids: number[] }>((resolve, reject) => {
  const root = document.createElement('div');
  root.className = 'decision-sheet-backdrop';
  root.innerHTML = `<section class="decision-sheet" role="dialog" aria-modal="true"><div class="decision-sheet-handle"></div><span>บันทึกการตัดสินใจ</span><h2>ทำไมจึงเลือกทำรายการนี้</h2><p>เลือกเหตุผลมาตรฐานเพื่อบันทึกและทำต่อทันที คนยังเป็นผู้ตัดสินใจสุดท้าย</p><section class="decision-sheet-shadow loading"><strong>AI กำลังวิเคราะห์เอกสารนี้...</strong><p>กำลังเปรียบเทียบยอด ผู้ส่ง เวลา และบริบทในแชท</p></section><details class="decision-sheet-evidence"><summary>เพิ่มหลักฐานจากแชท (ไม่บังคับ)</summary><small>เลือกได้สูงสุด 6 รายการก่อนกดเหตุผล</small><div></div></details><div class="decision-sheet-options"></div><label hidden>รายละเอียดเพิ่มเติม<textarea rows="3" maxlength="800" placeholder="แก้หรืออธิบายเหตุผลตามหลักฐานจริง"></textarea></label><div class="decision-sheet-actions"><button data-cancel type="button">ยกเลิก</button><button data-confirm type="button" hidden disabled>บันทึกเหตุผลอื่นและทำต่อ</button></div></section>`;
  const options = root.querySelector('.decision-sheet-options') as HTMLElement;
  const label = root.querySelector('label') as HTMLLabelElement;
  const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
  const confirm = root.querySelector('[data-confirm]') as HTMLButtonElement;
  const evidenceList = root.querySelector('.decision-sheet-evidence>div') as HTMLElement;
  const shadow = root.querySelector('.decision-sheet-shadow') as HTMLElement;
  let selected = '';
  const selectedEvidenceIds = () => [...evidenceList.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => Number(input.value));
  const finish = (reason_code: string, reason_text: string) => { const evidence_message_ids = selectedEvidenceIds(); root.remove(); resolve({ reason_code, reason_text, evidence_message_ids }); };
  const choose = (code: string, text = '') => { selected = code; options.querySelectorAll('button').forEach((entry) => entry.classList.toggle('selected', (entry as HTMLButtonElement).dataset.code === code)); if (code !== 'other') return finish(code, text); label.hidden = false; confirm.hidden = false; if (text) textarea.value = text; confirm.disabled = !textarea.value.trim(); textarea.focus(); };
  reasonChoices(actionKey, body).forEach(([code, text]) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.code = code; button.textContent = code === 'other' ? text : `${text} · กดแล้วบันทึก`;
    button.onclick = () => choose(code, code === 'other' ? '' : text);
    options.appendChild(button);
  });
  if (!evidence.length) evidenceList.innerHTML = '<small>ไม่พบข้อความใกล้เอกสารนี้</small>';
  evidence.forEach((row) => {
    const item = document.createElement('label'); item.className = 'decision-sheet-evidence-item';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(row.id);
    checkbox.onchange = () => { const checked = evidenceList.querySelectorAll('input:checked'); if (checked.length > 6) checkbox.checked = false; };
    const visual = row.message_type === 'image' && row.capture_item_id ? document.createElement('img') : document.createElement('span');
    if (visual instanceof HTMLImageElement) { visual.src = `/api/admin/items/${Number(row.capture_item_id)}/image`; visual.alt = 'รูปหลักฐาน'; } else { visual.className = 'decision-evidence-icon'; visual.textContent = 'แชท'; }
    const detail = document.createElement('span'); const sender = document.createElement('b'); const snippet = document.createElement('small');
    sender.textContent = row.sender_display_name || 'สมาชิก'; snippet.textContent = row.message_type === 'image' ? `รูป #${Number(row.capture_item_id || 0)}` : String(row.text || '-'); detail.append(sender, snippet); item.append(checkbox, visual, detail); evidenceList.appendChild(item);
  });
  const cancel = () => { root.remove(); const error = new Error('ยกเลิกการทำรายการ'); (error as any).code = 'decision_cancelled'; reject(error); };
  textarea.oninput = () => { confirm.disabled = !textarea.value.trim(); };
  (root.querySelector('[data-cancel]') as HTMLButtonElement).onclick = cancel;
  root.onclick = (event) => { if (event.target === root) cancel(); };
  confirm.onclick = () => { if (selected !== 'other' || !textarea.value.trim()) return; finish('other', textarea.value.trim()); };
  document.body.appendChild(root);
  if (!shadowRunId) { shadow.className = 'decision-sheet-shadow failed'; shadow.innerHTML = '<strong>AI ยังไม่พร้อมวิเคราะห์</strong><p>ให้เลือกเหตุผลจากหลักฐานที่ตรวจเองได้</p>'; return; }
  void waitShadowRun(shadowRunId).then((run) => { if (!root.isConnected) return; if (run.status === 'completed') { const supported = run.predicted_action === actionKey; const confidence = Math.round(Number(run.confidence || 0) * 100); const risks = Array.isArray(run.risk_flags) ? run.risk_flags : []; shadow.className = `decision-sheet-shadow ${supported && !risks.length ? '' : 'hold'}`; shadow.innerHTML = `<strong>${supported ? 'AI เห็นว่าทำรายการนี้ต่อได้' : 'AI แนะนำให้พักตรวจ'} · มั่นใจ ${confidence}%</strong><p>${escapeHtml(run.rationale || 'AI ไม่ได้ระบุเหตุผล')}</p>${risks.length ? `<small>จุดเสี่ยง: ${escapeHtml(risks.join(' · '))}</small>` : ''}<button type="button">ใช้เหตุผล AI เป็นร่าง</button>`; (shadow.querySelector('button') as HTMLButtonElement).onclick = () => choose('other', String(run.rationale || '')); } else { shadow.className = 'decision-sheet-shadow failed'; shadow.innerHTML = `<strong>AI วิเคราะห์รอบนี้ไม่ได้</strong><p>${run.status === 'skipped' ? 'ยังไม่ได้เปิด Shadow AI บนระบบนี้' : escapeHtml(run.error_message || 'ให้ใช้หลักฐานที่ตรวจเอง')}</p>`; } });
});

const params = (values: Record<string, unknown>) => {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return query.toString();
};

async function rawRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...requestOptions,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload.data as T;
}

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const route = path.split('?')[0];
  const needsDecision = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    && route !== '/api/admin/decision-contexts'
    && !route.startsWith('/api/admin/decisions/')
    && !route.startsWith('/api/admin/agents/')
    && !route.endsWith('/category-learning/review');
  if (!needsDecision) return rawRequest<T>(path, options);
  const actionKey = actionKeyFor(path, method);
  let body: unknown = {};
  if (typeof options.body === 'string') { try { body = JSON.parse(options.body); } catch { body = {}; } }
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const entityId = route.match(/\/(\d+)(?:\/|$)/)?.[1] || '';
  const [evidence, documents] = await Promise.all([decisionEvidence(path, body), decisionDocuments(path, body)]);
  const decision = await rawRequest<Row>('/api/admin/decision-contexts', {
    method: 'POST', body: JSON.stringify({
      action_key: actionKey, entity_type: route.split('/').filter(Boolean).at(-2) || 'document',
      entity_id: entityId, page_url: window.location.href,
      context_snapshot: { route, method, request: body, documents, evidence_candidates: evidenceSnapshot(evidence) }
    })
  });
  let reason: { reason_code: string; reason_text: string; evidence_message_ids: number[] };
  try {
    const existingReason = actionKey === 'match.review' ? String(payload.review_note || '').trim() : '';
    reason = existingReason
      ? { reason_code: 'review_note', reason_text: existingReason, evidence_message_ids: [] }
      : await askReason(actionKey, payload, evidence, decision.shadow_run_id);
  } catch (error) {
    await rawRequest(`/api/admin/decisions/${decision.id}/cancel`, { method: 'POST' }).catch(() => undefined);
    throw error;
  }
  const nextOptions = actionKey === 'match.review'
    && ['confirmed', 'rejected'].includes(String(payload.status || ''))
    && !String(payload.review_note || '').trim()
    ? { ...options, body: JSON.stringify({ ...payload, review_note: reason.reason_text, ai_learning_approved: Boolean(reason.reason_text) }) }
    : options;
  return rawRequest<T>(path, {
    ...nextOptions,
    headers: {
      ...(options.headers || {}),
      'X-Decision-Id': decision.id,
      'X-Decision-Reason-Code': reason.reason_code,
      'X-Decision-Reason-Text': encodeURIComponent(reason.reason_text),
      'X-Decision-Evidence-Ids': reason.evidence_message_ids.join(',')
    }
  });
}

export const api = {
  groups: () => request<Row[]>('/api/admin/groups'),
  days: (start: string, end: string, sourceId = '') =>
    request<Row[]>(`/api/admin/days?${params({ start, end, source_id: sourceId })}`),
  items: async (filters: Record<string, unknown>) => {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await request<Row[]>(`/api/admin/items?${params({ limit: 1000, offset, live: 1, ...filters })}`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  },
  matches: async (filters: Record<string, unknown>) => {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request<Row[]>(`/api/admin/matches?${params({ limit: 500, offset, ...filters })}`);
      rows.push(...page);
      if (page.length < 500) break;
    }
    return rows;
  },
  messages: (filters: Record<string, unknown>) =>
    request<Row[]>(`/api/admin/messages?${params({ limit: 300, ...filters })}`),
  senders: (filters: Record<string, unknown> = {}) =>
    request<Row[]>(`/api/admin/senders?${params({ limit: 300, ...filters })}`),
  context: (id: number) => request<Row>(`/api/admin/items/${id}/context`),
  aiStatus: () => request<Row>('/api/admin/ai/status'),
  agentHealth: () => request<Row>('/api/admin/agents/health'),
  decisions: (filters: Record<string, unknown> = {}) => request<Row[]>(`/api/admin/decisions?${params(filters)}`),
  answerDecisionFollowup: (id: string, answer: string) => request<Row>(`/api/admin/decisions/${id}/follow-up`, { method: 'POST', body: JSON.stringify({ answer }) }),
  mutate: (path: string, body: unknown, method = 'POST') =>
    request<Row>(path, { method, body: JSON.stringify(body) })
};

export const imageUrl = (id: number | string) => `/api/admin/items/${id}/image`;

export function bangkokToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00+07:00`);
  value.setDate(value.getDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function businessDate(item: Row) {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (timestamp) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(timestamp));
  }
  const fallback = String(item?.created_at || item?.created_at_line || '');
  return fallback.slice(0, 10);
}

export function lineTime(item: Row) {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (!timestamp) return String(item?.created_at_line || item?.created_at || '').slice(11, 16);
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

export const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

export const shortDate = (value: string) => new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok'
}).format(new Date(`${value}T12:00:00+07:00`));
