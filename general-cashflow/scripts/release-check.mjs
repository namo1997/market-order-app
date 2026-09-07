import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const scope='general-cashflow';
const commit=git('rev-parse','HEAD');
const artifacts=path.join(root,'output/playwright/cashflow-release',`${commit}-${Date.now()}`);
await fs.mkdir(artifacts,{recursive:true});
const stages=[];
const clean=()=>assert.equal(git('status','--porcelain','--untracked-files=all','--',scope),'','General Cashflow contains changes outside the tested commit');
try {
  clean();
  for(const area of ['server','client']) {
    console.log(`Checking ${area} tests`);
    const log=execFileSync('npm',['test','--','--test-reporter=tap'],{cwd:path.join(root,scope,area),encoding:'utf8',timeout:180000});
    await fs.writeFile(path.join(artifacts,`${area}-tests.tap`),log);
    const count=Number(log.match(/^# tests (\d+)/m)?.[1]);assert.ok(count>0,'Test results missing');
    for(const key of ['fail','cancelled','skipped','todo']) assert.match(log,new RegExp(`^# ${key} 0$`,'m'),`${area}: ${key} is not zero`);
    stages.push({stage:`${area} tests`,status:'passed',count});
  }
  const build=execFileSync('npm',['run','build'],{cwd:path.join(root,scope,'client'),encoding:'utf8',env:{...process.env,VITE_CASHFLOW_API_URL:'/api',VITE_BUILD_COMMIT:commit},timeout:180000});
  await fs.writeFile(path.join(artifacts,'build.log'),build);stages.push({stage:'build',status:'passed'});
  const deployments=JSON.parse(execFileSync('railway',['deployment','list','--service','general-cashflow','--environment','production','--limit','1','--json'],{cwd:root,encoding:'utf8'}));
  const deployment=deployments[0];assert.equal(deployment.status,'SUCCESS');assert.equal(deployment.meta.commitHash,commit);
  await fs.writeFile(path.join(artifacts,'deployment.json'),JSON.stringify({id:deployment.id,status:deployment.status,commit},null,2));
  execFileSync(process.execPath,[path.join(root,scope,'scripts/verify-receipts-overview.mjs'),'--expected-commit',commit,'--artifacts',path.join(artifacts,'production')],{cwd:root,stdio:'inherit',timeout:600000});
  const acceptance=JSON.parse(await fs.readFile(path.join(artifacts,'production/acceptance.json'),'utf8'));
  assert.equal(acceptance.status,'passed');assert.equal(acceptance.commit,commit);assert.equal(acceptance.checks.length,7);
  assert.ok(acceptance.checks.every(c=>c.status==='passed' && c.evidence));
  clean();assert.equal(git('rev-parse','HEAD'),commit,'Commit changed during verification');
  await fs.writeFile(path.join(artifacts,'release.json'),JSON.stringify({status:'passed',commit,stages,acceptance:'production/acceptance.json',checked_at:new Date().toISOString()},null,2));
  console.log(`Release verified: ${commit}\nEvidence: ${artifacts}`);
} catch(error){await fs.writeFile(path.join(artifacts,'release.json'),JSON.stringify({status:'failed',commit,stages,error:error.message},null,2));console.error(error.message);process.exitCode=1;}
