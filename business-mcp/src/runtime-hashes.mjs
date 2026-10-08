import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
// Fixed application-source paths only; never inspect env, secret files or business files.
export async function runtimeHashes() {
  const paths=['package.json','package-lock.json'];
  for(const dir of ['src','scripts']) {
    const entries=await readdir(new URL(`${dir}/`,root),{withFileTypes:true});
    paths.push(...entries.filter(x=>x.isFile()&&x.name.endsWith('.mjs')).map(x=>`${dir}/${x.name}`));
  }
  const files={};
  for(const path of paths.sort())files[path]=createHash('sha256').update(await readFile(new URL(path,root))).digest('hex');
  return {algorithm:'sha256',files};
}
