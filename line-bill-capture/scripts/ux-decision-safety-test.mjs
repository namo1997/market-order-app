import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
const elements = new Map();
const chips = [0, 1].map(index => ({ dataset: { why: String(index) }, setAttribute() {} }));
const $ = id => {
  if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: false, textContent: '', querySelectorAll: () => chips });
  return elements.get(id);
};
let escape;
const document = { addEventListener: (_event, handler) => { escape = handler; } };
const start = html.indexOf('let whyState=null;');
const end = html.indexOf('// ---- ความคืบหน้า', start);
const reasonUi = new Function('$', 'document', 'WHY_REASONS', 'esc', 'toast', `${html.slice(start, end)};return {askWhy};`)($, document, ['คนละร้าน', 'เลขอ้างอิงต่างกัน'], String, () => {});
const ask = () => {
  const results = [];
  reasonUi.askWhy({ bill: { id: 1 }, slip: { id: 2 }, onDone: (...args) => results.push(args) });
  return results;
};
for (const dismiss of [() => $('why-close').onclick(), () => $('why-bg').onclick({ target: $('why-bg') }), () => escape({ key: 'Escape' })]) {
  const results = ask();
  dismiss();
  assert.deepEqual(results, [[null, false]], 'Dismissal must cancel rather than submit an empty reason');
}
let results = ask();
chips[0].onclick();
assert.equal(results.length, 0, 'Selecting a reason must not commit');
assert.equal($('why-note').value, 'คนละร้าน');
$('why-form').onsubmit({ preventDefault() {} });
assert.deepEqual(results, [['คนละร้าน', false]], 'Ordinary reason does not implicitly teach AI');
results = ask();
$('why-note').value = 'ตรวจจากเลขอ้างอิง'; $('why-teach-ai').checked = true;
$('why-form').onsubmit({ preventDefault() {} });
assert.deepEqual(results, [['ตรวจจากเลขอ้างอิง', true]]);
results = ask();
assert.equal($('why-teach-ai').checked, false, 'Learning resets for the next decision');
$('why-skip').onclick();
assert.deepEqual(results, [['', false]], 'Explicitly labelled submit-without-reason remains distinct from cancel');

// Exercise the real correction handler: dismissal must not issue a mutation.
const updateStart = html.indexOf('update=async function(m,status){');
const updateEnd = html.indexOf('\nasync function unconfirmPair', updateStart);
let mutations = 0;
const runUpdate = new Function('$', 'askWhy', 'pairs', 'api', 'S', 'nextQueueItemId', 'data', 'writeDaySelection', 'offerUndo', 'toast', `let update;${html.slice(updateStart, updateEnd)};return update;`)($, ({ onDone }) => onDone(null, false), () => ({ bill: { id: 1 }, slip: { id: 2 } }), async () => { mutations++; }, {}, () => null, async () => {}, () => {}, () => {}, () => {});
$('pair-review-note').value = '';
await runUpdate({ bill_item_id: 1, slip_item_id: 2 }, 'rejected');
assert.equal(mutations, 0, 'Cancelling rejection must not send any write request');

// Confirmation presents its outcome instead of navigating to another document.
const flowState = { selected: 1 };
let decisionResult;
const confirmUpdate = new Function('$', 'askWhy', 'pairs', 'api', 'S', 'nextQueueItemId', 'data', 'writeDaySelection', 'offerUndo', 'toast', 'renderList', 'showDecisionResult', `let update;${html.slice(updateStart, updateEnd)};return update;`)($, () => {}, () => ({bill:{id:1},slip:{id:2}}), async () => {}, flowState, () => 9, async () => {flowState.selected=9;}, () => {}, () => {}, () => {}, () => {}, result => {decisionResult=result;});
await confirmUpdate({id:1,bill_item_id:1,slip_item_id:2}, 'confirmed');
assert.equal(flowState.selected, null, 'Confirmation must not select another pending decision');
assert.ok(flowState.completedReview, 'Completed result is separate from queued document state');
assert.equal(decisionResult.nextId, 9);
assert.deepEqual(decisionResult.bills.map(row=>row.id), [1]);

// Exercise filtered proposals with an exact hidden alternative.
const autoStart = html.indexOf("$('group-auto-match').onclick=()=>{");
const autoEnd = html.indexOf('\n', autoStart);
let offered = [];
const cards = new Map([[2, { hidden: true }], [3, { hidden: false }]]);
$('drawerlist').querySelector = selector => {
  const id = Number(selector.match(/value="(\d+)"/)?.[1]);
  return { closest: () => cards.get(id), checked: false };
};
new Function('$', 'chosen', 'sumDocs', 'item', 'slips', 'bills', 'findSubset', 'refresh', 'toast', 'money', html.slice(autoStart, autoEnd))($, kind => kind === 'bill' ? [1] : [], rows => rows.reduce((total, row) => total + row.value, 0), id => ({ id, value: 100 }), [{ id: 2 }, { id: 3 }], [], rows => { offered = rows.map(row => row.id); return []; }, () => {}, () => {}, String);
$('group-auto-match').onclick();
assert.deepEqual(offered, [3], 'Exact but hidden candidates must not enter the subset search');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-ux-decision-'));
process.env.CAPTURE_DATA_DIR = dir;
try {
  const db = await import('../src/db.js');
  await db.initDatabase();
  const sql = new DatabaseSync(path.join(dir, 'line-bill-capture.sqlite'));
  const now = new Date().toISOString();
  const insert = sql.prepare(`INSERT INTO capture_items (id,line_message_id,source_type,source_id,category,status,bill_total_value,slip_amount_value,match_status,raw_event_json,created_at,updated_at) VALUES (?,?,'group','Gux',?,'downloaded',?,?,'unmatched','{}',?,?)`);
  for (const [id, category, bill, slip] of [[1,'bill',100,null],[2,'transfer',null,100],[3,'bill',40,null],[4,'bill',60,null],[5,'transfer',null,100]]) insert.run(id, `ux-${id}`, category, bill, slip, now, now);
  const match = await db.setItemMatch({ billItemId: 1, slipItemId: 2, status: 'confirmed', reviewNote: 'ตรวจเลขอ้างอิงแล้ว', aiLearningApproved: true, createdBy: 'ux-test' });
  assert.equal((await db.listAiLearningExamples()).length, 1);
  await db.setItemMatch({ billItemId: 1, slipItemId: 2, status: 'pending', reviewNote: 'ย้อนกลับ', aiLearningApproved: false, createdBy: 'ux-test' });
  assert.equal((await db.listAiLearningExamples()).length, 0, 'Undo must stop using the old learning example');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM ai_learning_examples WHERE match_id=?').get(match.id).n, 1, 'Retain historical evidence');
  await db.setItemMatch({ billItemId: 1, slipItemId: 2, status: 'confirmed', reviewNote: 'หมายเหตุใหม่ ไม่สอน', aiLearningApproved: false, createdBy: 'ux-test' });
  assert.equal((await db.listAiLearningExamples()).length, 0, 'Confirm without teaching must not resurrect stale learning');
  const grouped = await db.setItemMatchGroup({ billItemIds: [3,4], slipItemIds: [5], status: 'pending', reviewNote: 'หมายเหตุชุดรวม', createdBy: 'ux-test' });
  assert.equal(grouped.error, undefined);
  const edges = sql.prepare('SELECT review_note, ai_learning_approved FROM capture_matches WHERE match_group_key=?').all(grouped.match_group_key);
  assert.equal(edges.length, 2);
  assert.ok(edges.every(edge => edge.review_note === 'หมายเหตุชุดรวม' && edge.ai_learning_approved === 0));
  const confirmed = await db.setItemMatchGroup({ billItemIds: [3,4], slipItemIds: [5], status: 'confirmed', reviewNote: 'ตรวจชุดรวมครบแล้ว', createdBy: 'ux-test' });
  assert.ok(sql.prepare('SELECT review_note FROM capture_matches WHERE match_group_key=?').all(confirmed.match_group_key).every(edge => edge.review_note === 'ตรวจชุดรวมครบแล้ว'));
  sql.close();
  console.log('UX decision safety passed: cancel paths, explicit submit/learning, filtered proposals, Undo learning exclusion, group notes.');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
