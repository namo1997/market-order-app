import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'market_order_db',
  port: 3306
});

const [scopes] = await conn.query(`
  SELECT pgis.id, pgis.product_group_id, pg.name AS product_group_name,
         pgis.branch_id, b.name AS branch_name,
         pgis.department_id, d.name AS department_name
  FROM product_group_internal_scopes pgis
  JOIN product_groups pg ON pg.id = pgis.product_group_id
  JOIN branches b ON b.id = pgis.branch_id
  JOIN departments d ON d.id = pgis.department_id
  WHERE pgis.branch_id = 2 AND pgis.department_id = 5
  ORDER BY pgis.product_group_id
`);

const [counts] = await conn.query(`
  SELECT pg.id, pg.name, COUNT(DISTINCT p.id) AS product_count
  FROM product_groups pg
  JOIN product_group_links pgl ON pgl.product_group_id = pg.id
  JOIN products p ON p.id = pgl.product_id AND p.is_active = 1
  WHERE pg.id IN (9,10)
  GROUP BY pg.id, pg.name
  ORDER BY pg.id
`);

const [sample] = await conn.query(`
  SELECT p.id, p.code, p.name,
         GROUP_CONCAT(DISTINCT pg.name ORDER BY pg.name SEPARATOR ', ') AS groups
  FROM products p
  JOIN product_group_links pgl ON pgl.product_id = p.id
  JOIN product_groups pg ON pg.id = pgl.product_group_id
  WHERE p.is_active = 1
    AND pgl.product_group_id IN (9,10)
  GROUP BY p.id, p.code, p.name
  ORDER BY p.name
  LIMIT 20
`);

console.log('scopes_branch2_dept5', scopes);
console.log('count_group_9_10', counts);
console.log('sample_products', sample);

await conn.end();
