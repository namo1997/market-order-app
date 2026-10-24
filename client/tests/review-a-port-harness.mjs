import { harness, armPad } from './receiving-harness.mjs';
export { harness, armPad };
export const user = { id: 1, role: 'admin', name: 'ผู้รับ', branch_id: 1, department_id: 1 };
export const row = (id = 1, patch = {}) => ({ id, line_no: id, product_id: id, product_name: `ผัก ${id}`, bill_text: `ดิบ ${id}`, order_item_id: 40 + id,
  unit_text: 'กก.', ordered_unit: 'kg', unit_id: 2, counted_quantity: '2', quantity_received: '2', quantity_billed: '2', quantity_ordered: '2',
  unit_price: '10', ordered_price: '10', amount: '20', remember_alias: false, match: { source: 'order', confidence: 1 }, ...patch });
export const doc = (patch = {}) => ({ id: 5, client_uuid: 'fixed-count', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, product_group_id: 1,
  supplier_name_text: 'ร้าน 1', delivery_date: '2026-10-18', counted_complete_at: '2026-10-18T00:00:00Z', images: [], warnings: [], ocr: { status: 'done' }, lines: [row()], ...patch });
export const signed = patch => doc({ lines: [row(1, { review_decision: 'accept' })], has_receiver_signature: true, ...patch });
export const text = h => h.text(h.visible()[0]);
export const btn = (h, label) => h.find(n => n.type === 'button' && (h.text(n) === label || n.props['aria-label'] === label));
export const field = (h, label) => { const l = h.find(n => n.type === 'label' && h.text(n).startsWith(label)); return l.props.htmlFor ? h.find(n => n.props.id === l.props.htmlFor) : h.all(l).find(n => n.type === 'input'); };
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const active = new Set();
export const track = h => { active.add(h); return h; };
export const cleanup = () => { for (const h of active) h.unmount(); active.clear(); };
export const open = async (initial = doc(), api = {}, props = {}, runtime = {}, browser = {}, capture = null) => track(await harness('DocumentEditor', { initialDocument: initial, user, onBack() {}, onChanged() {}, ...props }, { image: async () => new Blob(['mock-bill']), ...api }, {}, browser, runtime, capture));
// Owner 2026-10-24 (ข้อ 2): "ไปเซ็นรับของ" opens the receiver sheet by itself. Port tests read the sign page as before,
// so the helper closes that sheet; draw() opens it again through its tap target.
export const sign = async h => {
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ');
  if (h.visible().some(n => n.type === 'canvas') && h.visible().some(n => n.type === 'button' && h.text(n) === 'ยกเลิก')) await h.click('ยกเลิก');
};
export const draw = async (h, i = 0) => { await armPad(h, i); const n = h.visible().filter(n => n.type === 'canvas')[0]; n.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} }); n.props.onPointerUp(); await h.settle(); };
export const start = async (h, label) => { const promise = btn(h, label).props.onClick(); await h.settle(); return { promise }; };
export const fakeFile = () => ({ size: 20, type: 'image/jpeg', name: 'bill.jpeg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) });
export const chooseFile = async h => { h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [fakeFile()], value: '' } }); await h.settle(); };
export const clock = () => { let sequence = 0; const timeouts = new Map(); return { runtime: { setTimeout(fn, ms) { timeouts.set(++sequence, { fn, ms }); return sequence; }, clearTimeout(id) { timeouts.delete(id); } }, async tick(ms) { const entry = [...timeouts].find(([, v]) => v.ms === ms); if (!entry) throw new Error(`No timer ${ms}`); timeouts.delete(entry[0]); await entry[1].fn(); }, timeouts }; };
export function historyBrowser() {
  const entries = [{ router: 'keep' }]; let index = 0; const listeners = new Set(); let backs = 0;
  return { history: { get state() { return entries[index]; }, pushState(state) { entries.splice(++index); entries[index] = state; }, back() { backs++; if (index) index--; for (const fn of listeners) fn({ type: 'popstate' }); } },
    addEventListener(type, fn) { if (type === 'popstate') listeners.add(fn); }, removeEventListener(type, fn) { if (type === 'popstate') listeners.delete(fn); }, get backs() { return backs; }, get size() { return listeners.size; } };
}
export const group = (id, done = false) => ({ supplier_key: `pg:${id}`, supplier_name: `ร้าน ${id}`, items: [{ order_item_id: 40 + id, product_id: id, product_name: `ผัก ${id}`, has_pending: !done, unit_name: 'กก.' }] });
export async function queueFlow(before, { listFails = false } = {}) {
  const queue = deferred(); let confirmed = false, confirmations = 0, failList = listFails;
  const initial = signed();
  const h = track(await harness('Receiving', {}, {
    expected: async () => confirmed ? queue.promise : before,
    list: async () => { if (confirmed && failList) { await queue.promise; throw { response: { status: 500 } }; } return [signed({ status: confirmed ? 'confirmed' : 'draft' })]; },
    get: async () => initial,
    confirm: async () => { confirmed = true; confirmations++; return signed({ status: 'confirmed' }); },
  }));
  await h.radio('documents'); await h.click('เปิดเอกสาร #5 ร้าน 1 ยังไม่เสร็จ'); await sign(h); await h.click('ยืนยันรับสินค้า');
  return { h, queue, confirmations: () => confirmations, fixList: () => { failList = false; } };
}
export const summary = async patch => track(await harness('ReviewSummary', { doc: signed(patch) }));
