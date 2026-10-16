import { reviewedLine } from './receiving-ai.js';
import { decimalString, scaledInteger } from './receiving-utils.js';
import { lineErrors, normalizeLineEntry } from './receiving-validation.js';
import { quantityStatus } from './receiving-status.js';

export const newReviewState = () => ({ editing: null, pending: null, history: [], error: '', message: '' });
export const decisionLabels = { use: 'ใช้ค่าที่ AI เสนอ', ordered: 'รับเท่าที่สั่ง', zero: 'ยังไม่รับ (0)' };
export const lineTitle = (line, index) => line.product_name || line.bill_text || `รายการ ${index + 1}`;
export const pendingReviewIndices = lines => lines.flatMap((line, index) => line._aiProposal ? [index] : []);

export function orderComparison(line, expectedItems, lines) {
  const item = expectedItems?.find(item => line.order_item_id && Number(item.order_item_id) === Number(line.order_item_id));
  if (!item) return null;
  try {
    const remaining = scaledInteger(item.quantity_ordered) - scaledInteger(item.received_quantity || '0');
    const unique = lines.filter(row => Number(row.order_item_id) === Number(line.order_item_id)).length === 1;
    const compatible = Number(item.product_id) === Number(line.product_id) && line.unit_text === item.unit_name
      && (line.unit_multiplier == null || Number(line.unit_multiplier) === 1);
    return { ordered: item.quantity_ordered, previous: item.received_quantity || '0', remaining: decimalString(remaining > 0n ? remaining : 0n), safe: unique && compatible };
  } catch { return null; }
}

export function batchSelectable(line, index, lines, expectedItems, kind, warnings = []) {
  return !!orderComparison(line, expectedItems, lines)?.safe
    && !warnings.some(warning => Number(warning.line_no) === Number(line.line_no || index + 1))
    && !(line.match?.confidence != null && Number(line.match.confidence) < .8)
    && !Object.values(lineErrors(line, kind)).some(Boolean);
}

export function reviewCounters(lines, expectedItems, kind) {
  const states = lines.map(line => quantityStatus(line, expectedItems, lines, kind));
  return { total: lines.length,
    reviewed: lines.filter(line => !line._aiProposal).length,
    short: states.filter(state => state.direction === 'short').length,
    over: states.filter(state => state.direction === 'over').length };
}

// Local decisions only. A preview never changes quantities or acknowledges AI.
// Keep the previous complete line objects so undo also restores provenance.
export function transitionReview(state, event, { expectedItems, kind = 'bill', warnings = [] } = {}) {
  const { lines } = state;
  const fail = error => ({ ...state, error });
  const commit = (next, message) => ({ ...state, lines: next, editing: null, pending: null,
    history: [...state.history, lines], error: '', message });
  if (event.type === 'edit') {
    if (state.editing && state.editing.index !== event.index) return fail('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน');
    return { ...state, editing: { index: event.index, line: { ...lines[event.index] }, mode: event.mode || 'inline' }, error: '', message: '' };
  }
  if (event.type === 'input') {
    if (state.editing && state.editing.index !== event.index) return fail('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน');
    return { ...state, editing: { index: event.index, mode: 'inline', line: { ...(state.editing?.line || lines[event.index]), ...event.values } }, error: '', message: '' };
  }
  if (event.type === 'change') return state.editing ? { ...state, editing: { ...state.editing, line: { ...state.editing.line, ...event.values } }, error: '', message: '' } : state;
  if (event.type === 'cancel') return { ...state, editing: null, error: '' };
  if (event.type === 'save') {
    if (!state.editing) return state;
    const { index } = state.editing;
    const line = normalizeLineEntry(state.editing.line);
    const errors = lineErrors(line, kind);
    if (Object.entries(errors).some(([key, value]) => key !== 'product_id' && value)) return fail('ตรวจช่องที่ระบุ ก่อนบันทึกรายการ');
    return commit(lines.map((row, i) => i === index ? errors.product_id ? { ...line, match: { ...line.match, source: 'manual', confidence: 1 } } : reviewedLine(line) : row), errors.product_id ? 'ตรวจจำนวนแล้ว ยังต้องเลือกสินค้า' : 'ตรวจรายการนี้แล้ว');
  }
  if (event.type === 'clear-message') return { ...state, message: '' };
  if (event.type === 'dismiss') return { ...state, pending: null, error: '' };
  if (event.type === 'undo') {
    if (state.editing || state.pending) return fail('ปิดการแก้หรือสรุปผลก่อนย้อนกลับ');
    if (!state.history.length) return state;
    return { ...state, lines: state.history.at(-1), history: state.history.slice(0, -1), message: 'ย้อนกลับแล้ว', error: '' };
  }
  if (event.type === 'preview' || event.type === 'apply') {
    if (state.editing) return fail('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน');
    const indices = [...new Set(event.indices || [])];
    if (!indices.length || indices.some(index => !lines[index]) || !decisionLabels[event.action]) return fail('เลือกรายการก่อน');
    const rows = [];
    for (const index of indices) {
      const line = lines[index];
      const order = orderComparison(line, expectedItems, lines);
      const warning = warnings.some(warning => Number(warning.line_no) === Number(line.line_no || index + 1));
      let next;
      if (event.action === 'zero') next = { ...line, quantity_received: '0' };
      if (event.action === 'ordered') {
        if (!order?.safe) return fail(`${lineTitle(line, index)}: ตรวจสินค้า หน่วย หรือยอดสั่งแยกก่อน`);
        next = { ...line, quantity_received: order.remaining };
      }
      if (event.action === 'use') {
        if (!line._aiProposal || line.match?.source === 'manual') return fail(`${lineTitle(line, index)}: คงค่าที่คนแก้ไว้`);
        if (event.type === 'preview' && (warning || (line.match?.confidence != null && Number(line.match.confidence) < .8) || !order?.safe || quantityStatus(line, expectedItems, lines, kind).status === 'error')) return fail(`${lineTitle(line, index)}: เปิดตรวจแยกก่อนใช้ AI`);
        next = { ...line, ...line._aiProposal };
      }
      // Zero is an explicit human decision; incomplete product mapping remains a
      // separate validation issue and still blocks the final receiving action.
      const errors = lineErrors(next, kind);
      if (Object.entries(errors).some(([key, value]) => value && !(event.action === 'zero' && key === 'product_id'))) return fail(`${lineTitle(line, index)}: ตรวจข้อมูลแยกก่อน`);
      rows.push({ order, reasons: warnings.filter(warning => Number(warning.line_no) === Number(line.line_no || index + 1)), manual: line.match?.source === 'manual', discrepancy: quantityStatus(line, expectedItems, lines, kind).direction, index, title: lineTitle(line, index), before: line.quantity_received, after: next.quantity_received, unit: next.unit_text, next: reviewedLine(next) });
    }
    if (event.type === 'preview') return { ...state, pending: { action: event.action, rows }, error: '' };
    return commit(lines.map((line, index) => rows.find(row => row.index === index)?.next || line), `${decisionLabels[event.action]}แล้ว ${rows.length} รายการ`);
  }
  if (event.type === 'confirm' && state.pending) {
    const { rows, action } = state.pending;
    return commit(lines.map((line, index) => rows.find(row => row.index === index)?.next || line), `${decisionLabels[action]}แล้ว ${rows.length} รายการ`);
  }
  return state;
}
