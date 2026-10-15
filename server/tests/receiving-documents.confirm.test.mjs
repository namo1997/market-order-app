import test from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test("Two bills receive cumulatively and void independently", async (t) => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  let bill1Id, bill2Id;
  await t.test("First bill adds inventory, skips zero-quantity rows and non-stock products", async () => {
    // 1) ทดสอบ R2-6: บิล 2 ใบส่ง order_item 50 (สั่ง 10 กก.) ทีละส่วน (ใบแรก 6 กก. + ใบที่สอง 4 กก. = 10 กก.)
    // และมี order_item 51 ที่ในใบแรกส่งมา 0 กก. (ต้องข้ามการอัปเดต order_item 51 และเตือน QTY_SHORT)
    const oi51 = h.state.orderItems.find((i) => i.id === 51);
    oi51.received_quantity = 2; // สมมติว่ารับไว้ก่อนแล้ว 2 กก.
    oi51.is_received = false;

    const bill1 = await h.invoke('createDocument', {
      user,
      body: {
        client_uuid: 'cumulative-bill-1',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [50, 51]
      }
    });
    bill1Id = String(bill1.body.data.id);
    const b1Lines = bill1.body.data.lines;

    await h.invoke('updateDocument', {
      user,
      params: { id: bill1Id },
      body: {
        lines: [
          {
            id: b1Lines[0].id,
            line_no: 1,
            bill_text: 'หมูสามชั้น (งวด 1)',
            product_id: 7,
            order_item_id: 50,
            quantity_received: '6',
            unit_price: '150.00'
          },
          {
            id: b1Lines[1].id,
            line_no: 2,
            bill_text: 'ผักกาดขาว (ของยังไม่มา)',
            product_id: 8,
            order_item_id: 51,
            quantity_received: '0',
            unit_price: '40.00'
          },
          {
            line_no: 3,
            bill_text: 'น้ำแข็งบด (ไม่นับสต็อก)',
            product_id: 9,
            order_item_id: null,
            quantity_received: '5',
            unit_price: '20.00'
          }
        ]
      }
    });
    await h.invoke('addSignature', {
      user,
      params: { id: bill1Id },
      body: { role: 'receiver', image_data_url: makePngDataUrl() }
    });
    const confirmBill1 = await h.invoke('confirmDocument', { user, params: { id: bill1Id } });
    assert.equal(confirmBill1.statusCode, 200);

    // ยอดรับของ order_item 50 ต้องเป็น 6 กก. และสต็อกบวก +6 (จาก 5 เป็น 11)
    assert.equal(h.state.orderItems.find((i) => i.id === 50).received_quantity, 6);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
    // บรรทัดที่ qty = 0 (order_item 51) ต้องไม่ล้าง received_quantity เดิม (ยังคงเป็น 2) และมีเตือน QTY_SHORT
    assert.equal(h.state.orderItems.find((i) => i.id === 51).received_quantity, 2);
    assert.ok(confirmBill1.body.data.warnings.some((w) => w.code === 'QTY_SHORT'));
    // สินค้าไม่นับสต็อก (product 9) ต้องไม่ถูกสร้างแถวคลัง
    assert.equal(h.state.inventoryBalances.has('9:10'), false);
  });
  await t.test("Second bill accumulates quantities and inventory on the same order item", async () => {
    // สร้างบิลใบที่ 2 สำหรับ order_item 50 รับเพิ่มอีก 4 กก.
    const bill2 = await h.invoke('createDocument', {
      user,
      body: {
        client_uuid: 'cumulative-bill-2',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [50]
      }
    });
    bill2Id = String(bill2.body.data.id);
    await h.invoke('updateDocument', {
      user,
      params: { id: bill2Id },
      body: {
        lines: [
          {
            id: bill2.body.data.lines[0].id,
            line_no: 1,
            bill_text: 'หมูสามชั้น (งวด 2)',
            product_id: 7,
            order_item_id: 50,
            quantity_received: '4',
            unit_price: '160.00'
          }
        ]
      }
    });
    await h.invoke('addSignature', {
      user,
      params: { id: bill2Id },
      body: { role: 'receiver', image_data_url: makePngDataUrl() }
    });
    const confirmBill2 = await h.invoke('confirmDocument', { user, params: { id: bill2Id } });
    assert.equal(confirmBill2.statusCode, 200);

    // R2-6: ยอดรับสะสมบน order_item 50 ต้องเป็น 6 + 4 = 10 กก. และสต็อกเป็น 11 + 4 = 15 กก.!
    assert.equal(h.state.orderItems.find((i) => i.id === 50).received_quantity, 10);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 15);
  });
  await t.test("Void first bill preserves second bill price and notes; repeat void is rejected", async () => {
    // Void the first bill by delta; the second bill owns price and notes.
    const voidBill1WhileBill2Active = await h.invoke('voidDocument', {
      user,
      params: { id: bill1Id },
      body: { reason: 'พยายามยกเลิกใบแรกก่อน' }
    });
    assert.equal(voidBill1WhileBill2Active.statusCode, 200);
    const afterFirst = h.state.orderItems.find((i) => i.id === 50);
    assert.equal(afterFirst.received_quantity, 4);
    assert.equal(afterFirst.actual_price, 160);
    assert.equal(afterFirst.receive_notes, `รับสินค้าตามเอกสาร #${bill2Id}`);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 9);
    const repeated = await h.invoke('voidDocument', { user, params: { id: bill1Id }, body: { reason: 'ซ้ำ' } });
    assert.equal(repeated.statusCode, 409);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 9);
  });
  await t.test("Void second bill restores original inventory, price and notes", async () => {
    const voidSecond = await h.invoke('voidDocument', { user, params: { id: bill2Id }, body: { reason: 'ย้อนใบสอง' } });
    assert.equal(voidSecond.statusCode, 200);
    assert.equal(Number(h.state.orderItems.find((i) => i.id === 50).received_quantity), 0);
    assert.equal(h.state.orderItems.find((i) => i.id === 50).actual_price, null);
    assert.equal(h.state.orderItems.find((i) => i.id === 50).receive_notes, null);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
  });
});
