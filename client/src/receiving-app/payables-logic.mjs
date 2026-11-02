// Owner 2026-11-02 ระบบรวบรวมเจ้าหนี้: pure helpers for the accounting page (kept out of JSX so they can be tested).
export const canCollectPayables = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);

export const message = error => error?.response?.data?.message || error?.message || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง';
export const baht = value => value === null || value === undefined || value === '' ? '—'
  : Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = value => value === null || value === undefined ? '' : String(Number(value));
export const lineText = line => [line.quantity !== null && line.quantity !== undefined ? `${qty(line.quantity)}${line.unit ? ` ${line.unit}` : ''}` : '',
  line.unit_price !== null && line.unit_price !== undefined ? `× ${baht(line.unit_price)}` : ''].filter(Boolean).join(' ');
export const currentPeriod = (now = new Date()) => new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);
// What the review form sends: the person's edits; '' clears a field. Saving marks the bill as counted toward the month.
export const formBody = (form, status) => ({ doc_ref: form.doc_ref.trim(), doc_date: form.doc_date || '', total: form.total.trim() === '' ? '' : Number(form.total.replace(/,/g, '')), status });
