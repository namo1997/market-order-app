import pool from '../config/database.js';

let ensureDirectOrderRulesTablePromise = null;
let ensureDirectOrderDispatchLogsTablePromise = null;

const VALID_MERGE_MODES = new Set(['group_daily', 'group_order']);

const toNullableTrimmedString = (value) => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};

const normalizeTime = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '12:00:00';

  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    const error = new Error('Invalid cutoff_time format (HH:mm or HH:mm:ss)');
    error.statusCode = 400;
    throw error;
  }

  const hh = match[1].padStart(2, '0');
  const mm = match[2];
  const ss = (match[3] || '00').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const normalizeMergeMode = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'group_daily';
  if (!VALID_MERGE_MODES.has(text)) {
    const error = new Error('Invalid merge_mode');
    error.statusCode = 400;
    throw error;
  }
  return text;
};

const normalizeEnabled = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return false;
};

const ensureDirectOrderRulesTable = async () => {
  if (ensureDirectOrderRulesTablePromise) {
    return ensureDirectOrderRulesTablePromise;
  }

  ensureDirectOrderRulesTablePromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS direct_order_rules (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL UNIQUE,
        enabled BOOLEAN NOT NULL DEFAULT false,
        cutoff_time TIME NOT NULL DEFAULT '12:00:00',
        line_group_id VARCHAR(128) NULL,
        merge_mode ENUM('group_daily', 'group_order') NOT NULL DEFAULT 'group_daily',
        created_by_user_id INT NULL,
        updated_by_user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_direct_order_rule_product
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        CONSTRAINT fk_direct_order_rule_created_by
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_direct_order_rule_updated_by
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_direct_order_rules_enabled (enabled),
        INDEX idx_direct_order_rules_line_group (line_group_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
  })()
    .catch((error) => {
      ensureDirectOrderRulesTablePromise = null;
      throw error;
    });

  return ensureDirectOrderRulesTablePromise;
};

const ensureDirectOrderDispatchLogsTable = async () => {
  if (ensureDirectOrderDispatchLogsTablePromise) {
    return ensureDirectOrderDispatchLogsTablePromise;
  }

  ensureDirectOrderDispatchLogsTablePromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS direct_order_dispatch_logs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        order_id INT NOT NULL,
        line_group_id VARCHAR(128) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
        event_type VARCHAR(50) NOT NULL DEFAULT 'direct_order_after_cutoff',
        message_text TEXT NULL,
        error_message TEXT NULL,
        sent_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_order_group_payload (order_id, line_group_id, payload_hash),
        INDEX idx_direct_order_dispatch_status (status),
        INDEX idx_direct_order_dispatch_created_at (created_at),
        INDEX idx_direct_order_dispatch_order_id (order_id),
        CONSTRAINT fk_direct_order_dispatch_order
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
  })()
    .catch((error) => {
      ensureDirectOrderDispatchLogsTablePromise = null;
      throw error;
    });

  return ensureDirectOrderDispatchLogsTablePromise;
};

export const ensureDirectOrderInfrastructure = async () => {
  await ensureDirectOrderRulesTable();
  await ensureDirectOrderDispatchLogsTable();
};

export const listDirectOrderRules = async (filters = {}) => {
  await ensureDirectOrderInfrastructure();

  const search = String(filters.search || '').trim();
  const enabledFilter = String(filters.enabled || '').trim().toLowerCase();
  const productGroupIdRaw = Number(filters.productGroupId);
  const productGroupId =
    Number.isFinite(productGroupIdRaw) && productGroupIdRaw > 0
      ? Math.trunc(productGroupIdRaw)
      : null;
  const limitRaw = Number(filters.limit);
  const offsetRaw = Number(filters.offset);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 500;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const where = ['p.is_active = true'];
  const params = [];

  if (search) {
    where.push(
      `(p.name LIKE ? OR p.code LIKE ? OR IFNULL(pglx.product_group_names, '') LIKE ?)`
    );
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword);
  }

  if (enabledFilter === 'true') {
    where.push('dor.enabled = true');
  } else if (enabledFilter === 'false') {
    where.push('COALESCE(dor.enabled, false) = false');
  }

  if (productGroupId) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM product_group_links pglf
        JOIN product_groups pgf
          ON pgf.id = pglf.product_group_id
         AND pgf.is_active = true
        WHERE pglf.product_id = p.id
          AND pglf.product_group_id = ?
      )`
    );
    params.push(productGroupId);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const baseFromSql = `
    FROM products p
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN direct_order_rules dor ON dor.product_id = p.id
    LEFT JOIN (
      SELECT
        pgl.product_id,
        GROUP_CONCAT(DISTINCT pg.name ORDER BY pg.name SEPARATOR ', ') AS product_group_names
      FROM product_group_links pgl
      JOIN product_groups pg
        ON pg.id = pgl.product_group_id
       AND pg.is_active = true
      GROUP BY pgl.product_id
    ) pglx ON pglx.product_id = p.id
  `;

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     ${baseFromSql}
     ${whereSql}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT
       p.id AS product_id,
       p.code AS product_code,
       p.name AS product_name,
       p.default_price,
       p.latest_price_override,
       u.id AS unit_id,
       u.name AS unit_name,
       u.abbreviation AS unit_abbr,
       IFNULL(pglx.product_group_names, '') AS product_group_names,
       COALESCE(dor.enabled, false) AS enabled,
       COALESCE(TIME_FORMAT(dor.cutoff_time, '%H:%i:%s'), '12:00:00') AS cutoff_time,
       IFNULL(dor.line_group_id, '') AS line_group_id,
       COALESCE(dor.merge_mode, 'group_daily') AS merge_mode,
       dor.updated_at
     ${baseFromSql}
     ${whereSql}
     ORDER BY p.name ASC, p.id ASC
     LIMIT ?
     OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items: rows.map((row) => ({
      product_id: Number(row.product_id),
      product_code: row.product_code || '',
      product_name: row.product_name || '',
      default_price: row.default_price,
      latest_price_override: row.latest_price_override,
      unit_id: row.unit_id ? Number(row.unit_id) : null,
      unit_name: row.unit_name || '',
      unit_abbr: row.unit_abbr || '',
      product_group_names: row.product_group_names || '',
      enabled: Boolean(row.enabled),
      cutoff_time: row.cutoff_time || '12:00:00',
      line_group_id: row.line_group_id || '',
      merge_mode: row.merge_mode || 'group_daily',
      updated_at: row.updated_at || null
    })),
    pagination: {
      total: Number(countRow?.total || 0),
      limit,
      offset
    }
  };
};

export const upsertDirectOrderRule = async ({ productId, payload = {}, userId = null }) => {
  await ensureDirectOrderInfrastructure();

  const normalizedProductId = Number(productId);
  if (!Number.isFinite(normalizedProductId) || normalizedProductId <= 0) {
    const error = new Error('Invalid product id');
    error.statusCode = 400;
    throw error;
  }

  const [[productRow]] = await pool.query(
    'SELECT id, is_active FROM products WHERE id = ? LIMIT 1',
    [normalizedProductId]
  );
  if (!productRow) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }

  const enabled = normalizeEnabled(payload.enabled);
  const cutoffTime = normalizeTime(payload.cutoff_time);
  const mergeMode = normalizeMergeMode(payload.merge_mode);
  const lineGroupId = toNullableTrimmedString(payload.line_group_id);

  if (enabled && !lineGroupId) {
    const error = new Error('line_group_id is required when enabled');
    error.statusCode = 400;
    throw error;
  }

  const normalizedUserId = Number.isFinite(Number(userId)) ? Number(userId) : null;

  await pool.query(
    `INSERT INTO direct_order_rules (
       product_id,
       enabled,
       cutoff_time,
       line_group_id,
       merge_mode,
       created_by_user_id,
       updated_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       cutoff_time = VALUES(cutoff_time),
       line_group_id = VALUES(line_group_id),
       merge_mode = VALUES(merge_mode),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      normalizedProductId,
      enabled,
      cutoffTime,
      lineGroupId,
      mergeMode,
      normalizedUserId,
      normalizedUserId
    ]
  );

  const [rows] = await pool.query(
    `SELECT
       p.id AS product_id,
       p.code AS product_code,
       p.name AS product_name,
       IFNULL(dor.enabled, false) AS enabled,
       COALESCE(TIME_FORMAT(dor.cutoff_time, '%H:%i:%s'), '12:00:00') AS cutoff_time,
       IFNULL(dor.line_group_id, '') AS line_group_id,
       COALESCE(dor.merge_mode, 'group_daily') AS merge_mode,
       dor.updated_at
     FROM products p
     LEFT JOIN direct_order_rules dor ON dor.product_id = p.id
     WHERE p.id = ?
     LIMIT 1`,
    [normalizedProductId]
  );

  return rows.length > 0
    ? {
        product_id: Number(rows[0].product_id),
        product_code: rows[0].product_code || '',
        product_name: rows[0].product_name || '',
        enabled: Boolean(rows[0].enabled),
        cutoff_time: rows[0].cutoff_time || '12:00:00',
        line_group_id: rows[0].line_group_id || '',
        merge_mode: rows[0].merge_mode || 'group_daily',
        updated_at: rows[0].updated_at || null
      }
    : null;
};

export const getEnabledDirectOrderRulesByProductIds = async (productIds = []) => {
  await ensureDirectOrderInfrastructure();

  const normalizedIds = Array.from(
    new Set(
      (productIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (normalizedIds.length === 0) return [];

  const [rows] = await pool.query(
    `SELECT
       dor.product_id,
       COALESCE(TIME_FORMAT(dor.cutoff_time, '%H:%i:%s'), '12:00:00') AS cutoff_time,
       IFNULL(dor.line_group_id, '') AS line_group_id,
       COALESCE(dor.merge_mode, 'group_daily') AS merge_mode
     FROM direct_order_rules dor
     WHERE dor.enabled = true
       AND dor.product_id IN (${normalizedIds.map(() => '?').join(',')})
       AND dor.line_group_id IS NOT NULL
       AND dor.line_group_id <> ''`,
    normalizedIds
  );

  return rows.map((row) => ({
    product_id: Number(row.product_id),
    cutoff_time: row.cutoff_time || '12:00:00',
    line_group_id: row.line_group_id || '',
    merge_mode: row.merge_mode || 'group_daily'
  }));
};

export const getDirectOrderDispatchLogByPayload = async ({
  orderId,
  lineGroupId,
  payloadHash
}) => {
  await ensureDirectOrderInfrastructure();
  const normalizedOrderId = Number(orderId);
  const group = String(lineGroupId || '').trim();
  const hash = String(payloadHash || '').trim();
  if (!Number.isFinite(normalizedOrderId) || normalizedOrderId <= 0 || !group || !hash) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT id, order_id, line_group_id, payload_hash, status, event_type, sent_at, error_message
     FROM direct_order_dispatch_logs
     WHERE order_id = ?
       AND line_group_id = ?
       AND payload_hash = ?
     LIMIT 1`,
    [normalizedOrderId, group, hash]
  );
  return rows[0] || null;
};

export const upsertDirectOrderDispatchLog = async ({
  orderId,
  lineGroupId,
  payloadHash,
  status = 'pending',
  eventType = 'direct_order_after_cutoff',
  messageText = null,
  errorMessage = null
}) => {
  await ensureDirectOrderInfrastructure();
  const normalizedOrderId = Number(orderId);
  const group = String(lineGroupId || '').trim();
  const hash = String(payloadHash || '').trim();
  const normalizedStatus = ['pending', 'sent', 'failed', 'skipped'].includes(String(status))
    ? String(status)
    : 'pending';

  if (!Number.isFinite(normalizedOrderId) || normalizedOrderId <= 0 || !group || !hash) {
    const error = new Error('Invalid direct order dispatch log payload');
    error.statusCode = 400;
    throw error;
  }

  await pool.query(
    `INSERT INTO direct_order_dispatch_logs (
       order_id, line_group_id, payload_hash, status, event_type, message_text, error_message, sent_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       event_type = VALUES(event_type),
       message_text = VALUES(message_text),
       error_message = VALUES(error_message),
       sent_at = VALUES(sent_at)`,
    [
      normalizedOrderId,
      group,
      hash,
      normalizedStatus,
      eventType,
      messageText,
      errorMessage,
      normalizedStatus === 'sent' ? new Date() : null
    ]
  );
};
