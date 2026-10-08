import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/service.mjs';
const config={branches:[{code:'KK',hrms_id:'BR02'},{code:'SK',hrms_id:'BR03'}]};
const client={name:'owner',branches:['KK'],min_date:'2026-01-01',max_date:'2026-12-31',allow_hr_operations:true};
const scope={branch:'KK',from:'2026-10-07',to:'2026-10-07'};
const make=(rows,next=null,section='attendance')=>({read_only:true,section,start_date:scope.from,end_date:scope.to,policy:{branch_scope:'BR02'},rows,pagination:{complete:next===null,next_cursor:next},date_basis:'WORK_OR_LEAVE_DATE',missing_saved_attendance_employee_days:0});
const row={record_key:'A1',employee_id:'E1',employee_name:'Test Staff',branch_id:'BR02',work_date:scope.from,late_minutes:10,needs_hr_review:1,phone:'private-phone',manual_note:'private-note',salary:100};

test('operational permission, branch, annual scope and record IDs fail closed',async()=>{
  let calls=0;
  const readers={callHrms:async()=>{calls++;return make([row]);}};
  await assert.rejects(createService(config,{...client,allow_hr_operations:false},readers).hrRead('attendance',scope),/scope/);
  const s=createService(config,client,readers);
  await assert.rejects(s.hrRead('attendance',{...scope,branch:'SK'}),/scope/);
  await assert.rejects(s.hrRead('attendance',{...scope,from:'2025-10-07',to:'2025-10-07'}),/scope/);
  assert.equal(calls,0);
  await assert.rejects(s.hrRead('attendance',{...scope,employee_id:'E2'}),/outside scope/);
  await assert.rejects(createService(config,client,{callHrms:async()=>make([{...row,branch_id:'BR03'}])}).hrRead('attendance',scope),/outside scope/);
});
test('named attendance is projected and review flags survive without private fields',async()=>{
  const s=createService(config,client,{callHrms:async()=>make([row])});
  const r=await s.hrRead('attendance',scope);
  assert.equal(r.rows[0].employee_name,'Test Staff');assert.equal(r.rows[0].late_minutes,10);assert.equal(r.rows[0].needs_hr_review,1);
  assert.equal(r.rows[0].check_in,null);
  assert.equal(JSON.stringify(r).includes('private-'),false);assert.equal(r.rows[0].salary,undefined);
  assert.match(r.interpretation,/Missing scans do not prove absence/);
});
test('pagination binds query scope and rejects duplicate or conflicting source records',async()=>{
  const s=createService(config,client,{callHrms:async()=>make([row],'source-next')});
  const one=await s.hrRead('attendance',scope);assert.equal(one.status,'PARTIAL');assert.ok(one.next_cursor);
  await assert.rejects(s.hrRead('attendance',{...scope,cursor:one.next_cursor,status:'LATE'}),/cursor outside/);
  await assert.rejects(s.hrRead('attendance',{...scope,cursor:one.next_cursor}),/Duplicate/);
  const changed=createService(config,client,{callHrms:async()=>make([{...row,late_minutes:20}])});
  await assert.rejects(changed.hrRead('attendance',{...scope,cursor:one.next_cursor}),/Conflicting/);
});
test('unknown roster stays partial and source payload cannot leak private shift fields',async()=>{
  const s=createService(config,client,{callHrms:async()=>make([{...row,roster_day_type:null,shift:{id:'S1',name:'Day',salary:100}}],null,'roster')});
  const r=await s.hrRead('roster',scope);assert.equal(r.status,'PARTIAL');assert.equal(r.rows[0].roster_day_type,null);assert.equal(r.rows[0].shift.salary,undefined);
});
test('person reads use operational projections and name search only resolves IDs',async()=>{
  const s=createService(config,client,{callHrms:async(_c,_b,name,args)=>{assert.equal(name,'read_workforce_operations');return make([{...row,status:'ACTIVE'}],null,args.section);}});
  const r=await s.person({...scope,employee_id:'E1',section:'employees'});assert.equal(r.rows[0].employee_id,'E1');assert.equal(r.rows[0].salary,undefined);
});
test('missing saved attendance is partial and never treated as absence',async()=>{
  const s=createService(config,client,{callHrms:async()=>({...make([row]),missing_saved_attendance_employee_days:3})});
  const r=await s.hrRead('attendance',scope);
  assert.equal(r.status,'PARTIAL');assert.equal(r.missing_coverage[0].count,3);
  assert.match(r.interpretation,/not an assumed status=LATE/);
});
