import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lbc-pipeline-regression-'));
process.env.CAPTURE_DATA_DIR = scratch;
process.env.CAPTURE_DB_PATH = path.join(scratch, 'line-bill-capture.sqlite');
const db = await import('../src/db.js');
const ai = await import('../src/ai-worker.js');
await db.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
const insert = sql.prepare(`INSERT INTO capture_items (id,line_message_id,source_type,source_id,sender_user_id,category,status,file_sha256,storage_path,storage_relative_path,bill_total_value,slip_amount_value,ai_status,match_status,event_timestamp_ms,raw_event_json,created_at,updated_at) VALUES (?,?,'group',?,'A',?,'downloaded',?,'/tmp/fictional.jpg','fictional.jpg',?,?,?,'unmatched',?,'{}',?,?)`);
let nextId = 1;
const fixture = (group, category, date, amount = 100, status = 'done') => {
  const id = nextId++, stamp = date + 'T12:00:00+07:00';
  insert.run(id, `fictional-${id}`, group, category, `sha-${id}`, category === 'bill' ? amount : null, category === 'transfer' ? amount : null, status, Date.parse(stamp), stamp, stamp);
  return { id, sender_user_id: 'A', event_timestamp_ms: Date.parse(stamp), category, slip_amount_value: category === 'transfer' ? amount : null };
};
const text = (item, value) => ({ id: 900 + item.id, message_type: 'text', sender_user_id: 'A', event_timestamp_ms: item.event_timestamp_ms + 60000, text: value });
const marketVision = { category: 'bill', document_class: 'standard_bill', bill_purpose: 'บิลตลาด 2/10/69', bill_total_value: 11686, raw_text: 'ตลาดสด 2/10/69 รับ 30000 จ่าย 11686 ทอน 18314', summary: 'บิลตลาด', confidence: 0.9 };
const marketText = 'ตลาด 2/10/69\nรับ 30,000\nจ่าย 11,686\nทอน 18,314\nเงินในบัญชีขาดเกิน +7\nโอนเพิ่ม 20,000 รวมของเมื่อวาน';
const analyze = (item, vision, context, provider) => ai.analyzeItem({ item, config: { provider }, ...context, visionAnalyzer: async () => structuredClone(vision) });
let server;
try {
  for (const provider of ['mock', 'openai']) {
    const market = fixture(`market-${provider}`, 'bill', '2026-10-02');
    const result = await analyze(market, marketVision, { nearbyText: [text(market, marketText)] }, provider);
    assert.equal(result.announced_amount, 11679);
    assert.equal(result.market_reconciliation.typedTransferTotal, 20000);
    const stored = await db.applyAiAnalysis({ id: market.id, provider, model: 'fictional-vision', analysis: result });
    assert.equal(stored.bill_total_value, 11686);
    assert.equal(stored.announced_amount, 11679);
    assert.match(stored.ai_summary, /11,679/);
    assert.equal(JSON.parse(stored.ai_result_json).market_reconciliation.balance, 7);
    const slip = fixture(`slip-${provider}`, 'transfer', '2026-10-02', 11679);
    const protectedResult = await analyze(slip, marketVision, {}, provider);
    const protectedStored = await db.applyAiAnalysis({ id: slip.id, provider, analysis: protectedResult });
    assert.equal(protectedStored.category, 'transfer');
    assert.equal(protectedStored.slip_amount_value, 11679);
    assert.equal(protectedStored.bill_total_value, null);
  }
  const vegetable = fixture('context', 'bill', '2026-10-02');
  const vision = { category: 'bill', bill_total_value: 100, raw_text: 'ร้านผัก รวม 100 บาท', summary: 'บิลผัก 100 บาท', doc_ref: 'veg-1' };
  const image = { message_type: 'image', sender_user_id: 'A', capture_item_id: 9999, capture_doc_ref: 'chicken-2', event_timestamp_ms: vegetable.event_timestamp_ms + 30000 };
  const announcement = text(vegetable, 'ค่าไก่ ยอด 500 บาท');
  const unrelated = await analyze(vegetable, vision, { nearbyText: [announcement], imageContext: [image] }, 'mock');
  assert.equal(unrelated.announced_amount, null);
  assert.equal(unrelated.bill_purpose, undefined);
  assert.equal(unrelated.summary, vision.summary);
  const savedVegetable = await db.applyAiAnalysis({ id: vegetable.id, provider: 'mock', analysis: unrelated });
  assert.equal(savedVegetable.context_message_id, null);
  assert.equal(savedVegetable.amount_review_flag, 0);
  const sameDoc = await analyze(vegetable, vision, { conversationContext: [{ ...image, capture_doc_ref: 'veg-1' }, text(vegetable, 'ค่าผัก ยอด 100 บาท')] }, 'mock');
  assert.equal(sameDoc.announced_amount, 100);
  assert.ok(sameDoc._context_link);
  assert.doesNotMatch(sameDoc._context_link.reason, /อยู่ก่อนรูปถัดไป/);
  const explicitBatch = await analyze(vegetable, { ...vision, doc_ref: null }, { conversationContext: [{ ...image, capture_doc_ref: null }, text(vegetable, 'ชุดนี้รวม 2 รูป ค่าผัก ยอด 100 บาท')] }, 'openai');
  assert.equal(explicitBatch.announced_amount, 100);
  const unproven = await analyze(vegetable, vision, { conversationContext: [{ ...image, capture_doc_ref: null }, text(vegetable, 'ยอด 100 บาท')] }, 'mock');
  assert.equal(unproven.announced_amount, null, 'Same amount alone does not identify an image batch');
  const otherSender = await analyze(vegetable, vision, { conversationContext: [{ ...image, capture_doc_ref: 'veg-1', sender_user_id: 'B' }, text(vegetable, 'ยอด 100 บาท')] }, 'mock');
  assert.equal(otherSender.announced_amount, 100, 'Another sender image does not end the bill owner context');
  const unknownDaily = await analyze(vegetable, marketVision, { nearbyText: [text(vegetable, 'ตลาด 2/10/69 จ่าย 11,686 โอนเพิ่ม 20,000 รวมของเมื่อวาน')] }, 'mock');
  assert.equal(unknownDaily.announced_amount, null);
  assert.equal(unknownDaily.needs_review, true);
  assert.equal(ai.scoreSequencePair({ bill: unknownDaily, slip: { category: 'transfer', slip_amount_value: 11686 }, config: {} }), null, 'Unknown daily component cannot fall back to spend for auto matching');
  const shortage = await analyze(vegetable, marketVision, { nearbyText: [text(vegetable, marketText.replace('+7', '-7'))] }, 'mock');
  assert.equal(shortage.announced_amount, 11693);
  const combinedDays = 'ตลาด 8/10/69 จ่าย 13,985 เงินในบัญชีขาดเกิน +1\nตลาด 9/10/69 จ่าย 15,142 เงินในบัญชีขาดเกิน +29\nโอนเพิ่ม 29,097 รวม 2 วัน';
  for (const [day, spend, daily] of [[8,13985,13984],[9,15142,15113]]) {
    const document = fixture('two-days', 'bill', `2026-10-${String(day).padStart(2,'0')}`);
    const vision = { ...marketVision, bill_purpose: `บิลตลาด ${day}/10/69`, raw_text: `ตลาดสด ${day}/10/69 รับ 30000 จ่าย ${spend} ทอน 1000` };
    const result = await analyze(document, vision, { nearbyText: [text(document, combinedDays)] }, 'openai');
    assert.equal(result.announced_amount, daily);
    assert.equal(result.market_reconciliation.combinedAllocationSupported, true);
    assert.equal(result.market_reconciliation.typedTransferTotal, 29097);
    const stored = await db.applyAiAnalysis({ id: document.id, provider: 'openai', analysis: result });
    assert.equal(stored.announced_amount, daily);
  }
  const wrongDate = ai.marketAnnouncementFromText([text(vegetable, marketText.replace('2/10/69', '1/10/69'))], { analysis: marketVision, item: vegetable });
  assert.equal(wrongDate, null);

  // A late text must not jump backward over an unrelated image just because its amount is exact.
  const late = fixture('late', 'bill', '2026-10-02');
  const addMessage = sql.prepare(`INSERT INTO line_messages (line_message_id,message_type,source_type,source_id,sender_user_id,text,status,event_timestamp_ms,raw_event_json,created_at,updated_at) VALUES (?,?,'group',?,'A',?,'active',?,'{}','2026-10-02','2026-10-02')`);
  for (const day of [8,9]) addMessage.run('two-days-chat-' + day, 'text', 'two-days', combinedDays, Date.parse(`2026-10-0${day}T12:01:00+07:00`));
  sql.prepare("UPDATE capture_items SET announced_amount = 29097 WHERE source_id = 'two-days'").run();
  for (const provider of ['mock','openai']) addMessage.run('market-chat-' + provider, 'text', 'market-' + provider, marketText, Date.parse('2026-10-02T12:01:00+07:00'));
  sql.prepare('UPDATE capture_items SET announced_amount = 20000 WHERE source_id = ?').run('market-mock');
  addMessage.run('late-next-image', 'image', 'late', null, late.event_timestamp_ms + 30000);
  addMessage.run('late-text', 'text', 'late', 'ค่าไก่ ยอด 100 บาท', late.event_timestamp_ms + 60000);
  assert.equal(await db.bindRecentBillAnnouncement({ sourceType: 'group', sourceId: 'late', senderUserId: 'A', lineMessageId: 'late-text', text: 'ค่าไก่ ยอด 100 บาท', eventTimestampMs: late.event_timestamp_ms + 60000 }), null);
  const lateBatch = fixture('late-batch', 'bill', '2026-10-02');
  addMessage.run('late-batch-image', 'image', 'late-batch', null, lateBatch.event_timestamp_ms + 30000);
  addMessage.run('late-batch-text', 'text', 'late-batch', 'ชุดนี้รวม 2 รูป ค่าผัก ยอด 100 บาท', lateBatch.event_timestamp_ms + 60000);
  assert.ok(await db.bindRecentBillAnnouncement({ sourceType: 'group', sourceId: 'late-batch', senderUserId: 'A', lineMessageId: 'late-batch-text', text: 'ชุดนี้รวม 2 รูป ค่าผัก ยอด 100 บาท', eventTimestampMs: lateBatch.event_timestamp_ms + 60000 }));
  const images = await db.listAnnouncementImages({ sourceType: 'group', sourceId: 'late', centerMs: late.event_timestamp_ms });
  assert.equal(images.length, 1);

  const crossBill = fixture('cross', 'bill', '2026-09-30');
  const crossSlip = fixture('cross', 'transfer', '2026-10-01');
  await db.setItemMatch({ billItemId: crossBill.id, slipItemId: crossSlip.id, status: 'pending' });
  const b1 = fixture('multi', 'bill', '2026-10-01', 40), b2 = fixture('multi', 'bill', '2026-10-02', 60);
  const s1 = fixture('multi', 'transfer', '2026-10-03', 70), s2 = fixture('multi', 'transfer', '2026-10-04', 30);
  const grouped = await db.setItemMatchGroup({ billItemIds: [b1.id,b2.id], slipItemIds: [s1.id,s2.id], status: 'pending' });
  assert.ok(!grouped.error, JSON.stringify(grouped));
  for (const status of ['pending','processing','failed','paused']) fixture('ai-' + status, 'pending', '2026-10-02', 0, status);
  const fallbackBill = fixture('fallback-bill', 'bill', '2026-09-29'), fallbackSlip = fixture('fallback-slip', 'transfer', '2026-10-05');
  await db.setItemMatch({ billItemId: fallbackBill.id, slipItemId: fallbackSlip.id, status: 'pending' });
  sql.prepare("UPDATE capture_matches SET status = 'manual_review' WHERE bill_item_id = ?").run(crossBill.id);
  sql.prepare("UPDATE capture_items SET match_status = 'manual_review' WHERE id IN (?,?)").run(crossBill.id, crossSlip.id);
  const days = await db.listDays({ start: '2026-09-01', end: '2026-10-31' });
  for (const group of ['cross','multi','fallback-bill']) {
    for (const row of days.filter(r => r.source_id === group)) {
      const matches = await db.listMatches({ sourceId: group, start: row.business_date, end: row.business_date, status: 'pending' });
      const manual = await db.listMatches({ sourceId: group, start: row.business_date, end: row.business_date, status: 'manual_review' });
      const transactions = new Set([...matches, ...manual].map(m => m.match_group_key || m.id)).size;
      assert.equal(row.pending_count, transactions, JSON.stringify(row));
      const closing = await db.closeDay({ businessDate: row.business_date, sourceId: group });
      if (transactions) {
        assert.equal(closing.error, 'day_has_unresolved_items');
        assert.equal(closing.summary.pending_count, transactions);
        assert.equal(closing.summary.unresolved_count, row.unresolved_count);
      } else assert.ok(!closing.error, JSON.stringify(closing));
    }
  }
  const multi = days.find(r => r.source_id === 'multi' && r.business_date === '2026-10-03');
  assert.equal(multi.pending_count, 1);
  assert.equal(multi.pending_document_count, 4);
  const fallback = days.find(r => r.source_id === 'fallback-bill' && r.business_date === '2026-10-05');
  assert.equal(fallback.pending_count, 1, 'Create an anchor row even when no image was uploaded to this group that day');
  assert.equal((await db.listDays({ sourceId: 'cross', start: '2026-10-01', end: '2026-10-01' })).length, 1);
  const html = fs.readFileSync(path.join(root,'public/index.html'), 'utf8');
  const renderer = html.slice(html.indexOf('function renderBoard(){'), html.indexOf('function syncView(){'));
  for (const status of ['pending','processing','failed','paused']) {
    const rows = days.filter(r => r.source_id === 'ai-' + status);
    assert.equal(rows[0].processing_count, 1);
    const closing = await db.closeDay({ businessDate: '2026-10-02', sourceId: 'ai-' + status });
    assert.equal(closing.error, 'day_has_unresolved_items');
    assert.equal(closing.summary.unresolved_count, rows[0].unresolved_count);
    const elements = new Map(), $ = id => { if (!elements.has(id)) elements.set(id,{ innerHTML:'', querySelectorAll:()=>[] }); return elements.get(id); };
    new Function('S','$','calendarBounds','currentBangkokMonth','parseSummary','group','money','esc','shortThaiDate','dayHref','dayKey','gcolor','changeCalendarMonth','openDay','const monthLabel=x=>x;'+renderer+';renderBoard();')({calendarMonth:'2026-10',bSource:'ai-'+status,groups:[{source_id:'ai-'+status}],days:rows}, $, () => ({year:2026,month:10,last:31}),()=> '2026-10',v=>JSON.parse(v||'null'),String,String,String,String,()=>'',d=>d.business_date,()=> '#000',()=>{},()=>{});
    assert.match($('board').innerHTML, /งานค้างทั้งหมด<\/span><strong>1<\/strong>/);
    assert.doesNotMatch($('board').innerHTML, /class="calendar-day-state ready"|<span class="tag ai">พร้อมปิด/);
    assert.match($('board').innerHTML, /รอ AI 1 รูป/);
  }

  // Start the actual HTTP server against this fictional database; no LINE or paid AI access.
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  let output = '';
  server = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { ...process.env, DOTENV_CONFIG_PATH: path.join(scratch, 'no-env'), HOST:'127.0.0.1', PORT:String(port), ADMIN_AUTH_DISABLED:'1', AI_WORKER_ENABLED:'false', AI_PROVIDER:'mock', OPENAI_API_KEY:'', LINE_BILL_CAPTURE_SILENT_MODE:'1', DECISION_REASON_REQUIRED:'0', LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN:'' }, stdio:['ignore','pipe','pipe'] });
  server.stdout.on('data', v => output += v); server.stderr.on('data', v => output += v);
  let response;
  for (let attempt=0; attempt<100; attempt++) {
    try { response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(response?.ok, output);
  const apiRows = await (await fetch(`http://127.0.0.1:${port}/api/admin/days?start=2026-09-01&end=2026-10-31`)).json();
  assert.equal(apiRows.success, true);
  assert.equal(apiRows.data.find(r => r.source_id === 'multi' && r.business_date === '2026-10-03').pending_count, 1);
  assert.equal(apiRows.data.find(r => r.source_id === 'ai-paused').processing_count, 1);
  for (const provider of ['mock','openai']) {
    const persisted = sql.prepare('SELECT announced_amount FROM capture_items WHERE source_id = ?').get('market-' + provider);
    assert.equal(persisted.announced_amount, 11679, 'Restart must preserve daily component');
  }
  assert.deepEqual(sql.prepare("SELECT announced_amount FROM capture_items WHERE source_id = 'two-days' ORDER BY id").all().map(row => row.announced_amount), [13984,15113], 'Startup repair must allocate only evidenced daily components');
  console.log('Pipeline → persistence → DB/API/board/closing regressions passed (fictional data, both provider branches)');
} finally {
  if (server) { const ended = once(server,'exit'); server.kill('SIGTERM'); await ended; }
  sql.close();
  fs.rmSync(scratch,{recursive:true,force:true});
}
