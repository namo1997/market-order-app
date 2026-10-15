import path from 'node:path';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { readSnapshot, compileSnapshot } from '../src/ap/snapshot.js';
import { migrateAp } from '../src/ap/schema.js';
import { monthRange, validateJournal } from '../src/ap/domain.js';
import { loadApBundle, buildApReport } from '../src/ap/report.js';

const SSD = '/Volumes/SSD Files/SOLAO/cashflow/';
export async function assertLocalSocket(connection) {
  const [[row]] = await connection.query('SELECT @@datadir AS datadir, @@socket AS socket, @@skip_networking AS offline');
  if (!row.datadir.startsWith(SSD) || !row.socket.startsWith(SSD) || !Number(row.offline)) throw new Error('AP_REQUIRES_OFFLINE_SSD_MYSQL');
}
export async function importAp(connection, bundle) {
  await assertLocalSocket(connection);
  await migrateAp(connection);
  const { from } = monthRange(bundle.metadata.month);
  await connection.beginTransaction();
  try {
    const [[existing]] = await connection.query('SELECT id FROM ap_batches WHERE fingerprint=?', [bundle.fingerprint]);
    if (existing) { await connection.commit(); return { id: existing.id, reused: true }; }
    // A different snapshot must not silently replace an immutable economic event.
    const [[prior]] = await connection.query('SELECT id FROM ap_batches WHERE month_start=? LIMIT 1', [from]);
    if (prior) throw new Error('AP_SNAPSHOT_CHANGED_REVIEW_REQUIRED');
    const [result] = await connection.query('INSERT INTO ap_batches (fingerprint,month_start,metadata) VALUES (?,?,?)', [bundle.fingerprint, from, JSON.stringify(bundle.metadata)]);
    const id = result.insertId;
    for (const a of bundle.metadata.accounts) await connection.query('INSERT IGNORE INTO ap_accounts (code,name,kind,native_account_id) VALUES (?,?,?,?)', [a.code, a.name, 'ASSET', a.nativeId]);
    for (const s of bundle.suppliers) await connection.query('INSERT IGNORE INTO ap_suppliers (supplier_key,branch_code,name,reference) VALUES (?,?,?,?)', [s.key,s.branch,s.name,s.reference]);
    for (const s of [...bundle.sources, ...bundle.statements.map(s => ({ ...s, sourceType: 'STATEMENT' }))]) {
      await connection.query('INSERT INTO ap_sources (source_key,batch_id,branch_code,business_date,amount,source_type,document) VALUES (?,?,?,?,?,?,?)', [s.key,id,s.branch,s.date,s.amount,s.sourceType,JSON.stringify(s)]);
      await connection.query('INSERT INTO ap_source_links (source_key,canonical_key,relation_type,reason) VALUES (?,?,?,?)', [s.key,s.key,s.sourceType === 'LBC' ? 'SAME_PNL_EVENT' : 'BANK_EVIDENCE', 'One canonical economic event; AP never added to existing P&L expense totals']);
      if (s.sourceType === 'LBC') await connection.query('INSERT INTO ap_match_cases (match_key,source_key,status,adapter_version,document) VALUES (?,?,?,?,?)', [`3way:${s.key}`,s.key,'pending','receiving-v1',JSON.stringify({ missing: ['order_items', 'receiving_documents', 'bill_items'], sourceKey: s.key })]);
    }
    for (const j of bundle.journals) {
      validateJournal(j);
      await connection.query('INSERT INTO ap_journals (journal_key,source_key,business_date,branch_code,journal_type,due_date,reverses_key,description,flags) VALUES (?,?,?,?,?,?,?,?,?)', [j.key,j.sourceKey,j.date,j.branch,j.type,j.dueDate,j.reverses || null,j.description,JSON.stringify(j.flags)]);
      for (const [n,l] of j.lines.entries()) await connection.query('INSERT INTO ap_journal_lines (journal_key,line_no,account_code,supplier_key,debit,credit) VALUES (?,?,?,?,?,?)', [j.key,n+1,l.account,l.supplier,l.dr,l.cr]);
    }
    for (const b of bundle.metadata.branches) await connection.query('INSERT INTO ap_period_controls (batch_id,branch_code,month_start,document) VALUES (?,?,?,?)', [id,b.code,from,JSON.stringify({ opening: 'missing', receiving: 'missing', payments: 'LBC observed; bank outgoing coverage missing' })]);
    await connection.commit();
    return { id, reused: false };
  } catch (error) { await connection.rollback(); throw error; }
}

export async function runImport({ snapshot, socket, output, month = '2026-09', database = 'ap_ledger_preview_202609' }) {
  if (!socket?.startsWith(SSD) || !output?.startsWith(SSD) || !/^ap_ledger_preview_[a-z0-9_]+$/.test(database)) throw new Error('AP_LOCAL_PATH_REQUIRED');
  if (!(await fs.realpath(path.dirname(socket))).startsWith(SSD) || !(await fs.realpath(output)).startsWith(SSD)) throw new Error('SSD_SYMLINK_ESCAPE');
  const bundle = compileSnapshot(await readSnapshot(snapshot), month);
  const connection = await mysql.createConnection({ socketPath: socket, user: 'root', dateStrings: true, charset: 'utf8mb4' });
  try {
    await assertLocalSocket(connection);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database });
    const result = await importAp(connection, bundle);
    const loaded = await loadApBundle(connection, month), report = buildApReport(loaded, { month });
    if (report.balance.difference !== '0.00') throw new Error('UNBALANCED_IMPORT');
    await fs.writeFile(path.join(output, 'ap-report.json'), JSON.stringify(report, null, 2));
    const stats = { ...result, fingerprint: bundle.fingerprint, sources: bundle.sources.length, statements: bundle.statements.length, journals: bundle.journals.length, balance: report.balance };
    await fs.writeFile(path.join(output, `import-${result.reused ? 'repeat' : 'first'}.json`), JSON.stringify(stats, null, 2));
    return stats;
  } finally { await connection.end(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs,[value.slice(2),all[i+1]]] : pairs, []));
  try { console.log(JSON.stringify(await runImport(args))); }
  catch (error) { console.error('AP import stopped:', /^[A-Z_]+$/.test(error.message) ? error.message : 'AP_IMPORT_FAILED'); process.exitCode = 1; }
}
