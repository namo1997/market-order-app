import 'dotenv/config';
import { initDatabase, listItems, requeueAiItems } from '../src/db.js';

const apply = process.argv.includes('--apply');
const startArg = process.argv.find((value) => value.startsWith('--start='));
const endArg = process.argv.find((value) => value.startsWith('--end='));
const start = startArg?.slice('--start='.length) || '';
const end = endArg?.slice('--end='.length) || '';

await initDatabase();
const rows = [];
for (let offset = 0; offset < 100000; offset += 1000) {
  const page = await listItems({ start, end, live: true, limit: 1000, offset });
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}

const reasons = new Map();
const add = (row, reason) => {
  if (!row?.id || row.category_edited_at || row.status !== 'downloaded') return;
  reasons.set(Number(row.id), [...(reasons.get(Number(row.id)) || []), reason]);
};

for (const row of rows) {
  const evidence = `${row.ai_raw_text || ''} ${row.ai_summary || ''}`;
  if (Number(row.amount_review_flag || 0) === 1 && !row.bill_total_edited_at) add(row, 'rebind_chat_announcement');
  if (row.category === 'other' && /รายละเอียดคำสั่งซื้อ|Shopee|ช้อปปี้|Lazada|ลาซาด้า/i.test(evidence)) add(row, 'marketplace_order');
  if (['other', 'payment_voucher'].includes(row.category) && /ใบสำคัญจ่าย|PAYMENT\s+VOUCHER/i.test(evidence)) add(row, 'payment_voucher_as_bill');
  if (row.ai_status === 'failed' && row.ai_error_kind !== 'storage_missing') add(row, 'retry_ai_failure');
}

const ids = [...reasons.keys()].sort((a, b) => a - b);
const result = apply && ids.length ? await requeueAiItems({ ids }) : { requeued: 0 };
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  scope: { start: start || null, end: end || null },
  scanned: rows.length,
  selected: ids.length,
  requeued: Number(result.requeued || 0),
  items: ids.map((id) => ({ id, reasons: reasons.get(id) }))
}, null, 2));
