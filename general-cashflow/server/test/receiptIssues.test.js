import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIssue, summarizeIssues } from '../src/domain/receiptIssues.js';

test('an issue stores its amount with the sign of the over/short it explains',()=>{
  const short = validateIssue({ category:'GRAB_NOT_CANCELLED', direction:'SHORT', amount:'412', note:'ลูกค้ายกเลิก Grab แต่ไม่ได้ยกเลิกบิล POS', payment_channel_id:'4' });
  assert.deepEqual(short, { category:'GRAB_NOT_CANCELLED', amount:-412, note:'ลูกค้ายกเลิก Grab แต่ไม่ได้ยกเลิกบิล POS', paymentChannelId:4 });
  assert.equal(validateIssue({ category:'CASH_COUNT', direction:'OVER', amount:'1,000.50', note:'ทอนขาด' }).amount, 1000.5);
  for (const bad of [{ category:'X' }, { category:'OTHER', direction:'UP' }, { category:'OTHER', direction:'SHORT', amount:'0', note:'x' }, { category:'OTHER', direction:'SHORT', amount:'-5', note:'x' }, { category:'OTHER', direction:'SHORT', amount:'5', note:' ' }, { category:'OTHER', direction:'SHORT', amount:'5', note:'x', payment_channel_id:'abc' }]) {
    assert.throws(() => validateIssue(bad));
  }
});

test('issues explain part of the variance and leave the rest unexplained',()=>{
  const issues = [{ amount:'-412.00', status:'OPEN' }, { amount:'-50.00', status:'RESOLVED' }, { amount:'-999', status:'VOID' }];
  assert.deepEqual(summarizeIssues(issues, -510.25), { issue_count:2, open_issue_count:1, issue_explained:-462, variance_unexplained:-48.25 });
  assert.deepEqual(summarizeIssues([], null), { issue_count:0, open_issue_count:0, issue_explained:0, variance_unexplained:null });
});
