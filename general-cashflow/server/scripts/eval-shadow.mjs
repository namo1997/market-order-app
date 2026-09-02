import { getPool } from '../src/db.js';

const days = Math.max(1, Math.min(365, Number(process.argv.find((value) => value.startsWith('--days='))?.split('=')[1] || 30)));
const [rows] = await getPool().query(
  `SELECT d.action_key,
          COUNT(*) total,
          SUM(s.status = 'completed') predicted,
          SUM(s.comparison_status = 'agree') agreed,
          SUM(s.comparison_status = 'disagree') disagreed,
          SUM(s.comparison_status = 'insufficient') insufficient,
          SUM(s.status = 'failed') failed,
          SUM(s.status = 'skipped') skipped
   FROM decision_events d
   LEFT JOIN shadow_predictions s ON s.decision_id = d.id
   WHERE d.created_at >= NOW() - INTERVAL ? DAY
   GROUP BY d.action_key ORDER BY total DESC, d.action_key ASC`,
  [days]
);

const output = rows.map((row) => ({
  ...row,
  agreement_rate: Number(row.predicted || 0) > 0
    ? Number((Number(row.agreed || 0) / Number(row.predicted || 0)).toFixed(4))
    : null
}));
console.log(JSON.stringify({ service: 'general-cashflow', days, actions: output }, null, 2));
await getPool().end();
