import pool from '../config/database.js';
import { ensureOrderItemSourceGroupColumn, ensureOrderReceivingColumns } from './order.model.js';
import { ensurePurchaseWalkManualTable } from './purchase-walk-manual.model.js';

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDateString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
};

const toDateTimeString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.replace('T', ' ').slice(0, 19);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    const seconds = String(value.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return String(value).replace('T', ' ').slice(0, 19);
};

const resolveCostCenter = ({ branchId, branchName = '', productGroupName = '' }) => {
  const id = Number(branchId);
  const branch = String(branchName || '');
  const group = String(productGroupName || '');

  if (id === 1 || branch.includes('สาขาคันคลอง')) return 'BRANCH_KANKLONG';
  if (id === 3 || branch.includes('สาขาสันกำแพง')) return 'BRANCH_SANKAMPHAENG';
  if (id === 2 || branch.includes('ผลิตคันคลอง')) return 'KITCHEN_KANKLONG';
  if (id === 4 || branch.includes('ผลิตสันกำแพง')) return 'KITCHEN_SANKAMPHAENG';
  if (group.includes('คันคลอง')) return 'CENTRAL_KANKLONG';
  if (group.includes('สันกำแพง')) return 'CENTRAL_SANKAMPHAENG';
  return 'CENTRAL_UNASSIGNED';
};

const mapPurchaseWalkLine = (row) => {
  const quantity = toNumber(row.actual_quantity);
  const unitPrice = toNumber(row.actual_price);
  const amount = Number((quantity * unitPrice).toFixed(2));
  const costCenter = resolveCostCenter({
    branchId: row.branch_id,
    branchName: row.branch_name,
    productGroupName: row.product_group_name
  });

  return {
    external_id: String(row.external_id),
    external_ref: row.external_ref,
    source: row.source,
    purchase_date: toDateString(row.purchase_date),
    order_number: row.order_number || '',
    order_item_id: row.order_item_id ? Number(row.order_item_id) : null,
    manual_item_id: row.manual_item_id ? Number(row.manual_item_id) : null,
    product_id: row.product_id ? Number(row.product_id) : null,
    product_code: row.product_code || '',
    product_name: row.product_name || '',
    product_group_id: row.product_group_id ? Number(row.product_group_id) : null,
    product_group_name: row.product_group_name || '',
    branch_id: row.branch_id ? Number(row.branch_id) : null,
    branch_name: row.branch_name || '',
    department_id: row.department_id ? Number(row.department_id) : null,
    department_name: row.department_name || '',
    cost_center: costCenter,
    supplier_id: row.supplier_id ? Number(row.supplier_id) : null,
    supplier_name: row.supplier_name || '',
    quantity,
    unit: row.unit || '',
    unit_price: unitPrice,
    amount,
    received_quantity: toNumber(row.received_quantity),
    purchase_reason: row.purchase_reason || '',
    note: row.note || '',
    purchased_at: toDateTimeString(row.purchased_at),
    updated_at: toDateTimeString(row.updated_at)
  };
};

const buildOptionalFilters = ({ productGroupId, branchId, departmentId }, alias = 'base') => {
  const params = [];
  const clauses = [];

  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    clauses.push(`${alias}.product_group_id = ?`);
    params.push(Number(productGroupId));
  }
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    clauses.push(`${alias}.branch_id = ?`);
    params.push(Number(branchId));
  }
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    clauses.push(`${alias}.department_id = ?`);
    params.push(Number(departmentId));
  }

  return {
    sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  };
};

const groupLinesAsDocuments = (lines) => {
  const map = new Map();

  for (const line of lines) {
    const documentDate = line.purchase_date;
    const groupId = line.product_group_id || 0;
    const key = `${documentDate}|${groupId}`;
    if (!map.has(key)) {
      map.set(key, {
        external_id: `purchase-walk:${documentDate}:group:${groupId}`,
        external_ref: `market-order:purchase-walk:${documentDate}:group:${groupId}`,
        source: 'purchase_walk',
        document_type: 'fresh_market_purchase',
        document_date: documentDate,
        vendor_name: line.product_group_name || 'ตลาดสด',
        product_group_id: line.product_group_id,
        product_group_name: line.product_group_name,
        total_amount: 0,
        line_count: 0,
        cost_centers: [],
        items: []
      });
    }

    const doc = map.get(key);
    doc.items.push(line);
    doc.total_amount = Number((doc.total_amount + line.amount).toFixed(2));
    doc.line_count += 1;
  }

  for (const doc of map.values()) {
    const centers = new Map();
    for (const line of doc.items) {
      const current = centers.get(line.cost_center) || { cost_center: line.cost_center, amount: 0, line_count: 0 };
      current.amount = Number((current.amount + line.amount).toFixed(2));
      current.line_count += 1;
      centers.set(line.cost_center, current);
    }
    doc.cost_centers = [...centers.values()].sort((a, b) => a.cost_center.localeCompare(b.cost_center));
  }

  return [...map.values()].sort((a, b) => a.external_ref.localeCompare(b.external_ref));
};

export const getPurchaseWalkForAccountingExport = async ({
  from,
  to,
  productGroupId = null,
  branchId = null,
  departmentId = null,
  includeManual = true,
  groupAsDocuments = true,
  limit = 500
}) => {
  await ensureOrderReceivingColumns();
  await ensureOrderItemSourceGroupColumn();
  await ensurePurchaseWalkManualTable();

  const maxLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const filters = buildOptionalFilters({ productGroupId, branchId, departmentId });

  const [regularRows] = await pool.query(
    `SELECT *
     FROM (
       SELECT
         CONCAT('order-item:', oi.id) AS external_id,
         CONCAT('market-order:purchase-walk:order-item:', oi.id) AS external_ref,
         'order_item' AS source,
         o.order_date AS purchase_date,
         o.order_number,
         oi.id AS order_item_id,
         NULL AS manual_item_id,
         p.id AS product_id,
         p.code AS product_code,
         p.name AS product_name,
         pg.id AS product_group_id,
         pg.name AS product_group_name,
         b.id AS branch_id,
         b.name AS branch_name,
         d.id AS department_id,
         d.name AS department_name,
         sm.id AS supplier_id,
         sm.name AS supplier_name,
         COALESCE(oi.actual_quantity, oi.quantity, 0) AS actual_quantity,
         COALESCE(u.abbreviation, u.name, '') AS unit,
         COALESCE(oi.actual_price, 0) AS actual_price,
         COALESCE(oi.received_quantity, 0) AS received_quantity,
         oi.purchase_reason,
         oi.notes AS note,
         o.updated_at AS purchased_at,
         o.updated_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users usr ON usr.id = o.user_id
       JOIN departments d ON d.id = usr.department_id
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN product_groups pg ON pg.id = COALESCE(oi.source_product_group_id, p.product_group_id)
       LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
       WHERE o.order_date BETWEEN ? AND ?
         AND COALESCE(oi.is_purchased, false) = true
         AND COALESCE(oi.actual_quantity, oi.quantity, 0) > 0
         AND oi.actual_price IS NOT NULL
         AND oi.actual_price > 0
     ) base
     WHERE 1=1
       ${filters.sql}
     ORDER BY base.purchase_date ASC, base.product_group_name ASC, base.branch_name ASC, base.department_name ASC, base.product_name ASC
     LIMIT ?`,
    [from, to, ...filters.params, maxLimit]
  );

  let manualRows = [];
  if (includeManual) {
    const manualFilters = buildOptionalFilters({ productGroupId, branchId, departmentId });
    const [rows] = await pool.query(
      `SELECT *
       FROM (
         SELECT
           CONCAT('manual-item:', mi.id) AS external_id,
           CONCAT('market-order:purchase-walk:manual-item:', mi.id) AS external_ref,
           'manual_item' AS source,
           mi.order_date AS purchase_date,
           '' AS order_number,
           mi.receiving_order_item_id AS order_item_id,
           mi.id AS manual_item_id,
           p.id AS product_id,
           p.code AS product_code,
           mi.product_name,
           pg.id AS product_group_id,
           pg.name AS product_group_name,
           b.id AS branch_id,
           b.name AS branch_name,
           d.id AS department_id,
           d.name AS department_name,
           sm.id AS supplier_id,
           sm.name AS supplier_name,
           mi.actual_quantity,
           COALESCE(mi.unit_abbr, mi.unit_name, '') AS unit,
           COALESCE(mi.actual_price, 0) AS actual_price,
           COALESCE(oi.received_quantity, mi.actual_quantity, 0) AS received_quantity,
           mi.purchase_reason,
           mi.purchase_reason AS note,
           mi.updated_at AS purchased_at,
           mi.updated_at
         FROM purchase_walk_manual_items mi
         LEFT JOIN products p ON p.id = mi.base_product_id
         LEFT JOIN order_items oi ON oi.id = mi.receiving_order_item_id
         LEFT JOIN product_groups pg ON pg.id = mi.product_group_id
         LEFT JOIN branches b ON b.id = mi.branch_id
         LEFT JOIN departments d ON d.id = mi.department_id
         LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
         WHERE mi.order_date BETWEEN ? AND ?
           AND mi.is_active = true
           AND COALESCE(mi.is_purchased, false) = true
           AND COALESCE(mi.actual_quantity, 0) > 0
           AND mi.actual_price IS NOT NULL
           AND mi.actual_price > 0
       ) base
       WHERE 1=1
         ${manualFilters.sql}
       ORDER BY base.purchase_date ASC, base.product_group_name ASC, base.branch_name ASC, base.department_name ASC, base.product_name ASC
       LIMIT ?`,
      [from, to, ...manualFilters.params, maxLimit]
    );
    manualRows = rows;
  }

  const lines = [...regularRows, ...manualRows]
    .map(mapPurchaseWalkLine)
    .sort((a, b) => {
      const keyA = `${a.purchase_date}|${a.product_group_name}|${a.branch_name}|${a.department_name}|${a.product_name}|${a.external_ref}`;
      const keyB = `${b.purchase_date}|${b.product_group_name}|${b.branch_name}|${b.department_name}|${b.product_name}|${b.external_ref}`;
      return keyA.localeCompare(keyB, 'th');
    })
    .slice(0, maxLimit);

  const totalAmount = Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
  const documents = groupAsDocuments ? groupLinesAsDocuments(lines) : [];

  return {
    documents,
    lines,
    summary: {
      document_count: documents.length,
      line_count: lines.length,
      total_amount: totalAmount
    }
  };
};

export const getFreshMarketGroupId = async () => {
  const [rows] = await pool.query(
    `SELECT id
     FROM product_groups
     WHERE name = 'ตลาดสด'
       AND is_active = true
     ORDER BY id
     LIMIT 1`
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
};
