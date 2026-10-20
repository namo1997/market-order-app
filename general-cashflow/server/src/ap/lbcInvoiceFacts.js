import { date } from './domain.js';
// Optional explicit invoice facts only. A round/payment business_date is never a bill date.
// Older LBC exports omit these fields and must remain pending review.
export function lbcInvoiceFacts(row = {}) {
  const docRef = row.doc_ref ?? row.docRef;
  const docDate = row.doc_date ?? row.invoice_date ?? row.docDate;
  const apCode = row.ap_code ?? row.apCode;
  const result = {};
  if (typeof docRef === 'string' && docRef.trim() && docRef.length <= 200) result.docRef = docRef.trim();
  try { if (typeof docDate === 'string') result.docDate = date(docDate); } catch { /* Unknown invoice date stays absent. */ }
  if (typeof apCode === 'string' && apCode.trim() && apCode.length <= 80) result.apCode = apCode.trim();
  return result;
}
