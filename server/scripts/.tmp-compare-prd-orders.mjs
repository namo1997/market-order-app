import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306)
});

const [rows] = await conn.query(
  `SELECT
      p.code,
      p.name,
      COALESCE(SUM(oi.quantity), 0) AS total_qty,
      COUNT(*) AS line_count,
      COUNT(DISTINCT o.id) AS order_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE p.code IN ('PRD114', 'PRD093')
      AND o.order_date >= '2026-02-01'
      AND o.order_date < '2026-03-01'
      AND (o.status IS NULL OR o.status <> 'cancelled')
    GROUP BY p.code, p.name
    ORDER BY p.code`
);

const map = new Map(rows.map((row) => [row.code, row]));
for (const code of ['PRD114', 'PRD093']) {
  if (!map.has(code)) {
    map.set(code, {
      code,
      name: null,
      total_qty: 0,
      line_count: 0,
      order_count: 0
    });
  }
}

console.log(JSON.stringify([...map.values()], null, 2));
await conn.end();
