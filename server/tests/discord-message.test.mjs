import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDiscordContent, DISCORD_CONTENT_LIMIT } from '../src/utils/discord-message.js';

test('short message is sent as a single part unchanged', () => {
  assert.deepEqual(splitDiscordContent('สั่งซื้อใหม่\n1. หมู 2 กก.'), ['สั่งซื้อใหม่\n1. หมู 2 กก.']);
  assert.deepEqual(splitDiscordContent(''), []);
});

test('long order is split on line boundaries and every part fits Discord limit', () => {
  const lines = ['🟢 สั่งซื้อใหม่', ...Array.from({ length: 200 }, (_, i) => `${i + 1}. สินค้าทดสอบรายการที่ ${i + 1} [กลุ่ม: ผักสด] 10 กก.`)];
  const parts = splitDiscordContent(lines.join('\n'));
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(Array.from(part).length <= 2000);
  assert.match(parts[1], /^\(ต่อ 2\/\d+\)\n/);
  const rejoined = parts.map((p, i) => (i === 0 ? p : p.replace(/^\(ต่อ \d+\/\d+\)\n/, ''))).join('\n');
  assert.equal(rejoined, lines.join('\n'));
});

test('single line longer than the limit is hard-split', () => {
  const parts = splitDiscordContent('ก'.repeat(DISCORD_CONTENT_LIMIT * 2 + 5));
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(Array.from(part).length <= 2000);
});
