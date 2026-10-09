import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeManifest} from '../scripts/runtime-manifest.mjs';

test('runtime provenance hashes code/packages and excludes secrets; unsafe source links fail', t=>{
  const root=mkdtempSync(join(tmpdir(),'business-runtime-manifest-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src'));
  mkdirSync(join(root,'scripts'));
  for (const path of ['package.json','package-lock.json','src/main.mjs','scripts/start.mjs']) writeFileSync(join(root,path),'source');
  writeFileSync(join(root,'.env'),'SECRET=never-read');
  writeFileSync(join(root,'src','credential.json'),'SECRET=never-read');
  const first=runtimeManifest(root);
  assert.deepEqual(first.files.map(row=>row.path),['package-lock.json','package.json','scripts/start.mjs','src/main.mjs']);
  assert.deepEqual(runtimeManifest(root),first);
  assert.equal(JSON.stringify(first).includes('SECRET'),false);
  writeFileSync(join(root,'src','main.mjs'),'changed');
  assert.notEqual(runtimeManifest(root).sha256,first.sha256);
  symlinkSync(join(root,'.env'),join(root,'src','unsafe.mjs'));
  assert.throws(()=>runtimeManifest(root),/regular source files/);
});

test('canonical startup logs matching provenance and serves HTTP health', async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const child=spawn(process.execPath,['scripts/start-http.mjs'],{cwd:root,env:{...process.env,PORT:'0',BUSINESS_MCP_CLIENTS_JSON:JSON.stringify([{name:'test',token_sha256:'b'.repeat(64),branches:['KK']}]),BUSINESS_BRANCH_MAP_JSON:JSON.stringify([{code:'KK'}]),BUSINESS_PUBLIC_URL:'',BUSINESS_OAUTH_SIGNING_KEY:'',BUSINESS_OAUTH_PASSWORD_SHA256:''},stdio:['ignore','pipe','pipe']});
  let output='';
  let errors='';
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Startup manifest missing')),5000);
    child.stdout.on('data',()=>{if(output.includes('"event":"business_mcp_listening"')) {clearTimeout(timeout);resolve();}});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Startup exited ${code}: ${errors}`));});
  });
  const manifest=JSON.parse(output.split('\n').find(line=>line.startsWith('{"event":"business_mcp_runtime_manifest"')));
  assert.deepEqual(manifest,runtimeManifest(root));
  const listening=JSON.parse(output.split('\n').find(line=>line.startsWith('{"event":"business_mcp_listening"')));
  const health=await fetch(`http://127.0.0.1:${listening.port}/health`);
  assert.equal(health.status,200);
  const unauthorized=await fetch(`http://127.0.0.1:${listening.port}/mcp`,{method:'POST'});
  assert.equal(unauthorized.status,401);
  assert.equal(child.exitCode,null);
});
