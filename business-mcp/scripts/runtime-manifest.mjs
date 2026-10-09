import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fixed code/package allowlist only: never read environment files, secrets or business data.
export function runtimeManifest(root=fileURLToPath(new URL('../',import.meta.url))) {
  const paths=['package.json','package-lock.json'];
  for (const directory of ['src','scripts']) {
    for (const entry of readdirSync(join(root,directory),{withFileTypes:true})) {
      if (entry.name.endsWith('.mjs')) paths.push(directory+'/'+entry.name);
    }
  }
  const files=paths.sort().map(path=>{
    if (!lstatSync(join(root,path)).isFile()) throw new Error('Runtime manifest expects regular source files');
    return {path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')};
  });
  return {event:'business_mcp_runtime_manifest',schema_version:'1.0',files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
