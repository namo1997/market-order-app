import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = path.join(rootDir, '.local-preview');
const targetDir = path.join(previewRoot, 'data');
const stagingDir = path.join(previewRoot, 'data.next');
const remoteSnapshot = '/tmp/line-bill-capture-preview.sqlite';

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

const snapshotCode = [
  "import fs from 'node:fs';",
  "import { DatabaseSync } from 'node:sqlite';",
  `const target=${JSON.stringify(remoteSnapshot)};`,
  "fs.rmSync(target,{force:true});",
  "const db=new DatabaseSync('/data/line-bill-capture.sqlite');",
  "db.exec('PRAGMA busy_timeout=15000');",
  "db.exec(`VACUUM INTO '${target}'`);",
  "db.close();"
].join('');

console.log('Creating a consistent read-only snapshot on Railway...');
const snapshotBase64 = Buffer.from(snapshotCode).toString('base64');
await run('railway', [
  'ssh', '--service', 'line-bill-capture',
  'echo', snapshotBase64, '|', 'base64', '-d', '|', 'node', '--input-type=module'
]);

await fs.rm(stagingDir, { recursive: true, force: true });
await fs.mkdir(stagingDir, { recursive: true });

console.log('Downloading the database and captured images...');
const remote = spawn('railway', [
  'ssh', '--service', 'line-bill-capture',
  'tar', '-czf', '-', '-C', '/tmp', path.basename(remoteSnapshot),
  '|', 'base64'
], { stdio: ['ignore', 'pipe', 'inherit'] });
const decode = spawn('base64', ['-d'], { stdio: ['pipe', 'pipe', 'inherit'] });
const extract = spawn('tar', ['-xzf', '-', '-C', stagingDir], { stdio: ['pipe', 'inherit', 'inherit'] });
remote.stdout.pipe(decode.stdin);
decode.stdout.pipe(extract.stdin);

const waitFor = (child, name) => new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)));
});
await Promise.all([waitFor(remote, 'railway ssh'), waitFor(decode, 'base64'), waitFor(extract, 'tar')]);

await fs.rename(
  path.join(stagingDir, path.basename(remoteSnapshot)),
  path.join(stagingDir, 'line-bill-capture.sqlite')
);

const localDbPath = path.join(stagingDir, 'line-bill-capture.sqlite');
const database = new DatabaseSync(localDbPath, { readOnly: true });
const imageRows = database.prepare(
  `SELECT id, storage_relative_path
   FROM capture_items
   WHERE storage_relative_path IS NOT NULL
     AND storage_relative_path <> ''
     AND status <> 'unsent'
   ORDER BY id ASC`
).all();
database.close();

const imagesDir = path.join(stagingDir, 'images');
await fs.mkdir(imagesDir, { recursive: true });
let downloaded = 0;
let reused = 0;
let missing = 0;
let cursor = 0;
const worker = async () => {
  while (cursor < imageRows.length) {
    const row = imageRows[cursor++];
    const destination = path.join(imagesDir, row.storage_relative_path);
    const existing = path.join(targetDir, 'images', row.storage_relative_path);
    try {
      await fs.access(existing);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.link(existing, destination);
      reused += 1;
      continue;
    } catch {
      // A missing or cross-device file is downloaded below.
    }
    const response = await fetch(`https://line-bill-capture-production.up.railway.app/api/admin/items/${row.id}/image`);
    if (response.status === 404) {
      missing += 1;
      continue;
    }
    if (!response.ok) throw new Error(`Image ${row.id} returned HTTP ${response.status}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
    if (downloaded % 50 === 0) console.log(`Downloaded ${downloaded}/${imageRows.length} images...`);
  }
};
await Promise.all(Array.from({ length: 8 }, () => worker()));

const writableDatabase = new DatabaseSync(localDbPath);
writableDatabase.prepare(
  `UPDATE capture_items
   SET storage_path = ? || '/' || storage_relative_path
   WHERE storage_relative_path IS NOT NULL
     AND storage_relative_path <> ''`
).run(path.join(targetDir, 'images'));
writableDatabase.close();

await fs.rm(targetDir, { recursive: true, force: true });
await fs.rename(stagingDir, targetDir);

const dbSize = (await fs.stat(path.join(targetDir, 'line-bill-capture.sqlite'))).size;
console.log(`Local preview synced: ${downloaded} downloaded, ${reused} reused, ${missing} unavailable, ${(dbSize / 1024 / 1024).toFixed(1)} MB database.`);
