import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OTHER_SUPPLIER_GROUP_CODES,
  isDiscordWebhookUrl,
  parseGroupCodes,
  pickItemsByGroupIds
} from '../src/utils/other-suppliers-notification.js';

test('default group codes are the five ซัพอื่นๆ groups', () => {
  assert.deepEqual(parseGroupCodes(''), DEFAULT_OTHER_SUPPLIER_GROUP_CODES);
  assert.deepEqual(parseGroupCodes(null), ['SUP004', 'SUP006', 'SUP007', 'SUP008', 'SUP009']);
  assert.deepEqual(parseGroupCodes(' sup004, SUP009 sup004 '), ['SUP004', 'SUP009']);
});

test('only real Discord webhook URLs are accepted', () => {
  assert.equal(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc-DEF_9'), true);
  assert.equal(isDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/123/abc'), true);
  assert.equal(isDiscordWebhookUrl('Smoothie Powder'), false);
  assert.equal(isDiscordWebhookUrl("Expression #1 of ORDER BY clause"), false);
  assert.equal(isDiscordWebhookUrl(''), false);
  assert.equal(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/a'), false);
});

test('picks only items whose product group is in the list', () => {
  const items = [
    { product_name: 'ผักบุ้ง', supplier_id: 2 },
    { product_name: 'ซอสพิเศษ', supplier_id: 8 },
    { product_name: 'กาแฟ', supplier_id: '9' },
    { product_name: 'ไม่มีกลุ่ม', supplier_id: null }
  ];
  assert.deepEqual(pickItemsByGroupIds(items, [8, 9]).map((i) => i.product_name), ['ซอสพิเศษ', 'กาแฟ']);
  assert.deepEqual(pickItemsByGroupIds(items, []), []);
  assert.deepEqual(pickItemsByGroupIds(undefined, [8]), []);
});
