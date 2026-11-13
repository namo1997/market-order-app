// จัดของตามใบสั่ง (ครัวกลาง → สาขา): สแกนสติกเกอร์แปรรูปเทียบกับใบส่งสินค้าของสาขาในวันนั้น
// รุ่นแรก: ตรวจหยิบถูก/ครบ + เก็บว่าสติกเกอร์ (ล็อต) ดวงไหนไปสาขาไหน — ยังไม่เปลี่ยนการตัดสต็อก
// (สต็อกครัวกลางยังถูกตัดตอนสาขารับของเหมือนเดิม)
import { findTransformSticker } from './transform-sticker.model.js';

// กลุ่มสินค้าครัวกลางที่หน้าคำสั่งซื้อใช้ (ตรงกับ PRODUCTION_SUPPLIER_ID ใน client OrderHistory.jsx)
export const DEFAULT_PRODUCTION_GROUP_IDS = [8];
// สาขาที่ไม่พิมพ์ใบส่งสินค้า (ตรงกับ HIDDEN_BRANCHES_IN_PRINT)
const HIDDEN_BRANCH_NAMES = new Set(['สาขาส่วนกลาง']);
const normalizeName = (value) => String(value || '').replace(/\s+/g, '').trim();

const round = (value) => Math.round(Number(value || 0) * 1000) / 1000;

// โหลด pool / admin model เมื่อใช้จริง (import ตอนโหลดไฟล์เปิด connection ค้าง ทำให้เทสต์ไม่จบ)
const defaultDb = async () => (await import('../config/database.js')).default;
const defaultGetOrderItems = async (...args) => (await import('./admin.model.js')).getOrderItemsByDate(...args);

let tablesEnsured = null;
export const ensureProductionPackingTables = async (db) => {
  if (!tablesEnsured) {
    tablesEnsured = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS production_packing_scans (
          id INT PRIMARY KEY AUTO_INCREMENT,
          pack_date DATE NOT NULL,
          branch_id INT NOT NULL,
          product_id INT NOT NULL,
          quantity DECIMAL(12,3) NOT NULL,
          source VARCHAR(10) NOT NULL DEFAULT 'scan',
          sticker_code VARCHAR(20) NULL,
          transaction_id INT NULL,
          created_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_packing_sticker (sticker_code),
          INDEX idx_packing_date_branch (pack_date, branch_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS production_packing_status (
          pack_date DATE NOT NULL,
          branch_id INT NOT NULL,
          packed_by INT NULL,
          packed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pack_date, branch_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((error) => {
      tablesEnsured = null;
      throw error;
    });
  }
  return tablesEnsured;
};

export const isValidPackDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

// รวมรายการสั่งต่อ (สาขา, สินค้า) แบบเดียวกับใบส่งสินค้า
export const buildBranchLines = (orderItems = []) => {
  const branches = new Map();
  for (const item of orderItems) {
    if (HIDDEN_BRANCH_NAMES.has(normalizeName(item.branch_name))) continue;
    const branchId = Number(item.branch_id);
    const productId = Number(item.product_id);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) continue;
    if (!branches.has(branchId)) {
      branches.set(branchId, { branch_id: branchId, branch_name: item.branch_name, lines: new Map() });
    }
    const lines = branches.get(branchId).lines;
    const line = lines.get(productId) || {
      product_id: productId,
      product_name: item.product_name,
      product_code: item.product_code,
      unit: item.unit_abbr || item.unit_name || '',
      ordered: 0,
      departments: new Set()
    };
    line.ordered = round(line.ordered + Number(item.quantity || 0));
    if (item.department_name) line.departments.add(item.department_name);
    lines.set(productId, line);
  }
  return [...branches.values()].map((branch) => ({
    branch_id: branch.branch_id,
    branch_name: branch.branch_name,
    lines: [...branch.lines.values()]
      .map((line) => ({ ...line, departments: [...line.departments] }))
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'th'))
  }));
};

const loadBranchLines = async ({ date, groupIds, getOrderItems }) => {
  // ไม่มีกลุ่ม = ไม่มีสิทธิ์เห็นใบสั่งใด ๆ (ห้ามส่ง [] เพราะ getOrderItemsByDate จะคืนทุกกลุ่ม)
  if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
  const items = await getOrderItems(date, [], groupIds);
  return buildBranchLines(items);
};

const loadPacked = async (db, date, branchId = null) => {
  const params = [date];
  let branchFilter = '';
  if (branchId !== null) {
    branchFilter = 'AND branch_id = ?';
    params.push(branchId);
  }
  const [rows] = await db.query(
    `SELECT id, branch_id, product_id, quantity, source, sticker_code, created_at
       FROM production_packing_scans
      WHERE pack_date = ? ${branchFilter}
      ORDER BY id`,
    params
  );
  return rows || [];
};

const loadStatuses = async (db, date) => {
  const [rows] = await db.query(
    'SELECT branch_id, packed_by, packed_at FROM production_packing_status WHERE pack_date = ?',
    [date]
  );
  return new Map((rows || []).map((row) => [Number(row.branch_id), row]));
};

const attachPacked = (branch, packedRows, status) => {
  const byProduct = new Map();
  for (const row of packedRows) {
    if (Number(row.branch_id) !== branch.branch_id) continue;
    const key = Number(row.product_id);
    byProduct.set(key, round((byProduct.get(key) || 0) + Number(row.quantity || 0)));
  }
  const lines = branch.lines.map((line) => ({ ...line, packed: byProduct.get(line.product_id) || 0 }));
  // สแกนสินค้าที่ไม่อยู่ในใบสั่งไม่ได้ จึงไม่มีบรรทัดเกิน; แต่ถ้าใบสั่งถูกแก้ทีหลัง ให้เห็นของที่จัดไปแล้ว
  for (const [productId, packed] of byProduct) {
    if (!lines.some((line) => line.product_id === productId) && packed > 0) {
      lines.push({ product_id: productId, product_name: `สินค้า #${productId}`, unit: '', ordered: 0, packed, departments: [], removed: true });
    }
  }
  const orderedTotal = round(lines.reduce((sum, line) => sum + line.ordered, 0));
  const packedTotal = round(lines.reduce((sum, line) => sum + Math.min(line.packed, line.ordered), 0));
  return {
    branch_id: branch.branch_id,
    branch_name: branch.branch_name,
    lines,
    ordered_total: orderedTotal,
    packed_total: packedTotal,
    complete_lines: lines.filter((line) => line.ordered > 0 && line.packed >= line.ordered).length,
    line_count: lines.filter((line) => line.ordered > 0).length,
    packed_at: status?.packed_at || null
  };
};

export const getPackingOverview = async ({ date, groupIds, db, getOrderItems = defaultGetOrderItems }) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const [branches, packed, statuses] = await Promise.all([
    loadBranchLines({ date, groupIds, getOrderItems }),
    loadPacked(db, date),
    loadStatuses(db, date)
  ]);
  return branches
    .map((branch) => attachPacked(branch, packed, statuses.get(branch.branch_id)))
    .sort((a, b) => String(a.branch_name).localeCompare(String(b.branch_name), 'th'));
};

export const getBranchPacking = async ({ date, branchId, groupIds, db, getOrderItems = defaultGetOrderItems }) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const branches = await loadBranchLines({ date, groupIds, getOrderItems });
  const branch = branches.find((row) => row.branch_id === Number(branchId));
  if (!branch) return null;
  const [packed, statuses] = await Promise.all([loadPacked(db, date, branch.branch_id), loadStatuses(db, date)]);
  const result = attachPacked(branch, packed, statuses.get(branch.branch_id));
  const names = new Map(result.lines.map((line) => [line.product_id, line]));
  result.entries = packed
    .slice()
    .reverse()
    .map((row) => ({
      id: Number(row.id),
      product_id: Number(row.product_id),
      product_name: names.get(Number(row.product_id))?.product_name || '',
      unit: names.get(Number(row.product_id))?.unit || '',
      quantity: Number(row.quantity),
      source: row.source,
      sticker_code: row.sticker_code,
      created_at: row.created_at
    }));
  return result;
};

const isDuplicateKey = (error) => error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;

// สแกนสติกเกอร์ 1 ดวงเข้าสาขา: ok / not_in_order / over / duplicate / not_found / invalid
export const scanStickerForBranch = async ({
  date, branchId, code, userId, groupIds, db,
  getOrderItems = defaultGetOrderItems,
  findSticker = findTransformSticker
}) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const found = await findSticker(code, { db });
  if (found.status === 'invalid') return { status: 'invalid' };
  if (found.status !== 'ok') return { status: 'not_found' };
  const sticker = found.sticker;

  const [existing] = await db.query(
    `SELECT s.pack_date, s.branch_id, b.name AS branch_name
       FROM production_packing_scans s
       LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.sticker_code = ?
      LIMIT 1`,
    [sticker.code]
  );
  if (existing?.[0]) {
    return { status: 'duplicate', sticker, packed_to: existing[0].branch_name || null };
  }

  const branches = await loadBranchLines({ date, groupIds, getOrderItems });
  const branch = branches.find((row) => row.branch_id === Number(branchId));
  const line = branch?.lines.find((row) => row.product_id === sticker.product_id);
  if (!line) return { status: 'not_in_order', sticker };

  const packedRows = await loadPacked(db, date, branch.branch_id);
  const packed = round(packedRows
    .filter((row) => Number(row.product_id) === line.product_id)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0));
  const quantity = Number(sticker.quantity_per_sticker) > 0 ? Number(sticker.quantity_per_sticker) : 1;
  if (packed + quantity > line.ordered + 0.0005) {
    return { status: 'over', sticker, line: { ...line, packed } };
  }

  try {
    await db.query(
      `INSERT INTO production_packing_scans
         (pack_date, branch_id, product_id, quantity, source, sticker_code, transaction_id, created_by)
       VALUES (?, ?, ?, ?, 'scan', ?, ?, ?)`,
      [date, branch.branch_id, line.product_id, quantity, sticker.code, sticker.transaction_id, userId || null]
    );
  } catch (error) {
    if (isDuplicateKey(error)) return { status: 'duplicate', sticker, packed_to: null };
    throw error;
  }
  return { status: 'ok', sticker, quantity, line: { ...line, packed: round(packed + quantity) } };
};

// กด +/− เอง (ของไม่มีสติกเกอร์ เช่น ชั่งกิโล) — ยอมเกินที่สั่งได้เพราะผู้ใช้ตั้งใจ แต่ห้ามติดลบ
export const adjustPackedManually = async ({
  date, branchId, productId, delta, userId, groupIds, db,
  getOrderItems = defaultGetOrderItems
}) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const change = round(delta);
  if (!Number.isFinite(change) || change === 0) return { status: 'invalid' };
  const branches = await loadBranchLines({ date, groupIds, getOrderItems });
  const branch = branches.find((row) => row.branch_id === Number(branchId));
  const line = branch?.lines.find((row) => row.product_id === Number(productId));
  if (!line) return { status: 'not_in_order' };
  const packedRows = await loadPacked(db, date, branch.branch_id);
  const packed = round(packedRows
    .filter((row) => Number(row.product_id) === line.product_id)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0));
  if (packed + change < -0.0005) return { status: 'below_zero', line: { ...line, packed } };
  await db.query(
    `INSERT INTO production_packing_scans
       (pack_date, branch_id, product_id, quantity, source, created_by)
     VALUES (?, ?, ?, ?, 'manual', ?)`,
    [date, branch.branch_id, line.product_id, change, userId || null]
  );
  return { status: 'ok', line: { ...line, packed: round(packed + change) } };
};

export const removePackingEntry = async ({ id, date, branchId, db }) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const [result] = await db.query(
    'DELETE FROM production_packing_scans WHERE id = ? AND pack_date = ? AND branch_id = ?',
    [Number(id), date, Number(branchId)]
  );
  return Number(result?.affectedRows || 0) > 0;
};

export const setBranchPacked = async ({ date, branchId, packed, userId, db }) => {
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  if (packed) {
    await db.query(
      `INSERT INTO production_packing_status (pack_date, branch_id, packed_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE packed_by = VALUES(packed_by), packed_at = CURRENT_TIMESTAMP`,
      [date, Number(branchId), userId || null]
    );
  } else {
    await db.query('DELETE FROM production_packing_status WHERE pack_date = ? AND branch_id = ?', [date, Number(branchId)]);
  }
  return true;
};
