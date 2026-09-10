import { canonicalRevision } from './accountingExportReceivables.js';
import { fetchAccountingExportRows, logAudit } from './db.js';
import {
  MONTHLY_CLOSE_SOURCE_TYPES,
  buildCompanyMonthlySummary,
  buildMonthlySalesCloseSnapshot,
  monthlyCloseError,
  monthlyClosePublicPreview,
  parseMonthlyCloseMonth,
  todayBangkok
} from './domain/monthlySalesClose.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const BRANCH_RE = /^[A-Z0-9_-]{1,20}$/;
const DATASET_ALIASES = Object.freeze({
  daily_sales: 'pos_daily_sale',
  daily_receipts: 'receipt_day',
  receipt_lines: 'receipt_expectation',
  settlements: 'cash_settlement',
  adjustments: 'receivable_adjustment',
  payment_channels: 'payment_channel',
  receiving_accounts: 'receiving_account'
});

const CLOSE_MANIFEST_COLUMNS = `msc.id, msc.close_id, msc.schema_version, msc.month_start, msc.month_end,
  msc.branch_id, msc.revision_number, msc.close_revision, msc.revision_of,
  msc.source_snapshot_sha256, msc.summary_snapshot, msc.readiness_snapshot,
  msc.section_manifest, msc.note, msc.closed_by, msc.closed_at`;

const json = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const operationalBranches = async (connection) => {
  const [rows] = await connection.query(
    `SELECT id, code, name
     FROM branches
     WHERE is_active = TRUE AND clickhouse_branch_id IS NOT NULL AND clickhouse_branch_id <> ''
     ORDER BY code`
  );
  return rows.map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) }));
};

const selectBranches = (branches, selector = 'ALL') => {
  const branch = String(selector || 'ALL').toUpperCase();
  if (branch === 'ALL') return branches;
  if (!BRANCH_RE.test(branch)) throw monthlyCloseError('INVALID_BRANCH', 'รหัสสาขาไม่ถูกต้อง');
  const selected = branches.find((row) => row.code === branch);
  if (!selected) throw monthlyCloseError('INVALID_BRANCH', 'ไม่พบสาขาที่ใช้งานสำหรับปิดยอดรายเดือน');
  return [selected];
};

const loadDatasets = async ({ connection, period, branch, loadRows = fetchAccountingExportRows }) => Object.fromEntries(await Promise.all(
  MONTHLY_CLOSE_SOURCE_TYPES.map(async (sourceType) => [sourceType, await loadRows({
    connection,
    sourceType,
    from: period.from,
    to: period.to,
    branch: branch.code
  })])
));

const latestRowsForMonth = async (connection, monthStart, branchIds = []) => {
  if (!branchIds.length) return [];
  const [rows] = await connection.query(
    `SELECT ${CLOSE_MANIFEST_COLUMNS}, b.code AS branch_code, b.name AS branch_name
     FROM monthly_sales_closes msc
     JOIN branches b ON b.id = msc.branch_id
     WHERE msc.month_start = ? AND msc.branch_id IN (?)
     ORDER BY msc.branch_id, msc.revision_number DESC`,
    [monthStart, branchIds]
  );
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(Number(row.branch_id))) return false;
    seen.add(Number(row.branch_id));
    return true;
  });
};

export const monthlyCloseManifest = (row) => row ? {
  close_id: String(row.close_id),
  schema_version: String(row.schema_version || '1.0'),
  source: 'GENERAL_CASHFLOW',
  source_type: 'monthly_sales_close',
  period: {
    month: String(row.month_start).slice(0, 7),
    from: String(row.month_start).slice(0, 10),
    to: String(row.month_end).slice(0, 10),
    timezone: 'Asia/Bangkok'
  },
  branch: { id: Number(row.branch_id), code: String(row.branch_code), name: String(row.branch_name) },
  revision_number: Number(row.revision_number),
  revision: String(row.close_revision),
  revision_of: row.revision_of || null,
  source_snapshot_sha256: String(row.source_snapshot_sha256),
  status: 'CLOSED_READY',
  summary: json(row.summary_snapshot, {}),
  readiness: json(row.readiness_snapshot, {}),
  closed_at: String(row.closed_at).replace(' ', 'T') + (String(row.closed_at).includes('T') ? '' : '+07:00'),
  note: row.note || null,
  sections: json(row.section_manifest, {})
} : null;

const snapshotSectionManifest = (snapshot) => Object.fromEntries(Object.entries(snapshot.datasets).map(([sourceType, rows]) => [sourceType, {
  count: rows.length,
  sha256: canonicalRevision({ source_type: sourceType, data: rows })
}]));

const currentSnapshot = async ({ connection, month, branch, loadRows, today }) => {
  const period = parseMonthlyCloseMonth(month);
  const datasets = await loadDatasets({ connection, period, branch, loadRows });
  return buildMonthlySalesCloseSnapshot({ month, branch, datasets, today });
};

export const previewMonthlySalesCloses = async (pool, { month, branch = 'ALL', clock = new Date(), loadRows } = {}) => {
  const period = parseMonthlyCloseMonth(month);
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    const branches = selectBranches(await operationalBranches(connection), branch);
    const latestRows = await latestRowsForMonth(connection, period.from, branches.map((row) => row.id));
    const latestByBranch = new Map(latestRows.map((row) => [Number(row.branch_id), monthlyCloseManifest(row)]));
    const previews = [];
    for (const item of branches) {
      const snapshot = await currentSnapshot({ connection, month: period.month, branch: item, loadRows, today: todayBangkok(clock) });
      previews.push(monthlyClosePublicPreview(snapshot, latestByBranch.get(item.id) || null));
    }
    await connection.commit();
    return {
      schema_version: '1.0',
      source: 'GENERAL_CASHFLOW',
      source_type: 'monthly_sales_close_preview',
      period: { month: period.month, from: period.from, to: period.to, timezone: 'Asia/Bangkok' },
      branches: previews,
      company: buildCompanyMonthlySummary({
        month: period.month,
        branches: previews.map((row) => ({
          ...row,
          latest_close: row.latest_close?.source_snapshot_sha256 === row.source_snapshot_sha256 ? row.latest_close : null
        }))
      })
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const closeMonthlySales = async (pool, { month, branchCode, previewRevision, note = '', actor, clock = new Date(), loadRows } = {}) => {
  const period = parseMonthlyCloseMonth(month);
  const branchSelector = String(branchCode || '').toUpperCase();
  if (!SHA256_RE.test(String(previewRevision || ''))) throw monthlyCloseError('PREVIEW_REQUIRED', 'กรุณาเปิด Preview ล่าสุดก่อนปิดยอดเดือน', 409);
  const cleanNote = String(note || '').trim();
  if (cleanNote.length > 1000) throw monthlyCloseError('NOTE_TOO_LONG', 'หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const branches = selectBranches(await operationalBranches(connection), branchSelector);
    if (branches.length !== 1) throw monthlyCloseError('INVALID_BRANCH', 'ต้องปิดยอดทีละสาขา');
    const branch = branches[0];
    await connection.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branch.id]);
    const [latestRows] = await connection.query(
      `SELECT * FROM monthly_sales_closes
       WHERE month_start = ? AND branch_id = ?
       ORDER BY revision_number DESC LIMIT 1 FOR UPDATE`,
      [period.from, branch.id]
    );
    const latest = latestRows[0] || null;
    const snapshot = await currentSnapshot({ connection, month: period.month, branch, loadRows, today: todayBangkok(clock) });
    if (snapshot.source_snapshot_sha256 !== previewRevision) throw monthlyCloseError('STALE_PREVIEW', 'ข้อมูลเปลี่ยนหลังเปิด Preview กรุณาตรวจรายการล่าสุดอีกครั้ง', 409, { current_revision: snapshot.source_snapshot_sha256 });
    if (!snapshot.ready_to_close) throw monthlyCloseError('MONTH_NOT_READY', 'ยังปิดยอดรายเดือนไม่ได้', 409, { blockers: snapshot.blockers });
    if (latest?.source_snapshot_sha256 === snapshot.source_snapshot_sha256) {
      await connection.commit();
      return { duplicate: true, close: monthlyCloseManifest({ ...latest, branch_code: branch.code, branch_name: branch.name }) };
    }
    const revisionNumber = Number(latest?.revision_number || 0) + 1;
    const closeId = `gc-month-close:${branch.code}:${period.month}:r${revisionNumber}`;
    const revisionOf = latest?.close_revision || null;
    const closeRevision = canonicalRevision({ close_id: closeId, revision_of: revisionOf, source_snapshot_sha256: snapshot.source_snapshot_sha256 });
    const sectionManifest = snapshotSectionManifest(snapshot);
    const [result] = await connection.query(
      `INSERT INTO monthly_sales_closes
       (close_id, schema_version, month_start, month_end, branch_id, revision_number, close_revision,
        revision_of, source_snapshot_sha256, summary_snapshot, readiness_snapshot, section_manifest,
        export_snapshot, note, closed_by, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [closeId, snapshot.schema_version, period.from, period.to, branch.id, revisionNumber, closeRevision,
        revisionOf, snapshot.source_snapshot_sha256, JSON.stringify(snapshot.summary),
        JSON.stringify({ completeness: snapshot.completeness, blockers: snapshot.blockers, warnings: snapshot.warnings }),
        JSON.stringify(sectionManifest), JSON.stringify(snapshot.datasets), cleanNote || null, Number(actor.id)]
    );
    await logAudit({
      connection,
      entityType: 'monthly_sales_close',
      entityId: Number(result.insertId),
      action: 'close',
      actor,
      afterPayload: { close_id: closeId, month: period.month, branch_code: branch.code, revision_number: revisionNumber, close_revision: closeRevision, source_snapshot_sha256: snapshot.source_snapshot_sha256, summary: snapshot.summary },
      note: cleanNote || null
    });
    const [[created]] = await connection.query(
      `SELECT msc.*, b.code AS branch_code, b.name AS branch_name
       FROM monthly_sales_closes msc JOIN branches b ON b.id = msc.branch_id
       WHERE msc.id = ?`, [Number(result.insertId)]
    );
    await connection.commit();
    return {
      duplicate: false,
      close: monthlyCloseManifest(created)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const parseExportQuery = (query = {}, { requireSection = false } = {}) => {
  const period = parseMonthlyCloseMonth(query.month);
  const branch = String(query.branch || 'ALL').toUpperCase();
  if (branch !== 'ALL' && !BRANCH_RE.test(branch)) throw monthlyCloseError('INVALID_BRANCH', 'รหัสสาขาไม่ถูกต้อง');
  const revisionText = query.revision === undefined || query.revision === '' ? '' : String(query.revision);
  if (revisionText && (!/^\d+$/.test(revisionText) || Number(revisionText) < 1)) throw monthlyCloseError('INVALID_REVISION', 'revision ต้องเป็นเลขตั้งแต่ 1 ขึ้นไป');
  const section = requireSection ? DATASET_ALIASES[String(query.section || '')] : null;
  if (requireSection && !section) throw monthlyCloseError('INVALID_SECTION', `section ต้องเป็น ${Object.keys(DATASET_ALIASES).join(', ')}`);
  const limitText = query.limit === undefined || query.limit === '' ? '100' : String(query.limit);
  const offsetText = query.offset === undefined || query.offset === '' ? '0' : String(query.offset);
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 500 || !/^\d+$/.test(offsetText)) throw monthlyCloseError('INVALID_PAGINATION', 'limit ต้องอยู่ระหว่าง 1-500 และ offset ต้องไม่ติดลบ');
  return { period, branch, revision: revisionText ? Number(revisionText) : null, section, limit: Number(limitText), offset: Number(offsetText) };
};

const loadCloseRows = async (connection, { period, branch, revision }, { includeExportSnapshot = false } = {}) => {
  const params = [period.from];
  let where = 'msc.month_start = ?';
  if (branch !== 'ALL') { where += ' AND b.code = ?'; params.push(branch); }
  if (revision) { where += ' AND msc.revision_number = ?'; params.push(revision); }
  const [rows] = await connection.query(
    `SELECT ${CLOSE_MANIFEST_COLUMNS}${includeExportSnapshot ? ', msc.export_snapshot' : ''},
            b.code AS branch_code, b.name AS branch_name
     FROM monthly_sales_closes msc JOIN branches b ON b.id = msc.branch_id
     WHERE ${where} ORDER BY b.code, msc.revision_number DESC`, params
  );
  if (revision) return rows;
  const seen = new Set();
  return rows.filter((row) => seen.has(Number(row.branch_id)) ? false : (seen.add(Number(row.branch_id)), true));
};

export const exportMonthlySalesCloses = async (pool, query = {}) => {
  const parsed = parseExportQuery(query);
  const connection = await pool.getConnection();
  try {
    const branches = selectBranches(await operationalBranches(connection), parsed.branch);
    const rows = await loadCloseRows(connection, parsed);
    if (parsed.branch !== 'ALL' && !rows.length) throw monthlyCloseError('MONTHLY_CLOSE_NOT_FOUND', 'ไม่พบชุดปิดยอดรายเดือน', 404);
    const manifests = rows.map(monthlyCloseManifest);
    const previewRows = branches.map((branch) => ({ branch, latest_close: manifests.find((row) => row.branch.code === branch.code) || null }));
    return {
      schema_version: '1.0', source: 'GENERAL_CASHFLOW', source_type: 'monthly_sales_close',
      data: manifests,
      company: buildCompanyMonthlySummary({ month: parsed.period.month, branches: previewRows })
    };
  } finally {
    connection.release();
  }
};

export const exportMonthlySalesCloseData = async (pool, query = {}) => {
  const parsed = parseExportQuery(query, { requireSection: true });
  if (parsed.branch === 'ALL') throw monthlyCloseError('INVALID_BRANCH', 'ข้อมูลรายละเอียดต้องระบุสาขา');
  const connection = await pool.getConnection();
  try {
    selectBranches(await operationalBranches(connection), parsed.branch);
    const rows = await loadCloseRows(connection, parsed, { includeExportSnapshot: true });
    if (!rows.length) throw monthlyCloseError('MONTHLY_CLOSE_NOT_FOUND', 'ไม่พบชุดปิดยอดรายเดือน', 404);
    if (rows.length > 1 && parsed.revision) throw monthlyCloseError('MONTHLY_CLOSE_AMBIGUOUS', 'พบชุดข้อมูลมากกว่าหนึ่งรายการ', 409);
    const row = rows[0];
    const datasets = json(row.export_snapshot, {});
    const data = Array.isArray(datasets[parsed.section]) ? datasets[parsed.section] : [];
    const page = data.slice(parsed.offset, parsed.offset + parsed.limit);
    return {
      schema_version: '1.0', source: 'GENERAL_CASHFLOW', source_type: parsed.section,
      monthly_close: monthlyCloseManifest(row),
      data: page,
      pagination: { limit: parsed.limit, offset: parsed.offset, total: data.length, next_offset: parsed.offset + page.length < data.length ? parsed.offset + page.length : null }
    };
  } finally {
    connection.release();
  }
};
