import { initDatabase, listDecisionEvents } from '../src/db.js';

await initDatabase();
const rows = await listDecisionEvents({ limit: 500 });
const groups = new Map();
for (const row of rows) {
  const key = String(row.action_key || 'unknown');
  const current = groups.get(key) || { action_key: key, total: 0, predicted: 0, agreed: 0, disagreed: 0, insufficient: 0, failed: 0, skipped: 0 };
  current.total += 1;
  if (row.shadow_status === 'completed') current.predicted += 1;
  if (row.comparison_status === 'agree') current.agreed += 1;
  if (row.comparison_status === 'disagree') current.disagreed += 1;
  if (row.comparison_status === 'insufficient') current.insufficient += 1;
  if (row.shadow_status === 'failed') current.failed += 1;
  if (row.shadow_status === 'skipped') current.skipped += 1;
  groups.set(key, current);
}
const actions = [...groups.values()].map((row) => ({
  ...row,
  agreement_rate: row.predicted ? Number((row.agreed / row.predicted).toFixed(4)) : null
})).sort((a, b) => b.total - a.total || a.action_key.localeCompare(b.action_key));
console.log(JSON.stringify({ service: 'line-bill-capture', sample: rows.length, actions }, null, 2));
