const getClickHouseConfig = () => {
  const host = process.env.CLICKHOUSE_HOST;
  const user = process.env.CLICKHOUSE_USER;
  const password = process.env.CLICKHOUSE_PASSWORD;
  const database = process.env.CLICKHOUSE_DATABASE || 'dedebi';
  const port = process.env.CLICKHOUSE_PORT || '8123';
  const secure = String(process.env.CLICKHOUSE_SECURE || 'false') === 'true';

  if (!host || !user || !password) {
    throw new Error('Missing ClickHouse connection configuration');
  }

  return { host, user, password, database, port, secure };
};

export const queryClickHouse = async (sql) => {
  const { host, user, password, database, port, secure } = getClickHouseConfig();
  const protocol = secure ? 'https' : 'http';
  const url = `${protocol}://${host}:${port}/?database=${encodeURIComponent(
    database
  )}`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const trimmedSql = String(sql || '').trim();
  const hasFormat = /\bformat\s+\w+/i.test(trimmedSql);
  const finalSql = hasFormat ? trimmedSql : `${trimmedSql}\nFORMAT JSON`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain'
    },
    body: finalSql
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse query failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return payload?.data || [];
};
