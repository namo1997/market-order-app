import {loadConfig} from '../src/config.mjs';
import {createService} from '../src/service.mjs';

const config=loadConfig();
const client=config.clients.find(c=>c.name===process.env.BUSINESS_VERIFY_CLIENT);
if (!client || client.allow_hr_operations!==true) throw new Error('Configured operational verification client required');
const day=new Date(Date.now()+7*3600000-86400000).toISOString().slice(0,10);
const service=createService(config,client),cases=[];
for (const branch of client.branches) for (const section of ['employees','leave','attendance','roster','leave_balances']) {
  let cursor,pages=0,rows=0,complete=false;
  try {
    do {
      const result=await service.hrRead(section,{branch,from:process.env.BUSINESS_VERIFY_FROM || day,to:process.env.BUSINESS_VERIFY_TO || day,limit:100,cursor});
      pages++;rows+=result.rows.length;cursor=result.next_cursor;
      if (pages>=100 && cursor) throw new Error('Verification page cap reached');
    } while(cursor);
    complete=true;
  } catch { /* Do not print upstream payload, employee facts or credentials. */ }
  cases.push({branch,section,complete,pages,rows});
}
const passed=cases.length>0 && cases.every(c=>c.complete);
process.stdout.write(JSON.stringify({generated_at:new Date().toISOString(),evidence:'LIVE_SOURCE_READS_THROUGH_GATEWAY_SERVICE',passed,cases},null,2)+'\n');
if (!passed) process.exitCode=1;
