import 'dotenv/config';
import { queryClickHouse } from './src/services/clickhouse.service.js';

const docno = 'HL12605070052';
const guid = '3DOLI1vFYFeoX6VrijKdUHLeNIy';
const shop = process.env.CLICKHOUSE_SHOP_ID;
const esc = (s) => String(s).replace(/'/g, "''");

const tables = await queryClickHouse(`SELECT name FROM system.tables WHERE database=currentDatabase() ORDER BY name`);
const hits = [];

for (const { name: table } of tables) {
  if (String(table).startsWith('staging_')) continue;
  const cols = await queryClickHouse(`DESCRIBE TABLE \`${table}\``);
  const searchable = cols.filter((c) => {
    const n = String(c.name).toLowerCase();
    const t = String(c.type).toLowerCase();
    return t.includes('string') && (
      n.includes('doc') || n.includes('guid') || n.includes('ref') || n.includes('cancel') || n.includes('reason') || n.includes('checksum')
    );
  });
  if (!searchable.length) continue;
  const conds = [];
  for (const c of searchable) {
    const col = `\`${c.name}\``;
    conds.push(`${col}='${esc(docno)}'`, `${col}='${esc(guid)}'`, `positionCaseInsensitive(${col}, '${esc(docno)}') > 0`, `positionCaseInsensitive(${col}, '${esc(guid)}') > 0`);
  }
  const shopFilter = cols.some((c) => c.name === 'shopid') ? `shopid='${esc(shop)}' AND ` : '';
  const sql = `SELECT * FROM \`${table}\` WHERE ${shopFilter}(${conds.join(' OR ')}) LIMIT 20 FORMAT JSON`;
  try {
    const rows = await queryClickHouse(sql);
    if (rows.length) hits.push({ table, rows });
  } catch (e) {
    hits.push({ table, error: e.message.slice(0, 300) });
  }
}

console.log(JSON.stringify(hits, null, 2));
