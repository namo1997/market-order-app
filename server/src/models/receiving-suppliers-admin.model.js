import { canManageReceivingSuppliers } from './receiving-admin-access.js';
import { createReceivingError, normalizeMatchText } from '../services/receiving-ocr.service.js';

// Accounting/admin maintenance of supplier ordering notes and confirmed aliases.
// Every write runs in one transaction together with its audit row. Callers must
// run ensureReceivingDocumentsTables first (the controller does).

export const ORDERING_MODES = ['system', 'walk_in_phone', 'mixed'];
const SUPPLIER_LIMIT = 300;
const ALIAS_FIELDS = ['bill_text', 'unit_text', 'product_id'];
const PROFILE_FIELDS = ['ordering_mode', 'branches_note', 'bill_format_note', 'ordering_note'];
const BRANCH_CODE_LIMIT = 20;
const PROFILE_LIMITS = { branches_note: 500, bill_format_note: 2000, ordering_note: 2000 };

const fail = message => { throw createReceivingError('VALIDATION_FAILED', message); };
export function assertSupplierManager(user) {
  if (!canManageReceivingSuppliers(user)) throw createReceivingError('FORBIDDEN', 'เฉพาะบัญชีหรือผู้ดูแล');
}

export function parseSupplierKey(value) {
  const match = typeof value === 'string' ? /^(sm|pg):([1-9]\d{0,9})$/.exec(value) : null;
  if (!match || !Number.isSafeInteger(Number(match[2]))) fail('รหัสร้านไม่ถูกต้อง');
  return { key: value, master: match[1] === 'sm', id: Number(match[2]) };
}
const positiveId = (value, label) => {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) fail(`${label}ไม่ถูกต้อง`);
  return Number(text);
};
const exactBody = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('รูปแบบข้อมูลไม่ถูกต้อง');
  const keys = Object.keys(body);
  if (keys.some(key => !allowed.includes(key))) fail('มีฟิลด์ที่ไม่รองรับ');
  if (!keys.length) fail('ไม่มีข้อมูลที่ต้องการแก้ไข');
  return body;
};
// Bill text is shown to staff and sent to OCR as data: reject control characters.
const billText = value => {
  if (typeof value !== 'string') fail('ข้อความในบิลต้องเป็นตัวอักษร');
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!text || text.length > 255 || /[\u0000-\u001f\u007f]/.test(text)) fail('ข้อความในบิลต้องยาว 1–255 ตัวอักษร');
  if (!normalizeMatchText(text)) fail('ข้อความในบิลต้องมีตัวอักษรหรือตัวเลข');
  return text;
};
const unitText = value => {
  if (value == null) return '';
  if (typeof value !== 'string') fail('หน่วยในบิลต้องเป็นตัวอักษร');
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (text.length > 100 || /[\u0000-\u001f\u007f]/.test(text)) fail('หน่วยในบิลยาวเกิน 100 ตัวอักษร');
  return text;
};
const note = (value, field) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') fail('หมายเหตุต้องเป็นตัวอักษร');
  const text = value.normalize('NFC').trim();
  if (text.length > PROFILE_LIMITS[field] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    fail(`หมายเหตุยาวเกิน ${PROFILE_LIMITS[field]} ตัวอักษรหรือมีอักขระต้องห้าม`);
  }
  return text || null;
};

// Per-branch AP codes ("รหัสเจ้าหนี้ตามสาขา"): short codes only. Long digit runs look like phone,
// bank or tax numbers, which must never be stored here.
const hasLongDigits = text => /\d{9,}/.test(text.replace(/[\s-]/g, ''));
const branchCodes = value => {
  if (!Array.isArray(value) || value.length > BRANCH_CODE_LIMIT) fail('รหัสเจ้าหนี้ตามสาขาต้องเป็นรายการไม่เกิน ' + BRANCH_CODE_LIMIT + ' รายการ');
  const seen = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['code', 'branch_note'].includes(key))) fail('รูปแบบรหัสเจ้าหนี้ไม่ถูกต้อง');
    if (typeof entry.code !== 'string') fail('รหัสเจ้าหนี้ต้องเป็นตัวอักษร');
    const code = entry.code.normalize('NFC').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,29}$/.test(code) || hasLongDigits(code)) fail('รหัสเจ้าหนี้ต้องเป็นรหัสสั้น เช่น AP-049 (ห้ามใส่เลขบัญชี เลขภาษี หรือเบอร์โทร)');
    if (entry.branch_note != null && typeof entry.branch_note !== 'string') fail('หมายเหตุสาขาต้องเป็นตัวอักษร');
    const branchNote = (entry.branch_note ?? '').normalize('NFC').trim();
    if (branchNote.length > 100 || /[\u0000-\u001f\u007f]/.test(branchNote) || hasLongDigits(branchNote)) fail('หมายเหตุสาขายาวเกิน 100 ตัวอักษร มีอักขระต้องห้าม หรือมีเลขยาวคล้ายเบอร์โทร/เลขบัญชี');
    if (seen.has(code.toUpperCase())) fail('รหัสเจ้าหนี้ซ้ำกัน');
    seen.add(code.toUpperCase());
    return { code, branch_note: branchNote || null };
  });
};
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

const iso = value => (value == null ? null : value instanceof Date ? value.toISOString() : String(value));
const decimal = value => (value == null ? null : String(value));
const aliasView = row => ({ id: Number(row.id), bill_text: row.bill_text, unit_text: row.unit_text || '',
  product_id: Number(row.product_id), product_name: row.product_name ?? null, unit_name: row.unit_name ?? null,
  unit_multiplier: decimal(row.unit_multiplier), last_unit_price: decimal(row.last_unit_price),
  confirm_count: Number(row.confirm_count || 0), is_active: Number(row.is_active ?? 1) !== 0,
  updated_at: iso(row.updated_at), updated_by_name: row.updated_by_name ?? null });
// A shop can hold the same alias under its supplier-master key and under its legacy product-group key
// (OCR reads whichever key the receiving document carries). The page shows one row per distinct alias.
const aliasTriple = row => [row.normalized_bill_text, row.normalized_unit_text, Number(row.product_id)].join('|');
function mergeAliasRows(rows, primaryKey) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(aliasTriple(row)) || [];
    list.push(row); groups.set(aliasTriple(row), list);
  }
  return [...groups.values()].map(list => {
    const rep = list.find(row => row.supplier_key === primaryKey) || list[0];
    return { ...aliasView({ ...rep, is_active: list.some(row => Number(row.is_active ?? 1) !== 0) ? 1 : 0,
      confirm_count: Math.max(...list.map(row => Number(row.confirm_count || 0))) }),
    alias_ids: list.map(row => Number(row.id)), source_keys: [...new Set(list.map(row => row.supplier_key))] };
  });
}
const profileView = row => ({ ordering_mode: ORDERING_MODES.includes(row?.ordering_mode) ? row.ordering_mode : null,
  branches_note: row?.branches_note ?? null, bill_format_note: row?.bill_format_note ?? null,
  ordering_note: row?.ordering_note ?? null, updated_at: iso(row?.updated_at) });
const auditSnapshot = alias => alias && ({ bill_text: alias.bill_text, unit_text: alias.unit_text || '',
  product_id: Number(alias.product_id), product_name: alias.product_name ?? null, is_active: Number(alias.is_active ?? 1) !== 0 });

async function loadSupplier(db, { key, master, id }) {
  // Only these two static statements exist; the identifier is never interpolated.
  const [rows] = await db.query(master
    ? 'SELECT sm.id, sm.code, sm.name, sm.is_active FROM supplier_masters sm WHERE sm.id = ? LIMIT 1'
    : 'SELECT pg.id, pg.code, pg.name, pg.is_active FROM product_groups pg WHERE pg.id = ? LIMIT 1', [id]);
  if (!rows?.length) throw createReceivingError('NOT_FOUND', 'ไม่พบร้านนี้');
  return { supplier_key: key, kind: master ? 'master' : 'group', id, code: rows[0].code ?? null,
    name: rows[0].name, is_active: Number(rows[0].is_active ?? 1) !== 0 };
}
async function loadActiveProduct(db, productId) {
  const [rows] = await db.query(`SELECT p.id, p.name, p.unit_id FROM products p
    WHERE p.id = ? AND p.is_active = true LIMIT 1`, [productId]);
  if (!rows?.length) fail('ไม่พบสินค้านี้ในระบบ หรือสินค้าถูกปิดใช้งาน');
  return rows[0];
}
const aliasSelect = `SELECT a.id, a.supplier_key, a.bill_text, a.unit_text, a.normalized_bill_text,
  a.normalized_unit_text, a.product_id, p.name AS product_name, u.name AS unit_name, a.unit_multiplier,
  a.last_unit_price, a.confirm_count, a.is_active, a.updated_at, usr.name AS updated_by_name
  FROM supplier_product_aliases a LEFT JOIN products p ON p.id = a.product_id
  LEFT JOIN units u ON u.id = p.unit_id LEFT JOIN users usr ON usr.id = a.updated_by_user_id`;

async function transaction(db, work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* original error is more useful */ }
    if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
      throw createReceivingError('CONFLICT', 'มีชื่อย่อนี้ของร้านนี้อยู่แล้ว');
    }
    throw error;
  } finally { connection.release?.(); }
}
async function writeAudit(connection, { supplierKey, aliasId = null, action, user, before = null, after = null }) {
  await connection.query(`INSERT INTO receiving_supplier_admin_audits
    (supplier_key, alias_id, action, actor_user_id, actor_name, actor_role, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [supplierKey, aliasId, action, Number(user.id) || null,
    String(user.name || '').slice(0, 255) || null, String(user.role || '').slice(0, 50) || null,
    before && JSON.stringify(before), after && JSON.stringify(after)]);
}
async function aliasById(db, aliasId) {
  const [rows] = await db.query(`${aliasSelect} WHERE a.id = ? LIMIT 1`, [aliasId]);
  return rows?.[0] ? aliasView(rows[0]) : null;
}
// `keys` is the shop's whole key family (see keyFamily): an alias is reachable from any of its keys.
const lockedAlias = async (connection, aliasId, keys) => {
  const marks = placeholders(keys.length);
  const [rows] = await connection.query(`${aliasSelect} WHERE a.id = ? AND a.supplier_key IN (${marks}) FOR UPDATE`, [aliasId, ...keys]);
  if (!rows?.length) throw createReceivingError('NOT_FOUND', 'ไม่พบชื่อย่อของร้านนี้');
  return rows[0];
};
// Rows holding the same alias under the other keys of the shop (includes the row itself).
const lockedMirrors = async (connection, row, keys) => {
  const marks = placeholders(keys.length);
  const [rows] = await connection.query(`${aliasSelect} WHERE a.supplier_key IN (${marks}) AND a.normalized_bill_text = ?
    AND a.normalized_unit_text = ? AND a.product_id = ? FOR UPDATE`, [...keys, row.normalized_bill_text, row.normalized_unit_text, row.product_id]);
  return rows?.length ? rows : [row];
};
async function assertFree(connection, keys, normalizedBill, normalizedUnit, exceptIds = [0]) {
  const marks = placeholders(keys.length);
  const [rows] = await connection.query(`SELECT id FROM supplier_product_aliases
    WHERE supplier_key IN (${marks}) AND normalized_bill_text = ? AND normalized_unit_text = ? AND id NOT IN (` + placeholders(exceptIds.length) + ') FOR UPDATE',
  [...keys, normalizedBill.slice(0, 255), normalizedUnit.slice(0, 100), ...exceptIds]);
  if (rows?.length) throw createReceivingError('CONFLICT', 'มีชื่อย่อและหน่วยนี้ของร้านนี้อยู่แล้ว');
}

// Canonical supplier resolution, same rule as the receiving supplier catalog (round N1): a legacy product
// group whose TRIM name equals an active supplier master's name is the same shop. The lowest master id wins.
async function twinPairs(db) {
  const [rows] = await db.query(`SELECT sm.id AS master_id, pg.id AS group_id, pg.name AS group_name, pg.code AS group_code
    FROM supplier_masters sm JOIN product_groups pg ON TRIM(pg.name) = TRIM(sm.name)
    WHERE sm.is_active = true AND TRIM(sm.name) <> '' ORDER BY sm.id, pg.id`);
  const groupToMaster = new Map(), masterToGroups = new Map(), groups = new Map();
  for (const row of rows || []) {
    const groupId = Number(row.group_id), masterId = Number(row.master_id);
    if (groupToMaster.has(groupId)) continue;
    groupToMaster.set(groupId, masterId);
    masterToGroups.set(masterId, [...(masterToGroups.get(masterId) || []), groupId]);
    groups.set(groupId, { name: row.group_name ?? '', code: row.group_code ?? '' });
  }
  return { groupToMaster, masterToGroups, groups };
}
const familyOfMaster = (pairs, masterId) => ['sm:' + masterId, ...(pairs.masterToGroups.get(masterId) || []).map(id => 'pg:' + id)];
function keyFamily(pairs, target) {
  const masterId = target.master ? target.id : pairs.groupToMaster.get(target.id);
  if (!masterId) return { primary: target, keys: [target.key], groupIds: [] };
  return { primary: { key: 'sm:' + masterId, master: true, id: masterId }, keys: familyOfMaster(pairs, masterId),
    groupIds: pairs.masterToGroups.get(masterId) || [] };
}
const canonicalKey = (pairs, key) => key.startsWith('pg:') && pairs.groupToMaster.has(Number(key.slice(3))) ? 'sm:' + pairs.groupToMaster.get(Number(key.slice(3))) : key;
async function resolveFamily(db, target) {
  const requested = await loadSupplier(db, target);
  const family = keyFamily(await twinPairs(db), target);
  const supplier = family.primary.key === target.key ? requested : await loadSupplier(db, family.primary);
  return { ...family, supplier };
}
const readBranchCodes = async (db, keys) => {
  const marks = placeholders(keys.length);
  const [rows] = await db.query(`SELECT supplier_key, supplier_code, branch_note FROM receiving_supplier_branch_codes
    WHERE is_active = 1 AND supplier_key IN (${marks}) ORDER BY supplier_code`, keys);
  return rows || [];
};

// Branches that already received confirmed bills from each supplier (read-only evidence for "ส่งให้สาขา").
async function seenBranches(db, keys) {
  const marks = keys.map(() => '?').join(', ');
  const [rows] = await db.query(`SELECT DISTINCT supplier_key, branch_id, branch_name FROM (
      SELECT CASE WHEN rd.supplier_master_id IS NOT NULL THEN CONCAT('sm:', rd.supplier_master_id)
        ELSE CONCAT('pg:', rd.product_group_id) END AS supplier_key, rd.branch_id AS branch_id, b.name AS branch_name
      FROM receiving_documents rd LEFT JOIN branches b ON b.id = rd.branch_id
      WHERE rd.status = 'confirmed' AND (rd.supplier_master_id IS NOT NULL OR rd.product_group_id IS NOT NULL)
    ) seen WHERE supplier_key IN (${marks}) ORDER BY branch_id`, keys);
  return rows || [];
}

export async function listSuppliers(db, { user, query = {} }) {
  assertSupplierManager(user);
  const q = query.q == null || query.q === '' ? '' : query.q;
  if (typeof q !== 'string' || q.length > 100) fail('คำค้นไม่ถูกต้อง');
  const kind = query.kind == null || query.kind === '' ? 'all' : query.kind;
  if (!['all', 'master', 'group'].includes(kind)) fail('ประเภทร้านไม่ถูกต้อง');
  const needle = q.trim();
  const pairs = await twinPairs(db);
  const clauses = [], params = [];
  if (kind !== 'all') { clauses.push('kind = ?'); params.push(kind); }
  // A group that is the same shop as a supplier master is shown through that master only.
  const hiddenGroups = [...pairs.groupToMaster.keys()];
  if (hiddenGroups.length) { clauses.push("NOT (kind = 'group' AND id IN (" + placeholders(hiddenGroups.length) + '))'); params.push(...hiddenGroups); }
  if (needle) {
    // Shops are also found through their twin group's name/code and through per-branch AP codes.
    const extra = new Set();
    for (const [groupId, masterId] of pairs.groupToMaster) {
      const group = pairs.groups.get(groupId);
      if (group.name.includes(needle) || group.code.includes(needle)) extra.add('sm:' + masterId);
    }
    const [codeRows] = await db.query(`SELECT DISTINCT supplier_key FROM receiving_supplier_branch_codes
      WHERE is_active = 1 AND (LOCATE(?, supplier_code) > 0 OR LOCATE(?, COALESCE(branch_note, '')) > 0)`, [needle, needle]);
    for (const row of codeRows || []) extra.add(canonicalKey(pairs, row.supplier_key));
    // LOCATE is a literal substring test: % and _ are not wildcards.
    clauses.push("(LOCATE(?, name) > 0 OR LOCATE(?, COALESCE(code, '')) > 0" + (extra.size ? ' OR supplier_key IN (' + placeholders(extra.size) + ')' : '') + ')');
    params.push(needle, needle, ...extra);
  }
  const [rows] = await db.query(`SELECT supplier_key, kind, id, code, name, is_active FROM (
      SELECT CONCAT('sm:', sm.id) AS supplier_key, 'master' AS kind, sm.id AS id, sm.code AS code, sm.name AS name, sm.is_active AS is_active
      FROM supplier_masters sm
      UNION ALL
      SELECT CONCAT('pg:', pg.id), 'group', pg.id, pg.code, pg.name, pg.is_active FROM product_groups pg
    ) suppliers ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY (kind = 'master') DESC, name, id LIMIT ?`, [...params, SUPPLIER_LIMIT + 1]);
  const truncated = rows.length > SUPPLIER_LIMIT;
  const page = rows.slice(0, SUPPLIER_LIMIT);
  const families = new Map(page.map(row => [row.supplier_key, row.kind === 'master' ? familyOfMaster(pairs, Number(row.id)) : [row.supplier_key]]));
  const keys = [...new Set([...families.values()].flat())];
  const profiles = new Map(), aliasSets = new Map(), branches = new Map(), codes = new Map();
  if (keys.length) {
    const marks = placeholders(keys.length);
    const [profileRows] = await db.query(`SELECT supplier_key, ordering_mode, branches_note, bill_format_note,
      ordering_note, updated_at FROM receiving_supplier_profiles WHERE supplier_key IN (${marks})`, keys);
    for (const row of profileRows || []) profiles.set(row.supplier_key, row);
    const [aliasRows] = await db.query(`SELECT supplier_key, normalized_bill_text, normalized_unit_text, product_id, is_active
      FROM supplier_product_aliases WHERE supplier_key IN (${marks})`, keys);
    for (const row of aliasRows || []) {
      const set = aliasSets.get(row.supplier_key) || new Map(), triple = aliasTriple(row);
      set.set(triple, set.get(triple) || Number(row.is_active ?? 1) !== 0);
      aliasSets.set(row.supplier_key, set);
    }
    for (const row of await seenBranches(db, keys)) {
      const list = branches.get(row.supplier_key) || [];
      list.push(row.branch_name || `สาขา ${row.branch_id}`);
      branches.set(row.supplier_key, list);
    }
    for (const row of await readBranchCodes(db, keys)) {
      const list = codes.get(row.supplier_key) || [];
      list.push({ code: row.supplier_code, branch_note: row.branch_note ?? null });
      codes.set(row.supplier_key, list);
    }
  }
  const union = (family, source) => {
    const out = [], seen = new Set();
    for (const key of family) for (const entry of source.get(key) || []) {
      const id = typeof entry === 'string' ? entry : entry.code;
      if (!seen.has(id)) { seen.add(id); out.push(entry); }
    }
    return out;
  };
  return { items: page.map(row => {
    const family = families.get(row.supplier_key);
    const merged = new Map();
    for (const key of family) for (const [triple, active] of aliasSets.get(key) || []) merged.set(triple, merged.get(triple) || active);
    const activeCount = [...merged.values()].filter(Boolean).length;
    return { supplier_key: row.supplier_key, kind: row.kind, code: row.code ?? null, name: row.name,
      is_active: Number(row.is_active ?? 1) !== 0, ...profileView(family.map(key => profiles.get(key)).find(Boolean)),
      branches_seen: union(family, branches), branch_codes: union(family, codes),
      alias_active_count: activeCount, alias_disabled_count: merged.size - activeCount };
  }), truncated, limit: SUPPLIER_LIMIT, ordering_modes: ORDERING_MODES };
}

export async function supplierDetail(db, { user, key }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const { supplier, keys } = await resolveFamily(db, target);
  const marks = placeholders(keys.length);
  const [profileRows] = await db.query(`SELECT supplier_key, ordering_mode, branches_note, bill_format_note, ordering_note, updated_at
    FROM receiving_supplier_profiles WHERE supplier_key IN (${marks})`, keys);
  // Order must not depend on is_active: a status change keeps the row where it is.
  const [aliasRows] = await db.query(`${aliasSelect} WHERE a.supplier_key IN (${marks})
    ORDER BY a.normalized_bill_text, a.normalized_unit_text, a.id LIMIT 500`, keys);
  const [auditRows] = await db.query(`SELECT id, alias_id, action, actor_name, actor_role, before_json, after_json, created_at
    FROM receiving_supplier_admin_audits WHERE supplier_key IN (${marks}) ORDER BY id DESC LIMIT 30`, keys);
  const audits = (auditRows || []).map(row => {
    const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
    return { id: Number(row.id), alias_id: row.alias_id == null ? null : Number(row.alias_id), action: row.action,
      actor_name: row.actor_name ?? null, actor_role: row.actor_role ?? null, created_at: iso(row.created_at),
      before: parse(row.before_json), after: parse(row.after_json) };
  });
  const seen = new Set(), branches = [];
  for (const row of await seenBranches(db, keys)) {
    const name = row.branch_name || `สาขา ${row.branch_id}`;
    if (!seen.has(name)) { seen.add(name); branches.push(name); }
  }
  const codeRows = await readBranchCodes(db, keys), codeSeen = new Set();
  const codes = codeRows.filter(row => !codeSeen.has(row.supplier_code) && codeSeen.add(row.supplier_code))
    .map(row => ({ code: row.supplier_code, branch_note: row.branch_note ?? null }));
  const profile = keys.map(item => (profileRows || []).find(row => row.supplier_key === item)).find(Boolean);
  return { ...supplier, ...profileView(profile), branch_codes: codes, branches_seen: branches,
    aliases: mergeAliasRows(aliasRows || [], supplier.supplier_key), audits, ordering_modes: ORDERING_MODES,
    ...(keys.length > 1 ? { merged_keys: keys } : {}) };
}

export async function searchSupplierProducts(db, { user, key, query = {} }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const { primary, groupIds } = await resolveFamily(db, target);
  const q = query.q == null || query.q === '' ? '' : query.q;
  if (typeof q !== 'string' || q.length > 100) fail('คำค้นไม่ถูกต้อง');
  const needle = q.trim();
  let link = primary.master
    ? 'EXISTS (SELECT 1 FROM product_supplier_master_links l WHERE l.product_id = p.id AND l.supplier_master_id = ?)'
    : 'EXISTS (SELECT 1 FROM product_group_links l WHERE l.product_id = p.id AND l.product_group_id = ?)';
  const linkParams = [primary.id];
  if (primary.master && groupIds.length) {
    link = '(' + link + ' OR EXISTS (SELECT 1 FROM product_group_links g WHERE g.product_id = p.id AND g.product_group_id IN (' + placeholders(groupIds.length) + ')))';
    linkParams.push(...groupIds);
  }
  const [rows] = await db.query(`SELECT p.id, p.name, p.code, u.name AS unit_name, ${link} AS is_supplier_product
    FROM products p LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.is_active = true ${needle ? "AND (LOCATE(?, p.name) > 0 OR LOCATE(?, COALESCE(p.code, '')) > 0)" : ''}
    ORDER BY is_supplier_product DESC, p.name, p.id LIMIT 50`, needle ? [...linkParams, needle, needle] : linkParams);
  return { items: (rows || []).map(row => ({ id: Number(row.id), name: row.name, code: row.code ?? null,
    unit_name: row.unit_name ?? null, is_supplier_product: Number(row.is_supplier_product) === 1 })) };
}

export async function updateSupplierProfile(db, { user, key, body }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const input = exactBody(body, [...PROFILE_FIELDS, 'branch_codes']);
  const next = {};
  for (const field of PROFILE_FIELDS) {
    if (!(field in input)) continue;
    if (field === 'ordering_mode') {
      if (input[field] != null && input[field] !== '' && !ORDERING_MODES.includes(input[field])) fail('รูปแบบการสั่งไม่ถูกต้อง');
      next[field] = input[field] || null;
    } else next[field] = note(input[field], field);
  }
  const touchCodes = 'branch_codes' in input;
  const nextCodes = touchCodes ? branchCodes(input.branch_codes) : null;
  const { primary, keys } = await resolveFamily(db, target);
  return transaction(db, async connection => {
    const marks = placeholders(keys.length);
    const [rows] = await connection.query(`SELECT supplier_key, ordering_mode, branches_note, bill_format_note, ordering_note, updated_at
      FROM receiving_supplier_profiles WHERE supplier_key IN (${marks}) FOR UPDATE`, keys);
    const existing = keys.map(item => (rows || []).find(row => row.supplier_key === item)).find(Boolean);
    const before = profileView(existing);
    const merged = { ordering_mode: before.ordering_mode, branches_note: before.branches_note,
      bill_format_note: before.bill_format_note, ordering_note: before.ordering_note, ...next };
    const changed = PROFILE_FIELDS.some(field => merged[field] !== before[field]);
    const pick = value => Object.fromEntries(PROFILE_FIELDS.map(field => [field, value[field]]));
    let codesChanged = false, codesBefore = null;
    if (touchCodes) {
      const [codeRows] = await connection.query(`SELECT supplier_code, branch_note, is_active FROM receiving_supplier_branch_codes
        WHERE supplier_key = ? ORDER BY supplier_code FOR UPDATE`, [primary.key]);
      const current = (codeRows || []).filter(row => Number(row.is_active ?? 1) !== 0);
      codesBefore = current.map(row => ({ code: row.supplier_code, branch_note: row.branch_note ?? null }));
      const wanted = new Map(nextCodes.map(entry => [entry.code, entry]));
      for (const row of current) {
        if (wanted.has(row.supplier_code)) continue;
        codesChanged = true; // Removed codes are switched off, never deleted, so the history stays.
        await connection.query(`UPDATE receiving_supplier_branch_codes SET is_active = 0, updated_by_user_id = ?
          WHERE supplier_key = ? AND supplier_code = ?`, [Number(user.id) || null, primary.key, row.supplier_code]);
      }
      for (const entry of nextCodes) {
        const old = current.find(row => row.supplier_code === entry.code);
        if (old && (old.branch_note ?? null) === entry.branch_note) continue;
        codesChanged = true;
        await connection.query(`INSERT INTO receiving_supplier_branch_codes (supplier_key, supplier_code, branch_note, is_active, updated_by_user_id)
          VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE branch_note = VALUES(branch_note), is_active = 1,
          updated_by_user_id = VALUES(updated_by_user_id)`, [primary.key, entry.code, entry.branch_note, Number(user.id) || null]);
      }
    }
    if (changed || !rows?.length) {
      await connection.query(`INSERT INTO receiving_supplier_profiles
        (supplier_key, ordering_mode, branches_note, bill_format_note, ordering_note, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ordering_mode = VALUES(ordering_mode),
        branches_note = VALUES(branches_note), bill_format_note = VALUES(bill_format_note),
        ordering_note = VALUES(ordering_note), updated_by_user_id = VALUES(updated_by_user_id)`,
      [primary.key, merged.ordering_mode, merged.branches_note, merged.bill_format_note, merged.ordering_note, Number(user.id) || null]);
    }
    if (changed || codesChanged || !rows?.length) {
      await writeAudit(connection, { supplierKey: primary.key, action: 'profile_update', user,
        before: touchCodes ? { ...pick(before), branch_codes: codesBefore } : pick(before),
        after: touchCodes ? { ...pick(merged), branch_codes: nextCodes } : pick(merged) });
    }
    return { ...merged, ...(touchCodes ? { branch_codes: nextCodes } : {}), changed: changed || codesChanged };
  });
}

export async function createSupplierAlias(db, { user, key, body }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const input = exactBody(body, ALIAS_FIELDS);
  if (!('bill_text' in input) || !('product_id' in input)) fail('กรุณาระบุข้อความในบิลและสินค้า');
  const text = billText(input.bill_text), unit = unitText(input.unit_text);
  const productId = positiveId(input.product_id, 'สินค้า');
  const { supplier, primary, keys } = await resolveFamily(db, target);
  const product = await loadActiveProduct(db, productId);
  const normalizedBill = normalizeMatchText(text), normalizedUnit = normalizeMatchText(unit);
  const aliasId = await transaction(db, async connection => {
    await assertFree(connection, keys, normalizedBill, normalizedUnit);
    let primaryId = null;
    // OCR looks aliases up by the key the receiving document carries, so a merged shop gets the alias under every key.
    for (const itemKey of keys) {
      const master = itemKey.startsWith('sm:'), id = Number(itemKey.slice(3));
      const [inserted] = await connection.query(`INSERT INTO supplier_product_aliases
        (supplier_key, supplier_master_id, product_group_id, supplier_name_text, bill_text, normalized_bill_text,
         unit_text, normalized_unit_text, product_id, unit_id, unit_multiplier, confirm_count, is_active, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0000, 1, 1, ?)`,
      [itemKey, master ? id : null, master ? null : id, String(supplier.name).slice(0, 255),
        text, normalizedBill.slice(0, 255), unit, normalizedUnit.slice(0, 100), product.id, product.unit_id ?? null, Number(user.id) || null]);
      if (itemKey === primary.key) primaryId = Number(inserted.insertId);
    }
    await writeAudit(connection, { supplierKey: primary.key, aliasId: primaryId, action: 'alias_create', user,
      after: auditSnapshot({ bill_text: text, unit_text: unit, product_id: product.id, product_name: product.name, is_active: 1 }) });
    return primaryId;
  });
  return (await aliasById(db, aliasId)) || { id: aliasId, bill_text: text, unit_text: unit, product_id: product.id,
    product_name: product.name, is_active: true };
}

export async function updateSupplierAlias(db, { user, key, aliasId, body }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const id = positiveId(aliasId, 'ชื่อย่อ');
  const input = exactBody(body, ALIAS_FIELDS);
  const next = {};
  if ('bill_text' in input) next.bill_text = billText(input.bill_text);
  if ('unit_text' in input) next.unit_text = unitText(input.unit_text);
  if ('product_id' in input) next.product_id = positiveId(input.product_id, 'สินค้า');
  const { primary, keys } = await resolveFamily(db, target);
  const product = next.product_id ? await loadActiveProduct(db, next.product_id) : null;
  await transaction(db, async connection => {
    const current = await lockedAlias(connection, id, keys);
    const billValue = next.bill_text ?? current.bill_text, unitValue = next.unit_text ?? (current.unit_text || '');
    const productChanged = product && Number(product.id) !== Number(current.product_id);
    if (billValue === current.bill_text && unitValue === (current.unit_text || '') && !productChanged) return;
    const normalizedBill = normalizeMatchText(billValue), normalizedUnit = normalizeMatchText(unitValue);
    const mirrors = await lockedMirrors(connection, current, keys);
    await assertFree(connection, keys, normalizedBill, normalizedUnit, mirrors.map(row => Number(row.id)));
    for (const row of mirrors) {
      await connection.query(`UPDATE supplier_product_aliases SET bill_text = ?, normalized_bill_text = ?, unit_text = ?,
        normalized_unit_text = ?, product_id = ?, unit_id = ?, unit_multiplier = ?, candidate_product_id = ?,
        candidate_confirm_count = ?, updated_by_user_id = ? WHERE id = ? AND supplier_key = ?`,
      [billValue, normalizedBill.slice(0, 255), unitValue, normalizedUnit.slice(0, 100),
        productChanged ? product.id : row.product_id, productChanged ? product.unit_id ?? null : row.unit_id ?? null,
        productChanged ? '1.0000' : row.unit_multiplier ?? '1.0000', productChanged ? null : row.candidate_product_id ?? null,
        productChanged ? 0 : Number(row.candidate_confirm_count || 0), Number(user.id) || null, row.id, row.supplier_key]);
    }
    await writeAudit(connection, { supplierKey: primary.key, aliasId: id, action: 'alias_update', user, before: auditSnapshot(current),
      after: auditSnapshot({ bill_text: billValue, unit_text: unitValue, product_id: productChanged ? product.id : current.product_id,
        product_name: productChanged ? product.name : current.product_name, is_active: current.is_active }) });
  });
  const result = await aliasById(db, id);
  if (!result) throw createReceivingError('NOT_FOUND', 'ไม่พบชื่อย่อของร้านนี้');
  return result;
}

export async function setSupplierAliasActive(db, { user, key, aliasId, active }) {
  assertSupplierManager(user);
  const target = parseSupplierKey(key);
  const id = positiveId(aliasId, 'ชื่อย่อ');
  const { primary, keys } = await resolveFamily(db, target);
  await transaction(db, async connection => {
    const current = await lockedAlias(connection, id, keys);
    const mirrors = (await lockedMirrors(connection, current, keys)).filter(row => (Number(row.is_active ?? 1) !== 0) !== active);
    if (!mirrors.length) return;
    for (const row of mirrors) {
      await connection.query('UPDATE supplier_product_aliases SET is_active = ?, updated_by_user_id = ? WHERE id = ? AND supplier_key = ?',
        [active ? 1 : 0, Number(user.id) || null, row.id, row.supplier_key]);
    }
    await writeAudit(connection, { supplierKey: primary.key, aliasId: id, action: active ? 'alias_enable' : 'alias_disable', user,
      before: auditSnapshot({ ...current, is_active: active ? 0 : 1 }), after: auditSnapshot({ ...current, is_active: active ? 1 : 0 }) });
  });
  const result = await aliasById(db, id);
  if (!result) throw createReceivingError('NOT_FOUND', 'ไม่พบชื่อย่อของร้านนี้');
  return result;
}
