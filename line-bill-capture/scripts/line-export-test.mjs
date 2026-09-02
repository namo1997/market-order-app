import assert from 'node:assert/strict';
import { parseLineChatExport } from '../src/line-export.js';

const messages = parseLineChatExport(`2026.07.27 วันจันทร์
11:23 🧸🦋คาราเมล🦋🧸 รูป
11:24 โซลาว บ้านเจ๊ รับเงินทอน 500 บาท
รายละเอียดบรรทัดถัดไป
11:25 โซลาว บ้านเจ๊ รูป
`);

assert.equal(messages.length, 3);
assert.equal(messages.filter((message) => message.messageType === 'image').length, 2);
assert.equal(messages[0].sender, '🧸🦋คาราเมล🦋🧸');
assert.equal(messages[1].sender, 'โซลาว บ้านเจ๊');
assert.equal(messages[1].text, 'รับเงินทอน 500 บาท\nรายละเอียดบรรทัดถัดไป');
assert.equal(messages[2].sender, 'โซลาว บ้านเจ๊');

console.log('LINE export parser tests passed');
