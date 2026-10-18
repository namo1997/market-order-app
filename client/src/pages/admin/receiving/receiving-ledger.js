export const canViewReceivingAdmin = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
export const statusLabels = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };
// Format decimal strings without converting money to a floating point number.
export function ledgerNumber(value, suffix = '') {
  if (value == null || value === '') return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return '—';
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(match[3] || '').padEnd(2, '0')}${suffix}`;
}
export function ledgerDate(value, withTime = false) {
  if (!value) return '—';
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+07:00`
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}+07:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
export const relatedFollowups = (doc, items = []) => items.filter(item =>
  Number(item.branch_id) === Number(doc.branch_id) &&
  (doc.scope === 'branch' || Number(item.department_id) === Number(doc.department_id)) &&
  (item.pending_items || []).some(pending => Number(pending.document_id) === Number(doc.id) || doc.lines.some(line => Number(line.order_item_id) > 0 &&
    Number(line.order_item_id) === Number(pending.order_item_id))));
