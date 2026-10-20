import fs from 'node:fs';
import path from 'node:path';
import { ssdPath } from './ssd-path.mjs';

export function writeReport(out, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rounds = [1, 2].map(round => {
    const result = JSON.parse(fs.readFileSync(path.join(out, `results-${round}.json`), 'utf8'));
    return { round, ...result.stats };
  });
  const passed = rounds.every(round => round.expected === 66 && round.unexpected === 0 && round.skipped === 0);
  const mark = passed ? '✅' : '⚠️';
  const ui = passed ? 'E2E ทั้งสองรอบผ่าน' : 'Chromium เปิดไม่ได้ก่อนเข้า test body; ยังไม่พิสูจน์ UI';
  const runName = path.basename(manifest.run);
  const log = name => `${runName}-${name}.log`;
  const texts = rounds.map(({ round, expected, unexpected, skipped, flaky }) => `| ${round} | ${expected + unexpected + skipped + flaky} | ${expected} | ${unexpected} | ${skipped} | ${flaky} | [log](${log(`round-${round}`)}) / [JSON](results-${round}.json) |`).join('\n');
  const files = manifest.files.filter(file => file.path.startsWith('e2e/')).map(file => `- \`${file.path}\``).join('\n');
  let pngCount = 0;
  const countScreens = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) countScreens(path.join(dir, entry.name));
      else if (entry.name.endsWith('.png')) pngCount++;
    }
  };
  countScreens(path.join(out, 'screens'));
  const harnessStep = manifest.steps.find(step => step.name === 'harness');
  const harnessLog = harnessStep ? fs.readFileSync(path.join(out, log('harness')), 'utf8') : '';
  const harnessStats = ['tests', 'pass', 'fail', 'skipped'].map(name => `${name}=${harnessLog.match(new RegExp(`(?:ℹ |# )${name} (\\d+)`))?.[1] || '?'}`).join(', ');
  const body = `# รายงาน E2E หน้ารับสินค้า (mock API)

## 1. สรุปและไฟล์

${passed ? 'ชุด E2E ผ่านสองรอบตามตัวเลขด้านล่าง' : 'ยังไม่ผ่านด่าน E2E: sandbox ปฏิเสธเปิด Chromium ด้วย MachPortRendezvousServer Permission denied (1100) ก่อนโหลดหน้าเว็บ'} ไม่มีผล UI/a11y/สี/focus ที่จะอ้างว่าผ่านเมื่อ browser เปิดไม่ได้ สร้างเฉพาะไฟล์ใหม่ใน e2e/; ไม่แก้ client/src, server/ หรือไฟล์เดิม ไม่ commit/push/deploy ไม่เรียก OpenAI API และไม่อ่าน .env หรือ credential จริง

แหล่ง source: \`${manifest.source}\` บน branch receiving/server; snapshot \`${manifest.run}\` ดู checksum รายไฟล์ใน [manifest](${path.basename(manifestPath)}) ใช้ผลตรวจ SSD ของ Claude ที่ผู้ใช้ส่งให้ 2026-10-15 22:02:30 rc=0 UUID AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B ไม่เรียก ssd-workspace check/diskutil ซ้ำ

ไฟล์เพิ่ม:

${files}

ไฟล์เดิมที่แก้: ไม่มี งาน dirty ใน client/server เป็นงานร่วมจากเอเจนต์อื่นและไม่ได้ stage

## 2. คำสั่งและผลจริง

คำสั่งส่งมอบให้ Claude รันนอก sandbox ได้ทันที:

\`\`\`sh
cd /Users/surachart/solao-worktrees/market-receiving-apk
E2E_OUT='/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-e2e-codex' ./e2e/run-on-ssd.sh
\`\`\`

สคริปต์คัดลอก client/e2e ไป SSD โดยตัด .env*, .npmrc, .git, node_modules, dist ออก ติดตั้ง npm ci, build client/dist บน SSD, ติดตั้ง Playwright/axe และ Chromium บน SSD, รัน mock harness, test discovery แล้ว E2E สองรอบ ไม่เปิด dev server หรือ API จริง ตั้ง TMPDIR/npm cache/browser/profile/trace/report ไป SSD ทั้งหมด ใช้ static server loopback ใน fixture และ page.route ดักทุก /api/* พร้อมบล็อก network ภายนอก

ผลขั้นเตรียม: ${manifest.steps.filter(step => !step.name.startsWith('round-')).map(step => `${step.name} rc=${step.rc}`).join('; ')}

Mock harness แยกจาก UI: ${harnessStats} ([log](${log('harness')})) เป็นการตรวจ mock route ด้วย Node ไม่ใช่ผล server/API/DB จริง

Playwright discovery: 11 กรณี × 3 viewport (360/390/1440) × 2 theme (light/dark) = 66 tests, Chromium, retries=0

| รอบ | tests | pass | fail | skip | flaky | หลักฐาน |
|---|---:|---:|---:|---:|---:|---|
${texts}

${passed ? 'ผลผ่านทั้งสองรอบ' : 'fail ทั้งหมดเป็น environment blocker browserType.launch ก่อนเข้า flow ไม่ใช่หลักฐานพบ UI defect; ไม่มี skip และไม่ได้แก้เทสต์ให้ผ่านหลอก'}

ภาพหน้าจอ .png ที่สร้างได้ใน screens/: ${pngCount} ภาพ เป้าหมายคือ screens/round-1 และ round-2 แยก viewport/theme/test/step ถ้า Chromium เปิดไม่ได้จะยังไม่มีภาพหน้า UI หลักฐาน launch failure อยู่ใน log/JSON และ HTML reports ใน html-1/2

วันที่ถูกตรึง 2026-10-15 22:10 Bangkok โดย setFixedTime; timer ยังทำงานปกติ ไม่มี fixed sleep ใน flow ใช้ gate รอ confirm เพื่อพิสูจน์ปุ่มกำลังบันทึกก่อนปล่อย response

## 3. Checklist หัวข้อ 3–5 ของ AGENTS.md

| ข้อ | สถานะ | หลักฐาน / ขอบเขต |
|---|---|---|
| 3 เทสต์เดิม server ทั้งหมด/release-invariants/order-safety/hrms-sales-product-catalog | ⚠️ | ไม่รันในงาน mock E2E นี้ ต้องให้สาย server ตรวจ |
| 3 ทุก endpoint: success/422/403/404/409 | ${mark} | complete receiving, errors PUT/OCR/confirm/image/session; mock ครบ endpoint แต่ไม่ได้พิสูจน์ทุก error ของทุก endpoint จริง; ${ui} |
| 3 confirm/void transaction และ rollback order/inventory/alias | ⚠️ | mock E2E พิสูจน์ DB ไม่ได้ ต้อง integration test ของ server |
| 3 client_uuid ซ้ำรวม concurrent | ${mark} | offline retry ตรวจ double activation, lost response หลังสร้าง, ปิด/เปิดแล้ว payload เดิม; mock harness concurrent ผ่าน แต่ DB race ยังไม่พิสูจน์; ${ui} |
| 3 OCR mock/timeout/JSON เสีย/คอมมา/พ.ศ. | ⚠️ | mock normalized OCR และ 429/503; ไม่มี provider call แต่ timeout/JSON/normalization เป็นงาน server ยังไม่พิสูจน์ |
| 3 เงินสตางค์/จำนวนเต็ม/rounding | ⚠️ | fixture ใช้ money string 2 ตำแหน่งและ quantity string; harness ตรวจ 2.50 → 2.5; ไม่พิสูจน์ 0.1+0.2/rounding ของระบบจริง |
| 3 ผลซ้ำสองรอบ | ${mark} | ตัวเลขตามตาราง; ${passed ? '66 pass ซ้ำ' : '66 fail จาก environment ซ้ำ ไม่ใช่ deterministic UI pass'} |
| 4 IDOR ทุก endpoint รวมรูป | ⚠️ | errors image 403 เป็น mock UX เท่านั้น ไม่พิสูจน์ authorization server |
| 4 ไม่มี/ผิด/หมดอายุ login ทุก endpoint | ⚠️ | errors expired session 401 ตรวจ redirect ผ่าน mock; ไม่พิสูจน์ auth ทุก endpoint |
| 4 SQL placeholders | ⚠️ | ชุด E2E ไม่ query DB; ต้อง audit server |
| 4 รูป: limit ก่อน decode/magic/page/body limit | ⚠️ | mock ตรวจ JPEG magic และ ≤3 MB; รูปสร้างใน browser memory; ไม่พิสูจน์ server limits |
| 4 ค่าใช้จ่าย OCR/rate/hash/timeout | ⚠️ | 429 UX, network ถูกบล็อก ไม่มี AI API; ไม่พิสูจน์ quota/hash/cost/timeout จริง |
| 4 prompt injection/schema/negative/huge/line limit | ⚠️ | quantity ติดลบตรวจสีแดงใน complete receiving; ไม่ทดสอบ prompt/schema ของ provider จริง |
| 4 สถานะ draft/confirm/void ซ้ำ | ${mark} | complete receiving ตรวจ UI และ mock รับ confirm/void ครั้งเดียว; harness ปฏิเสธ mutation terminal; ${ui} |
| 4 concurrent confirm สำเร็จครั้งเดียว | ⚠️ | ไม่พิสูจน์ DB row lock/unique/version ด้วย UI mock |
| 4 error/log ไม่รั่วข้อมูล | ${mark} | ไม่ persist request body หรือภาพ/ลายเซ็น/session ใน browser-evidence; console/pageerror fail; production error/stack/log ยังไม่ audit; ${ui} |
| 4 Asia/Bangkok/ข้ามเที่ยงคืน | ⚠️ | ใช้ timezoneId และ fixed Date; ไม่พิสูจน์ server boundary ข้ามวัน |
| 4 legacy /api/orders/receiving ไม่พัง | ⚠️ | ไม่แตะ legacy แต่ไม่ได้รัน regression ของ server |
| 4 schema idempotent/DECIMAL/index | ⚠️ | งานนี้ไม่แตะ schema; ไม่ตรวจ migration/DB |
| 5 module ไม่เกินประมาณ 800 บรรทัด | ✅ | แยก config, runner, static server, mock API, fixture, harness, report, tests |
| 5 ไม่มี debug/dead code/TODO/skip/only | ✅ | ไม่มี console.log debug หรือ test skip/only/todo; stdout ของ runner ใช้รายงานสถานะและพาธ log |
| 5 ใช้ auth/receiving/inventory เดิม | ✅ | เสิร์ฟ client build จริง ใช้ UI/API client เดิม; mock ที่ boundary ไม่มี SQL สำเนาหรือ business implementation ใน production |
| 5 API contract fields/errors | ⚠️ | mock envelopes และ quantity normalization ตามเอกสาร; harness ผ่าน; ไม่แก้สัญญาและไม่ได้พิสูจน์ response ฝั่ง server |

## 4. จุดที่ตรวจและแก้ในชุดทดสอบ

- บล็อก endpoint ที่ไม่มี mock พร้อม fail และบล็อก origin ภายนอก จึงไม่มี fallback ไปบริการจริง
- เก็บ image/signature/session สังเคราะห์ในหน่วยความจำเท่านั้น browser-evidence เก็บ method/path และ error ที่จำเป็น
- เส้นทาง output ต้องอยู่ filesystem SSD เดียวกัน ไม่มี fallback และไม่ทิ้ง node_modules/browser ใน worktree
- แก้ mock PUT ให้รับ quantity 2.50 จาก client และคืน 2.5 ตามสัญญา; seed session เพียงครั้งเดียวเพื่อไม่ login ซ้ำเองหลัง 401
- แยก browser resource errors ที่จงใจจำลองใน negative test (401/403/404/409/422/429/503/offline) เป็น expectedNetworkErrors; application console.error, pageerror, network ที่ไม่คาดไว้ และทุก error ใน happy flow ยัง fail
- หลังเก็บผล browser launch failure ปิด network trace ใน config ส่งมอบ เพื่อไม่ฝัง raw upload/signature body ใน artifact เมื่อ Claude รันต่อ ใช้ screenshot ที่ขอและ sanitized browser-evidence แทน ไม่ได้รัน browser ใหม่หลังเปลี่ยนตัวเลือก trace เพราะติด blocker เดิม

ไม่มีข้ออ้างว่าแก้ช่องโหว่ production แล้วในงานนี้ เพราะไม่ได้รับขอบเขตให้แก้ client/server

## 5. ความเสี่ยงที่เหลือ / ยังไม่ทำ

1. ${passed ? 'ผลนี้เป็น mock E2E เท่านั้น' : 'ต้องรันนอก sandbox เพื่อยืนยัน selector/flow/layout/axe/focus/console และเก็บ screenshot; ยังไม่ยืนยันสิ่งเหล่านี้ผ่าน'}
2. ข้อมูล OCR ใช้ยอด 392 ที่อ้างจากกรณี real-bill-shaped 392/472 ใน server/tests/receiving-ocr-findings.test.mjs:173–181 ชื่อ/สินค้า/ID/วันที่/ปริมาณเป็นสังเคราะห์ ยังไม่มีภาพต้นฉบับที่ยืนยันว่าเป็นบิลจริง จึงยังไม่ครบข้อ fixture จากบิลจริง และไม่ใช่การวัดความแม่น OCR
3. ยังต้องทดสอบ transaction/rollback, SQL/IDOR/auth, concurrent DB, provider schema/timeout/cost, legacy, migration และ release gates ตามสาย server
4. Client/server มีเอเจนต์อื่นทำงานอยู่ snapshot มี checksum ผูกหลักฐานกับ source รอบนั้น การรันใหม่จะสร้าง snapshot ใหม่ ไม่ทับ source
5. บราวเซอร์ครอบคลุม Chromium เท่านั้น ยังไม่ได้พิสูจน์ Safari/WebKit, Android WebView หรือ APK บนอุปกรณ์จริง

## 6. Commit ที่เสนอ

ไม่ commit จริงตามขอบเขตงานล่าสุดที่ขอเพียงข้อความเสนอ และไม่ stage งานของเอเจนต์อื่น

\`test(receiving): add SSD-only mocked Playwright E2E and accessibility checks\`

ไฟล์สำหรับ review อยู่ e2e/ ทั้งหมด ให้ Claude ตรวจรายงานและรันคำสั่งด้านบนก่อนรวม ไม่มี push/deploy/Production write
`;
  fs.writeFileSync(ssdPath(path.join(out, 'REPORT.md')), body);
}
