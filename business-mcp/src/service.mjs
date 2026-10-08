import {requireScope} from './config.mjs';
import {readMarket, readCashflow, callHrms, readLineRounds, readLineSnapshot} from './readers.mjs';

export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return value;
}
const bangkokDay = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const previousDay = () => new Date(Date.parse(`${bangkokDay()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
export function range(from, to) {
  const end = date(to || previousDay());
  const start = date(from || end);
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 31) throw new Error('Date range must be 0-31 days');
  return {from: start, to: end};
}
const failure = (source, branch, error) => ({source, branch, status: 'UNAVAILABLE', reason: error.message.replace(/https?:\/\/\S+/g, '[upstream]')});
const success = value => ({status: 'fulfilled', value});
const failed = reason => ({status: 'rejected', reason});
const settle = async task => {try {return success(await task());} catch (error) {return failed(error);}};
const maskNumbers = value => value == null ? null : String(value).replace(/\b\d{8,16}\b/g, digits => `••••${digits.slice(-4)}`);
const LINE_SUMMARY_FIELDS = ['snapshot_version', 'snapshot_created_at', 'bill_count', 'slip_count', 'pending_count', 'unmatched_count', 'needs_amount_count', 'orphan_page_count', 'processing_count', 'reimbursement_pending_count', 'unresolved_count', 'confirmed_count', 'confirmed_transfer_count', 'confirmed_cash_count', 'confirmed_bill_amount', 'confirmed_transfer_bill_amount', 'confirmed_slip_amount', 'confirmed_cash_amount', 'confirmed_payment_amount', 'incoming_transfer_count', 'incoming_transfer_amount'];

export function createService(config, client, readers = {readMarket, readCashflow, callHrms, readLineRounds, readLineSnapshot}) {
  const scoped = codes => requireScope(config, client, codes);
  const scopedRange = (from, to) => {
    const period = range(from, to);
    if (client.min_date && period.from < client.min_date || client.max_date && period.to > client.max_date) throw new Error('Date outside client scope');
    return period;
  };
  const describe = () => ({
    schema_version: '1.0', read_only: true, branches: client.branches,
    sources: [
      {name: 'MARKET_ORDER_CLICKHOUSE', date_kind: 'SALE_DATE', dimensions: ['branch', 'date', 'daily', 'product_group', 'top_item'], limits: ['AS_REPORTED', 'possible duplicates or lag']},
      {name: 'HRMS', date_kind: 'CALENDAR_YEAR_AND_LAST_7_DAYS', dimensions: ['branch', 'active_headcount', 'leave_status', 'attendance_review', 'person_if_authorized'], limits: ['not full requested range', 'person details separately authorized']},
      {name: 'GENERAL_CASHFLOW', date_kind: 'RECEIPT_DATE_AND_PRIOR_RESIDUALS', dimensions: ['branch', 'receipt', 'variance', 'channel', 'issues'], limits: ['stored POS snapshot', 'refunds unavailable', 'paginated residual candidates']},
      {name: 'LINE_BILL', date_kind: 'ROUND_DATE', dimensions: ['branch', 'round_status', 'closed_round_snapshot_if_authorized'], limits: ['open rounds status only', 'not actual expense or paid total']}
    ],
    rules: ['Null means unknown, never zero', 'Join only by verified IDs in BUSINESS_BRANCH_MAP_JSON', 'No write tool or arbitrary SQL', 'A missing source gives PARTIAL and missing_coverage']
  });

  async function overview(input = {}) {
    const branches = scoped(input.branches || []);
    const period = scopedRange(input.from, input.to);
    const day = period.to > previousDay() ? previousDay() : period.to;
    const tasks = branches.flatMap(branch => [
      {source: 'MARKET_ORDER_CLICKHOUSE', branch, run: () => readers.readMarket(config, branch, period.from, period.to)},
      {source: 'HRMS', branch, run: () => readers.callHrms(config, branch, 'hrms_overview', {year: Number(period.to.slice(0, 4)), include_inactive: false})},
      {source: 'LINE_BILL', branch, run: () => readers.readLineRounds(config, branch, period.from, period.to)}
    ]);
    const cashflow = day >= period.from ? await settle(() => readers.readCashflow(config, day, '0')) : failed(new Error('Cash Flow has no completed day in requested range'));
    const results = await Promise.all(tasks.map(t => settle(t.run)));
    const sources = [];
    const missing_coverage = [];
    for (let i = 0; i < tasks.length; i++) {
      const {source, branch} = tasks[i];
      const result = results[i];
      if (result.status === 'rejected') { const item = failure(source, branch.code, result.reason); sources.push(item); missing_coverage.push(item); continue; }
      const raw = result.value;
      if (source === 'MARKET_ORDER_CLICKHOUSE') sources.push({source, branch: branch.code, status: 'OK', period: raw.period, basis: raw.basis, summary: raw.summary, freshness: raw.freshness, limitations: raw.limitations});
      if (source === 'HRMS') sources.push({source, branch: branch.code, status: 'OK', period: {year: raw.year, attendance_window: 'LAST_7_DAYS'}, generated_at: raw.generated_at, active_headcount: raw.employee_status?.find(row => row.status === 'ACTIVE')?.count ?? null, leave_requests_by_status: raw.leave_requests_by_status ?? null, attendance_needs_review_last_7_days: raw.attendance_needs_review_last_7_days ?? null});
      if (source === 'LINE_BILL') {
        const incomplete = raw.pagination.next_offset !== null;
        const round_status_counts_on_page = {};
        for (const row of raw.data) {
          const key = ['open', 'closed'].includes(row.status) ? row.status : 'unknown';
          round_status_counts_on_page[key] = (round_status_counts_on_page[key] || 0) + 1;
        }
        sources.push({source, branch: branch.code, status: incomplete ? 'PARTIAL' : 'OK', period: {kind: 'ROUND_DATE', ...period}, round_count_on_page: raw.data.length, round_status_counts_on_page, next_offset: raw.pagination.next_offset, limitation: 'Round status only; no expense or payment total. Request business_read_line_rounds for individual rounds.'});
        if (incomplete) missing_coverage.push({source, branch: branch.code, reason: 'More round pages available'});
      }
    }
    for (const branch of branches) {
      if (!branch.cashflow_code) {const item = failure('GENERAL_CASHFLOW', branch.code, new Error('Cash Flow branch binding missing')); sources.push(item); missing_coverage.push(item); continue;}
      if (cashflow.status === 'rejected') {const item = failure('GENERAL_CASHFLOW', branch.code, cashflow.reason); sources.push(item); missing_coverage.push(item); continue;}
      const raw = cashflow.value;
      const rows = raw.rows.filter(row => row.branch_code === branch.cashflow_code && row.business_date >= period.from && row.business_date <= period.to);
      sources.push({source: 'GENERAL_CASHFLOW', branch: branch.code, status: raw.pagination.complete ? 'OK' : 'PARTIAL', period: {kind: 'RECEIPT_DATE', requested: period, source_day: raw.day}, generated_at: raw.generated_at, receipt_count_on_page: rows.filter(row => row.receipt_id !== null).length, missing_receipt_count_on_page: rows.filter(row => row.status === 'MISSING').length, variance_candidates_on_page: rows.filter(row => row.exceeds_100_thb).length, coverage: raw.coverage, next_cursor: raw.pagination.next_cursor});
      if (!raw.pagination.complete) missing_coverage.push({source: 'GENERAL_CASHFLOW', branch: branch.code, reason: 'More receipt pages available'});
    }
    return {schema_version: '1.0', read_only: true, status: missing_coverage.length ? 'PARTIAL' : 'OK', requested: {branches: branches.map(b => b.code), ...period}, generated_at: new Date().toISOString(), sources, missing_coverage};
  }

  async function analyze(input = {}) {
    const goal = input.goal;
    if (!['compare_current_headcount', 'compare_actual_reconciled_variance'].includes(goal)) throw new Error('Unsupported analysis goal');
    const branches = scoped(input.branches || []);
    const period = scopedRange(input.from, input.to);
    const observations = [];
    const missing_coverage = [];
    if (goal === 'compare_current_headcount') {
      const results = await Promise.all(branches.map(branch => settle(() => readers.callHrms(config, branch, 'hrms_overview', {year: Number(period.to.slice(0, 4)), include_inactive: false}))));
      for (let i = 0; i < branches.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {const item = failure('HRMS', branches[i].code, result.reason); observations.push({branch: branches[i].code, active_headcount: null, status: 'UNAVAILABLE'}); missing_coverage.push(item);}
        else observations.push({branch: branches[i].code, active_headcount: result.value.employee_status?.find(row => row.status === 'ACTIVE')?.count ?? null, year: result.value.year, status: 'OK'});
      }
    } else {
      const day = period.to > previousDay() ? previousDay() : period.to;
      const result = day >= period.from ? await settle(() => readers.readCashflow(config, day, '0')) : failed(new Error('Cash Flow has no completed day in requested range'));
      for (const branch of branches) {
        if (!branch.cashflow_code || result.status === 'rejected') {const item = failure('GENERAL_CASHFLOW', branch.code, result.status === 'rejected' ? result.reason : new Error('Cash Flow branch binding missing')); observations.push({branch: branch.code, variance_candidates_on_page: null, status: 'UNAVAILABLE'}); missing_coverage.push(item);}
        else {
          observations.push({branch: branch.code, variance_candidates_on_page: result.value.rows.filter(row => row.branch_code === branch.cashflow_code && row.business_date >= period.from && row.business_date <= period.to && row.exceeds_100_thb).length, source_day: day, next_cursor: result.value.pagination.next_cursor, status: result.value.pagination.complete ? 'OK' : 'PARTIAL'});
          if (!result.value.pagination.complete) missing_coverage.push({source: 'GENERAL_CASHFLOW', branch: branch.code, reason: 'More receipt pages available'});
        }
      }
    }
    return {schema_version: '1.0', read_only: true, goal, status: missing_coverage.length ? 'PARTIAL' : 'OK', observations, missing_coverage, interpretation: goal === 'compare_current_headcount' ? 'Current ACTIVE headcount; not historical headcount for requested date range' : 'Counts residual candidates on first page only; not a total variance or proof of resolution'};
  }

  async function sales(input) {
    const [branch] = scoped([input.branch]);
    const period = scopedRange(input.from, input.to);
    return {branch: branch.code, ...(await readers.readMarket(config, branch, period.from, period.to))};
  }

  async function lineRounds(input) {
    const [branch] = scoped([input.branch]);
    const period = scopedRange(input.from, input.to);
    const offset = input.offset || 0;
    const result = await readers.readLineRounds(config, branch, period.from, period.to, offset);
    return {source: 'LINE_BILL', branch: branch.code, status: result.pagination.next_offset === null ? 'OK' : 'PARTIAL', period, rounds: result.data.map(row => ({id: row.id, business_date: row.business_date, status: row.status, closed_at: row.closed_at, reopened_at: row.reopened_at, fingerprint: row.fingerprint})), pagination: result.pagination, limitation: 'Round status, not actual expense or payment total'};
  }

  async function lineSnapshot(input) {
    const [branch] = scoped([input.branch]);
    const roundDay = date(input.round_id.slice(input.round_id.lastIndexOf(':') + 1));
    scopedRange(roundDay, roundDay);
    const data = await readers.readLineSnapshot(config, branch, input.round_id);
    if (data.business_date !== roundDay) throw new Error('LINE Bill round date mismatch');
    const offset = input.item_offset || 0;
    const items = (data.items || []).slice(offset, offset + 100).map(item => ({id: item.id, bill_id: item.bill_id, business_date: item.business_date, supplier_name: maskNumbers(item.supplier_name), description: maskNumbers(item.description), amount_incl_vat: item.amount_incl_vat, payment_method: item.payment_method, evidence: item.evidence?.map(e => ({item_id: e.item_id, kind: e.kind, label: maskNumbers(e.label)})) || []}));
    const nextOffset = offset + items.length < (data.items?.length || 0) ? offset + items.length : null;
    const summary = Object.fromEntries(LINE_SUMMARY_FIELDS.map(key => [key, data.summary?.[key] ?? null]));
    return {source: 'LINE_BILL', branch: branch.code, status: nextOffset === null ? 'OK' : 'PARTIAL', basis: 'CLOSED_ROUND_SNAPSHOT_AS_REPORTED', business_date: data.business_date, revision: data.revision, fingerprint: data.fingerprint, summary, items, next_item_offset: nextOffset, limitations: ['ยอดใน snapshot ไม่ใช่หลักฐานยืนยันการจ่ายเงินจริง', 'วันจ่ายจาก source มี fallback จึงไม่ส่งเป็น paid_date']};
  }

  async function person(input) {
    const [branch] = scoped([input.branch]);
    if (!client.allow_person_details || !client.employee_ids?.includes(input.employee_id)) throw new Error('Person detail outside client scope');
    const period = scopedRange(input.from, input.to);
    const profile = await readers.callHrms(config, branch, 'get_employee_profile', {employee_id: input.employee_id, year: Number(period.to.slice(0, 4)), include_sensitive: false});
    const employee = profile.employee || profile.profile || profile;
    if (String(employee.id || employee.employee_id || '') !== String(input.employee_id)) throw new Error('HRMS employee ID mismatch');
    if (input.section === 'employees') return {source: 'HRMS', branch: branch.code, section: 'employees', result: profile};
    const employeeCode = employee.employee_code || employee.code;
    if (!employeeCode) throw new Error('HRMS employee code unavailable for detail read');
    const name = input.section === 'leave' ? 'list_leave_requests' : 'list_attendance';
    const args = input.section === 'leave' ? {employee_code: employeeCode, start_date: period.from, end_date: period.to, limit: 100, include_reason: false} : {employee_code: employeeCode, start_date: period.from, end_date: period.to, limit: 100, source: 'daily'};
    return {source: 'HRMS', branch: branch.code, section: input.section, period, result: await readers.callHrms(config, branch, name, args), limit: 100};
  }

  async function receipts(input) {
    const [branch] = scoped([input.branch]);
    const period = scopedRange(input.from, input.to);
    const day = period.to > previousDay() ? previousDay() : period.to;
    if (day < period.from) throw new Error('No completed Cash Flow day in range');
    const cursor = input.cursor ? JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) : {source: '0', index: 0, seen: []};
    if (!/^(0|[1-9]\d{0,9})$/.test(cursor.source) || !Number.isInteger(cursor.index) || cursor.index < 0 || !Array.isArray(cursor.seen) || cursor.seen.length > 1000) throw new Error('Invalid cursor');
    const raw = await readers.readCashflow(config, day, cursor.source);
    const seen = new Set(cursor.seen);
    const rows = raw.rows.filter(row => row.branch_code === branch.cashflow_code && row.business_date >= period.from && row.business_date <= period.to);
    const page = rows.slice(cursor.index, cursor.index + input.limit);
    for (const row of page) {
      if (row.receipt_id == null) continue;
      const id = String(row.receipt_id);
      if (seen.has(id)) throw new Error('Duplicate receipt across pages');
      seen.add(id);
    }
    const next = cursor.index + page.length < rows.length ? {source: cursor.source, index: cursor.index + page.length, seen: [...seen]} : raw.pagination.next_cursor ? {source: raw.pagination.next_cursor, index: 0, seen: [...seen]} : null;
    return {source: 'GENERAL_CASHFLOW', branch: branch.code, day, period, status: next ? 'PARTIAL' : 'OK', rows: input.receipt_id ? page.filter(row => String(row.receipt_id) === input.receipt_id) : page, coverage: raw.coverage, next_cursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null};
  }

  async function findings(input = {}) {
    const branches = scoped(input.branches || []);
    const period = scopedRange(input.from, input.to);
    const day = period.to > previousDay() ? previousDay() : period.to;
    const result = day >= period.from ? await settle(() => readers.readCashflow(config, day, '0')) : failed(new Error('Cash Flow has no completed day in range'));
    const rows = [];
    const missing_coverage = [];
    for (const branch of branches) {
      if (!branch.cashflow_code || result.status === 'rejected') {missing_coverage.push(failure('GENERAL_CASHFLOW', branch.code, result.status === 'rejected' ? result.reason : new Error('Cash Flow branch binding missing'))); continue;}
      for (const receipt of result.value.rows.filter(r => r.branch_code === branch.cashflow_code && r.business_date >= period.from && r.business_date <= period.to)) {
        const kind = receipt.status === 'MISSING' ? 'MISSING_RECEIPT' : receipt.exceeds_100_thb ? 'VARIANCE_CANDIDATE' : null;
        if (!kind) continue;
        rows.push({id: `cashflow:${branch.code}:${receipt.business_date}:${receipt.receipt_id ?? 'missing'}:${kind}`, source: 'GENERAL_CASHFLOW', branch: branch.code, business_date: receipt.business_date, kind, receipt_id: receipt.receipt_id, observed: kind === 'VARIANCE_CANDIDATE' ? {actual_reconciled_variance: receipt.actual_reconciled_variance ?? null, issues: receipt.issues ?? []} : {status: 'MISSING'}, state: 'REQUIRES_REVIEW', source_generated_at: result.value.generated_at});
      }
      if (!result.value.pagination.complete) missing_coverage.push({source: 'GENERAL_CASHFLOW', branch: branch.code, reason: 'More receipt pages available'});
    }
    return {schema_version: '1.0', read_only: true, status: missing_coverage.length ? 'PARTIAL' : 'OK', generated_at: new Date().toISOString(), requested: {branches: branches.map(b => b.code), ...period}, findings: rows, missing_coverage, limitations: ['ข้อสังเกตคำนวณจากการอ่านปัจจุบัน ไม่มีประวัติสถานะถาวร', 'ผลต่างเป็น candidate ต้องให้ผู้รับผิดชอบตรวจหลักฐาน', 'อ่านหน้าแรกเท่านั้น หากมี cursor ต้องอ่านรายละเอียดต่อ']};
  }

  async function finding(input) {
    const match = /^cashflow:([A-Z0-9_-]{1,24}):(\d{4}-\d{2}-\d{2}):(missing|\d+):(MISSING_RECEIPT|VARIANCE_CANDIDATE)$/.exec(input.finding_id);
    if (!match) throw new Error('Invalid finding ID');
    const [, code, businessDate, id, kind] = match;
    const [branch] = scoped([code]);
    scopedRange(businessDate, businessDate);
    if (!branch.cashflow_code) throw new Error('Cash Flow branch binding missing');
    let cursor = '0';
    const visited = new Set();
    for (let page = 0; page < 10; page++) {
      if (visited.has(cursor)) throw new Error('Cash Flow cursor cycle');
      visited.add(cursor);
      const raw = await readers.readCashflow(config, businessDate, cursor);
      const row = raw.rows.find(r => r.branch_code === branch.cashflow_code && r.business_date === businessDate && String(r.receipt_id ?? 'missing') === id);
      if (row) {
        const stillPresent = kind === 'MISSING_RECEIPT' ? row.status === 'MISSING' : row.exceeds_100_thb === true;
        return {schema_version: '1.0', read_only: true, id: input.finding_id, status: stillPresent ? 'REQUIRES_REVIEW' : 'NOT_REPRODUCED_ON_CURRENT_READ', source_generated_at: raw.generated_at, evidence: row, interpretation: 'Current source evidence only; not a persisted resolution decision'};
      }
      if (raw.pagination.next_cursor === null) return {schema_version: '1.0', read_only: true, id: input.finding_id, status: 'NOT_REPRODUCED_ON_CURRENT_READ', evidence: null, interpretation: 'No source row found in complete current read; human recheck required'};
      cursor = raw.pagination.next_cursor;
    }
    return {schema_version: '1.0', read_only: true, id: input.finding_id, status: 'PARTIAL', evidence: null, next_source_cursor: cursor, interpretation: 'Stopped after 10 pages; not enough evidence to determine current state'};
  }

  return {describe, overview, analyze, sales, lineRounds, lineSnapshot, person, receipts, findings, finding};
}
