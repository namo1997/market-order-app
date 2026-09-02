import {
  claimPendingGroupValidationRequests,
  finishGroupValidationRequest,
  listItems
} from './db.js';

const CHANNEL_ACCESS_TOKEN = String(process.env.LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN || '').trim();
const SILENT_MODE = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.LINE_BILL_CAPTURE_SILENT_MODE || '').trim().toLowerCase()
);

const parseConfiguredGroups = () => {
  const raw = String(process.env.LINE_BILL_CAPTURE_VALIDATION_GROUPS || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.warn('[LINE CAPTURE] invalid LINE_BILL_CAPTURE_VALIDATION_GROUPS; validation replies disabled');
    return {};
  }
};

const groupKey = (sourceType, sourceId) => `${String(sourceType || '').trim()}:${String(sourceId || '').trim()}`;

export const getConfiguredGroupSettings = (sourceType, sourceId) => {
  const groups = parseConfiguredGroups();
  const type = String(sourceType || '').trim();
  const source = String(sourceId || '').trim();
  const value = groups[source] || groups[groupKey(type, source)];
  if (!value || typeof value !== 'object') return null;
  return {
    mode: String(value.mode || 'bill_summary').trim() || 'bill_summary',
    supplier: String(value.supplier || '').trim() || 'ซัพพลายเออร์',
    replyEnabled: !SILENT_MODE && value.reply_enabled !== false,
    sourceType: type,
    sourceId: source
  };
};

const parseAiResult = (item) => {
  try {
    const parsed = JSON.parse(String(item?.ai_result_json || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const isSummaryCover = (item, analysis) => {
  if (analysis.document_class === 'bill_summary_cover') return true;
  const text = `${item?.ai_raw_text || ''} ${item?.ai_summary || ''}`.toLowerCase();
  return /ใบรับวางบิล|bill acceptance|ใบปะหน้า|สรุปยอด/.test(text);
};

const isAggregateSummary = (item, analysis) => {
  if (analysis.document_class === 'bill_summary') return true;
  const text = `${item?.ai_raw_text || ''} ${item?.ai_summary || ''}`.toLowerCase();
  // Some suppliers send a cash-sale period summary after the detail slips. It has
  // no detail document number and explicitly says it was already booked.
  return !String(item?.doc_ref || analysis.doc_ref || '').trim()
    && /cash sale|บิลเงินสด/.test(text)
    && /ลงบัญชีแล้ว|สรุป|รวมเงิน/.test(text);
};

const moneyCents = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
};

const formatMoney = (cents) => (Number(cents || 0) / 100).toLocaleString('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const normalizeDocRef = (value) => String(value || '').replace(/[^a-zA-Z0-9ก-๙]/g, '').toUpperCase();

const normalizeDate = (value) => String(value || '').replace(/[^0-9ก-๙]/g, '');

const listAllGroupItems = async (sourceId) => {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await listItems({ sourceId, limit: pageSize, offset });
    rows.push(...(page?.rows || []));
    if (rows.length >= Number(page?.total || 0) || (page?.rows || []).length < pageSize) break;
  }
  return rows;
};

const matchSummaryLines = ({ summaryLines, details }) => {
  const unused = new Set(details.map((detail) => Number(detail.item.id)));
  const matchedExpected = new Set();
  const missing = [];
  const amountMismatches = [];
  const matched = [];

  const take = (detail, expected, expectedIndex, method) => {
    if (!detail) return false;
    unused.delete(Number(detail.item.id));
    const expectedAmount = moneyCents(expected.amount);
    const actualAmount = moneyCents(detail.item.bill_total_value);
    const amountMatches = expectedAmount === actualAmount;
    matched.push({
      expected_doc_ref: expected.doc_ref || null,
      actual_doc_ref: detail.item.doc_ref || detail.analysis.doc_ref || null,
      expected_amount: expectedAmount == null ? null : expectedAmount / 100,
      actual_amount: actualAmount == null ? null : actualAmount / 100,
      detail_item_id: Number(detail.item.id),
      method,
      amount_matches: amountMatches
    });
    matchedExpected.add(expectedIndex);
    if (!amountMatches) {
      amountMismatches.push({
        expected_doc_ref: expected.doc_ref || null,
        actual_doc_ref: detail.item.doc_ref || detail.analysis.doc_ref || null,
        expected_amount: expectedAmount == null ? null : expectedAmount / 100,
        actual_amount: actualAmount == null ? null : actualAmount / 100,
        detail_item_id: Number(detail.item.id)
      });
    }
    return true;
  };

  summaryLines.forEach((expected, expectedIndex) => {
    const expectedRef = normalizeDocRef(expected.doc_ref);
    if (!expectedRef) return;
    const sameRef = details.find((detail) => unused.has(Number(detail.item.id))
      && normalizeDocRef(detail.item.doc_ref || detail.analysis.doc_ref) === expectedRef);
    if (sameRef) take(sameRef, expected, expectedIndex, 'document_ref');
  });

  summaryLines.forEach((expected, expectedIndex) => {
    const expectedRef = normalizeDocRef(expected.doc_ref);
    if (matchedExpected.has(expectedIndex)) return;
    const expectedAmount = moneyCents(expected.amount);
    const expectedDate = normalizeDate(expected.invoice_date);
    const candidates = details.filter((detail) => {
      if (!unused.has(Number(detail.item.id))) return false;
      if (moneyCents(detail.item.bill_total_value) !== expectedAmount) return false;
      if (!expectedDate) return true;
      const actualDate = normalizeDate(detail.analysis.invoice_date);
      return !actualDate || actualDate === expectedDate;
    });
    if (candidates.length) {
      const sameDate = candidates.find((detail) => normalizeDate(detail.analysis.invoice_date) === expectedDate);
      take(sameDate || candidates[0], expected, expectedIndex, expectedDate && sameDate ? 'amount_and_date' : 'amount');
    } else {
      missing.push({
        doc_ref: expected.doc_ref || null,
        amount: expectedAmount == null ? null : expectedAmount / 100,
        count: 1
      });
    }
  });

  const extra = details
    .filter((detail) => unused.has(Number(detail.item.id)))
    .map((detail) => ({
      doc_ref: detail.item.doc_ref || detail.analysis.doc_ref || null,
      amount: moneyCents(detail.item.bill_total_value) == null ? null : moneyCents(detail.item.bill_total_value) / 100,
      count: 1,
      detail_item_id: Number(detail.item.id)
    }));
  return { missing, extra, amountMismatches, matched };
};

const validateSummaryGroup = async ({ settings, request, coverId = null }) => {
  const rows = (await listAllGroupItems(settings.sourceId))
    .filter((item) => !['unsent', 'duplicate'].includes(item.status) && !item.duplicate_of_item_id);
  const result = {
    source_type: settings.sourceType,
    source_id: settings.sourceId,
    supplier: settings.supplier,
    request_id: Number(request.id),
    status: 'waiting',
    reason: '',
    cover_item_id: null,
    expected_count: 0,
    actual_count: 0,
    expected_total: null,
    actual_total: null,
    missing: [],
    extra: [],
    detail_item_ids: [],
    summary_item_ids: []
  };

  if (!rows.length) {
    result.reason = 'ยังไม่มีรูปเอกสารในกลุ่ม';
    return result;
  }

  const analyzed = rows.map((item) => ({ item, analysis: parseAiResult(item) }));
  const covers = analyzed
    .filter(({ item, analysis }) => isSummaryCover(item, analysis))
    .sort((left, right) => Number(left.item.id) - Number(right.item.id));
  const cover = coverId == null
    ? covers.at(-1)
    : covers.find(({ item }) => Number(item.id) === Number(coverId));
  if (!cover) {
    result.reason = 'ยังไม่พบใบปะหน้าสรุปยอด';
    return result;
  }

  const nextCoverId = covers.find(({ item }) => Number(item.id) > Number(cover.item.id))?.item.id || null;
  const cycleRows = rows.filter((item) => Number(item.id) > Number(cover.item.id)
    && (!nextCoverId || Number(item.id) < Number(nextCoverId)));
  const notReady = cycleRows.filter((item) => item.status !== 'downloaded' || item.ai_status !== 'done');
  if (cover.item.status !== 'downloaded' || cover.item.ai_status !== 'done' || notReady.length) {
    result.reason = `รอ AI อ่านเอกสารอีก ${notReady.length + (cover.item.ai_status === 'done' ? 0 : 1)} รายการ`;
    return result;
  }

  result.cover_item_id = Number(cover.item.id);
  result.supplier = String(cover.item.supplier_name || cover.analysis.supplier_name || '').trim() || settings.supplier;
  const summaryLines = Array.isArray(cover.analysis.summary_lines)
    ? cover.analysis.summary_lines.filter((line) => moneyCents(line?.amount) != null)
    : [];
  if (!summaryLines.length) {
    result.reason = 'ใบปะหน้ายังไม่มีรายการยอดย่อยที่ AI อ่านได้';
    return result;
  }

  const details = analyzed.filter(({ item, analysis }) => {
    if (Number(item.id) === Number(cover.item.id)) return false;
    if (Number(item.id) <= Number(cover.item.id)) return false;
    if (nextCoverId && Number(item.id) >= Number(nextCoverId)) return false;
    if (item.category !== 'bill') return false;
    return !isSummaryCover(item, analysis) && !isAggregateSummary(item, analysis);
  });
  result.summary_item_ids = analyzed
    .filter(({ item, analysis }) => Number(item.id) > Number(cover.item.id)
      && (!nextCoverId || Number(item.id) < Number(nextCoverId))
      && isAggregateSummary(item, analysis))
    .map(({ item }) => Number(item.id));
  const unreadable = details.filter(({ item }) => moneyCents(item.bill_total_value) == null);
  if (unreadable.length) {
    result.reason = `มีบิลที่ยังอ่านยอดไม่ได้ ${unreadable.length} รายการ`;
    result.detail_item_ids = details.map(({ item }) => Number(item.id));
    return result;
  }

  const expectedValues = summaryLines.map((line) => line.amount);
  const actualValues = details.map(({ item }) => item.bill_total_value);
  const expectedTotal = expectedValues.reduce((sum, value) => sum + (moneyCents(value) || 0), 0);
  const actualTotal = actualValues.reduce((sum, value) => sum + (moneyCents(value) || 0), 0);
  const differences = matchSummaryLines({ summaryLines, details });
  const coverTotal = moneyCents(cover.item.bill_total_value);

  result.status = differences.missing.length || differences.extra.length || differences.amountMismatches.length
    || (coverTotal != null && coverTotal !== expectedTotal)
    ? 'mismatch'
    : 'passed';
  result.reason = result.status === 'passed' ? 'ยอดในใบปะหน้าและบิลย่อยตรงกันครบ' : 'จำนวนหรือยอดบิลย่อยไม่ตรงกับใบปะหน้า';
  result.expected_count = expectedValues.length;
  result.actual_count = actualValues.length;
  result.expected_total = expectedTotal / 100;
  result.actual_total = actualTotal / 100;
  result.cover_total = coverTotal == null ? null : coverTotal / 100;
  result.missing = differences.missing;
  result.extra = differences.extra;
  result.amount_mismatches = differences.amountMismatches;
  result.matched = differences.matched;
  result.detail_item_ids = details.map(({ item }) => Number(item.id));
  result.fingerprint = [
    result.cover_item_id,
    ...details.map(({ item }) => `${item.id}:${moneyCents(item.bill_total_value)}`).sort()
  ].join('|');
  return result;
};

const validateAllSummaryGroups = async ({ settings, request }) => {
  const rows = (await listAllGroupItems(settings.sourceId))
    .filter((item) => !['unsent', 'duplicate'].includes(item.status) && !item.duplicate_of_item_id);
  const covers = rows
    .map((item) => ({ item, analysis: parseAiResult(item) }))
    .filter(({ item, analysis }) => isSummaryCover(item, analysis))
    .sort((left, right) => Number(left.item.id) - Number(right.item.id));
  if (!covers.length) {
    return {
      source_type: settings.sourceType,
      source_id: settings.sourceId,
      supplier: settings.supplier,
      request_id: Number(request.id),
      status: 'waiting',
      reason: 'ยังไม่พบใบปะหน้าสรุปยอด',
      cover_count: 0,
      cover_results: []
    };
  }

  const coverResults = [];
  for (const cover of covers) {
    coverResults.push(await validateSummaryGroup({
      settings,
      request,
      coverId: cover.item.id
    }));
  }
  const suppliers = [...new Set(coverResults.map((result) => String(result.supplier || '').trim()).filter(Boolean))];
  const status = coverResults.some((result) => result.status === 'waiting')
    ? 'waiting'
    : coverResults.some((result) => result.status === 'mismatch')
      ? 'mismatch'
      : 'passed';
  return {
    source_type: settings.sourceType,
    source_id: settings.sourceId,
    supplier: suppliers.join(', ') || settings.supplier,
    suppliers,
    request_id: Number(request.id),
    status,
    reason: status === 'passed' ? 'ทุกใบปะหน้าและบิลย่อยตรงกันครบ' : 'ยังมีใบปะหน้าที่ต้องตรวจ',
    cover_count: coverResults.length,
    passed_cover_count: coverResults.filter((result) => result.status === 'passed').length,
    waiting_cover_count: coverResults.filter((result) => result.status === 'waiting').length,
    mismatch_cover_count: coverResults.filter((result) => result.status === 'mismatch').length,
    expected_count: coverResults.reduce((sum, result) => sum + Number(result.expected_count || 0), 0),
    actual_count: coverResults.reduce((sum, result) => sum + Number(result.actual_count || 0), 0),
    expected_total: coverResults.reduce((sum, result) => sum + Number(result.expected_total || 0), 0),
    actual_total: coverResults.reduce((sum, result) => sum + Number(result.actual_total || 0), 0),
    missing: coverResults.flatMap((result) => (result.missing || []).map((entry) => ({ ...entry, cover_item_id: result.cover_item_id }))),
    extra: coverResults.flatMap((result) => (result.extra || []).map((entry) => ({ ...entry, cover_item_id: result.cover_item_id }))),
    amount_mismatches: coverResults.flatMap((result) => (result.amount_mismatches || []).map((entry) => ({ ...entry, cover_item_id: result.cover_item_id }))),
    summary_item_ids: coverResults.flatMap((result) => result.summary_item_ids || []),
    cover_results: coverResults
  };
};

export const pushLineGroupMessage = async ({ sourceType, sourceId, text, imageUrl = '', previewImageUrl = '' }) => {
  if (SILENT_MODE) throw new Error('LINE push disabled by capture-only silent mode');
  if (!['group', 'room'].includes(sourceType) || !sourceId) throw new Error('Validation reply requires a LINE group or room');
  if (String(process.env.LINE_BILL_CAPTURE_PUSH_MOCK || '').trim() === '1') return { mock: true };
  if (!CHANNEL_ACCESS_TOKEN) throw new Error('LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN is not configured');
  const messages = [];
  if (imageUrl) {
    messages.push({ type: 'image', originalContentUrl: imageUrl, previewImageUrl: previewImageUrl || imageUrl });
  }
  messages.push({ type: 'text', text });
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: sourceId,
      messages
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE validation reply failed: ${response.status}${body ? ` ${body.slice(0, 300)}` : ''}`);
  }
  return { mock: false };
};

const buildPassedMessage = (result) => {
  const count = Number(result.expected_count || 0);
  const covers = Number(result.cover_count || 0);
  const total = formatMoney(moneyCents(result.expected_total));
  return `ตรวจบิล ${result.supplier} แล้ว\nยอดตรงครบ ${covers} ใบปะหน้า ${count} ใบ รวม ${total} บาท`;
};

export const runConfiguredGroupChecks = async () => {
  const requests = await claimPendingGroupValidationRequests();
  const results = [];
  for (const request of requests) {
    const settings = getConfiguredGroupSettings(request.source_type, request.source_id);
    if (!settings || settings.mode !== 'bill_summary' || !settings.replyEnabled) {
      await finishGroupValidationRequest({ id: request.id, status: 'mismatch', result: { status: 'disabled' } });
      continue;
    }

    try {
      const result = await validateAllSummaryGroups({ settings, request });
      if (result.status === 'passed') {
        await pushLineGroupMessage({
          sourceType: request.source_type,
          sourceId: request.source_id,
          text: buildPassedMessage(result)
        });
        await finishGroupValidationRequest({ id: request.id, status: 'replied', result });
      } else {
        await finishGroupValidationRequest({
          id: request.id,
          status: result.status === 'mismatch' ? 'mismatch' : 'pending',
          result
        });
      }
      results.push(result);
    } catch (error) {
      await finishGroupValidationRequest({
        id: request.id,
        status: 'pending',
        errorMessage: error?.message || 'group validation failed'
      });
      results.push({ request_id: Number(request.id), status: 'error', error: error?.message || String(error) });
    }
  }
  return results;
};
