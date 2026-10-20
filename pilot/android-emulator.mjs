import { access, copyFile, cp, readFile, realpath, open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { root, reports, ssdDir, json, command, cleanEnv, receipt } from './common.mjs';

const options = process.argv.slice(2);
if (options.length > 1 || options[0]?.startsWith('-') && !['--stop', '--screenshot'].includes(options[0])) {
  throw new Error('Usage: sh pilot/android-emulator.sh [absolute-APK-path | --screenshot | --stop]');
}
const android = `${root}/cache/android`;
const sdk = `${android}/pilot-sdk`;
const user = `${android}/pilot-user`;
const avds = `${android}/pilot-avd`;
const avd = 'solao-receiving-api36';
const device = `${avds}/${avd}.avd`;
const serial = 'emulator-5580';
const screens = `${reports}/screens`;
for (const dir of [sdk, user, avds, `${android}/pilot-tmp`, `${android}/pilot-cache`, screens]) await ssdDir(dir);
const env = { ...cleanEnv(`${android}/pilot-tmp`),
  ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: user,
  ANDROID_EMULATOR_HOME: user, ANDROID_AVD_HOME: avds,
  ANDROID_PREFS_ROOT: user, ANDROID_SDK_HOME: user,
  XDG_CACHE_HOME: `${android}/pilot-cache`, XDG_CONFIG_HOME: user,
  ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5047', ANDROID_ADB_SERVER_PORT: '5047',
  // adb may create its authentication key only under this SSD user directory.
  ADB_VENDOR_KEYS: `${user}/adbkey`,
  JAVA_HOME: '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
  ANDROID_EMULATOR_USE_SYSTEM_LIBS: '1' };
const stamp = `${Date.now()}-${process.pid}`;
const logs = await ssdDir(`${reports}/android-${stamp}`);
const adb = `${sdk}/platform-tools/adb`;
const runAdb = (args, capture = false) => command(adb, ['-P', '5047', '-s', serial, ...args],
  { cwd: android, env, log: `${logs}/adb-${++sequence}.log`, capture });
let sequence = 0;
async function isPilotRunning() {
  try { return (await runAdb(['emu', 'avd', 'name'], true)).split('\n')[0].trim() === avd; }
  catch { return false; }
}
async function screenshot() {
  const file = `${screens}/emulator-${Date.now()}.png`;
  await new Promise((resolve, reject) => {
    const output = createWriteStream(`${file}.partial`, { mode: 0o600 });
    const child = spawn(adb, ['-P', '5047', '-s', serial, 'exec-out', 'screencap', '-p'],
      { cwd: android, env, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pipe(output);
    const done = new Promise(r => output.once('finish', r));
    child.once('error', reject);
    child.once('close', async code => { await done; code === 0 ? resolve() : reject(new Error('adb screencap failed')); });
  });
  const bytes = await readFile(`${file}.partial`);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid screenshot PNG');
  const { rename } = await import('node:fs/promises');
  await rename(`${file}.partial`, file);
  process.stdout.write(`Screenshot: ${file}\n`);
  return file;
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} busy; no unrelated emulator/adb process will be stopped`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

try {
  if (options[0] === '--stop' || options[0] === '--screenshot') {
    if (!await isPilotRunning()) throw new Error('Pilot AVD is not running on emulator-5580');
    if (options[0] === '--stop') await runAdb(['emu', 'kill']);
    else await screenshot();
    process.exit(0);
  }
  if (process.arch !== 'arm64') throw new Error('This pilot requires Apple Silicon arm64');
  const apk = options[0] || `${root}/reports/receiving-apk-codex/r2/receiving-debug.apk`;
  if (!apk.startsWith('/') || !apk.endsWith('.apk')) throw new Error('Supply an absolute APK path');
  await access(apk);
  // Tool binaries may be existing installed files; every new SDK package is SSD-only.
  const existing = '/opt/homebrew/share/android-commandlinetools';
  await access(`${env.JAVA_HOME}/bin/java`);
  await ssdDir(`${sdk}/cmdline-tools`);
  try { await access(`${sdk}/cmdline-tools/latest/bin/sdkmanager`); }
  catch {
    await cp(`${existing}/cmdline-tools/latest`, `${sdk}/cmdline-tools/latest`, { recursive: true, dereference: true });
  }
  // Reuse ONLY already accepted android-sdk-license; do not run --licenses or yes.
  await ssdDir(`${sdk}/licenses`);
  await copyFile(`${existing}/licenses/android-sdk-license`, `${sdk}/licenses/android-sdk-license`);
  // Upstream v19 shell launchers expand toolsdir through eval and break on
  // '/Volumes/SSD Files'. Invoke their identical Java entry points with argv.
  const tools = `${sdk}/cmdline-tools/latest`;
  const androidTool = (name, args, extra = {}) => command(`${env.JAVA_HOME}/bin/java`, [
    `-Duser.home=${user}`, `-Djava.io.tmpdir=${android}/pilot-tmp`,
    `-Dcom.android.sdklib.toolsdir=${tools}`, `-Dcom.android.sdkmanager.toolsdir=${tools}`,
    '-classpath', `${tools}/lib/${name}-classpath.jar`,
    name === 'sdkmanager' ? 'com.android.sdklib.tool.sdkmanager.SdkManagerCli' : 'com.android.sdklib.tool.AvdManagerCli',
    ...args
  ], { cwd: android, env, ...extra });
  const image = 'system-images;android-36;google_apis;arm64-v8a';
  try {
    await androidTool('sdkmanager', [`--sdk_root=${sdk}`, '--install', 'platform-tools', 'emulator', image],
      { log: `${logs}/sdk-install.log` });
  } catch (error) {
    const output = await readFile(`${logs}/sdk-install.log`, 'utf8');
    const license = output.match(/License ([a-z0-9-]+):/i)?.[1];
    if (license) throw new Error(`Android requested license ${license}; stopped without acceptance`);
    throw error;
  }
  for (const packagePath of ['platform-tools', 'emulator', 'system-images/android-36/google_apis/arm64-v8a']) {
    const metadata = await readFile(`${sdk}/${packagePath}/package.xml`, 'utf8').catch(() => '');
    const licenseRefs = [...metadata.matchAll(/<uses-license\s+ref="([^"]+)"/g)].map(m => m[1]);
    if (!metadata || !licenseRefs.length || licenseRefs.some(ref => ref !== 'android-sdk-license')) {
      throw new Error(`Package missing or needs a different license: ${packagePath}; stop for owner review`);
    }
  }
  // Use a dedicated adb server; never reuse or stop the user's default server.
  try {
    await command(adb, ['-P', '5047', 'devices'], { cwd: android, env, log: `${logs}/devices.log` });
  } catch { throw new Error('Dedicated SSD adb server failed'); }
  try { await access(`${avds}/${avd}.ini`); }
  catch {
    await androidTool('avdmanager', ['create', 'avd', '--name', avd, '--package', image, '--device', 'pixel_7', '--path', device],
      { input: 'no\n', log: `${logs}/avd-create.log` });
  }
  if (await realpath(device) !== device) throw new Error('AVD redirected outside SSD');
  const ini = await readFile(`${avds}/${avd}.ini`, 'utf8');
  if (!ini.split(/\r?\n/).includes(`path=${device}`)) throw new Error('AVD data path is not pilot SSD path');
  // Keep writable emulator disks, snapshots, shader/crash cache under android/.
  if (!await isPilotRunning()) {
    await freePort(5580); await freePort(5581);
    const output = await open(`${logs}/emulator.log`, 'w', 0o600);
    const child = spawn(`${sdk}/emulator/emulator`, ['-avd', avd, '-port', '5580', '-datadir', device,
      '-no-snapshot', '-no-audio', '-no-boot-anim', '-no-metrics', '-gpu', 'swiftshader'],
    { cwd: android, env, detached: true, stdio: ['ignore', output.fd, output.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); await output.close();
    await json(`${logs}/process.json`, { avd, serial, pid: child.pid, data: device, ssdReceipt: receipt });
  }
  let booted = false;
  for (let i = 0; i < 180; i++) {
    try { if ((await runAdb(['shell', 'getprop', 'sys.boot_completed'], true)).trim() === '1') { booted = true; break; } }
    catch { /* Boot is still in progress; bounded retry, never use another device. */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!booted) throw new Error('Emulator did not boot in 6 minutes; see emulator.log');
  await runAdb(['install', '-r', apk]);
  await runAdb(['shell', 'am', 'start', '-W', '-n', 'th.co.solao.receiving/.MainActivity']);
  await new Promise(r => setTimeout(r, 2000));
  const file = await screenshot();
  await json(`${logs}/result.json`, { installed: true, apk, apkSha256: createHash('sha256').update(await readFile(apk)).digest('hex'),
    avd, serial, screenshot: file, license: 'reused android-sdk-license only', ssdReceipt: receipt });
  let base = 'http://10.0.2.2:<port>';
  try { base = JSON.parse(await readFile(`${reports}/current.json`, 'utf8')).emulatorBase; } catch { /* Server can be started later. */ }
  process.stdout.write(`AVD ready: ${serial}\nIn app: ตั้งค่า API → ${base} (no /api)\nLogs: ${logs}\n`);
} catch (e) {
  await json(`${logs}/result.json`, { installed: false, error: e.message, ssdReceipt: receipt });
  process.stderr.write(`${e.message}\nIf sdk-install.log requests any new license, STOP; do not auto-accept.\nLogs: ${logs}\n`);
  process.exitCode = 1;
}
