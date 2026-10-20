import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIVIDER,
  diffOrderItems,
  formatOrderDate,
  formatOrderMessage,
  formatOrderUpdateMessage
} from '../src/utils/order-notification-format.js';

const order = {
  order_date: '2026-10-08',
  branch_name: 'สาขาผลิตสันกำแพง',
  department_name: 'กับข้าวพนักงาน',
  items: [
    { product_id: 1, product_name: 'เส้นข้าวซอย', quantity: '10.00', unit_abbr: 'กก.', supplier_name: 'ตลาดสด' },
    { product_id: 2, product_name: 'พริกแกงข้าวซอย', quantity: 2, unit_abbr: 'กก.', supplier_name: 'ตลาดสด', notes: 'สั่งนอกรอบ' },
    { product_id: 3, product_name: 'กะทิพร้าวหอม 250 มล.', quantity: 3, unit_abbr: 'pack', supplier_name: 'สโตร์สันกำแพง' }
  ]
};

test('order date stays on the chosen day (Buddhist year, no timezone shift)', () => {
  assert.equal(formatOrderDate('2026-10-08'), '08/10/2569');
  assert.equal(formatOrderDate(null), '-');
});

test('new order is grouped by product group with dividers, bold qty and notes', () => {
  const text = formatOrderMessage({ title: '🟢 สั่งซื้อใหม่', order });
  assert.equal(text, [
    '**🟢 สั่งซื้อใหม่ · สาขาผลิตสันกำแพง / กับข้าวพนักงาน**',
    'วันที่สั่งซื้อ 08/10/2569 · 3 รายการ',
    DIVIDER,
    '**ตลาดสด** (2)',
    '• พริกแกงข้าวซอย **2 กก.**',
    '　📝 สั่งนอกรอบ',
    '• เส้นข้าวซอย **10 กก.**',
    DIVIDER,
    '**สโตร์สันกำแพง** (1)',
    '• กะทิพร้าวหอม 250 มล. **3 pack**'
  ].join('\n'));
});

test('cancelled order uses red squares, strike-through and who deleted it', () => {
  const text = formatOrderMessage({ title: '🔴 ยกเลิกคำสั่งซื้อ', order, cancelled: true, actorName: 'จารุนันท์' });
  assert.match(text, /3 รายการ · ลบโดย จารุนันท์/);
  assert.match(text, /🟥 ~~เส้นข้าวซอย 10 กก\.~~/);
});

test('admin field settings still hide header parts', () => {
  const text = formatOrderMessage({ title: '🟢 สั่งซื้อใหม่', order, fields: ['branch', 'items'] });
  assert.match(text, /^\*\*🟢 สั่งซื้อใหม่ · สาขาผลิตสันกำแพง\*\*\n━/);
  assert.doesNotMatch(text, /วันที่สั่งซื้อ|กับข้าวพนักงาน/);
});

test('update shows only what changed, including notes', () => {
  const after = {
    ...order,
    items: [
      { ...order.items[0], quantity: 15 },
      { product_id: 4, product_name: 'หมูสับ', quantity: 5, unit_abbr: 'กก.', supplier_name: 'ตลาดสด' },
      { ...order.items[2], notes: 'เอายี่ห้อเดิม' }
    ]
  };
  const text = formatOrderUpdateMessage({ title: '🟡 แก้ไขคำสั่งซื้อ', order: after, beforeItems: order.items });
  assert.equal(text, [
    '**🟡 แก้ไขคำสั่งซื้อ · สาขาผลิตสันกำแพง / กับข้าวพนักงาน**',
    'วันที่สั่งซื้อ 08/10/2569 · แก้ 4 รายการ',
    DIVIDER,
    '**ตลาดสด**',
    '🟨 แก้ เส้นข้าวซอย 10 → **15 กก.**',
    '🟩 เพิ่ม หมูสับ **5 กก.**',
    '🟥 ยกเลิก ~~พริกแกงข้าวซอย 2 กก.~~',
    DIVIDER,
    '**สโตร์สันกำแพง**',
    '🟨 แก้หมายเหตุ กะทิพร้าวหอม 250 มล. **3 pack**',
    '　📝 เอายี่ห้อเดิม'
  ].join('\n'));
});

test('update with no change returns null so nothing is sent', () => {
  assert.equal(formatOrderUpdateMessage({ title: 't', order, beforeItems: order.items }), null);
  const { changes, unchanged } = diffOrderItems(order.items, order.items);
  assert.equal(changes.length, 0);
  assert.equal(unchanged.length, 3);
});

test('unchanged items are listed after the changes', () => {
  const after = { ...order, items: [{ ...order.items[0], quantity: 12 }, order.items[1], order.items[2]] };
  const text = formatOrderUpdateMessage({ title: 't', order: after, beforeItems: order.items });
  assert.match(text, /ไม่เปลี่ยน: กะทิพร้าวหอม 250 มล\. 3 pack, พริกแกงข้าวซอย 2 กก\.$/);
});
