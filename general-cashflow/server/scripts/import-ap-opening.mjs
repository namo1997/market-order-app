import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { migrateAp } from '../src/ap/schema.js';
import { monthRange, validateJournal } from '../src/ap/domain.js';
import { parseOpeningCsv, openingJournals, openingTemplate } from '../src/ap/opening.js';
import { assertLocalSocket } from './import-ap-snapshot.mjs';
import { loadApBundle, buildApReport } from '../src/ap/report.js';
import { readSnapshot, compileSnapshot } from '../src/ap/snapshot.js';

const SSD = '/Volumes/SSD Files/SOLAO/cashflow/';
const object = value => typeof value === 'string' ? JSON.parse(value) : value;
async function ssdFile(file) {
  const real = await fs.realpath(file);
  if (!real.startsWith(SSD)) throw new Error('AP_LOCAL_PATH_REQUIRED');
  return real;
}

export async function importApOpening(connection, csv, { month = '2026-09' } = {}) {
  await assertLocalSocket(connection);
  await migrateAp(connection);
  const { from } = monthRange(month);
  await connection.beginTransaction();
  try {
    // Serialize replacements on the immutable snapshot's batch, including the first import.
    const [[batch]] = await connection.query('SELECT id FROM ap_batches WHERE month_start=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [from]);
    if (!batch) throw new Error('AP_NOT_IMPORTED');
    const [controls] = await connection.query('SELECT * FROM ap_period_controls WHERE batch_id=? ORDER BY branch_code FOR UPDATE', [batch.id]);
    const [registry] = await connection.query('SELECT supplier_key AS `key`, branch_code AS branch, name, reference FROM ap_suppliers ORDER BY supplier_key');
    const suppliers = registry.filter(s => controls.some(c => c.branch_code === s.branch &&
      (!object(c.document).supplierKeys || object(c.document).supplierKeys.includes(s.key))));
    if (!controls.length || !suppliers.length) throw new Error('AP_OPENING_REGISTRY_MISSING');
    const input = parseOpeningCsv(csv, { suppliers, month });
    const [[prior]] = await connection.query('SELECT * FROM ap_opening_imports WHERE batch_id=? ORDER BY id DESC LIMIT 1', [batch.id]);
    if (prior?.fingerprint === input.fingerprint) {
      await connection.commit();
      return { id: prior.id, reused: true, fingerprint: input.fingerprint, missing: input.missing };
    }
    const [inserted] = await connection.query('INSERT INTO ap_opening_imports (batch_id,fingerprint,previous_id,document) VALUES (?,?,?,?)',
      [batch.id, input.fingerprint, prior?.id || null, JSON.stringify({ entries: input.entries })]);
    const id = inserted.insertId;
    const { journals, reversals } = openingJournals(input, { id, previous: prior ? object(prior.document).journals : [] });
    for (const c of controls) {
      const branch = c.branch_code, key = `ap:opening:${id}:${branch}`;
      const entries = input.entries.filter(e => e.branch === branch);
      await connection.query('INSERT INTO ap_sources (source_key,batch_id,branch_code,business_date,amount,source_type,document) VALUES (?,?,?,?,?,?,?)',
        [key, batch.id, branch, input.date, null, 'OPENING', JSON.stringify({ key, sourceType: 'OPENING', importId: id, fingerprint: input.fingerprint, entries })]);
      await connection.query('INSERT INTO ap_source_links (source_key,canonical_key,relation_type,reason) VALUES (?,?,?,?)',
        [key, key, 'OPENING_OWNER_INPUT', 'Owner CSV; replacement appends reversals, never deletes history']);
      const missing = input.missing.filter(s => s.branch === branch);
      const document = { ...object(c.document), opening: missing.length ? 'incomplete' : 'complete', openingImportId: id,
        openingFingerprint: input.fingerprint, openingDate: input.date, openingMissing: missing,
        openingConfirmed: entries.map(e => e.supplier), openingAgingBasis: 'AS_OF_DATE_ESTIMATE' };
      await connection.query('UPDATE ap_period_controls SET opening_complete=?,document=? WHERE batch_id=? AND branch_code=?',
        [missing.length === 0, JSON.stringify(document), batch.id, branch]);
    }
    for (const j of [...reversals, ...journals]) {
      validateJournal(j);
      await connection.query('INSERT INTO ap_journals (journal_key,source_key,business_date,branch_code,journal_type,due_date,reverses_key,description,flags) VALUES (?,?,?,?,?,?,?,?,?)',
        [j.key,j.sourceKey,j.date,j.branch,j.type,j.dueDate,j.reverses || null,j.description,JSON.stringify(j.flags)]);
      for (const [n,l] of j.lines.entries()) await connection.query('INSERT INTO ap_journal_lines (journal_key,line_no,account_code,supplier_key,debit,credit) VALUES (?,?,?,?,?,?)',
        [j.key,n+1,l.account,l.supplier,l.dr,l.cr]);
    }
    await connection.query('UPDATE ap_opening_imports SET document=? WHERE id=?', [JSON.stringify({ entries: input.entries, journals }), id]);
    await connection.commit();
    return { id, reused: false, fingerprint: input.fingerprint, posted: journals.length, reversed: reversals.length, missing: input.missing };
  } catch (error) { await connection.rollback(); throw error; }
}

export async function runOpeningImport({ csv, socket, output, month = '2026-09', database = 'ap_ledger_preview_202609' }) {
  if (!socket?.startsWith(SSD) || !/^ap_ledger_preview_[a-z0-9_]+$/.test(database)) throw new Error('AP_LOCAL_PATH_REQUIRED');
  await ssdFile(path.dirname(socket));
  await ssdFile(output);
  const bytes = await fs.readFile(await ssdFile(csv));
  const connection = await mysql.createConnection({ socketPath: socket, user: 'root', database, dateStrings: true, charset: 'utf8mb4' });
  try {
    const result = await importApOpening(connection, bytes, { month });
    const report = buildApReport(await loadApBundle(connection, month), { month });
    if (report.balance.difference !== '0.00') throw new Error('UNBALANCED_IMPORT');
    await fs.writeFile(path.join(output, 'ap-opening-report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(output, 'opening-import.json'), JSON.stringify(result, null, 2));
    return result;
  } finally { await connection.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).flatMap((value,i,all) => value.startsWith('--') ? [[value.slice(2),all[i+1]]] : []));
  try {
    if (args.template) {
      await ssdFile(path.dirname(args.template));
      const bundle = compileSnapshot(await readSnapshot(args.snapshot), args.month || '2026-09');
      await fs.writeFile(args.template, openingTemplate(bundle.suppliers, args.month || '2026-09'), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ template: args.template, rows: bundle.suppliers.length }));
    } else {
      const result = await runOpeningImport(args);
      console.log(JSON.stringify({ id: result.id, reused: result.reused, missingCount: result.missing.length }));
    }
  } catch (error) {
    console.error('AP opening import stopped:', /^[A-Z_]+$/.test(error.message) ? error.message : 'AP_OPENING_IMPORT_FAILED', error.csvRow ? `CSV row ${error.csvRow}` : '');
    process.exitCode = 1;
  }
}
