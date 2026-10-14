import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_LAUNCHER_PATHS, toAppLauncherShell } from '../src/utils/app-launcher-shell.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('/apps shell points home-screen installs at the launcher manifest and icons', async () => {
  const html = await read('../../client/index.html');
  const shell = toAppLauncherShell(html);

  assert.match(shell, /<link rel="manifest" href="\/apps\.webmanifest" \/>/);
  assert.match(shell, /<link rel="apple-touch-icon" href="\/apps-icons\/apple-touch-icon\.png" \/>/);
  assert.match(shell, /<meta name="apple-mobile-web-app-title" content="ทางลัด" \/>/);
  assert.match(shell, /<title>SOLAO ทางลัด<\/title>/);
  assert.doesNotMatch(shell, /manifest\.webmanifest/);
  assert.match(shell, /<div id="root"><\/div>/);
  assert.ok(APP_LAUNCHER_PATHS.has('/apps'));
});

test('launcher manifest starts at /apps with PNG icons that exist', async () => {
  const manifest = JSON.parse(await read('../../client/public/apps.webmanifest'));
  assert.equal(manifest.start_url, '/apps');
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    await readFile(new URL(`../../client/public${icon.src}`, import.meta.url));
  }
});
