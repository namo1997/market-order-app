import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');
const commands=[['node',['scripts/expense-phase45-backend-test.mjs']],['node',['scripts/expense-profile-assist-test.mjs']],['node',['scripts/expense-profile-assist-ui-test.mjs']],['node',['scripts/expense-status-test.mjs']],['node',['scripts/not-document-options-test.mjs']],['node',['scripts/scope-receipt-regression-test.mjs']],['npm',['run','check']],['npm',['run','smoke']]];
const results=[];
for(const [command,args] of commands){
 const name=args.join(' ').replaceAll('/','-').replaceAll(' ','-');
 const file=path.join(process.env.SOLAO_TEST_OUTPUT_DIR,name+'.log');const handle=await fs.open(file,'w');
 const child=spawn(command,args,{env:process.env,stdio:['ignore',handle.fd,handle.fd]});const code=await new Promise(resolve=>child.once('exit',resolve));await handle.close();results.push({command:[command,...args].join(' '),code,log:file});console.log(results.at(-1));
}
await fs.writeFile(path.join(process.env.SOLAO_TEST_OUTPUT_DIR,'phase45-checks.json'),JSON.stringify(results,null,2));if(results.some(row=>row.code!==0))process.exitCode=1;
