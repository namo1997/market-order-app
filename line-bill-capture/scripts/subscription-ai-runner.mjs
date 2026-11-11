#!/usr/bin/env node
// ตัวอ่านบิล/สลิปด้วย AI แบบ subscription สำหรับ line-bill-capture (ใช้บน iMac ของเจ้าของ)
// ดึงรูปที่ยังไม่อ่านจากเซิร์ฟเวอร์ (AI_PROVIDER=external) ทีละใบ ให้ Claude Code (`claude -p`) หรือ Codex (`codex exec`)
// ที่ล็อกอินด้วยบัญชี subscription อ่าน แล้วส่ง JSON กลับ เซิร์ฟเวอร์จะผูกข้อความแชทและจับคู่บิล–สลิปเอง
// ไฟล์นี้ไม่พึ่ง npm package ใด ๆ คัดลอกไฟล์เดียวไปเครื่องอื่นแล้วรันด้วย Node 20+ ได้เลย
//
//   node subscription-ai-runner.mjs run --agent claude            # อ่านคิวรอบเดียวแล้วจบ
//   node subscription-ai-runner.mjs status                        # ดูคิว
//   node subscription-ai-runner.mjs doctor --agent claude          # ตรวจความพร้อมของเครื่อง (ติดตั้งบน iMac ครั้งแรก)
//   node subscription-ai-runner.mjs install-launchd --interval 600 --agent claude [--load]
//   node subscription-ai-runner.mjs uninstall-launchd
//
// ค่าตั้ง: --server <url> หรือ LBC_RUNNER_URL, token จาก LBC_RUNNER_TOKEN หรือไฟล์ --token-file
// (ค่าเริ่มต้น ~/.config/lbc-ai-runner/token สิทธิ์ 600), --work-dir สำหรับรูปชั่วคราว/บันทึก
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_WORK_DIR = '/Volumes/SSD Files/SOLAO/line-bill-capture/subscription-runner';
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.config', 'lbc-ai-runner', 'token');
const LAUNCHD_LABEL = 'com.solao.lbc-subscription-ai-runner';
// ตัวแปรที่ทำให้ CLI หันไปใช้ API แบบเสียเงิน หรือผูกกับ session ของ Claude Code ที่เรียกสคริปต์นี้ ต้องตัดทิ้ง
const STRIPPED_ENV = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|OPENAI_|CODEX_API_KEY$|AZURE_OPENAI_|AWS_BEARER_TOKEN_BEDROCK$)/;
// ข้อความที่แปลว่าตัวอ่านใช้ไม่ได้ทั้งรอบ (โควตา/ล็อกอิน) → คืนรูปเข้าคิวแล้วหยุด
const AGENT_UNAVAILABLE = /usage limit|hit your limit|limit reached|rate.?limit|quota|not logged in|please log ?in|\/login|login required|authenticat|unauthori[sz]ed|invalid api key|credit balance|overloaded/i;

const parseArgs = (argv) => {
  const [command = 'run', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=', 2);
    if (inline !== undefined) flags[key] = inline;
    else if (rest[index + 1] !== undefined && !rest[index + 1].startsWith('--')) flags[key] = rest[++index];
    else flags[key] = true;
  }
  return { command, flags };
};

const { command, flags } = parseArgs(process.argv.slice(2));
const option = (name, envName, fallback) => flags[name] ?? (envName ? process.env[envName] : undefined) ?? fallback;

const settings = {
  server: String(option('server', 'LBC_RUNNER_URL', '')).replace(/\/+$/, ''),
  agent: String(option('agent', 'LBC_RUNNER_AGENT', 'claude')).toLowerCase(),
  model: option('model', 'LBC_RUNNER_MODEL', ''),
  max: Math.max(1, Math.min(500, Number(option('max', 'LBC_RUNNER_MAX', 30)) || 30)),
  timeoutMs: Math.max(30, Number(option('timeout-sec', 'LBC_RUNNER_TIMEOUT_SEC', 300)) || 300) * 1000,
  workDir: path.resolve(String(option('work-dir', 'LBC_RUNNER_WORK_DIR', DEFAULT_WORK_DIR))),
  tokenFile: String(option('token-file', 'LBC_RUNNER_TOKEN_FILE', DEFAULT_TOKEN_FILE)),
  claudeBin: String(option('claude-bin', 'LBC_RUNNER_CLAUDE_BIN', 'claude')),
  codexBin: String(option('codex-bin', 'LBC_RUNNER_CODEX_BIN', 'codex')),
  keepImages: flags['keep-images'] === true || flags['keep-images'] === '1',
  interval: Math.max(60, Number(option('interval', 'LBC_RUNNER_INTERVAL_SEC', 600)) || 600)
};

let logFile = null;
const log = async (message) => {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (logFile) await fs.appendFile(logFile, `${line}\n`).catch(() => {});
};

const fail = (message, code = 1) => {
  console.error(`ผิดพลาด: ${message}`);
  process.exit(code);
};

const readToken = async () => {
  if (process.env.LBC_RUNNER_TOKEN) return process.env.LBC_RUNNER_TOKEN.trim();
  try {
    const stat = await fs.stat(settings.tokenFile);
    if ((stat.mode & 0o077) !== 0) fail(`ไฟล์ token ${settings.tokenFile} ต้องตั้งสิทธิ์ 600 (chmod 600)`);
    return (await fs.readFile(settings.tokenFile, 'utf8')).trim();
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`ไม่พบ token: ตั้ง LBC_RUNNER_TOKEN หรือสร้างไฟล์ ${settings.tokenFile}`);
    throw error;
  }
};

// รูปบิลเป็นข้อมูลธุรกิจ: ถ้าที่เก็บอยู่บนไดรฟ์ภายนอก ไดรฟ์ต้องเสียบอยู่ ห้ามสร้างแทนบนดิสก์ภายใน
const prepareWorkDir = async () => {
  const volume = settings.workDir.match(/^\/Volumes\/[^/]+/)?.[0];
  if (volume) {
    await fs.access(volume, fsConstants.W_OK).catch(() => fail(`ไม่พบไดรฟ์ ${volume} (เสียบ SSD ก่อน หรือใช้ --work-dir)`));
  }
  await fs.mkdir(path.join(settings.workDir, 'logs'), { recursive: true });
  await fs.mkdir(path.join(settings.workDir, 'items'), { recursive: true });
  logFile = path.join(settings.workDir, 'logs', `${new Date().toISOString().slice(0, 10)}.log`);
};

// launchd อาจเรียกซ้อนถ้ารอบก่อนยังไม่จบ ใช้ไฟล์ lock กันอ่านรูปเดียวกันสองตัว
const acquireLock = async () => {
  const lockPath = path.join(settings.workDir, 'runner.lock');
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lockPath, 'utf8').catch(() => '0'));
    let alive = false;
    try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch {}
    if (alive) return null;
    await fs.rm(lockPath, { force: true });
    return acquireLock();
  }
  const release = () => fs.rm(lockPath, { force: true });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await release(); process.exit(130); });
  }
  return release;
};

const api = (token) => async (method, route, body, { raw = false } = {}) => {
  const response = await fetch(`${settings.server}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000)
  });
  if (raw) {
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${route}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || json?.success === false) {
    throw Object.assign(new Error(`${json?.error || `HTTP ${response.status}`}: ${json?.message || text.slice(0, 200)}`), { status: response.status, code: json?.error });
  }
  return json?.data;
};

const childEnv = () => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key) && !key.startsWith('LBC_RUNNER_TOKEN')) env[key] = value;
  }
  return env;
};

const runProcess = (bin, args, { cwd, input }) => new Promise((resolve) => {
  const child = spawn(bin, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, settings.timeoutMs);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut }); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});

// ดึง JSON object ก้อนแรกที่ parse ได้จากข้อความ (เผื่อ AI ห่อด้วย ```json)
export const extractJsonObject = (text) => {
  const source = String(text || '').trim();
  try { const parsed = JSON.parse(source); if (parsed && typeof parsed === 'object') return parsed; } catch {}
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(source.slice(first, last + 1)); } catch {} }
  return null;
};

// schema เดิมเป็นแบบ OpenAI strict (type: ['string','null']) — Claude Code รับ anyOf ได้ชัวร์กว่า
export const toAnyOfSchema = (node) => {
  if (Array.isArray(node)) return node.map(toAnyOfSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === 'properties' && value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toAnyOfSchema(child)]))
      : toAnyOfSchema(value);
  }
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { anyOf: type.map((t) => (t === 'null' ? { type: 'null' } : { ...rest, type: t })) };
  }
  return out;
};

class AgentUnavailableError extends Error {}

const imageInstruction = (fileName) => `\n\nรูปเอกสารที่ต้องอ่านอยู่ที่ไฟล์ ./${fileName} ในโฟลเดอร์ปัจจุบัน เปิดดูรูปนั้นก่อนตอบ ห้ามเดาจากชื่อไฟล์ ตอบเป็น JSON object ตาม schema เท่านั้น ไม่ต้องมีคำอธิบายอื่น`;

const agentFailure = (agent, result) => {
  const detail = `${result.stdout}\n${result.stderr}`.replace(/\s+/g, ' ').trim().slice(-400);
  if (result.timedOut) return new Error(`${agent} timeout หลัง ${settings.timeoutMs / 1000} วินาที`);
  if (AGENT_UNAVAILABLE.test(detail)) return new AgentUnavailableError(`${agent} ใช้งานไม่ได้ตอนนี้: ${detail}`);
  return new Error(`${agent} exit ${result.code}: ${detail || 'no output'}`);
};

const runClaude = async ({ task, dir, fileName }) => {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(toAnyOfSchema(task.schema)),
    '--tools', 'Read',
    '--allowedTools', 'Read',
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    ...(settings.model ? ['--model', String(settings.model)] : [])
  ];
  const result = await runProcess(settings.claudeBin, args, { cwd: dir, input: task.prompt + imageInstruction(fileName) });
  const envelope = extractJsonObject(result.stdout);
  if (result.code !== 0 || !envelope || envelope.is_error) {
    throw agentFailure('claude', { ...result, stdout: envelope?.result || result.stdout });
  }
  const analysis = envelope.structured_output && typeof envelope.structured_output === 'object'
    ? envelope.structured_output
    : extractJsonObject(envelope.result);
  if (!analysis) throw new Error(`claude ตอบไม่เป็น JSON: ${String(envelope.result || '').slice(0, 200)}`);
  return analysis;
};

const runCodex = async ({ task, dir, fileName }) => {
  const schemaPath = path.join(dir, 'schema.json');
  const outputPath = path.join(dir, 'answer.json');
  await fs.writeFile(schemaPath, JSON.stringify(task.schema));
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--color', 'never',
    '-C', dir,
    '--image', path.join(dir, fileName),
    '--output-schema', schemaPath,
    '--output-last-message', outputPath,
    ...(settings.model ? ['--model', String(settings.model)] : []),
    '-'
  ];
  const result = await runProcess(settings.codexBin, args, { cwd: dir, input: task.prompt + imageInstruction(fileName) });
  const answer = await fs.readFile(outputPath, 'utf8').catch(() => '');
  if (result.code !== 0 || !answer.trim()) throw agentFailure('codex', result);
  const analysis = extractJsonObject(answer);
  if (!analysis) throw new Error(`codex ตอบไม่เป็น JSON: ${answer.slice(0, 200)}`);
  return analysis;
};

const AGENTS = { claude: runClaude, codex: runCodex };

const processTask = async (call, task) => {
  const dir = path.join(settings.workDir, 'items', `item-${task.item_id}-${task.claim}`);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `image${task.file_extension || '.jpg'}`;
  const startedAt = Date.now();
  try {
    const image = await call('GET', task.image_path, null, { raw: true });
    await fs.writeFile(path.join(dir, fileName), image);
    const analysis = await AGENTS[settings.agent]({ task, dir, fileName });
    const saved = await call('POST', `/api/ai-runner/items/${task.item_id}/result`, { claim: task.claim, analysis, started_at_ms: startedAt });
    const amount = saved.bill_total_value ?? saved.slip_amount_value;
    await log(`อ่านแล้ว #${task.item_id} → ${saved.category}${amount == null ? '' : ` ${amount}`} (${Math.round((Date.now() - startedAt) / 1000)} วิ)`);
    return 'done';
  } catch (error) {
    if (error instanceof AgentUnavailableError) {
      await call('POST', `/api/ai-runner/items/${task.item_id}/release`, { claim: task.claim }).catch(() => {});
      await log(`หยุดรอบนี้ คืนรูป #${task.item_id} เข้าคิว: ${error.message}`);
      return 'stop';
    }
    if (error?.code === 'CLAIM_EXPIRED') {
      await log(`ข้าม #${task.item_id}: การจองหมดอายุ`);
      return 'failed';
    }
    await call('POST', `/api/ai-runner/items/${task.item_id}/fail`, { claim: task.claim, error: error.message, transient: true }).catch(() => {});
    await log(`อ่านไม่สำเร็จ #${task.item_id} (จะลองใหม่ภายหลัง): ${error.message}`);
    return 'failed';
  } finally {
    if (!settings.keepImages) await fs.rm(dir, { recursive: true, force: true });
  }
};

const runOnce = async () => {
  if (!AGENTS[settings.agent]) fail(`--agent ต้องเป็น claude หรือ codex (ได้ ${settings.agent})`);
  if (!settings.server) fail('ต้องระบุ --server หรือ LBC_RUNNER_URL');
  await prepareWorkDir();
  const releaseLock = await acquireLock();
  if (!releaseLock) {
    await log('มีตัวอ่านอีกรอบกำลังทำงานอยู่ ข้ามรอบนี้');
    return 0;
  }
  const call = api(await readToken());
  const counts = { done: 0, failed: 0 };
  let stopped = false;
  try {
    for (let index = 0; index < settings.max; index += 1) {
      const { task } = await call('POST', '/api/ai-runner/claim', { agent: settings.agent, model: settings.model || 'default' });
      if (!task) break;
      const outcome = await processTask(call, task);
      if (outcome === 'stop') { stopped = true; break; }
      counts[outcome] += 1;
    }
    if (counts.done > 0) {
      const finish = await call('POST', '/api/ai-runner/finish');
      await log(`จับคู่บิล–สลิป: เสนอคู่ใหม่ ${finish.matched} คู่`);
    }
    await log(`จบรอบ (${settings.agent}): อ่านสำเร็จ ${counts.done}, ไม่สำเร็จ ${counts.failed}${stopped ? ', หยุดเพราะตัวอ่านใช้งานไม่ได้' : ''}`);
    return stopped ? 75 : 0;
  } finally {
    await releaseLock();
  }
};

const showStatus = async () => {
  if (!settings.server) fail('ต้องระบุ --server หรือ LBC_RUNNER_URL');
  const status = await api(await readToken())('GET', '/api/ai-runner/status');
  console.log(JSON.stringify(status, null, 2));
  return status.external_mode ? 0 : 2;
};

const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
const xml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const runLaunchctl = (args) => new Promise((resolve) => {
  const child = spawn('launchctl', args, { stdio: 'inherit' });
  child.on('close', resolve);
  child.on('error', () => resolve(-1));
});

// launchd มี PATH สั้นมาก จึงบันทึก path เต็มของ node และโฟลเดอร์ของ claude/codex ไว้ใน plist
const installLaunchd = async () => {
  if (!settings.server) fail('ต้องระบุ --server หรือ LBC_RUNNER_URL');
  if (!AGENTS[settings.agent]) fail('--agent ต้องเป็น claude หรือ codex');
  await prepareWorkDir();
  await readToken();
  const binDirs = [path.dirname(process.execPath), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const programArgs = [process.execPath, SCRIPT_PATH, 'run',
    '--server', settings.server, '--agent', settings.agent, '--max', String(settings.max),
    '--timeout-sec', String(settings.timeoutMs / 1000), '--work-dir', settings.workDir, '--token-file', settings.tokenFile,
    ...(settings.model ? ['--model', String(settings.model)] : []),
    ...(settings.claudeBin !== 'claude' ? ['--claude-bin', settings.claudeBin] : []),
    ...(settings.codexBin !== 'codex' ? ['--codex-bin', settings.codexBin] : [])];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml([...new Set(binDirs)].join(':'))}</string>
    <key>HOME</key><string>${xml(os.homedir())}</string>
  </dict>
  <key>StartInterval</key><integer>${settings.interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(settings.workDir, 'logs', 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(settings.workDir, 'logs', 'launchd.err.log'))}</string>
</dict>
</plist>
`;
  await fs.mkdir(path.dirname(plistPath()), { recursive: true });
  await fs.writeFile(plistPath(), plist);
  console.log(`เขียน ${plistPath()} แล้ว (ทุก ${settings.interval} วินาที, agent=${settings.agent})`);
  if (flags.load) {
    const domain = `gui/${process.getuid()}`;
    await runLaunchctl(['bootout', `${domain}/${LAUNCHD_LABEL}`]);
    const code = await runLaunchctl(['bootstrap', domain, plistPath()]);
    console.log(code === 0 ? 'เปิดตั้งเวลาแล้ว' : `launchctl bootstrap ล้มเหลว (exit ${code})`);
    return code === 0 ? 0 : 1;
  }
  console.log(`ยังไม่เปิดใช้: รัน launchctl bootstrap gui/$(id -u) "${plistPath()}" หรือเพิ่ม --load`);
  return 0;
};

const uninstallLaunchd = async () => {
  await runLaunchctl(['bootout', `gui/${process.getuid()}/${LAUNCHD_LABEL}`]);
  await fs.rm(plistPath(), { force: true });
  console.log('ปิดตั้งเวลาและลบ plist แล้ว');
  return 0;
};

// ตรวจความพร้อมก่อนตั้งเวลา: Node, ที่เก็บงาน, token, เซิร์ฟเวอร์, และ CLI ล็อกอิน subscription แล้วหรือยัง
const doctor = async () => {
  const results = [];
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      results.push(true);
      console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
    } catch (error) {
      results.push(false);
      console.log(`❌ ${label}: ${error?.message || error}`);
    }
  };
  await check('Node 20 ขึ้นไป', async () => {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error(`ตอนนี้ ${process.version}`);
    return process.version;
  });
  await check('ที่เก็บรูปชั่วคราว/บันทึก', async () => {
    const volume = settings.workDir.match(/^\/Volumes\/[^/]+/)?.[0];
    if (volume) await fs.access(volume, fsConstants.W_OK).catch(() => { throw new Error(`ไม่พบไดรฟ์ ${volume} ใช้ --work-dir ชี้ที่อื่น`); });
    await fs.mkdir(settings.workDir, { recursive: true });
    await fs.access(settings.workDir, fsConstants.W_OK);
    return settings.workDir;
  });
  let token = '';
  await check('token', async () => {
    if (process.env.LBC_RUNNER_TOKEN) { token = process.env.LBC_RUNNER_TOKEN.trim(); return 'จาก LBC_RUNNER_TOKEN'; }
    const stat = await fs.stat(settings.tokenFile).catch(() => { throw new Error(`ไม่พบไฟล์ ${settings.tokenFile}`); });
    if ((stat.mode & 0o077) !== 0) throw new Error(`ต้อง chmod 600 ${settings.tokenFile}`);
    token = (await fs.readFile(settings.tokenFile, 'utf8')).trim();
    if (token.length < 24) throw new Error('token สั้นเกิน 24 ตัวอักษร');
    return settings.tokenFile;
  });
  await check('เชื่อมเซิร์ฟเวอร์ (โหมด external)', async () => {
    if (!settings.server) throw new Error('ต้องระบุ --server หรือ LBC_RUNNER_URL');
    if (!token) throw new Error('ยังไม่มี token');
    const status = await api(token)('GET', '/api/ai-runner/status');
    if (!status.external_mode) throw new Error(`เซิร์ฟเวอร์ยังใช้ AI_PROVIDER=${status.provider || 'ปิด'} (ต้องเป็น external)`);
    return `รูปรออ่านในคิว ${status.queue?.pending_retryable ?? "?"} รูป`;
  });
  await check(`${settings.agent} ล็อกอินแบบ subscription`, async () => {
    if (settings.agent === 'codex') {
      const result = await runProcess(settings.codexBin, ['login', 'status'], { cwd: settings.workDir, input: '' });
      const text = `${result.stdout}${result.stderr}`.trim();
      if (result.code !== 0 || !/chatgpt/i.test(text)) throw new Error(text || `exit ${result.code} (รัน codex login แล้วเลือก Sign in with ChatGPT)`);
      return text.split('\n')[0];
    }
    if (settings.agent !== 'claude') throw new Error('--agent ต้องเป็น claude หรือ codex');
    // ถามสั้น ๆ หนึ่งครั้งเพื่อยืนยันล็อกอิน (ใช้โควตา subscription เล็กน้อย ไม่ใช่ API เสียเงิน)
    const result = await runProcess(settings.claudeBin, ['-p', '--output-format', 'json', '--tools', '', '--setting-sources', 'project', '--strict-mcp-config'], { cwd: settings.workDir, input: 'ตอบคำว่า ok คำเดียว' });
    const envelope = extractJsonObject(result.stdout);
    if (result.code !== 0 || !envelope || envelope.is_error) {
      throw new Error(`${envelope?.result || result.stderr || result.stdout || `exit ${result.code}`}`.trim().slice(0, 200) + ' (รัน claude แล้วพิมพ์ /login เลือกบัญชี Claude Pro/Max)');
    }
    return 'ตอบได้';
  });
  const ok = results.every(Boolean);
  console.log(ok ? '\nพร้อมใช้งาน: รัน install-launchd --load เพื่อตั้งเวลา' : '\nยังไม่พร้อม แก้ข้อที่มี ❌ แล้วรัน doctor ใหม่');
  return ok ? 0 : 1;
};

const commands = { run: runOnce, status: showStatus, doctor, 'install-launchd': installLaunchd, 'uninstall-launchd': uninstallLaunchd };

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const handler = commands[command];
  if (!handler) fail(`ไม่รู้จักคำสั่ง ${command} (ใช้ run | status | doctor | install-launchd | uninstall-launchd)`);
  handler().then((code) => process.exit(code ?? 0), (error) => fail(error?.message || String(error)));
}
