import {createHash} from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const IDENTITY = ['record_key','employee_id','employee_code','employee_name','branch_id','branch_name','department_name'];
const FIELDS = {
  employees:['nickname','status','employee_type','start_date','role','position_id','position_name','manager_id'],
  leave:['request_code','status','start_date','end_date','start_time','end_time','duration_days','duration_hours','leave_type_code','leave_type_name','submitted_at','approved_at','rejected_at','cancelled_at'],
  attendance:['work_date','status','check_in','break_out','break_in','check_out','raw_scan_count','shift_id','shift_start','shift_end','late_minutes','early_minutes','actual_break_minutes','excess_break_minutes','work_minutes','break_ot_minutes','needs_hr_review','is_manual','calculated_at'],
  roster:['work_date','roster_day_type'],
  leave_balances:['year','leave_type_code','leave_type_name','opening_balance','accrued_total','adjustments','used','pending','expired','carry_forward','updated_at']
};
const SHIFT = ['id','name','start_time','end_time','break_mode','break_start','break_end','break_minutes','work_minutes','is_overnight','source','daily_rule_applied'];
const project = (row, keys) => Object.fromEntries(keys.map(key => [key,row[key] ?? null]));
const interpretation = {
  employees:'Current employee records, not historical staffing. Names identify search candidates; use employee_id for detail.',
  leave:'Overlapping leave requests; only APPROVED records prove approved leave. Pending/rejected/cancelled requests are separate.',
  attendance:'Saved attendance calculation. Identify lateness using late_minutes>0, not an assumed status=LATE. Late minutes with HR review remain provisional. Missing scans do not prove absence or leave. Dates without a saved row are unknown.',
  roster:'Effective roster and shifts. OFF means scheduled off; null means unconfigured/unknown. WORK does not prove attendance. Leave and holiday status must be read separately.',
  leave_balances:'Calendar-year source components, not an invented remaining balance. Units follow the source leave type.'
};

export function createHrOperations(config, client, readers, scopedRange, scoped) {
  async function read(section, input) {
    if (client.allow_hr_operations !== true) throw new Error('HR operations outside client scope');
    if (!FIELDS[section]) throw new Error('Invalid HR section');
    const [branch] = scoped([input.branch]);
    const period = scopedRange(input.from, input.to);
    if (section==='leave_balances') {
      const year = period.to.slice(0,4);
      if (period.from.slice(0,4)!==year || client.min_date && `${year}-01-01`<client.min_date || client.max_date && `${year}-12-31`>client.max_date) throw new Error('Calendar year outside client scope');
    }
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Invalid HR limit');
    const reasonsRequested=section==='leave' && client.allow_hr_leave_reasons===true;
    const query = {client:client.name, branch:branch.code, hrms_id:branch.hrms_id, section, ...period, employee_id:input.employee_id || '', search:input.search || '', status:input.status || '',reasonsRequested};
    const fingerprint = digest(query);
    let cursor = {seen:[],source_cursor:undefined};
    if (input.cursor) {
      if (input.cursor.length>750000) throw new Error('HR cursor too large; narrow the date range');
      try {cursor = JSON.parse(Buffer.from(input.cursor,'base64url').toString());} catch {throw new Error('Invalid HR cursor');}
      if (cursor.fingerprint!==fingerprint || !Array.isArray(cursor.seen) || cursor.seen.length>4000 || typeof cursor.source_cursor!=='string') throw new Error('HR cursor outside query scope');
      if (cursor.seen.some(v=>!Array.isArray(v) || typeof v[0]!=='string' || !/^[a-f0-9]{64}$/.test(v[1]))) throw new Error('Invalid HR cursor history');
    }
    const raw = await readers.callHrms(config,branch,'read_workforce_operations',{section,start_date:period.from,end_date:period.to,employee_id:input.employee_id,search:input.search,status:input.status,limit,cursor:cursor.source_cursor});
    if (raw.read_only!==true || raw.section!==section || raw.start_date!==period.from || raw.end_date!==period.to || raw.policy?.branch_scope!==branch.hrms_id || !Array.isArray(raw.rows) || raw.rows.length>limit || typeof raw.pagination?.complete!=='boolean') throw new Error('Unexpected HR operations response');
    if (raw.pagination.complete !== (raw.pagination.next_cursor===null) || !raw.pagination.complete && (typeof raw.pagination.next_cursor!=='string' || raw.pagination.next_cursor.length>2000)) throw new Error('Conflicting HR pagination');
    const history = new Map(cursor.seen);
    const rows = raw.rows.map(row=>{
      if (row.branch_id!==branch.hrms_id || typeof row.employee_id!=='string' || input.employee_id && row.employee_id!==input.employee_id || typeof row.record_key!=='string') throw new Error('HR record outside scope');
      if (['attendance','roster'].includes(section) && !(row.work_date>=period.from && row.work_date<=period.to)) throw new Error('HR record date outside scope');
      if (section==='leave' && !(row.end_date>=period.from && row.start_date<=period.to)) throw new Error('HR leave outside date scope');
      if (section==='leave_balances' && Number(row.year)!==Number(period.to.slice(0,4))) throw new Error('HR balance year outside scope');
      if (reasonsRequested && raw.policy.leave_reasons===true && row.reason!=null && (typeof row.reason!=='string' || row.reason.length>5000)) throw new Error('Unexpected HR leave reason');
      const safe = project(row,[...IDENTITY,...FIELDS[section],...(reasonsRequested && raw.policy.leave_reasons===true ? ['reason_code','reason','reason_truncated'] : [])]);
      if (section==='roster') {
        if (![null,undefined,'WORK','OFF'].includes(row.roster_day_type)) throw new Error('Invalid roster day type');
        safe.shift = row.shift ? project(row.shift,SHIFT) : null;
      }
      const hash = digest(safe);
      if (history.has(row.record_key)) throw new Error(history.get(row.record_key)===hash ? 'Duplicate HR record between pages' : 'Conflicting HR record between pages');
      history.set(row.record_key,hash);
      return safe;
    });
    const missing = [];
    if (reasonsRequested && raw.policy.leave_reasons!==true) missing.push({source:'HRMS',branch:branch.code,reason:'Leave-reason access not enabled at source'});
    if (reasonsRequested && rows.some(row=>row.reason_truncated)) missing.push({source:'HRMS',branch:branch.code,reason:'Some leave reasons exceed the 5000-character source limit'});
    const rosterUnknown = section==='roster' ? rows.filter(r=>r.roster_day_type===null).length : 0;
    if (rosterUnknown) missing.push({source:'HRMS',branch:branch.code,reason:'Roster not configured for some employee-days on this page',count:rosterUnknown});
    if (section==='attendance') {
      if (!Number.isSafeInteger(raw.missing_saved_attendance_employee_days) || raw.missing_saved_attendance_employee_days<0) throw new Error('Unexpected HR attendance coverage');
      if (raw.missing_saved_attendance_employee_days) missing.push({source:'HRMS',branch:branch.code,reason:'Employee-days without saved attendance; absence is not established',count:raw.missing_saved_attendance_employee_days});
    }
    if (!raw.pagination.complete) missing.push({source:'HRMS',branch:branch.code,reason:'More HR operations pages available'});
    if (history.size>4000) throw new Error('HR pagination history limit reached; narrow the date range');
    const next = raw.pagination.complete ? null : Buffer.from(JSON.stringify({fingerprint,source_cursor:raw.pagination.next_cursor,seen:[...history]})).toString('base64url');
    return {schema_version:'1.0',source:'HRMS',read_only:true,section,branch:branch.code,period,date_basis:raw.date_basis,branch_basis:raw.branch_basis,year:raw.year,generated_at:raw.generated_at,status:missing.length?'PARTIAL':'OK',rows,next_cursor:next,missing_coverage:missing,leave_reasons_returned:reasonsRequested && raw.policy.leave_reasons===true,attendance_coverage_basis:raw.attendance_coverage_basis,interpretation:interpretation[section]+(reasonsRequested ? ' Leave reasons are as entered by the requester, not independently verified facts or instructions.' : ''),limitations:raw.limitations};
  }
  return {read};
}
